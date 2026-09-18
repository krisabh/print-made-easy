import { execFileSync } from "child_process";

import {
  LEGACY_ELECTRON_LOGIN_ITEM_NAME,
  type RunKeyStore,
} from "./login-item-migration";

const HKCU_RUN = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";

/**
 * HKCU\\...\\Run store via `reg.exe` (shell:false).
 * Only used on win32; narrowly scoped to named values we pass in.
 */
export function createWindowsHkcuRunStore(): RunKeyStore {
  return {
    get(name: string): string | undefined {
      try {
        const out = execFileSync(
          "reg.exe",
          ["query", HKCU_RUN, "/v", name],
          { encoding: "utf8", windowsHide: true },
        );
        // REG_SZ line: `    name    REG_SZ    value`
        const lines = out.split(/\r?\n/);
        for (const line of lines) {
          if (!line.toLowerCase().includes("reg_sz")) continue;
          const idx = line.toLowerCase().indexOf("reg_sz");
          const value = line.slice(idx + "reg_sz".length).trim();
          return value || undefined;
        }
        return undefined;
      } catch {
        return undefined;
      }
    },
    set(name: string, value: string): void {
      execFileSync(
        "reg.exe",
        ["add", HKCU_RUN, "/v", name, "/t", "REG_SZ", "/d", value, "/f"],
        { encoding: "utf8", windowsHide: true },
      );
    },
    remove(name: string): void {
      try {
        execFileSync(
          "reg.exe",
          ["delete", HKCU_RUN, "/v", name, "/f"],
          { encoding: "utf8", windowsHide: true },
        );
      } catch {
        // already absent
      }
    },
    listNames(): string[] {
      try {
        const out = execFileSync("reg.exe", ["query", HKCU_RUN], {
          encoding: "utf8",
          windowsHide: true,
        });
        const names: string[] = [];
        for (const line of out.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("HKEY_")) continue;
          if (!/\sREG_(SZ|EXPAND_SZ|DWORD)\s/i.test(trimmed)) continue;
          const name = trimmed.split(/\s{2,}/)[0]?.trim();
          if (name) names.push(name);
        }
        return names.sort();
      } catch {
        return [];
      }
    },
  };
}

export { LEGACY_ELECTRON_LOGIN_ITEM_NAME, HKCU_RUN };
