import fs from "fs";
import path from "path";

import { loadConfig, updateConfig } from "./config";

export type AgentConnectionStatus = "Connected" | "Disconnected";

export type PendingJob = {
  id: string;
  jobNumber: string;
  copies: number;
  totalPages: number;
  printMode: "BW" | "COLOR";
  printType: "SINGLE" | "DOUBLE";
  /** Optional; null/undefined on legacy jobs. Do not trust shape — parse safely. */
  printSettings?: unknown | null;
  status: string;
  printAttempts: number;
  files: Array<{
    id: string;
    originalFileName: string;
    fileExtension: string;
    fileSize: number;
    totalPages: number;
  }>;
};

let authChain: Promise<void> = Promise.resolve();

function withAuthLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = authChain.then(fn, fn);
  authChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function baseUrl() {
  return loadConfig().apiUrl.replace(/\/$/, "");
}

function authHeaders() {
  const token = loadConfig().authToken;
  if (!token) {
    throw new Error("Agent is not registered. Missing auth token.");
  }
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function parseJson(response: Response) {
  const data = await response.json().catch(() => ({} as Record<string, unknown>));
  if (!response.ok) {
    const message =
      typeof data === "object" &&
      data &&
      typeof (data as { error?: unknown }).error === "string"
        ? (data as { error: string }).error
        : `Request failed (${response.status})`;
    throw new Error(message);
  }
  return data;
}

export type PrinterCapabilityRow = {
  printerName: string;
  colorSupported: boolean;
  isDefault: boolean;
  status: string;
};

export type HeartbeatResult = {
  ok: boolean;
  serverTime: string;
  printers?: PrinterCapabilityRow[];
};

function setupSecretHeaders(): Record<string, string> {
  const secret =
    process.env.AGENT_SETUP_SECRET ||
    process.env.PRINT_AGENT_SECRET ||
    "";
  if (!secret) return {};
  return { "X-Agent-Setup-Secret": secret };
}

export async function registerAgent(input: {
  selectedPrinter?: string | null;
  printerStatus?: string;
}) {
  return withAuthLock(async () => {
    const config = loadConfig();
    const secret =
      process.env.AGENT_SETUP_SECRET ||
      process.env.PRINT_AGENT_SECRET ||
      undefined;

    const response = await fetch(`${baseUrl()}/api/print-agent/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...setupSecretHeaders(),
      },
      body: JSON.stringify({
        shopCode: config.shopCode,
        agentId: config.agentId,
        selectedPrinter: input.selectedPrinter || undefined,
        printerStatus: input.printerStatus || undefined,
        setupSecret: secret,
      }),
    });

    const data = await parseJson(response);
    updateConfig({ authToken: data.token });
    return data as {
      token: string;
      shop: { id: string; shopCode: string; shopName: string };
    };
  });
}

export async function sendHeartbeat(input: {
  selectedPrinter?: string | null;
  printerStatus?: string;
  printers?: Array<{ name: string; status: string }>;
  colorUpdate?: { printerName: string; colorSupported: boolean };
}) {
  return withAuthLock(async () => {
    const response = await fetch(`${baseUrl()}/api/print-agent/heartbeat`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        selectedPrinter: input.selectedPrinter || undefined,
        printerStatus: input.printerStatus || undefined,
        printers: input.printers,
        colorUpdate: input.colorUpdate,
      }),
    });
    return parseJson(response) as Promise<HeartbeatResult>;
  });
}

/**
 * Persist manual Supports Color (server is source of truth).
 * Tries PATCH, then POST, then heartbeat colorUpdate (older hosts / undeployed PATCH route).
 */
export async function setPrinterColorSupported(input: {
  printerName: string;
  colorSupported: boolean;
  printers?: Array<{ name: string; status: string }>;
  selectedPrinter?: string | null;
  printerStatus?: string;
}) {
  return withAuthLock(async () => {
    const body = {
      printerName: input.printerName,
      colorSupported: input.colorSupported,
    };

    const tryMethod = async (method: "PATCH" | "POST") => {
      const response = await fetch(`${baseUrl()}/api/print-agent/printers`, {
        method,
        headers: authHeaders(),
        body: JSON.stringify(body),
      });
      return response;
    };

    let response = await tryMethod("PATCH");
    if (response.status === 404 || response.status === 405) {
      response = await tryMethod("POST");
    }

    if (response.ok) {
      return parseJson(response) as Promise<PrinterCapabilityRow>;
    }

    // Production may not have /printers yet — use heartbeat colorUpdate (deployed with web).
    if (response.status === 404 || response.status === 405) {
      const heartbeat = await fetch(`${baseUrl()}/api/print-agent/heartbeat`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          selectedPrinter: input.selectedPrinter || undefined,
          printerStatus: input.printerStatus || undefined,
          printers: input.printers,
          colorUpdate: {
            printerName: input.printerName,
            colorSupported: input.colorSupported,
          },
        }),
      });
      const data = (await parseJson(heartbeat)) as HeartbeatResult;
      const row = data.printers?.find(
        (printer) => printer.printerName === input.printerName,
      );
      if (!row || row.colorSupported !== input.colorSupported) {
        throw new Error(
          "Color setting was not saved. Deploy the latest PrintMadeEasy web app, then try again.",
        );
      }
      return row;
    }

    return parseJson(response) as Promise<PrinterCapabilityRow>;
  });
}

export async function registerWithPairingToken(input: {
  apiUrl: string;
  pairingToken: string;
  selectedPrinter?: string | null;
  printerStatus?: string;
}) {
  return withAuthLock(async () => {
    const config = loadConfig();
    const apiUrl = input.apiUrl.replace(/\/$/, "");

    let response: Response;
    try {
      response = await fetch(`${apiUrl}/api/print-agent/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          pairingToken: input.pairingToken,
          agentId: config.agentId,
          selectedPrinter: input.selectedPrinter || undefined,
          printerStatus: input.printerStatus || undefined,
        }),
      });
    } catch {
      throw new Error("network");
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || `Request failed (${response.status})`);
    }

    return data as {
      token: string;
      shop: { id: string; shopCode: string; shopName: string };
    };
  });
}

