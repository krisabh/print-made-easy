import { deleteShopJob } from "@/lib/dashboard-service";
import { requireProductAccessApi } from "@/lib/require-product-access";

type RouteContext = {
  params: Promise<{ jobId: string }>;
};

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const gated = await requireProductAccessApi();
    if (gated instanceof Response) return gated;
    const { shop } = gated.session;

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
