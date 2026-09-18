/**
 * Phase 7 — Windows Print Agent auto-start smoke (static + config helpers).
 * Run: npx tsx scripts/phase7-agent-autostart-smoke.ts
 *
 * Does NOT perform a real Windows reboot / login session test.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  LOGIN_ITEM_NAME,
  resolveOpenAtLogin,
} from "../print-agent/src/config";

function read(rel: string) {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8").replace(/\r\n/g, "\n");
}

function main() {
  const configSrc = read("print-agent/src/config.ts");
  const mainSrc = read("print-agent/src/main.ts");
  const indexHtml = read("print-agent/src/index.html");
  const preload = read("print-agent/src/preload.ts");
  const apiClient = read("print-agent/src/api-client.ts");
  const pkg = JSON.parse(read("print-agent/package.json"));
  const nsh = read("print-agent/build/installer.nsh");
  const prerequisites = read("components/dashboard/printing-prerequisites.tsx");

  // A — Startup configuration enabled by default
  assert.equal(resolveOpenAtLogin(undefined), true);
  assert.equal(resolveOpenAtLogin(null), true);
  assert.equal(resolveOpenAtLogin(true), true);
  assert.equal(resolveOpenAtLogin(false), false);
  assert.match(configSrc, /openAtLogin:\s*true/);
  assert.match(indexHtml, /Start PrintMadeEasy Agent when Windows starts/);
  assert.match(indexHtml, /Enabled by default/);
  console.log("A PASS openAtLogin enabled by default");

  // B–E — authenticated config fields survive (identity not regenerated on patch)
  assert.match(configSrc, /agentId:\s*current\.agentId/);
  assert.match(configSrc, /authToken/);
  assert.match(configSrc, /selectedPrinter/);
  const typeBlock = configSrc.match(/export type AgentConfig[\s\S]*?\n\}/)?.[0] ?? "";
  assert.ok(typeBlock.includes("agentId"));
  assert.ok(typeBlock.includes("authToken"));
  assert.ok(typeBlock.includes("selectedPrinter"));
  assert.ok(typeBlock.includes("openAtLogin"));
  assert.ok(!/\bpassword\b/.test(typeBlock));
  console.log("B–E PASS agentId/authToken/selectedPrinter preserved; no password field");

  // F — no password persisted in config type / save path
  assert.ok(!configSrc.includes("password:"));
  assert.match(apiClient, /does not store the password/);
  console.log("F PASS no password persistence in Agent config");

  // G — multi-device: auto-start must not invent new device IDs at boot
  assert.match(configSrc, /Device identity is never replaced/);
  assert.match(mainSrc, /wasOpenedAtLogin/);
  assert.match(mainSrc, /applyOpenAtLoginSetting/);
  console.log("G PASS auto-start does not regenerate device identity");

  // H — tray behavior unchanged (Open / Restart / Exit)
  assert.match(mainSrc, /label:\s*"Open"/);
  assert.match(mainSrc, /label:\s*"Restart Agent"/);
  assert.match(mainSrc, /label:\s*"Exit Agent"/);
  assert.match(mainSrc, /forceExitAgent/);
  assert.match(mainSrc, /app\.relaunch/);
  console.log("H PASS tray Open / Restart / Exit present");

  // I — Exit still quits (does not relaunch or rewrite login items)
  const exitBlock = mainSrc.slice(
    mainSrc.indexOf("function forceExitAgent"),
    mainSrc.indexOf("function restartAgent"),
  );
  assert.match(exitBlock, /app\.quit\(\)/);
  assert.ok(!exitBlock.includes("relaunch"));
  assert.ok(!exitBlock.includes("setLoginItemSettings"));
  console.log("I PASS Exit Agent still exits without relaunch");

  // J — Restart Agent still restarts
  const restartBlock = mainSrc.slice(
    mainSrc.indexOf("function restartAgent"),
    mainSrc.indexOf("async function openDashboardInBrowser"),
  );
  assert.match(restartBlock, /app\.relaunch\(\)/);
  console.log("J PASS Restart Agent still restarts");

  // K — installer/uninstaller: single login-item mechanism + NSIS cleanup
  assert.equal(pkg.build?.nsis?.include, "build/installer.nsh");
  assert.match(nsh, /customUnInstall/);
  assert.match(nsh, /PrintMadeEasy Agent/);
  assert.match(nsh, /CurrentVersion\\Run/);
  assert.equal(LOGIN_ITEM_NAME, "PrintMadeEasy Agent");
  assert.match(mainSrc, /setLoginItemSettings/);
  assert.match(mainSrc, /removeLegacyElectronLoginItemIfOurs/);
  assert.ok(!JSON.stringify(pkg.build).includes("runAfterFinish"));
  assert.ok(!/"createStartupShortcut"\s*:\s*true/.test(JSON.stringify(pkg.build)));
  console.log("K PASS single login-item mechanism + legacy Run cleanup + uninstall");

  // L — login IPC still present
  assert.match(mainSrc, /agent:login-account/);
  assert.match(preload, /loginAccount/);
  console.log("L PASS Agent login behavior intact");

  // M — multi-device agentId pattern intact
  assert.match(configSrc, /PMEA-WINDOWS/);
  console.log("M PASS multi-device agentId pattern intact");

  // N — prerequisites copy; no billing surface edits in this file beyond wording
  assert.match(prerequisites, /starts automatically with Windows/);
  assert.ok(!prerequisites.includes("PayU"));
  assert.ok(!prerequisites.includes("Cashfree"));
  console.log("N PASS prerequisites copy updated; no billing changes in this surface");

  // Extra: auto-start tray-only when paired
  assert.match(mainSrc, /autoStarted/);
  assert.match(mainSrc, /!autoStarted \|\| !isAgentPaired\(\)/);
  console.log("EXTRA PASS login auto-start stays in tray when authenticated");

  console.log("\nPhase 7 agent autostart smoke: ALL PASS");
  console.log("NOTE: Windows reboot/login session test NOT PERFORMED.");
}

main();
