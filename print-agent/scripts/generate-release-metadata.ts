/**
 * After `npm run dist`, hash the installer and emit release metadata + Hostinger env lines.
 *
 * Run from print-agent/:
 *   npm run release:hash
 *
 * Never modifies .env or production Hostinger. Never uploads.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const PRODUCT_NAME = "PrintYantra Agent";
const HOSTINGER_FILE_PATH_TEMPLATE =
  "/home/USER/domains/printyantra.com/agent-files";

function fail(message: string): never {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function sha256HexOfFileSync(filePath: string): string {
  const hash = createHash("sha256");
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(1024 * 1024);
    let bytesRead: number;
    while ((bytesRead = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      hash.update(buf.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

function readAgentReleaseContract(repoRoot: string): {
  version: string;
  fileName: string;
  productName: string;
} {
  const releasePath = path.join(repoRoot, "lib", "agent-release.ts");
  if (!fs.existsSync(releasePath)) {
    fail(`Missing lib/agent-release.ts at ${releasePath}`);
  }
  const text = fs.readFileSync(releasePath, "utf8");
  const version = text.match(/version:\s*"([^"]+)"/)?.[1];
  const fileName = text.match(/fileName:\s*"([^"]+)"/)?.[1];
  const productName = text.match(/productName:\s*"([^"]+)"/)?.[1];
  if (!version || !fileName || !productName) {
    fail("Could not parse version/fileName/productName from lib/agent-release.ts");
  }
  return { version, fileName, productName };
}

function main() {
  const agentRoot = path.resolve(__dirname, "..");
  const repoRoot = path.resolve(agentRoot, "..");
  const releaseDir = path.join(agentRoot, "release");

  const pkgPath = path.join(agentRoot, "package.json");
  if (!fs.existsSync(pkgPath)) {
    fail(`Missing package.json at ${pkgPath}`);
  }
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
    version?: string;
    build?: { productName?: string; appId?: string };
  };
  const pkgVersion = pkg.version?.trim() ?? "";
  if (!pkgVersion) {
    fail("print-agent/package.json has no version");
  }

  const contract = readAgentReleaseContract(repoRoot);
  const expectedFileName = `PrintYantra-Agent-Setup-${pkgVersion}.exe`;
  const installerPath = path.join(releaseDir, expectedFileName);

  if (contract.version !== pkgVersion) {
    fail(
      `Version mismatch: package.json=${pkgVersion} lib/agent-release.ts=${contract.version}`,
    );
  }
  if (contract.fileName !== expectedFileName) {
    fail(
      `Filename mismatch: expected ${expectedFileName} from package version, lib/agent-release.ts has ${contract.fileName}`,
    );
  }
  if (contract.productName !== PRODUCT_NAME) {
    fail(
      `productName mismatch: expected "${PRODUCT_NAME}", lib/agent-release.ts has "${contract.productName}"`,
    );
  }
  if (pkg.build?.productName && pkg.build.productName !== PRODUCT_NAME) {
    fail(
      `package.json build.productName is "${pkg.build.productName}", expected "${PRODUCT_NAME}"`,
    );
  }
  if (pkg.build?.appId && pkg.build.appId !== "com.printyantra.agent") {
    fail(
      `package.json build.appId is "${pkg.build.appId}", expected "com.printyantra.agent"`,
    );
  }

  if (!fs.existsSync(installerPath)) {
    fail(
      `Installer not found: ${installerPath}\nRun \`npm run dist\` first.`,
    );
  }
  const st = fs.statSync(installerPath);
  if (!st.isFile() || st.size <= 0) {
    fail(`Installer is missing or empty: ${installerPath}`);
  }
  if (path.basename(installerPath) !== expectedFileName) {
    fail(`Installer basename does not match ${expectedFileName}`);
  }

  let sha256: string;
  try {
    sha256 = sha256HexOfFileSync(installerPath);
  } catch (err) {
    fail(
      `SHA-256 calculation failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    fail(`Calculated SHA-256 is not a valid 64-char hex digest: ${sha256}`);
  }

  const meta = {
    version: pkgVersion,
    fileName: expectedFileName,
    productName: PRODUCT_NAME,
    sha256,
  };

  assert.equal(meta.version, contract.version);
  assert.equal(meta.fileName, contract.fileName);
  assert.equal(meta.productName, contract.productName);

  if (!fs.existsSync(releaseDir)) {
    fs.mkdirSync(releaseDir, { recursive: true });
  }
  const metaPath = path.join(releaseDir, "agent-release.meta.json");
  fs.writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`, "utf8");

  const hostingerPath = `${HOSTINGER_FILE_PATH_TEMPLATE}/${expectedFileName}`;

  console.log("Release metadata generated.\n");
  console.log(`Installer: ${installerPath}`);
  console.log(`Size:     ${st.size} bytes`);
  console.log(`Metadata: ${metaPath}`);
  console.log(`version:  ${meta.version}`);
  console.log(`fileName: ${meta.fileName}`);
  console.log(`product:  ${meta.productName}`);
  console.log(`sha256:   ${meta.sha256}`);
  console.log("\n--- Hostinger environment (copy manually; not written to .env) ---\n");
  console.log(`WINDOWS_AGENT_FILE_PATH=${hostingerPath}`);
  console.log(`WINDOWS_AGENT_SHA256=${meta.sha256}`);
  console.log("");
}

main();
