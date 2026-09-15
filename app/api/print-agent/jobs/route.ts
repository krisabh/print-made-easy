import { NextRequest } from "next/server";

import { authenticateAgentContext } from "@/lib/print-agent-auth";
import { listPendingJobsForShop } from "@/lib/print-agent-service";

export async function GET(request: NextRequest) {
  try {
    const auth = await authenticateAgentContext(request);
    if (!auth) {
      return Response.json({ error: "Unauthorized." }, { status: 401 });
    }

    const jobs = await listPendingJobsForShop(auth.shop.id, {
      agentDeviceId: auth.agentDeviceId,
    });

    return Response.json({
      shopCode: auth.shop.shopCode,
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
