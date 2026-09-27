/**
 * Phase 8C — Agent update checker smoke (semver, manifest, single-flight).
 * Run: npx tsx scripts/phase8c-agent-update-check-smoke.ts
 */
import assert from "node:assert/strict";

import {
  compareSemver,
  isRemoteNewer,
  parseSemver,
} from "../print-agent/src/semver";
import {
  createUpdateChecker,
  validateAgentUpdateManifest,
} from "../print-agent/src/update-check";

function validManifest(overrides: Record<string, unknown> = {}) {
  return {
    version: "1.5.2",
    url: "https://printyantra.com/api/agent/download",
    sha256: null,
    notes: "Bug fixes",
    fileName: "PrintYantra-Agent-Setup-1.5.2.exe",
    ...overrides,
  };
}

async function main() {
  // A — Version comparison
  assert.equal(isRemoteNewer("1.4.0", "1.4.1"), true);
  assert.equal(isRemoteNewer("1.5.2", "1.6.0"), true);
  assert.equal(isRemoteNewer("1.6.0", "1.5.2"), false);
  assert.equal(isRemoteNewer("1.6.0", "1.7.0"), true);
  assert.equal(isRemoteNewer("1.7.0", "1.6.0"), false);
  assert.equal(isRemoteNewer("1.7.0", "1.7.0"), false);
  assert.equal(isRemoteNewer("1.4.0", "1.5.0"), true);
  assert.equal(isRemoteNewer("1.4.0", "2.0.0"), true);
  assert.equal(isRemoteNewer("1.4.0", "1.4.0"), false);
  assert.equal(isRemoteNewer("1.4.1", "1.4.0"), false);
  assert.equal(compareSemver("1.4.0", "1.4.1"), -1);
  assert.equal(compareSemver("2.0.0", "1.9.9"), 1);
  console.log("A PASS version comparison");

  // B — Malformed versions
  for (const bad of ["abc", "", "1", "1.x.0", "1.4", "v1.4.0-beta", null, 12]) {
    assert.equal(parseSemver(bad as never), null);
    assert.equal(isRemoteNewer("1.4.0", String(bad ?? "")), false);
  }
  assert.equal(compareSemver("1.4.0", "abc"), null);
  console.log("B PASS malformed versions rejected");

  // C — Manifest validation
  const trusted = "https://printyantra.com";
  const ok = validateAgentUpdateManifest(validManifest(), trusted);
  assert.equal(ok.ok, true);

  const cases: Array<[string, unknown]> = [
    ["http_url", validManifest({ url: "http://evil.com/api/agent/download" })],
    [
      "unexpected_origin",
      validManifest({ url: "https://evil.com/api/agent/download" }),
    ],
    [
      "malformed_sha",
      validManifest({ sha256: "not-a-hash" }),
    ],
    ["missing_version", validManifest({ version: undefined })],
    ["invalid_fileName", validManifest({ fileName: "setup.exe" })],
    ["non_object", "nope"],
    ["array", []],
    [
      "path",
      validManifest({ url: "https://printyantra.com/secret/installer.exe" }),
    ],
    [
      "name_mismatch",
      validManifest({
        version: "1.5.2",
        fileName: "PrintYantra-Agent-Setup-1.5.0.exe",
      }),
    ],
  ];
  for (const [label, raw] of cases) {
    const result = validateAgentUpdateManifest(raw, trusted);
    assert.equal(result.ok, false, label);
  }
  console.log("C PASS manifest validation");

  // D — URL/origin + localhost http allowed for apiUrl
  const localOk = validateAgentUpdateManifest(
    validManifest({
      version: "1.5.2",
      url: "http://localhost:3000/api/agent/download",
      fileName: "PrintYantra-Agent-Setup-1.5.2.exe",
    }),
    "http://localhost:3000",
  );
  assert.equal(localOk.ok, true);
  console.log("D PASS URL/origin validation");

  // E — Network failure / single-flight / state transitions / sensitive data
  let fetchCalls = 0;
  let lastInit: RequestInit | undefined;
  const fetchImpl: typeof fetch = async (_input, init) => {
    fetchCalls += 1;
    lastInit = init;
    await new Promise((r) => setTimeout(r, 40));
    return new Response(JSON.stringify(validManifest()), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const checker = createUpdateChecker({
    getCurrentVersion: () => "1.5.0",
    getApiUrl: () => "https://printyantra.com",
    fetchImpl,
  });

  assert.equal(checker.getPublicState().status, "idle");
  const p1 = checker.runCheck({ manual: true });
  assert.equal(checker.getPublicState().status, "checking");
  const p2 = checker.runCheck({ manual: true });
  const [r1, r2] = await Promise.all([p1, p2]);
  assert.equal(fetchCalls, 1);
  assert.equal(r1.updateAvailable, true);
  assert.equal(r2.updateAvailable, true);
  assert.equal(checker.getPublicState().status, "available");
  assert.equal(checker.getPublicState().latestVersion, "1.5.2");
  console.log("E PASS single-flight + available transition");

  // Headers: no auth
  const headers = new Headers(lastInit?.headers || {});
  assert.equal(headers.get("Authorization"), null);
  assert.equal(lastInit?.credentials, "omit");
  console.log("F PASS no Authorization / credentials on update check");

  // upToDate transition
  const checkerSame = createUpdateChecker({
    getCurrentVersion: () => "1.5.2",
    getApiUrl: () => "https://printyantra.com",
    fetchImpl: async () =>
      new Response(JSON.stringify(validManifest()), { status: 200 }),
  });
  const up = await checkerSame.runCheck();
  assert.equal(up.updateAvailable, false);
  assert.equal(checkerSame.getPublicState().status, "upToDate");
  console.log("G PASS upToDate transition");

  // error transitions
  const failCases = [
    async () => {
      throw new Error("network");
    },
    async () => new Response("nope", { status: 500 }),
    async () =>
      new Response("{not-json", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
  ];
  for (const fetchFail of failCases) {
    const c = createUpdateChecker({
      getCurrentVersion: () => "1.5.0",
      getApiUrl: () => "https://printyantra.com",
      fetchImpl: fetchFail as typeof fetch,
    });
    const result = await c.runCheck({ manual: true });
    assert.equal(result.updateAvailable, false);
    assert.equal(c.getPublicState().status, "error");
    assert.equal(
      c.getPublicState().userMessage,
      "Unable to check for updates right now.",
    );
  }
  console.log("H PASS network/500/invalid JSON → safe error");

  // Background failure stays silent (no userMessage)
  const silent = createUpdateChecker({
    getCurrentVersion: () => "1.5.0",
    getApiUrl: () => "https://printyantra.com",
    fetchImpl: async () => new Response("{}", { status: 500 }),
  });
  await silent.runCheck({ manual: false });
  assert.equal(silent.getPublicState().status, "error");
  assert.equal(silent.getPublicState().userMessage, null);
  console.log("I PASS background failures silent");

  // Update Now with missing sha256 → verificationUnavailable (Phase 8D)
  const noSha = await checker.startUpdateDownload();
  assert.equal(noSha.accepted, false);
  assert.equal(noSha.code, "SHA256_MISSING");
  assert.equal(
    checker.getPublicState().status,
    "verificationUnavailable",
  );
  assert.equal(
    checker.getPublicState().userMessage,
    "Update verification is not available yet.",
  );
  console.log("J PASS Update Now blocked when sha256 missing");

  // Sensitive fields not in request URL construction beyond public path
  assert.equal(
    String((lastInit as { method?: string } | undefined)?.method || "GET").toUpperCase(),
    "GET",
  );
  console.log("K PASS sensitive-data check (no auth headers)");

  // Release notes come from the manifest, including a future version string.
  const withNotes = validateAgentUpdateManifest(
    validManifest({
      version: "1.8.0",
      fileName: "PrintYantra-Agent-Setup-1.8.0.exe",
      notes: "ignored when bullets exist",
      releaseNotes: ["Faster job processing", "Better printer connection handling"],
    }),
    trusted,
  );
  assert.equal(withNotes.ok, true);
  if (withNotes.ok) {
    assert.deepEqual(withNotes.manifest.releaseNotes, [
      "Faster job processing",
      "Better printer connection handling",
    ]);
  }
  const notesOnly = validateAgentUpdateManifest(
    validManifest({ notes: "- One line\n- Two line" }),
    trusted,
  );
  assert.equal(notesOnly.ok, true);
  if (notesOnly.ok) {
    assert.deepEqual(notesOnly.manifest.releaseNotes, ["One line", "Two line"]);
  }
  const badNotesField = validateAgentUpdateManifest(
    validManifest({ releaseNotes: "not-an-array", notes: "Still usable" }),
    trusted,
  );
  assert.equal(badNotesField.ok, true);
  if (badNotesField.ok) {
    assert.deepEqual(badNotesField.manifest.releaseNotes, ["Still usable"]);
  }
  console.log("L PASS release notes parsed from server metadata");

  let remembered: string | null = "1.7.0";
  let spawnCount = 0;
  const dismissedChecker = createUpdateChecker({
    getCurrentVersion: () => "1.6.0",
    getApiUrl: () => "https://printyantra.com",
    getDismissedUpdateVersion: () => remembered,
    rememberDismissedUpdateVersion: (version) => {
      remembered = version;
    },
    spawnInstaller: () => {
      spawnCount += 1;
      return { ok: true, pid: 1 };
    },
    fetchImpl: async () =>
      new Response(
        JSON.stringify(
          validManifest({
            version: "1.7.0",
            fileName: "PrintYantra-Agent-Setup-1.7.0.exe",
            sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            releaseNotes: ["Improved print reliability"],
          }),
        ),
        { status: 200 },
      ),
  });
  const detected = await dismissedChecker.runCheck({ manual: false });
  assert.equal(detected.updateAvailable, true);
  assert.equal(dismissedChecker.getPublicState().dismissed, true);
  assert.equal(spawnCount, 0);
  assert.deepEqual(dismissedChecker.getPublicState().releaseNotes, [
    "Improved print reliability",
  ]);
  console.log("M PASS dismissed version stays quiet and check does not install");

  remembered = null;
  const fresh = createUpdateChecker({
    getCurrentVersion: () => "1.6.0",
    getApiUrl: () => "https://printyantra.com",
    getDismissedUpdateVersion: () => remembered,
    rememberDismissedUpdateVersion: (version) => {
      remembered = version;
    },
    spawnInstaller: () => {
      spawnCount += 1;
      return { ok: true, pid: 1 };
    },
    fetchImpl: async () =>
      new Response(
        JSON.stringify(
          validManifest({
            version: "1.7.0",
            fileName: "PrintYantra-Agent-Setup-1.7.0.exe",
            sha256: null,
            notes: "",
            releaseNotes: [],
          }),
        ),
        { status: 200 },
      ),
  });
  await fresh.runCheck({ manual: false });
  assert.equal(fresh.getPublicState().dismissed, false);
  assert.equal(fresh.getPublicState().updateAvailable, true);
  assert.deepEqual(fresh.getPublicState().releaseNotes, []);
  fresh.dismissAvailable();
  assert.equal(remembered, "1.7.0");
  assert.equal(fresh.getPublicState().dismissed, true);
  assert.equal(spawnCount, 0);
  const blocked = await fresh.startUpdate();
  assert.equal(blocked.accepted, false);
  assert.equal(blocked.code, "SHA256_MISSING");
  assert.equal(spawnCount, 0);
  console.log("N PASS Later remembers version; missing SHA still blocks install");

  const failingRecheck = createUpdateChecker({
    getCurrentVersion: () => "1.6.0",
    getApiUrl: () => "https://printyantra.com",
    fetchImpl: async () => {
      throw new Error("offline");
    },
  });
  await failingRecheck.runCheck({ manual: false });
  assert.equal(failingRecheck.getPublicState().userMessage, null);
  assert.equal(failingRecheck.getPublicState().status, "error");

  let calls = 0;
  const preserve = createUpdateChecker({
    getCurrentVersion: () => "1.6.0",
    getApiUrl: () => "https://printyantra.com",
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(
          JSON.stringify(
            validManifest({
              version: "1.7.0",
              fileName: "PrintYantra-Agent-Setup-1.7.0.exe",
              releaseNotes: ["Improved print reliability"],
            }),
          ),
          { status: 200 },
        );
      }
      throw new Error("timeout");
    },
  });
  await preserve.runCheck({ manual: false });
  const again = await preserve.runCheck({ manual: false });
  assert.equal(again.updateAvailable, true);
  assert.equal(preserve.getPublicState().status, "available");
  assert.equal(preserve.getPublicState().userMessage, null);
  assert.deepEqual(preserve.getPublicState().releaseNotes, [
    "Improved print reliability",
  ]);
  console.log("O PASS background check failure stays non-blocking");

  console.log("\nPhase 8C agent update-check smoke: ALL PASS");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
