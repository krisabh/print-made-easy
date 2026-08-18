import { requireShopApi } from "@/lib/auth";
import { deleteShopJob } from "@/lib/dashboard-service";

type RouteContext = {
  params: Promise<{ jobId: string }>;
};

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const session = await requireShopApi();
    if (session instanceof Response) return session;
    const { shop } = session;

    const { jobId } = await context.params;
    if (!jobId) {
      return Response.json({ error: "Job id is required." }, { status: 400 });
    }

    const deleted = await deleteShopJob(shop.id, jobId);
    if (!deleted) {
      return Response.json({ error: "Job not found." }, { status: 404 });
    }

    return Response.json({
      ok: true,
      jobNumber: deleted.jobNumber,
    });
  } catch (error) {
    console.error("Delete job failed");
    return Response.json(
      { error: "Unable to delete this job." },
      { status: 500 },
    );
  }
}
