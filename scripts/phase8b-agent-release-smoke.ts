/**
 * Phase 8B — Agent release metadata / update manifest smoke.
 * Run: npx tsx scripts/phase8b-agent-release-smoke.ts
 *
 * Does not require a real installer EXE in the repo.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  WINDOWS_AGENT_RELEASE,
  getPublicAgentDownloadUrl,
  getPublicAgentUpdateManifest,
  isSha256Hex,
  resolveConfiguredAgentSha256,
} from "../lib/agent-release";
import { WINDOWS_AGENT_DOWNLOAD } from "../lib/print-agent-download";
import { SITE } from "../lib/marketing";
import { sha256HexOfBuffer, sha256HexOfFile } from "../lib/sha256-file";
import { GET as getAgentUpdate } from "../app/api/agent/update/route";

async function main() {
  const agentPkg = JSON.parse(
    await readFile(path.join(process.cwd(), "print-agent", "package.json"), "utf8"),
  ) as { version: string };

  // 1 — Agent package version
  assert.equal(agentPkg.version, "1.5.1");
  console.log("1 PASS Agent package version is 1.5.1");

  // 2 — Dashboard release metadata
  assert.equal(WINDOWS_AGENT_DOWNLOAD.version, "1.5.1");
  assert.equal(WINDOWS_AGENT_RELEASE.version, "1.5.1");
  console.log("2 PASS dashboard release metadata reports 1.5.1");

  // 3 — Installer filename
  assert.equal(
    WINDOWS_AGENT_DOWNLOAD.fileName,
    "PrintYantra-Agent-Setup-1.5.1.exe",
  );
  assert.equal(
    WINDOWS_AGENT_RELEASE.fileName,
    "PrintYantra-Agent-Setup-1.5.1.exe",
  );
  console.log("3 PASS installer filename is PrintYantra-Agent-Setup-1.5.1.exe");

  // 4 — Manifest shape
  const manifest = getPublicAgentUpdateManifest("");
  assert.equal(manifest.version, "1.5.1");
  assert.equal(typeof manifest.url, "string");
  assert.equal(manifest.url.startsWith("https://"), true);
  assert.equal(manifest.url.includes("/api/agent/download"), true);
  assert.equal(manifest.sha256, null);
  assert.equal(typeof manifest.notes, "string");
  assert.equal(manifest.notes.length > 0, true);
  assert.equal(manifest.fileName, WINDOWS_AGENT_RELEASE.fileName);
  const expectedBase =
    process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "") || SITE.url;
  assert.equal(
    getPublicAgentDownloadUrl(),
    `${expectedBase}/api/agent/download`,
  );
  // Explicit production-style URL when siteUrl is passed.
  assert.equal(
    getPublicAgentDownloadUrl(SITE.url),
    `${SITE.url}/api/agent/download`,
  );
  console.log("4 PASS manifest shape is valid (sha256 null until configured)");

  // 5 — SHA-256 utility deterministic for known fixture
  const fixture = Buffer.from("PME-PHASE8B-SHA256-FIXTURE");
  const expected = createHash("sha256").update(fixture).digest("hex");
  assert.equal(sha256HexOfBuffer(fixture), expected);
  assert.equal(isSha256Hex(expected), true);

  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), "pme-8b-sha-"));
  try {
    const fixturePath = path.join(tmpRoot, "fixture.bin");
    await writeFile(fixturePath, fixture);
    const fileHash = await sha256HexOfFile(fixturePath);
    assert.equal(fileHash, expected);
    assert.equal(fileHash, fileHash.toLowerCase());
    console.log("5 PASS SHA-256 utility matches known fixture (buffer + file)");
  } finally {
    await rm(tmpRoot, { recursive: true, force: true });
  }

  // 6 — Manifest does not expose secrets / paths
  const withBadSha = getPublicAgentUpdateManifest("not-a-hash");
  assert.equal(withBadSha.sha256, null);
  const withGoodSha = getPublicAgentUpdateManifest(
    "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  );
  assert.equal(
    withGoodSha.sha256,
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  );
  const dumped = JSON.stringify(getPublicAgentUpdateManifest(""));
  for (const bad of [
    "WINDOWS_AGENT_FILE_PATH",
    "C:\\",
    "/home/",
    "password",
    "authToken",
    "agentToken",
    "shopId",
    "AgentDevice",
  ]) {
    assert.equal(dumped.toLowerCase().includes(bad.toLowerCase()), false, bad);
  }
  assert.equal(resolveConfiguredAgentSha256(undefined), null);
  assert.equal(resolveConfiguredAgentSha256(""), null);
  console.log("6 PASS manifest does not expose secrets or filesystem paths");

  // 7 — Manual download contract still points at allowlisted route
  assert.equal(WINDOWS_AGENT_DOWNLOAD.href, "/api/agent/download");
  assert.equal(WINDOWS_AGENT_RELEASE.downloadPath, "/api/agent/download");
  console.log("7 PASS /api/agent/download contract remains intact");

  // 8–10 — Public update endpoint
  const res = await getAgentUpdate(new Request("http://localhost/api/agent/update?path=/etc/passwd"));
  assert.equal(res.status, 200);
  const body = (await res.json()) as Record<string, unknown>;
  assert.equal(body.version, "1.5.1");
  assert.equal(typeof body.url, "string");
  assert.equal(String(body.url).includes("/api/agent/download"), true);
  assert.equal("sha256" in body, true);
  assert.equal("notes" in body, true);
  assert.equal("fileName" in body, true);
  const bodyText = JSON.stringify(body);
  assert.equal(bodyText.includes("/etc/passwd"), false);
  assert.equal(bodyText.includes("WINDOWS_AGENT_FILE_PATH"), false);
  assert.equal(bodyText.includes("password"), false);
  // Route does not require Authorization — call succeeded without credentials.
  console.log("8 PASS update metadata endpoint returns public release metadata");
  console.log("9 PASS no local filesystem path in public manifest");
  console.log("10 PASS no shop/Agent authentication required for update metadata");

  console.log("\nPhase 8B agent release smoke: ALL PASS");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
