import { createReadStream } from "fs";
import { stat } from "fs/promises";
import path from "path";
import { Readable } from "stream";

import { WINDOWS_AGENT_DOWNLOAD } from "@/lib/print-agent-download";

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
 */
export async function createWindowsAgentDownloadResponse(
  envPath: string | undefined = process.env.WINDOWS_AGENT_FILE_PATH,
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
