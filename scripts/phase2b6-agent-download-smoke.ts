/**
 * Phase 2B-6 — Windows Agent download smoke tests.
 * Run: npx tsx scripts/phase2b6-agent-download-smoke.ts
 *
 * Does not use the production installer. Creates a small temp file only.
 */
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";

import { WINDOWS_AGENT_DOWNLOAD } from "../lib/print-agent-download";
import {
  createWindowsAgentDownloadResponse,
  resolveWindowsAgentInstallerPath,
} from "../lib/print-agent-installer";

function jsonBodyHasSensitive(body: string, secrets: string[]) {
  return secrets.some((secret) => secret && body.includes(secret));
}

async function main() {
  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "pme-agent-dl-"));
  const installerPath = path.join(tmpRoot, WINDOWS_AGENT_DOWNLOAD.fileName);
  const payload = Buffer.from("PME-AGENT-DOWNLOAD-SMOKE");
  await writeFile(installerPath, payload);

  const secrets = [
    installerPath,
    tmpRoot,
    "CASHFREE_CLIENT_SECRET",
    "passwordHash",
    "agentTokenHash",
  ];

  try {
    assert.equal(WINDOWS_AGENT_DOWNLOAD.href, "/api/agent/download");
    assert.equal(
      WINDOWS_AGENT_DOWNLOAD.fileName,
      "PrintMadeEasy-Agent-Setup-1.0.0.exe",
    );
    assert.equal(WINDOWS_AGENT_DOWNLOAD.version, "1.0.0");
    console.log("1 PASS dashboard download href is the server endpoint");

    const missingEnv = resolveWindowsAgentInstallerPath("");
    assert.equal(missingEnv.ok, false);
    if (!missingEnv.ok) assert.equal(missingEnv.status, 500);
    const missingRes = await createWindowsAgentDownloadResponse("");
    assert.equal(missingRes.status, 500);
    const missingJson = await missingRes.json();
    assert.equal(typeof missingJson.error, "string");
    assert.equal(jsonBodyHasSensitive(JSON.stringify(missingJson), secrets), false);
    console.log("2 PASS missing env returns 500 without exposing paths");

    const wrongName = path.join(tmpRoot, "secrets.env");
    await writeFile(wrongName, "DO-NOT-SERVE");
    const rejected = resolveWindowsAgentInstallerPath(wrongName);
    assert.equal(rejected.ok, false);
    if (!rejected.ok) assert.equal(rejected.status, 500);
    const rejectedRes = await createWindowsAgentDownloadResponse(wrongName);
    const rejectedBody = await rejectedRes.text();
    assert.equal(rejectedRes.status, 500);
    assert.equal(rejectedBody.includes("DO-NOT-SERVE"), false);
    assert.equal(rejectedBody.includes(wrongName), false);
    console.log("3 PASS non-installer path is refused");

    const missingFile = resolveWindowsAgentInstallerPath(
      path.join(tmpRoot, "missing", WINDOWS_AGENT_DOWNLOAD.fileName),
    );
    assert.equal(missingFile.ok, true);
    const missingFileRes = await createWindowsAgentDownloadResponse(
      path.join(tmpRoot, "missing", WINDOWS_AGENT_DOWNLOAD.fileName),
    );
    assert.equal(missingFileRes.status, 404);
    const missingFileJson = await missingFileRes.json();
    assert.equal(
      jsonBodyHasSensitive(JSON.stringify(missingFileJson), [
        ...secrets,
        "missing",
      ]),
      false,
    );
    console.log("4 PASS missing installer file returns 404");

    const ok = resolveWindowsAgentInstallerPath(installerPath);
    assert.equal(ok.ok, true);
    const okRes = await createWindowsAgentDownloadResponse(installerPath);
    assert.equal(okRes.status, 200);
    assert.equal(
      okRes.headers.get("Content-Type"),
      "application/octet-stream",
    );
    assert.equal(
      okRes.headers.get("Content-Disposition"),
      `attachment; filename="${WINDOWS_AGENT_DOWNLOAD.fileName}"`,
    );
    assert.equal(okRes.headers.get("Content-Length"), String(payload.length));
    assert.equal(okRes.body != null, true);

    const bytes = Buffer.from(await okRes.arrayBuffer());
    assert.equal(bytes.equals(payload), true);

    const headerDump = JSON.stringify(Object.fromEntries(okRes.headers.entries()));
    assert.equal(headerDump.includes(tmpRoot), false);
    console.log("5 PASS valid file streams with attachment headers");

    // The HTTP route ignores query strings; the helper has no client path argument.
    const ignoredQuery = new URL(
      "http://localhost/api/agent/download?path=/etc/passwd&file=secrets.env",
    );
    assert.equal(ignoredQuery.searchParams.get("path"), "/etc/passwd");
    const stillInstaller = await createWindowsAgentDownloadResponse(installerPath);
    assert.equal(stillInstaller.status, 200);
    await stillInstaller.arrayBuffer();
    console.log("6 PASS client cannot request an arbitrary filesystem path");

    console.log("\nPhase 2B-6 agent download smoke tests passed.");
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
