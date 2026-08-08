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
