/**
 * Phase 8E.2 — Legacy Windows auto-start Run-key migration smoke.
 * Run: npx tsx scripts/phase8e2-legacy-autostart-migration-smoke.ts
 */
import assert from "node:assert/strict";

import { LOGIN_ITEM_NAME } from "../print-agent/src/config";
import {
  LEGACY_ELECTRON_LOGIN_ITEM_NAME,
  LEGACY_PRINTMADEEASY_LOGIN_ITEM_NAME,
  applyOpenAtLoginRunKeys,
  createMemoryRunKeyStore,
  isLegacyPrintMadeEasyAgentRunValue,
  isPrintYantraAgentRunValue,
} from "../print-agent/src/login-item-migration";

const AGENT_EXE =
  "C:\\Program Files\\PrintYantra Agent\\PrintYantra Agent.exe";
const LEGACY_PME_EXE =
  "C:\\Program Files\\PrintMadeEasy Agent\\PrintMadeEasy Agent.exe";

function main() {
  // Helper: ownership check
  assert.equal(
    isPrintYantraAgentRunValue(AGENT_EXE, AGENT_EXE),
    true,
  );
  assert.equal(
    isPrintYantraAgentRunValue(`"${AGENT_EXE}"`, AGENT_EXE),
    true,
  );
  assert.equal(
    isPrintYantraAgentRunValue(
      "C:\\Program Files\\SomeOtherApp\\app.exe",
      AGENT_EXE,
    ),
    false,
  );
  assert.equal(isLegacyPrintMadeEasyAgentRunValue(LEGACY_PME_EXE), true);
  assert.equal(
    isLegacyPrintMadeEasyAgentRunValue(`"${LEGACY_PME_EXE}" --hidden`),
    true,
  );
  assert.equal(
    isLegacyPrintMadeEasyAgentRunValue(AGENT_EXE),
    false,
  );
  console.log("Helper PASS ownership matching");

  // A — Legacy ON migration
  {
    const store = createMemoryRunKeyStore({
      [LEGACY_ELECTRON_LOGIN_ITEM_NAME]: AGENT_EXE,
    });
    applyOpenAtLoginRunKeys({
      openAtLogin: true,
      loginItemName: LOGIN_ITEM_NAME,
      agentExecutablePath: AGENT_EXE,
      store,
    });
    assert.equal(store.get(LEGACY_ELECTRON_LOGIN_ITEM_NAME), undefined);
    assert.equal(store.get(LOGIN_ITEM_NAME), AGENT_EXE);
    assert.deepEqual(store.listNames(), [LOGIN_ITEM_NAME]);
    console.log("A PASS Legacy ON migration");
  }

  // B — Legacy OFF migration
  {
    const store = createMemoryRunKeyStore({
      [LEGACY_ELECTRON_LOGIN_ITEM_NAME]: AGENT_EXE,
      [LOGIN_ITEM_NAME]: AGENT_EXE,
    });
    applyOpenAtLoginRunKeys({
      openAtLogin: false,
      loginItemName: LOGIN_ITEM_NAME,
      agentExecutablePath: AGENT_EXE,
      store,
    });
    assert.equal(store.get(LEGACY_ELECTRON_LOGIN_ITEM_NAME), undefined);
    assert.equal(store.get(LOGIN_ITEM_NAME), undefined);
    assert.deepEqual(store.listNames(), []);
    console.log("B PASS Legacy OFF migration");
  }

  // C — Fresh 1.5.0 ON
  {
    const store = createMemoryRunKeyStore();
    applyOpenAtLoginRunKeys({
      openAtLogin: true,
      loginItemName: LOGIN_ITEM_NAME,
      agentExecutablePath: AGENT_EXE,
      store,
    });
    assert.equal(store.get(LOGIN_ITEM_NAME), AGENT_EXE);
    assert.equal(store.get(LEGACY_ELECTRON_LOGIN_ITEM_NAME), undefined);
    console.log("C PASS Fresh ON");
  }

  // D — Fresh 1.5.0 OFF
  {
    const store = createMemoryRunKeyStore();
    applyOpenAtLoginRunKeys({
      openAtLogin: false,
      loginItemName: LOGIN_ITEM_NAME,
      agentExecutablePath: AGENT_EXE,
      store,
    });
    assert.equal(store.get(LOGIN_ITEM_NAME), undefined);
    assert.equal(store.get(LEGACY_ELECTRON_LOGIN_ITEM_NAME), undefined);
    console.log("D PASS Fresh OFF");
  }

  // E — Idempotency
  {
    const store = createMemoryRunKeyStore({
      [LEGACY_ELECTRON_LOGIN_ITEM_NAME]: AGENT_EXE,
    });
    for (let i = 0; i < 3; i++) {
      applyOpenAtLoginRunKeys({
        openAtLogin: true,
        loginItemName: LOGIN_ITEM_NAME,
        agentExecutablePath: AGENT_EXE,
        store,
      });
    }
    assert.deepEqual(store.listNames(), [LOGIN_ITEM_NAME]);
    assert.equal(store.get(LOGIN_ITEM_NAME), AGENT_EXE);
    console.log("E PASS Idempotency");
  }

  // F — Unrelated Run entry preserved
  {
    const OTHER = "SomeOtherTestApplication";
    const otherPath = "C:\\Program Files\\Other\\Other.exe";
    const store = createMemoryRunKeyStore({
      [LEGACY_ELECTRON_LOGIN_ITEM_NAME]: AGENT_EXE,
      [OTHER]: otherPath,
    });
    applyOpenAtLoginRunKeys({
      openAtLogin: true,
      loginItemName: LOGIN_ITEM_NAME,
      agentExecutablePath: AGENT_EXE,
      store,
    });
    assert.equal(store.get(OTHER), otherPath);
    assert.equal(store.get(LEGACY_ELECTRON_LOGIN_ITEM_NAME), undefined);
    assert.equal(store.get(LOGIN_ITEM_NAME), AGENT_EXE);

    applyOpenAtLoginRunKeys({
      openAtLogin: false,
      loginItemName: LOGIN_ITEM_NAME,
      agentExecutablePath: AGENT_EXE,
      store,
    });
    assert.equal(store.get(OTHER), otherPath);
    assert.deepEqual(store.listNames(), [OTHER]);
    console.log("F PASS Unrelated Run entry preserved");
  }

  // Do not remove legacy if it belongs to a different app
  {
    const store = createMemoryRunKeyStore({
      [LEGACY_ELECTRON_LOGIN_ITEM_NAME]:
        "C:\\Program Files\\UnrelatedElectronApp\\app.exe",
    });
    applyOpenAtLoginRunKeys({
      openAtLogin: true,
      loginItemName: LOGIN_ITEM_NAME,
      agentExecutablePath: AGENT_EXE,
      store,
    });
    assert.equal(
      store.get(LEGACY_ELECTRON_LOGIN_ITEM_NAME),
      "C:\\Program Files\\UnrelatedElectronApp\\app.exe",
    );
    console.log("F2 PASS foreign electron.app.Electron left alone");
  }

  // G — PrintMadeEasy 1.4.0 Run key removed when PrintYantra takes over (ON)
  {
    const store = createMemoryRunKeyStore({
      [LEGACY_PRINTMADEEASY_LOGIN_ITEM_NAME]: LEGACY_PME_EXE,
    });
    applyOpenAtLoginRunKeys({
      openAtLogin: true,
      loginItemName: LOGIN_ITEM_NAME,
      agentExecutablePath: AGENT_EXE,
      store,
    });
    assert.equal(store.get(LEGACY_PRINTMADEEASY_LOGIN_ITEM_NAME), undefined);
    assert.equal(store.get(LOGIN_ITEM_NAME), AGENT_EXE);
    assert.deepEqual(store.listNames(), [LOGIN_ITEM_NAME]);
    console.log("G PASS PrintMadeEasy Run key removed on PrintYantra ON");
  }

  // H — PrintMadeEasy 1.4.0 Run key removed even when PrintYantra openAtLogin=OFF
  {
    const store = createMemoryRunKeyStore({
      [LEGACY_PRINTMADEEASY_LOGIN_ITEM_NAME]: LEGACY_PME_EXE,
      [LOGIN_ITEM_NAME]: AGENT_EXE,
    });
    applyOpenAtLoginRunKeys({
      openAtLogin: false,
      loginItemName: LOGIN_ITEM_NAME,
      agentExecutablePath: AGENT_EXE,
      store,
    });
    assert.equal(store.get(LEGACY_PRINTMADEEASY_LOGIN_ITEM_NAME), undefined);
    assert.equal(store.get(LOGIN_ITEM_NAME), undefined);
    assert.deepEqual(store.listNames(), []);
    console.log("H PASS PrintMadeEasy Run key removed on PrintYantra OFF");
  }

  // I — Dual-install: both legacy electron + PrintMadeEasy cleared
  {
    const store = createMemoryRunKeyStore({
      [LEGACY_ELECTRON_LOGIN_ITEM_NAME]: AGENT_EXE,
      [LEGACY_PRINTMADEEASY_LOGIN_ITEM_NAME]: LEGACY_PME_EXE,
    });
    applyOpenAtLoginRunKeys({
      openAtLogin: true,
      loginItemName: LOGIN_ITEM_NAME,
      agentExecutablePath: AGENT_EXE,
      store,
    });
    assert.deepEqual(store.listNames(), [LOGIN_ITEM_NAME]);
    assert.equal(store.get(LOGIN_ITEM_NAME), AGENT_EXE);
    console.log("I PASS dual-legacy cleanup leaves only PrintYantra");
  }

  console.log("\nPhase 8E.2 legacy auto-start migration smoke: ALL PASS");
}

main();
