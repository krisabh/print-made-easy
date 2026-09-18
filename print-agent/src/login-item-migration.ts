/**
 * Migrate legacy Windows HKCU Run auto-start entries from Agent 1.3.0.
 *
 * 1.3.0 called setLoginItemSettings without `name`, so Electron wrote:
 *   electron.app.Electron
 * 1.4.0 passes LOGIN_ITEM_NAME ("PrintMadeEasy Agent").
 * Without cleanup, upgrades leave both keys (duplicate auto-start) and OFF
 * only removes the named key, leaving the orphan legacy entry.
 */

export const LEGACY_ELECTRON_LOGIN_ITEM_NAME = "electron.app.Electron";

/** Narrow registry facade — real Windows store or in-memory test double. */
export type RunKeyStore = {
  get(name: string): string | undefined;
  set(name: string, value: string): void;
  remove(name: string): void;
  listNames(): string[];
};

export type ApplyOpenAtLoginRunKeysOptions = {
  openAtLogin: boolean;
  /** Current named login item (LOGIN_ITEM_NAME). */
  loginItemName: string;
  /** Absolute path to this Agent executable. */
  agentExecutablePath: string;
  /** Optional override; defaults to LEGACY_ELECTRON_LOGIN_ITEM_NAME. */
  legacyLoginItemName?: string;
  store: RunKeyStore;
};

function normalizeRunValue(value: string): string {
  return value.trim().replace(/^"+|"+$/g, "").toLowerCase();
}

/**
 * True only when a Run value clearly points at this PrintMadeEasy Agent EXE.
 * Unrelated apps named similarly are not matched unless the path is ours.
 */
export function isPrintMadeEasyAgentRunValue(
  runValue: string,
  agentExecutablePath: string,
): boolean {
  if (!runValue || !agentExecutablePath) return false;
  const value = normalizeRunValue(runValue);
  const exe = normalizeRunValue(agentExecutablePath);
  if (!value || !exe) return false;
  if (value === exe || value.startsWith(`${exe} `) || value.startsWith(`${exe}\t`)) {
    return true;
  }
  // Quoted path variants / extra args
  if (value.includes(exe)) return true;
  // Path-normalized: accept only our well-known executable filename under PrintMadeEasy
  if (
    /printmadeeasy agent\.exe(?:\s|$)/i.test(value) &&
    /printmadeeasy/i.test(value)
  ) {
    return true;
  }
  return false;
}

/**
 * Apply desired openAtLogin Run-key state for tests / Windows store.
 * Callers that use Electron should still call setLoginItemSettings first;
 * this synchronizes the named key in the injectable store and always removes
 * a legacy electron.app.Electron entry that belongs to this Agent.
 */
export function applyOpenAtLoginRunKeys(
  options: ApplyOpenAtLoginRunKeysOptions,
): void {
  const {
    openAtLogin,
    loginItemName,
    agentExecutablePath,
    store,
  } = options;
  const legacyName =
    options.legacyLoginItemName ?? LEGACY_ELECTRON_LOGIN_ITEM_NAME;

  if (openAtLogin) {
    store.set(loginItemName, agentExecutablePath);
  } else {
    store.remove(loginItemName);
  }

  removeLegacyElectronLoginItemIfOurs({
    store,
    legacyLoginItemName: legacyName,
    agentExecutablePath,
  });
}

export function removeLegacyElectronLoginItemIfOurs(options: {
  store: RunKeyStore;
  agentExecutablePath: string;
  legacyLoginItemName?: string;
}): boolean {
  const legacyName =
    options.legacyLoginItemName ?? LEGACY_ELECTRON_LOGIN_ITEM_NAME;
  const current = options.store.get(legacyName);
  if (current == null || current === "") return false;
  if (!isPrintMadeEasyAgentRunValue(current, options.agentExecutablePath)) {
    return false;
  }
  options.store.remove(legacyName);
  return true;
}

/** In-memory Run key store for unit/smoke tests. */
export function createMemoryRunKeyStore(
  initial: Record<string, string> = {},
): RunKeyStore {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    get(name) {
      return map.has(name) ? map.get(name) : undefined;
    },
    set(name, value) {
      map.set(name, value);
    },
    remove(name) {
      map.delete(name);
    },
    listNames() {
      return Array.from(map.keys()).sort();
    },
  };
}
