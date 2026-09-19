/**
 * Migrate legacy Windows HKCU Run auto-start entries.
 *
 * 1.3.0 called setLoginItemSettings without `name`, so Electron wrote:
 *   electron.app.Electron
 * 1.4.0 used LOGIN_ITEM_NAME "PrintMadeEasy Agent".
 * 1.5.0 passes LOGIN_ITEM_NAME ("PrintYantra Agent").
 * Without cleanup, upgrades leave both keys (duplicate auto-start) and OFF
 * only removes the named key, leaving the orphan legacy entry.
 */

export const LEGACY_ELECTRON_LOGIN_ITEM_NAME = "electron.app.Electron";

/** Pre-1.5.0 product Run-key name (PrintMadeEasy Agent 1.4.0). */
export const LEGACY_PRINTMADEEASY_LOGIN_ITEM_NAME = "PrintMadeEasy Agent";

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
  // Strip all quotes so `"C:\...\App.exe" --flag` matches path + args forms.
  return value.trim().replace(/"/g, "").toLowerCase();
}

/**
 * True only when a Run value clearly points at this Agent EXE
 * (executableName is "PrintYantra Agent").
 * Unrelated apps named similarly are not matched unless the path is ours.
 */
export function isPrintYantraAgentRunValue(
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
  // Path-normalized: accept only our well-known executable filename under PrintYantra
  if (
    /printyantra agent\.exe(?:\s|$)/i.test(value) &&
    /printyantra/i.test(value)
  ) {
    return true;
  }
  return false;
}

/**
 * True when a Run value clearly belongs to the retired PrintMadeEasy Agent product.
 * Used to stop 1.4.0 auto-start after PrintYantra 1.5.0 takes over.
 */
export function isLegacyPrintMadeEasyAgentRunValue(runValue: string): boolean {
  if (!runValue) return false;
  const value = normalizeRunValue(runValue);
  if (!value) return false;
  return (
    /printmadeeasy agent\.exe(?:\s|$)/i.test(value) &&
    /printmadeeasy/i.test(value)
  );
}

/**
 * Apply desired openAtLogin Run-key state for tests / Windows store.
 * Callers that use Electron should still call setLoginItemSettings first;
 * this synchronizes the named key in the injectable store and always removes
 * legacy electron.app.Electron / PrintMadeEasy Agent entries that belong to
 * this product line.
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
  removeLegacyPrintMadeEasyLoginItemIfPresent({ store });
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
  if (!isPrintYantraAgentRunValue(current, options.agentExecutablePath)) {
    return false;
  }
  options.store.remove(legacyName);
  return true;
}

/**
 * Remove the retired PrintMadeEasy Agent Run key when present.
 * Always safe for PrintYantra 1.5.0 takeover: only deletes the well-known
 * product name when the value points at PrintMadeEasy Agent.exe.
 */
export function removeLegacyPrintMadeEasyLoginItemIfPresent(options: {
  store: RunKeyStore;
}): boolean {
  const current = options.store.get(LEGACY_PRINTMADEEASY_LOGIN_ITEM_NAME);
  if (current == null || current === "") return false;
  if (!isLegacyPrintMadeEasyAgentRunValue(current)) {
    return false;
  }
  options.store.remove(LEGACY_PRINTMADEEASY_LOGIN_ITEM_NAME);
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
