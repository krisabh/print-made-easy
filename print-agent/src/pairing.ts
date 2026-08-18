import { loadConfig, updateConfig } from "./config";

export type ParsedPairingUrl = {
  apiUrl: string;
  pairingToken: string;
};

export class PairingError extends Error {
  code:
    | "INVALID"
    | "EXPIRED"
    | "USED"
    | "NETWORK"
    | "UNAUTHORIZED";

  constructor(
    code: PairingError["code"],
    message: string,
  ) {
    super(message);
    this.code = code;
    this.name = "PairingError";
  }
}

function isLocalHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

/**
 * Validate PrintMadeEasy pairing QR / paste URL.
 * Does not log the token.
 */
export function parsePairingUrl(rawInput: string): ParsedPairingUrl {
  const raw = rawInput.trim();
  if (!raw) {
    throw new PairingError("INVALID", "Invalid PrintMadeEasy connection QR.");
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new PairingError("INVALID", "Invalid PrintMadeEasy connection QR.");
  }

  const path = url.pathname.replace(/\/+$/, "") || "/";
  if (path !== "/agent/connect") {
    throw new PairingError("INVALID", "Invalid PrintMadeEasy connection QR.");
  }

  const pairingToken = url.searchParams.get("t")?.trim() || "";
  if (!pairingToken || pairingToken.length < 16) {
    throw new PairingError("INVALID", "Invalid PrintMadeEasy connection QR.");
  }

  const local = isLocalHost(url.hostname);
  if (url.protocol === "https:") {
    // ok
  } else if (url.protocol === "http:" && local) {
    // ok for local/dev
  } else {
    throw new PairingError("INVALID", "Invalid PrintMadeEasy connection QR.");
  }

  const configured = loadConfig().apiUrl;
  let configuredHost: string | null = null;
  try {
    configuredHost = new URL(configured).hostname;
  } catch {
    configuredHost = null;
  }

  // If Agent already targets a real cloud host, require the QR host to match.
  if (
    configuredHost &&
    !isLocalHost(configuredHost) &&
    url.hostname !== configuredHost
  ) {
    throw new PairingError("INVALID", "Invalid PrintMadeEasy connection QR.");
  }

  return {
    apiUrl: url.origin,
    pairingToken,
  };
}

export function mapRegisterError(message: string): PairingError {
  const lower = message.toLowerCase();
  if (lower.includes("expired")) {
    return new PairingError(
      "EXPIRED",
      "Connection code expired. Generate a new QR from your dashboard.",
    );
  }
  if (lower.includes("already used")) {
    return new PairingError(
      "USED",
      "This connection code has already been used.",
    );
  }
  if (
    lower.includes("unauthorized") ||
    lower.includes("invalid pairing") ||
    lower.includes("invalid")
  ) {
    return new PairingError("INVALID", "Invalid PrintMadeEasy connection QR.");
  }
  if (
    lower.includes("fetch") ||
    lower.includes("network") ||
    lower.includes("econn") ||
    lower.includes("enotfound") ||
    lower.includes("failed")
  ) {
    return new PairingError(
      "NETWORK",
      "Unable to connect to PrintMadeEasy. Check your internet connection.",
    );
  }
  return new PairingError(
    "NETWORK",
    "Unable to connect to PrintMadeEasy. Check your internet connection.",
  );
}

/**
 * Shared pairing entry used by paste-URL and QR scan flows.
 */
export async function connectWithPairingUrl(
  rawUrl: string,
  options?: {
    selectedPrinter?: string | null;
    printerStatus?: string;
  },
) {
  const parsed = parsePairingUrl(rawUrl);
  const { registerWithPairingToken } = await import("./api-client.js");

  try {
    const result = await registerWithPairingToken({
      apiUrl: parsed.apiUrl,
      pairingToken: parsed.pairingToken,
      selectedPrinter: options?.selectedPrinter,
      printerStatus: options?.printerStatus,
    });

    updateConfig({
      apiUrl: parsed.apiUrl,
      shopCode: result.shop.shopCode,
      shopName: result.shop.shopName,
      authToken: result.token,
      agentId: loadConfig().agentId,
    });

    // Never return tokens to renderer
    return {
      shopCode: result.shop.shopCode,
      shopName: result.shop.shopName,
      agentId: loadConfig().agentId,
    };
  } catch (error) {
    if (error instanceof PairingError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw mapRegisterError(message);
  }
}
