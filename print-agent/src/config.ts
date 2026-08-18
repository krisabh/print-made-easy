import { randomBytes } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

/** Production API used by packaged Windows installs (no repo .env required). */
const PACKAGED_DEFAULT_API_URL = "https://clauras.com";

const DEVICE_AGENT_ID_RE = /^PMEA-WINDOWS-[0-9A-F]{8}$/i;

/**
 * True when running the installed/packaged Electron binary.
 * Development `electron .` sets process.defaultApp = true.
 */
function isPackagedApp() {
  return (
    typeof process.versions.electron === "string" &&
    process.defaultApp !== true
  );
}

function loadDotEnv() {
  // Packaged installs must not depend on a repository .env file.
  if (isPackagedApp()) return;

  const candidates = [
    path.join(process.cwd(), ".env"),
    path.join(__dirname, "..", ".env"),
  ];

  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue;
    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
    break;
  }
}

loadDotEnv();

export type AgentConfig = {
  apiUrl: string;
  shopCode: string;
  shopName: string | null;
  agentId: string;
  authToken: string | null;
  selectedPrinter: string | null;
  openAtLogin: boolean;
};

const APP_DIR =
  process.platform === "win32"
    ? path.join(process.env.PROGRAMDATA || "C:\\ProgramData", "PrintMadeEasy")
    : path.join(os.homedir(), ".printmadeeasy");

export const CONFIG_PATH = path.join(APP_DIR, "agent-config.json");
export const JOBS_DIR = path.join(APP_DIR, "jobs");

export function createDeviceAgentId() {
  return `PMEA-WINDOWS-${randomBytes(4).toString("hex").toUpperCase()}`;
}

export function isDeviceAgentId(agentId: string) {
  return DEVICE_AGENT_ID_RE.test(agentId.trim());
}

/**
 * Shop-tied IDs such as PME2SRN2X-WINDOWS-01 must not survive re-pairing.
 */
export function isShopDerivedAgentId(
  agentId: string,
  shopCode?: string | null,
) {
  const id = agentId.trim();
  if (!id) return false;
  if (isDeviceAgentId(id)) return false;

  const shop = (shopCode || "").trim();
  if (shop && id.toUpperCase().startsWith(`${shop.toUpperCase()}-`)) {
    return true;
  }

  // Legacy .env pattern: {SHOP_CODE}-WINDOWS-...
  if (/^[A-Z0-9]+-WINDOWS-/i.test(id)) {
    return true;
  }

  return false;
}

export function resolveDeviceAgentId(input: {
  existingAgentId?: string | null;
  shopCode?: string | null;
  envAgentId?: string | null;
  packaged: boolean;
}): { agentId: string; generated: boolean } {
  const existing = (input.existingAgentId || "").trim();
  if (existing && !isShopDerivedAgentId(existing, input.shopCode)) {
    return { agentId: existing, generated: false };
  }

  // Development-only override: used only when no persisted device identity exists.
  if (!input.packaged) {
    const envId = (input.envAgentId || "").trim();
    if (
      envId &&
      !isShopDerivedAgentId(envId, input.shopCode) &&
      !existing
    ) {
      return { agentId: envId, generated: true };
    }
  }

  return { agentId: createDeviceAgentId(), generated: true };
}

function resolveDefaultApiUrl() {
  if (process.env.PRINTMADEEASY_API_URL) return process.env.PRINTMADEEASY_API_URL;
  if (process.env.API_URL) return process.env.API_URL;
  if (isPackagedApp()) return PACKAGED_DEFAULT_API_URL;
  return "http://localhost:3000";
}

function getDefaultConfig(agentId: string): AgentConfig {
  const packaged = isPackagedApp();

  return {
    apiUrl: resolveDefaultApiUrl(),
    shopCode: packaged ? "" : process.env.SHOP_CODE || "",
    shopName: null,
    agentId,
    authToken: null,
    selectedPrinter: null,
    openAtLogin: false,
  };
}

function ensureAppDirs() {
  fs.mkdirSync(APP_DIR, { recursive: true });
  fs.mkdirSync(JOBS_DIR, { recursive: true });
}

function persistIfNeeded(config: AgentConfig, shouldWrite: boolean) {
  if (shouldWrite) {
    saveConfig(config);
  }
}

export function loadConfig(): AgentConfig {
  ensureAppDirs();

  const identityInput = {
    packaged: isPackagedApp(),
    envAgentId: process.env.AGENT_ID || null,
  };

  if (!fs.existsSync(CONFIG_PATH)) {
    const identity = resolveDeviceAgentId({
      ...identityInput,
      existingAgentId: null,
      shopCode: identityInput.packaged ? "" : process.env.SHOP_CODE || "",
    });
    const created = getDefaultConfig(identity.agentId);
    saveConfig(created);
    return { ...created };
  }

  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<AgentConfig>;
    const paired = Boolean(parsed.authToken);
    const identity = resolveDeviceAgentId({
      ...identityInput,
      existingAgentId: parsed.agentId,
      shopCode: parsed.shopCode,
    });

    let config: AgentConfig;

    if (paired) {
      config = {
        ...getDefaultConfig(identity.agentId),
        ...parsed,
        apiUrl: parsed.apiUrl || resolveDefaultApiUrl(),
        shopCode: parsed.shopCode || "",
        shopName: parsed.shopName ?? null,
        agentId: identity.agentId,
        authToken: parsed.authToken ?? null,
        selectedPrinter: parsed.selectedPrinter ?? null,
        openAtLogin: Boolean(parsed.openAtLogin),
      };
    } else if (isPackagedApp()) {
      config = {
        ...getDefaultConfig(identity.agentId),
        ...parsed,
        apiUrl: parsed.apiUrl || resolveDefaultApiUrl(),
        shopCode: parsed.shopCode || "",
        shopName: parsed.shopName ?? null,
        agentId: identity.agentId,
        authToken: null,
        selectedPrinter: parsed.selectedPrinter ?? null,
        openAtLogin: Boolean(parsed.openAtLogin),
      };
    } else {
      config = {
        ...getDefaultConfig(identity.agentId),
        ...parsed,
        apiUrl:
          process.env.PRINTMADEEASY_API_URL ||
          process.env.API_URL ||
          parsed.apiUrl ||
          resolveDefaultApiUrl(),
        shopCode: process.env.SHOP_CODE || parsed.shopCode || "",
        shopName: parsed.shopName ?? null,
        agentId: identity.agentId,
        authToken: null,
        selectedPrinter: parsed.selectedPrinter ?? null,
        openAtLogin: Boolean(parsed.openAtLogin),
      };
    }

    persistIfNeeded(config, identity.generated);
    return config;
  } catch (error) {
    console.error("Failed to read agent config:", error);
    const identity = resolveDeviceAgentId({
      ...identityInput,
      existingAgentId: null,
    });
    const fallback = getDefaultConfig(identity.agentId);
    saveConfig(fallback);
    return fallback;
  }
}

export function saveConfig(config: AgentConfig) {
  ensureAppDirs();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
}

export function updateConfig(patch: Partial<AgentConfig>): AgentConfig {
  const current = loadConfig();
  const next = {
    ...current,
    ...patch,
    // Device identity is never replaced by pairing/shop updates.
    agentId: current.agentId,
  };
  saveConfig(next);
  return next;
}

export function getConfigPaths() {
  return {
    appDir: APP_DIR,
    configPath: CONFIG_PATH,
    jobsDir: JOBS_DIR,
  };
}

export function isAgentPaired() {
  return Boolean(loadConfig().authToken);
}