export async function ensureAgentAuthenticated(input: {
  selectedPrinter?: string | null;
  printerStatus?: string;
}) {
  return withAuthLock(async () => {
    const config = loadConfig();
    if (config.authToken) {
      try {
        const response = await fetch(`${baseUrl()}/api/print-agent/heartbeat`, {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({
            selectedPrinter: input.selectedPrinter || undefined,
            printerStatus: input.printerStatus || undefined,
          }),
        });
        await parseJson(response);
        return {
          status: "Connected" as const,
          message: `Connected to ${config.shopCode} at ${config.apiUrl}`,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const isUnauthorized =
          message.toLowerCase().includes("unauthorized") ||
          message.includes("(401)");

        if (isUnauthorized) {
          console.warn("Heartbeat unauthorized, clearing auth token");
          updateConfig({ authToken: null });
        } else {
          console.warn("Heartbeat failed (keeping auth token):", message);
          throw error;
        }
      }
    }

    const latest = loadConfig();
    const secret =
      process.env.AGENT_SETUP_SECRET ||
      process.env.PRINT_AGENT_SECRET ||
      undefined;

    // Legacy .env registration — only when setup secret is configured.
    if (!secret) {
      return {
        status: "Disconnected" as const,
        message: "Not connected. Scan the dashboard QR to connect this Agent.",
      };
    }

    const response = await fetch(`${baseUrl()}/api/print-agent/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...setupSecretHeaders(),
      },
      body: JSON.stringify({
        shopCode: latest.shopCode,
        agentId: latest.agentId,
        selectedPrinter: input.selectedPrinter || undefined,
        printerStatus: input.printerStatus || undefined,
        setupSecret: secret,
      }),
    });
    const data = await parseJson(response);
    updateConfig({ authToken: data.token });

    return {
      status: "Connected" as const,
      message: `Connected to ${latest.shopCode} at ${latest.apiUrl}`,
    };
  });
}

export async function fetchPendingJobs(): Promise<PendingJob[]> {
  const response = await fetch(`${baseUrl()}/api/print-agent/jobs`, {
    method: "GET",
    headers: authHeaders(),
  });
  const data = await parseJson(response);
  return (data.jobs || []) as PendingJob[];
}

export async function claimJob(jobId: string) {
  const response = await fetch(
    `${baseUrl()}/api/print-agent/jobs/${jobId}/status`,
    {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ status: "PRINTING" }),
    },
  );
  return parseJson(response);
}

export async function reportFilePrinted(jobId: string, fileId: string) {
  const response = await fetch(
    `${baseUrl()}/api/print-agent/jobs/${jobId}/status`,
    {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ status: "FILE_PRINTED", fileId }),
    },
  );
  return parseJson(response);
}

export async function reportJobReady(jobId: string) {
  const response = await fetch(
    `${baseUrl()}/api/print-agent/jobs/${jobId}/status`,
    {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ status: "READY_FOR_PICKUP" }),
    },
  );
  return parseJson(response);
}

export async function reportJobFailed(jobId: string, error: string) {
  const response = await fetch(
    `${baseUrl()}/api/print-agent/jobs/${jobId}/status`,
    {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ status: "PENDING", error }),
    },
  );
  return parseJson(response);
}

export async function downloadJobFile(
  jobId: string,
  fileId: string,
  destinationPath: string,
) {
  const token = loadConfig().authToken;
  if (!token) throw new Error("Missing auth token.");

  const response = await fetch(
    `${baseUrl()}/api/print-agent/jobs/${jobId}/file?fileId=${encodeURIComponent(fileId)}`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Download failed (${response.status})`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.writeFileSync(destinationPath, buffer);
  return destinationPath;
}

export async function checkBackendReachable(): Promise<{
  status: AgentConnectionStatus;
  message: string;
}> {
  try {
    const config = loadConfig();
    return await ensureAgentAuthenticated({
      selectedPrinter: config.selectedPrinter,
    });
  } catch (error) {
    return {
      status: "Disconnected",
      message:
        error instanceof Error
          ? error.message
          : `Cannot reach backend at ${loadConfig().apiUrl}`,
    };
  }
}
