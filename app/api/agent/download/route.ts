import { createWindowsAgentDownloadResponse } from "@/lib/print-agent-installer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/agent/download
 * Streams the Windows Agent installer from WINDOWS_AGENT_FILE_PATH.
 * Query parameters are ignored — the client cannot choose a filesystem path.
 */
export async function GET(_request: Request) {
  try {
    return await createWindowsAgentDownloadResponse();
  } catch {
    console.error("Windows Agent download failed");
    return Response.json(
      { error: "Unable to download Windows Agent." },
      { status: 500 },
    );
  }
}
