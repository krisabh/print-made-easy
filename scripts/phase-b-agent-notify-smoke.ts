/**
 * Phase B — Agent update notice, What's New, and support actions.
 * Run: npx tsx scripts/phase-b-agent-notify-smoke.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { SITE } from "../lib/marketing";
import { getPublicAgentUpdateManifest } from "../lib/agent-release";
import {
  AGENT_SUPPORT_EMAIL,
  AGENT_SUPPORT_EMAIL_HREF,
  AGENT_WHATSAPP_E164,
  AGENT_WHATSAPP_MESSAGE,
  AGENT_WHATSAPP_SUPPORT_HREF,
} from "../print-agent/src/support-links";

const root = process.cwd();

function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function main() {
  const manifest = getPublicAgentUpdateManifest("");
  assert.equal(manifest.version, "1.7.0");
  assert.ok(manifest.releaseNotes.length >= 3);
  assert.equal(manifest.notes, manifest.releaseNotes.join("\n"));
  assert.equal(manifest.sha256, null);
  console.log("1 PASS release metadata includes ordered notes; SHA still env-only");

  const renderer = read("print-agent/src/renderer.js");
  const html = read("print-agent/src/index.html");
  const mainSrc = read("print-agent/src/main.ts");
  const preload = read("print-agent/src/preload.ts");

  assert.match(renderer, /What's New in PrintYantra Agent \$\{version\}/);
  assert.equal(renderer.includes("1.7.0"), false);
  assert.equal(renderer.includes("1.8.0"), false);
  assert.match(renderer, /New update available/);
  assert.match(renderer, /Update details are currently unavailable/);
  assert.match(renderer, /releaseNotes/);
  assert.match(html, /What's New/);
  assert.match(html, /Update Now/);
  assert.match(html, /Later/);
  assert.match(html, /Need Help\?/);
  assert.match(html, /Contact Support/);
  assert.match(html, /WhatsApp Support/);
  console.log("2 PASS What's New uses the server version, not a hardcoded release");

  assert.equal(AGENT_SUPPORT_EMAIL, SITE.email);
  assert.equal(AGENT_SUPPORT_EMAIL, "support@printyantra.com");
  assert.equal(AGENT_SUPPORT_EMAIL_HREF, "mailto:support@printyantra.com");
  assert.equal(AGENT_WHATSAPP_E164, SITE.whatsappE164);
  assert.equal(AGENT_WHATSAPP_E164, "918618089513");
  assert.equal(
    AGENT_WHATSAPP_MESSAGE,
    "Hello PrintYantra Support, I need help with my PrintYantra Agent.",
  );
  assert.equal(
    AGENT_WHATSAPP_SUPPORT_HREF,
    `https://wa.me/918618089513?text=${encodeURIComponent(AGENT_WHATSAPP_MESSAGE)}`,
  );
  assert.match(mainSrc, /AGENT_SUPPORT_EMAIL_HREF/);
  assert.match(mainSrc, /AGENT_WHATSAPP_SUPPORT_HREF/);
  assert.match(mainSrc, /agent:open-support-email/);
  assert.match(mainSrc, /agent:open-whatsapp-support/);
  assert.equal(mainSrc.includes("openExternal(url"), false);
  assert.match(preload, /openSupportEmail/);
  assert.match(preload, /openWhatsAppSupport/);
  assert.match(renderer, /openSupportEmail/);
  assert.match(renderer, /openWhatsAppSupport/);
  console.log("3 PASS support email and WhatsApp use the existing public contacts");

  assert.match(mainSrc, /startUpdateCheckLoops|UPDATE_CHECK_INTERVAL_MS/);
  assert.match(mainSrc, /manual: false/);
  assert.match(renderer, /startUpdate\(\)/);
  const autoBlock = mainSrc.slice(
    mainSrc.indexOf("function startUpdateCheckLoops"),
    mainSrc.indexOf("function forceExitAgent"),
  );
  assert.equal(autoBlock.includes("startUpdate("), false);
  assert.equal(autoBlock.includes("spawn"), false);
  console.log("4 PASS automatic check does not install");

  console.log("\nPhase B agent notify smoke: ALL PASS");
}

main();
