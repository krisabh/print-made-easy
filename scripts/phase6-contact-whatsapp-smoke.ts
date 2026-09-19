/**
 * Phase 6 — Contact Us visibility + floating WhatsApp support smoke.
 * Run: npx tsx scripts/phase6-contact-whatsapp-smoke.ts
 *
 * Does not send WhatsApp messages. Static + helper checks only.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  getWhatsAppSupportHref,
  SITE,
  WHATSAPP_SUPPORT_HREF,
} from "../lib/marketing";
import { DEFAULT_PRINT_PRICING } from "../lib/pricing-service";
import { PREMIUM_PLAN } from "../lib/billing/plan";

function read(rel: string) {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8").replace(/\r\n/g, "\n");
}

function main() {
  const expectedMessage =
    "Hello PrintYantra Support, I need help with my print shop account.";
  const expectedHref = `https://wa.me/918618089513?text=${encodeURIComponent(expectedMessage)}`;

  // A — authenticated dashboard contains Contact Us
  const shell = read("components/dashboard/shell.tsx");
  assert.match(shell, /Contact Us/);
  assert.match(shell, /href=["']\/contact["']/);
  assert.ok(
    shell.includes('href="/contact"') && shell.includes("font-bold"),
    "Contact Us in dashboard should be bold / prominent",
  );
  console.log("A PASS authenticated dashboard contains Contact Us");

  // B — Contact Us points to /contact
  assert.ok(shell.includes('href="/contact"'));
  assert.ok(shell.includes('{ href: "/contact", label: "Contact Us"'));
  console.log("B PASS Contact Us points to /contact");

  // C — WhatsApp button exists in authenticated dashboard
  assert.match(shell, /WhatsAppFloatingButton/);
  const fab = read("components/marketing/whatsapp-floating-button.tsx");
  assert.match(fab, /getWhatsAppSupportHref/);
  assert.match(fab, /aria-label=\{SITE\.whatsappLabel\}/);
  assert.match(fab, /Chat on WhatsApp/);
  assert.match(fab, /safe-area-inset-bottom/);
  assert.match(fab, /fixed/);
  console.log("C PASS WhatsApp button exists in authenticated dashboard");

  // D — WhatsApp link uses correct India number
  assert.equal(SITE.phone, "8618089513");
  assert.equal(SITE.whatsappE164, "918618089513");
  assert.ok(!SITE.whatsappE164.startsWith("910"));
  assert.ok(!/"\+91\s*0/.test(SITE.whatsappE164));
  assert.equal(getWhatsAppSupportHref(), expectedHref);
  assert.equal(WHATSAPP_SUPPORT_HREF, expectedHref);
  assert.match(expectedHref, /https:\/\/wa\.me\/918618089513\?text=/);
  console.log("D PASS WhatsApp uses +91 8618089513 → wa.me/918618089513");

  // E — prefilled message present and URL-encoded
  assert.equal(SITE.whatsappPrefillMessage, expectedMessage);
  assert.ok(expectedHref.includes(encodeURIComponent(expectedMessage)));
  assert.ok(
    expectedHref.includes(
      "Hello%20PrintYantra%20Support%2C%20I%20need%20help%20with%20my%20print%20shop%20account.",
    ),
  );
  console.log("E PASS prefilled message present and URL-encoded");

  // F — no secrets in WhatsApp URL
  const href = getWhatsAppSupportHref();
  for (const bad of [
    "password",
    "otp",
    "token",
    "Bearer",
    "shopId",
    "agentDevice",
    "credential",
    "payment",
  ]) {
    assert.ok(
      !href.toLowerCase().includes(bad.toLowerCase()),
      `WhatsApp URL must not contain ${bad}`,
    );
  }
  console.log("F PASS no password/token/shop credentials in WhatsApp URL");

  // G — public /contact remains functional
  const contact = read("app/(marketing)/contact/page.tsx");
  assert.match(contact, /Contact Us/);
  assert.match(contact, /SITE\.email/);
  assert.match(contact, /SITE\.phone/);
  assert.match(contact, /WhatsAppIconLink/);
  assert.match(contact, /SITE\.parentCompany/);
  assert.equal(SITE.email, "clauras.ai@gmail.com");
  assert.equal(SITE.phone, "8618089513");
  console.log("G PASS public /contact remains functional");

  // H — /support remains functional
  const support = read("app/(marketing)/support/page.tsx");
  assert.match(support, /Need help\?/);
  assert.match(support, /Contact us or chat with us on WhatsApp/);
  assert.match(support, /href=["']\/contact["']/);
  assert.match(support, /WhatsAppIconLink/);
  console.log("H PASS /support remains functional");

  // I — company identity remains correct
  assert.equal(SITE.name, "PrintYantra");
  assert.equal(SITE.parentCompany, "Clauras");
  assert.equal(SITE.legalName, "Ramyad Enterprises - Abhiram");
  assert.equal(SITE.email, "clauras.ai@gmail.com");
  assert.match(SITE.relationship, /Clauras/);
  console.log("I PASS company identity remains correct (Clauras)");

  // J — customer upload not changed for WhatsApp FAB
  const uploadPage = read("app/upload/[shopCode]/page.tsx");
  assert.ok(
    !uploadPage.includes("WhatsAppFloatingButton"),
    "customer upload must not mount WhatsApp FAB",
  );
  console.log("J PASS no customer upload WhatsApp FAB");

  // K — billing / pricing untouched by this phase
  assert.equal(DEFAULT_PRINT_PRICING.bwSingle, 5);
  assert.equal(PREMIUM_PLAN.amountInr, 199);
  console.log("K PASS pricing defaults unchanged (₹5 / ₹199)");

  // L — Agent / multi-device surfaces not edited in Phase 6 scope (spot-check shell only imports support UI)
  assert.ok(!shell.includes("print-agent-service"));
  assert.ok(shell.includes("AgentStatusBadge"));
  console.log("L PASS dashboard shell Agent badge preserved; no agent service edits via shell");

  // M — mobile-safe positioning via component/code checks
  assert.match(fab, /env\(safe-area-inset-bottom\)/);
  assert.match(fab, /env\(safe-area-inset-right\)/);
  assert.match(fab, /right-4/);
  assert.match(fab, /bottom-4|bottom-5/);
  assert.match(shell, /pb-24|pb-28/);
  console.log("M PASS mobile-safe positioning present in FAB + shell padding");

  console.log("\nPhase 6 contact/WhatsApp smoke: ALL PASS");
}

main();
