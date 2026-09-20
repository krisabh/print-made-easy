const fs = require("fs");
const path = require("path");

const distDir = path.join(__dirname, "..", "dist");
const buildDir = path.join(__dirname, "..", "build");
fs.mkdirSync(distDir, { recursive: true });

const files = ["index.html", "renderer.js"];

for (const file of files) {
  const src = path.join(__dirname, "..", "src", file);
  const dest = path.join(distDir, file);
  fs.copyFileSync(src, dest);
  console.log(`Copied ${file} to dist/`);
}

const iconFiles = ["icon.png", "tray-icon.png", "icon.ico"];
for (const file of iconFiles) {
  const src = path.join(buildDir, file);
  const dest = path.join(distDir, file);
  if (!fs.existsSync(src)) {
    console.warn(`Icon asset missing (skip): ${src}`);
    continue;
  }
  fs.copyFileSync(src, dest);
  console.log(`Copied ${file} to dist/`);
}
