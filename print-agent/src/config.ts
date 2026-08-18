import { randomBytes } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";

function loadDotEnv() {
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

function createStableAgentId() {
  const host = (os.hostname() || "windows")
    .replace(/[^A-Za-z0-9_-]/g, "")
    .slice(0, 24);
  return `WIN-${host || "PC"}-${randomBytes(3).toString("hex")}`.slice(0, 128);
}

function getDefaultConfig(): AgentConfig {
  return {
    apiUrl:
      process.env.PRINTMADEEASY_API_URL ||
      process.env.API_URL ||
      "http://localhost:3000",
    shopCode: process.env.SHOP_CODE || "PME001",
    shopName: null,
    agentId: process.env.AGENT_ID || createStableAgentId(),
    authToken: null,
    selectedPrinter: null,
    openAtLogin: false,
  };
}

function ensureAppDirs() {
  fs.mkdirSync(APP_DIR, { recursive: true });
  fs.mkdirSync(JOBS_DIR, { recursive: true });
}

export function loadConfig(): AgentConfig {
  ensureAppDirs();
  const defaults = getDefaultConfig();

  if (!fs.existsSync(CONFIG_PATH)) {
    saveConfig(defaults);
    return { ...defaults };
  }

  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<AgentConfig>;
    const paired = Boolean(parsed.authToken);

    // Once paired, persisted JSON wins over .env SHOP_CODE / AGENT_ID so local
    // leftovers like PME001 cannot hijack the Agent.
    if (paired) {
      return {
        ...defaults,
        ...parsed,
        apiUrl: parsed.apiUrl || defaults.apiUrl,
        shopCode: parsed.shopCode || defaults.shopCode,
        shopName: parsed.shopName ?? null,
        agentId: parsed.agentId || defaults.agentId,
        authToken: parsed.authToken ?? null,
        selectedPrinter: parsed.selectedPrinter ?? null,
        openAtLogin: Boolean(parsed.openAtLogin),
      };
    }

    return {
      ...defaults,
      ...parsed,
      apiUrl:
        process.env.PRINTMADEEASY_API_URL ||
        process.env.API_URL ||
        parsed.apiUrl ||
        defaults.apiUrl,
      shopCode: process.env.SHOP_CODE || parsed.shopCode || defaults.shopCode,
      shopName: parsed.shopName ?? null,
      agentId: process.env.AGENT_ID || parsed.agentId || defaults.agentId,
      authToken: null,
    };
  } catch (error) {
    console.error("Failed to read agent config:", error);
    return { ...defaults };
  }
}

export function saveConfig(config: AgentConfig) {
  ensureAppDirs();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
}

export function updateConfig(patch: Partial<AgentConfig>): AgentConfig {
  const next = {
    ...loadConfig(),
    ...patch,
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
