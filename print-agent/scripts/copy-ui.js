const fs = require("fs");
const path = require("path");

const distDir = path.join(__dirname, "..", "dist");
fs.mkdirSync(distDir, { recursive: true });

const files = ["index.html", "renderer.js"];

for (const file of files) {
  const src = path.join(__dirname, "..", "src", file);
  const dest = path.join(distDir, file);
  fs.copyFileSync(src, dest);
  console.log(`Copied ${file} to dist/`);
}

const jsqrSrc = path.join(__dirname, "..", "node_modules", "jsqr", "dist", "jsQR.js");
const jsqrAlt = path.join(__dirname, "..", "node_modules", "jsqr", "jsQR.js");
const jsqrDest = path.join(distDir, "jsQR.js");
if (fs.existsSync(jsqrSrc)) {
  fs.copyFileSync(jsqrSrc, jsqrDest);
  console.log("Copied jsQR.js to dist/");
} else if (fs.existsSync(jsqrAlt)) {
  fs.copyFileSync(jsqrAlt, jsqrDest);
  console.log("Copied jsQR.js to dist/");
} else {
  console.warn(
    "jsQR.js not found — QR scanning will not work until dependency is installed.",
  );
}
