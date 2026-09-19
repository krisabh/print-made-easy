/**
 * PrintYantra 1.5.0 — legacy PrintMadeEasy ProgramData config migration smoke.
 * Run: npx tsx scripts/phase8e3b-legacy-config-migration-smoke.ts
 */
import assert from "node:assert/strict";

import {
  remapLegacyProductionApiUrl,
  tryMigrateLegacyAgentConfig,
} from "../print-agent/src/config";

function main() {
  assert.equal(
    remapLegacyProductionApiUrl("https://clauras.com"),
    "https://printyantra.com",
  );
  assert.equal(
    remapLegacyProductionApiUrl("https://clauras.com/"),
    "https://printyantra.com",
  );
  assert.equal(
    remapLegacyProductionApiUrl("https://printyantra.com"),
    "https://printyantra.com",
  );
  assert.equal(
    remapLegacyProductionApiUrl("http://localhost:3000"),
    "http://localhost:3000",
  );
  console.log("A PASS apiUrl remap only for known Clauras production hosts");

  const files = new Map<string, string>();
  const legacyPath = "C:/ProgramData/PrintMadeEasy/agent-config.json";
  const targetPath = "C:/ProgramData/PrintYantra/agent-config.json";

  files.set(
    legacyPath,
    JSON.stringify(
      {
        apiUrl: "https://clauras.com",
        shopCode: "PME001",
        shopName: "Demo Shop",
        agentId: "PMEA-WINDOWS-ABCDEF12",
        authToken: "paired-token-abc",
        selectedPrinter: "Canon LBP",
        openAtLogin: true,
      },
      null,
      2,
    ),
  );

  const migrated = tryMigrateLegacyAgentConfig({
    legacyConfigPath: legacyPath,
    targetConfigPath: targetPath,
    exists: (p) => files.has(p),
    readFile: (p) => {
      const v = files.get(p);
      if (v == null) throw new Error(`missing ${p}`);
      return v;
    },
    writeFile: (p, data) => {
      files.set(p, data);
    },
    ensureDirs: () => {},
  });
  assert.equal(migrated, true);
  assert.ok(files.has(targetPath));
  const parsed = JSON.parse(files.get(targetPath)!);
  assert.equal(parsed.apiUrl, "https://printyantra.com");
  assert.equal(parsed.shopCode, "PME001");
  assert.equal(parsed.authToken, "paired-token-abc");
  assert.equal(parsed.agentId, "PMEA-WINDOWS-ABCDEF12");
  assert.equal(parsed.selectedPrinter, "Canon LBP");
  assert.equal(parsed.openAtLogin, true);
  console.log("B PASS migrates paired PrintMadeEasy config into PrintYantra path");

  const second = tryMigrateLegacyAgentConfig({
    legacyConfigPath: legacyPath,
    targetConfigPath: targetPath,
    exists: (p) => files.has(p),
    readFile: (p) => files.get(p)!,
    writeFile: (p, data) => {
      files.set(p, data);
    },
    ensureDirs: () => {},
  });
  assert.equal(second, false);
  console.log("C PASS does not overwrite existing PrintYantra config");

  const empty = new Map<string, string>();
  const none = tryMigrateLegacyAgentConfig({
    legacyConfigPath: legacyPath,
    targetConfigPath: targetPath,
    exists: (p) => empty.has(p),
    readFile: () => {
      throw new Error("should not read");
    },
    writeFile: () => {
      throw new Error("should not write");
    },
    ensureDirs: () => {},
  });
  assert.equal(none, false);
  console.log("D PASS no-op when legacy config absent");

  console.log("\nphase8e3b-legacy-config-migration-smoke: ALL PASS");
}

main();
