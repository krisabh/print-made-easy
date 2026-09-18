import { getPublicAgentUpdateManifest } from "@/lib/agent-release";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/agent/update
 * Public Agent release metadata for future in-app update checks.
 * No shop/Agent authentication. Never exposes filesystem paths or secrets.
 * Query parameters are ignored — clients cannot supply a custom release URL.
 */
export async function GET(_request: Request) {
  try {
    const manifest = getPublicAgentUpdateManifest();
    return Response.json(manifest, {
      status: 200,
      headers: {
        "Cache-Control": "public, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    console.error("Agent update manifest failed");
    return Response.json(
      { error: "Unable to load Agent update metadata." },
      { status: 500 },
    );
  }
}
