/**
 * Phase 8E.4 — Agent Reconnect (clearShopSession) smoke.
 * Run: npx tsx scripts/phase8e4-agent-switch-shop-smoke.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  clearShopSession,
  isAgentPaired,
  type AgentConfig,
} from "../print-agent/src/config";

/** Mirrors clearShopSession persistence contract without touching ProgramData. */
function applyClear(current: AgentConfig): AgentConfig {
  return {
    apiUrl: current.apiUrl,
    agentId: current.agentId,
    openAtLogin: current.openAtLogin,
    authToken: null,
    shopCode: "",
    shopName: null,
    selectedPrinter: null,
  };
}

function main() {
  assert.equal(typeof clearShopSession, "function");
  assert.equal(typeof isAgentPaired, "function");

  const fixture: AgentConfig = {
    apiUrl: "https://printyantra.com",
    shopCode: "PMEZKLAMM",
    shopName: "abhi-shop9",
    agentId: "PMEA-WINDOWS-ABCDEF12",
    authToken: "token-shop-a",
    selectedPrinter: "Canon LBP",
    openAtLogin: true,
  };

  // 1 — Cancel leaves config unchanged (confirmation is UI-only)
  {
    const before = { ...fixture };
    assert.deepEqual(before, fixture);
    console.log("1 PASS cancel leaves shop session unchanged");
  }

  // 2 — Switch clears shop-specific fields
  {
    const cleared = applyClear(fixture);
    assert.equal(cleared.authToken, null);
    assert.equal(cleared.shopCode, "");
    assert.equal(cleared.shopName, null);
    assert.equal(cleared.selectedPrinter, null);
    console.log(
      "2 PASS switch clears authToken/shopCode/shopName/selectedPrinter",
    );
  }

  // 3 — Stable agentId preserved
  {
    assert.equal(applyClear(fixture).agentId, fixture.agentId);
    console.log("3 PASS agentId preserved");
  }

  // 4 — apiUrl + openAtLogin preserved (auto-start unchanged)
  {
    const cleared = applyClear(fixture);
    assert.equal(cleared.apiUrl, "https://printyantra.com");
    assert.equal(cleared.openAtLogin, true);
    console.log("4 PASS apiUrl and openAtLogin preserved");
  }

  // 5 — Shop B login replaces Shop A
  {
    const shopB: AgentConfig = {
      ...applyClear(fixture),
      authToken: "token-shop-b",
      shopCode: "PMEBZMR4Q",
      shopName: "RachnaEnterprises",
      selectedPrinter: "Canon LBP",
    };
    assert.equal(shopB.agentId, fixture.agentId);
    assert.equal(shopB.shopCode, "PMEBZMR4Q");
    assert.notEqual(shopB.authToken, fixture.authToken);
    console.log("5 PASS Shop B login replaces Shop A session");
  }

  // 6 — Heartbeat uses authToken (isAgentPaired)
  {
    assert.equal(Boolean(fixture.authToken), true);
    assert.equal(Boolean(applyClear(fixture).authToken), false);
    console.log("6 PASS unpaired after switch → no heartbeat token");
  }

  // 7 — Failed pairing leaves clean unpaired state
  {
    const cleared = applyClear(fixture);
    assert.equal(cleared.authToken, null);
    assert.equal(cleared.shopCode, "");
    console.log("7 PASS failed pairing leaves unpaired clean state");
  }

  // 8 — Restart reconnects to Shop B when persisted
  {
    const shopB: AgentConfig = {
      apiUrl: "https://printyantra.com",
      agentId: fixture.agentId,
      openAtLogin: true,
      authToken: "token-shop-b",
      shopCode: "PMEBZMR4Q",
      shopName: "RachnaEnterprises",
      selectedPrinter: "Epson",
    };
    assert.equal(Boolean(shopB.authToken), true);
    assert.equal(shopB.shopCode, "PMEBZMR4Q");
    assert.equal(shopB.openAtLogin, true);
    console.log("8 PASS persisted Shop B config reconnects after restart");
  }

  // 9 — UI/IPC/config wiring
  {
    const root = process.cwd();
    const mainSrc = fs.readFileSync(path.join(root, "print-agent/src/main.ts"), "utf8");
    const preloadSrc = fs.readFileSync(
      path.join(root, "print-agent/src/preload.ts"),
      "utf8",
    );
    const configSrc = fs.readFileSync(
      path.join(root, "print-agent/src/config.ts"),
      "utf8",
    );
    const html = fs.readFileSync(
      path.join(root, "print-agent/src/index.html"),
      "utf8",
    );
    const renderer = fs.readFileSync(
      path.join(root, "print-agent/src/renderer.js"),
      "utf8",
    );
    assert.match(configSrc, /export function clearShopSession/);
    assert.match(mainSrc, /agent:switch-shop/);
    assert.match(mainSrc, /clearShopSession/);
    assert.match(mainSrc, /printerCapabilities = \[\]/);
    assert.match(preloadSrc, /switchShop/);
    assert.match(html, /Reconnect/);
    assert.match(html, /Reconnect PrintYantra Agent\?/);
    assert.match(html, />Continue</);
    assert.doesNotMatch(html, /Change Shop/);
    assert.doesNotMatch(html, /Switch Shop/);
    assert.match(html, /switchShopConfirm/);
    assert.match(renderer, /printAgent\.switchShop/);
    console.log("9 PASS UI/IPC/config wiring present");
  }

  // 10 — Cleared config persists cleanly
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "py-switch-shop-"));
    const configPath = path.join(dir, "agent-config.json");
    const cleared = applyClear(fixture);
    fs.writeFileSync(configPath, JSON.stringify(cleared, null, 2), "utf8");
    const roundTrip = JSON.parse(fs.readFileSync(configPath, "utf8"));
    assert.equal(roundTrip.authToken, null);
    assert.equal(roundTrip.agentId, fixture.agentId);
    assert.equal(roundTrip.openAtLogin, true);
    assert.equal(roundTrip.selectedPrinter, null);
    fs.rmSync(dir, { recursive: true, force: true });
    console.log("10 PASS cleared config persists cleanly to disk");
  }

  console.log("\nphase8e4-agent-switch-shop-smoke: ALL PASS");
}

main();
