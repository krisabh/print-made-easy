import { NextRequest } from "next/server";

import { authenticateAgent } from "@/lib/print-agent-auth";
import { listPendingJobsForShop } from "@/lib/print-agent-service";

export async function GET(request: NextRequest) {
  try {
    const shop = await authenticateAgent(request);
    if (!shop) {
      return Response.json({ error: "Unauthorized." }, { status: 401 });
    }

    const jobs = await listPendingJobsForShop(shop.id);

    return Response.json({
      shopCode: shop.shopCode,
      jobs: jobs.map((job) => ({
        ...job,
        createdAt: job.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error("Agent jobs list failed:", error);
    return Response.json(
      { error: "Unable to load pending jobs." },
      { status: 500 },
    );
  }
}
