import { listAdminAuditLogs } from "@/lib/admin-audit";
import { requireAdminApi } from "@/lib/auth";

export async function GET(request: Request) {
  try {
    const session = await requireAdminApi();
    if (session instanceof Response) return session;

    const url = new URL(request.url);
    const page = Number(url.searchParams.get("page") || "1");
    const result = await listAdminAuditLogs({ page });
    return Response.json({ success: true, ...result });
  } catch (error) {
    console.error("GET /api/admin/audit-log failed");
    return Response.json(
      { error: "Unable to load the audit log." },
      { status: 500 },
    );
  }
}
