/**
 * Smoke: QR branding + Agent PY center icon + navbar asset checks.
 * Run: npx tsx scripts/qr-brand-smoke.ts
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { readFile } from "node:fs/promises";
import QRCode from "qrcode";
import sharp from "sharp";

const require = createRequire(import.meta.url);
const jsQR = require("jsqr") as (
  data: Uint8ClampedArray,
  width: number,
  height: number,
) => { data: string } | null;

async function sha256File(filePath: string) {
  const buf = await readFile(filePath);
  return createHash("sha256").update(buf).digest("hex");
}

async function buildBrandedQrPng(uploadUrl: string, size = 640) {
  const qrPng = await QRCode.toBuffer(uploadUrl, {
    errorCorrectionLevel: "H",
    margin: 3,
    width: size,
    type: "png",
    color: { dark: "#0f172a", light: "#ffffff" },
  });

  const iconPath = path.join(
    process.cwd(),
    "public",
    "brand",
    "printyantra-qr-icon.png",
  );
  const iconBuf = await readFile(iconPath);

  const logoSize = Math.round(size * 0.2);
  const pad = Math.round(logoSize * 0.22);
  const box = logoSize + pad * 2;
  const left = Math.round((size - box) / 2);
  const top = Math.round((size - box) / 2);

  const whitePad = await sharp({
    create: {
      width: box,
      height: box,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .png()
    .toBuffer();

  const logo = await sharp(iconBuf)
    .resize(logoSize, logoSize, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  return sharp(qrPng)
    .composite([
      { input: whitePad, left, top },
      { input: logo, left: left + pad, top: top + pad },
    ])
    .png()
    .toBuffer();
}

async function main() {
  const root = process.cwd();
  const agentIcon = path.join(root, "print-agent", "build", "icon.png");
  const qrIcon = path.join(root, "public", "brand", "printyantra-qr-icon.png");
  const navbarLogo = path.join(
    root,
    "public",
    "brand",
    "printyantra-navbar-logo.png",
  );
  const qrCardSrc = path.join(root, "components", "dashboard", "qr-card.tsx");

  // 1–3 assets
  const agentSha = await sha256File(agentIcon);
  const qrSha = await sha256File(qrIcon);
  assert.equal(agentSha, qrSha, "QR center icon must match Agent 1.5.2 icon.png");
  console.log("1 PASS QR icon byte-identical to Agent print-agent/build/icon.png");

  const navbarMeta = await sharp(navbarLogo).metadata();
  assert.ok(navbarMeta.width && navbarMeta.height, "Navbar logo exists");
  const navbarCorner = await sharp(navbarLogo)
    .extract({ left: 0, top: 0, width: 1, height: 1 })
    .ensureAlpha()
    .raw()
    .toBuffer();
  assert.equal(navbarCorner[3], 0, "Navbar logo corner must be transparent");
  console.log(
    `2 PASS navbar logo exists (${navbarMeta.width}x${navbarMeta.height}) with transparent corner`,
  );

  // 4 payload
  const uploadUrl = "https://printyantra.com/upload/PME001";
  const png = await buildBrandedQrPng(uploadUrl, 640);
  const { data, info } = await sharp(png)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const code = jsQR(
    new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
    info.width,
    info.height,
  );
  assert.ok(code, "Branded QR should decode");
  assert.equal(code.data, uploadUrl);
  assert.match(code.data, /^https:\/\/printyantra\.com\/upload\//);
  console.log("3 PASS QR payload unchanged and scannable:", code.data);

  // 5–7 branding strings in QR source
  const qrSrc = await readFile(qrCardSrc, "utf8");
  for (const bad of [
    "PrintMadeEasy",
    "printmadeeasy",
    "PRINTMADEEASY",
    "clauras.com",
    "Print Made Easy",
  ]) {
    assert.equal(
      qrSrc.toLowerCase().includes(bad.toLowerCase()),
      false,
      `QR card must not contain ${bad}`,
    );
  }
  assert.match(qrSrc, /PrintYantra/);
  assert.match(qrSrc, /NOT A PAYMENT QR/);
  assert.match(qrSrc, /text-red-600/);
  assert.match(qrSrc, /errorCorrectionLevel:\s*"H"/);
  assert.match(qrSrc, /printyantra-qr-icon\.png/);
  assert.equal(qrSrc.includes("printyantra-navbar-logo.png"), false);
  assert.match(
    qrSrc,
    /export const QR_PRODUCT_NAME = "PrintYantra"/,
    "QR_PRODUCT_NAME must be the PrintYantra string literal",
  );
  assert.match(qrSrc, /https:\/\/printyantra\.com/);
  // No center-of-modules overlay compositing anymore.
  assert.equal(
    /logoSize = Math\.round\(size \* 0\.2\)/.test(qrSrc),
    false,
    "QR must not draw a center logo inside modules",
  );
  console.log("4 PASS QR source has PrintYantra + NOT A PAYMENT QR; no PrintMadeEasy");
  console.log("5 PASS QR errorCorrectionLevel H; PY icon + site URL at top-left (not in modules)");

  console.log("\nqr-brand-smoke: ALL PASS");
}

main().catch((error) => {
  console.error("qr-brand-smoke: FAIL");
  console.error(error);
  process.exit(1);
});
