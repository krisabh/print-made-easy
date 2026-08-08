import {
  DEMO_SHOP_CODE,
  deleteShopJob,
  getDemoShop,
} from "@/lib/dashboard-service";

type RouteContext = {
  params: Promise<{ jobId: string }>;
};

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const shop = await getDemoShop();
    if (!shop) {
      return Response.json(
        { error: `Shop ${DEMO_SHOP_CODE} is not available.` },
        { status: 404 },
      );
    }

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
    console.error("Delete job failed:", error);
    return Response.json(
      { error: "Unable to delete this job." },
      { status: 500 },
    );
  }
}
