/**
 * Smoke: clean QR (no center overlay) remains scannable.
 * Run: npx tsx scripts/qr-brand-smoke.ts
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import QRCode from "qrcode";
import sharp from "sharp";

const require = createRequire(import.meta.url);
const jsQR = require("jsqr") as (
  data: Uint8ClampedArray,
  width: number,
  height: number,
) => { data: string } | null;

async function main() {
  const uploadUrl = "https://clauras.com/upload/PME001";
  const size = 640;
  const png = await QRCode.toBuffer(uploadUrl, {
    errorCorrectionLevel: "H",
    margin: 3,
    width: size,
    type: "png",
    color: { dark: "#0f172a", light: "#ffffff" },
  });

  const { data, info } = await sharp(png)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const code = jsQR(
    new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
    info.width,
    info.height,
  );

  assert.ok(code, "Clean QR should decode");
  assert.equal(code.data, uploadUrl, "Decoded URL must match upload URL");
  console.log("qr-brand-smoke: PASS — clean QR scannable");
  console.log(`decoded: ${code.data}`);
}

main().catch((error) => {
  console.error("qr-brand-smoke: FAIL");
  console.error(error);
  process.exit(1);
});
