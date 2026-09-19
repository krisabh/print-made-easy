import { createReadStream } from "fs";
import { stat } from "fs/promises";
import path from "path";
import { Readable } from "stream";

import {
  resolveConfiguredAgentSha256,
} from "@/lib/agent-release";
import { WINDOWS_AGENT_DOWNLOAD } from "@/lib/print-agent-download";
import { sha256HexOfFile } from "@/lib/sha256-file";

/**
 * Resolve the server-side installer path from WINDOWS_AGENT_FILE_PATH.
 * The client never supplies a filesystem path.
 */
export function resolveWindowsAgentInstallerPath(
  envPath: string | undefined = process.env.WINDOWS_AGENT_FILE_PATH,
): { ok: true; filePath: string } | { ok: false; status: 500; error: string } {
  const configured = envPath?.trim() ?? "";
  if (!configured) {
    return {
      ok: false,
      status: 500,
      error: "Windows Agent download is not configured.",
    };
  }

  const resolved = path.resolve(configured);
  if (path.basename(resolved) !== WINDOWS_AGENT_DOWNLOAD.fileName) {
    return {
      ok: false,
      status: 500,
      error: "Windows Agent download is not configured.",
    };
  }

  return { ok: true, filePath: resolved };
}

/**
 * Stream the known Windows Agent installer. Never loads the file into memory.
 *
 * When WINDOWS_AGENT_SHA256 is configured, verifies the on-disk file matches
 * that independent expected digest before streaming (fail closed on mismatch).
 * Does not publish SHA from live file bytes into the update manifest.
 */
export async function createWindowsAgentDownloadResponse(
  envPath: string | undefined = process.env.WINDOWS_AGENT_FILE_PATH,
  envSha256: string | undefined = process.env.WINDOWS_AGENT_SHA256,
): Promise<Response> {
  const resolved = resolveWindowsAgentInstallerPath(envPath);
  if (!resolved.ok) {
    return Response.json({ error: resolved.error }, { status: resolved.status });
  }

  let fileStat;
  try {
    fileStat = await stat(resolved.filePath);
  } catch {
    return Response.json(
      { error: "Windows Agent file is unavailable." },
      { status: 404 },
    );
  }

  if (!fileStat.isFile() || fileStat.size <= 0) {
    return Response.json(
      { error: "Windows Agent file is unavailable." },
      { status: 404 },
    );
  }

  const expectedSha = resolveConfiguredAgentSha256(envSha256);
  if (expectedSha) {
    let actualSha: string;
    try {
      actualSha = (await sha256HexOfFile(resolved.filePath)).toLowerCase();
    } catch {
      return Response.json(
        { error: "Windows Agent file is unavailable." },
        { status: 500 },
      );
    }
    if (actualSha !== expectedSha) {
      console.error(
        "Windows Agent download refused: on-disk installer SHA-256 does not match WINDOWS_AGENT_SHA256",
      );
      return Response.json(
        { error: "Windows Agent file is unavailable." },
        { status: 500 },
      );
    }
  }

  const stream = createReadStream(resolved.filePath);
  const webStream = Readable.toWeb(stream) as ReadableStream;

  return new Response(webStream, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${WINDOWS_AGENT_DOWNLOAD.fileName}"`,
      "Content-Length": String(fileStat.size),
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      "X-Agent-Version": WINDOWS_AGENT_DOWNLOAD.version,
    },
  });
}
