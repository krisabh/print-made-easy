import { updateAdminSettings, getOrCreateAdminSettings } from "@/lib/admin-settings";
import { requireAdminApi } from "@/lib/auth";

export async function GET() {
  try {
    const session = await requireAdminApi();
    if (session instanceof Response) return session;

    const settings = await getOrCreateAdminSettings();
    return Response.json({ success: true, settings });
  } catch (error) {
    console.error("GET /api/admin/settings failed");
    return Response.json(
      { error: "Unable to load admin settings." },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await requireAdminApi();
    if (session instanceof Response) return session;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Invalid settings." }, { status: 400 });
    }

    const result = await updateAdminSettings({
      adminUserId: session.user.id,
      patch: body,
    });
    if (!result.ok) {
      return Response.json({ error: result.error }, { status: result.status });
    }

    return Response.json({ success: true, settings: result.settings });
  } catch (error) {
    console.error("PATCH /api/admin/settings failed");
    return Response.json(
      { error: "Unable to save admin settings." },
      { status: 500 },
    );
  }
}
