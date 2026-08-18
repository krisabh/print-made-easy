import { clearAuthCookie } from "@/lib/auth";

export async function POST() {
  await clearAuthCookie();
  return Response.json(
    { ok: true },
    {
      headers: { "Cache-Control": "no-store" },
    },
  );
}
