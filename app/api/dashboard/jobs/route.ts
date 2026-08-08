import { NextRequest } from "next/server";
import { PrintStatus } from "@prisma/client";

import {
  DEMO_SHOP_CODE,
  getDashboardSummary,
  getDateRange,
  getDemoShop,
  getShopJobs,
  type DateFilter,
  type StatusFilter,
} from "@/lib/dashboard-service";
import { getShopAgentStatus } from "@/lib/print-agent-service";

export async function GET(request: NextRequest) {
  try {
    const shop = await getDemoShop();
    if (!shop) {
      return Response.json(
        { error: "Demo shop is not available." },
        { status: 404 },
      );
    }

    const params = request.nextUrl.searchParams;
    const statusParam = params.get("status") ?? "ALL";
    const search = params.get("search") ?? "";
    const dateParam = (params.get("date") ?? "today") as DateFilter;

    const allowedStatuses: StatusFilter[] = [
      "ALL",
      PrintStatus.PENDING,
      PrintStatus.PRINTING,
      PrintStatus.READY_FOR_PICKUP,
      PrintStatus.DELIVERED,
      PrintStatus.CANCELLED,
    ];

    const status = allowedStatuses.includes(statusParam as StatusFilter)
      ? (statusParam as StatusFilter)
      : "ALL";

    const allowedDates: DateFilter[] = [
      "today",
      "yesterday",
      "last7",
      "month",
      "all",
    ];
    const date = allowedDates.includes(dateParam) ? dateParam : "today";

    const [jobs, summary, agentStatus] = await Promise.all([
      getShopJobs({
        shopId: shop.id,
        status,
        search,
        date,
      }),
      getDashboardSummary(shop.id),
      getShopAgentStatus(shop.id),
    ]);

    return Response.json({
      shopCode: DEMO_SHOP_CODE,
      jobs,
      summary,
      agentStatus,
      dateRange: getDateRange(date),
    });
  } catch (error) {
    console.error("Dashboard jobs fetch failed:", error);
    return Response.json(
      { error: "Unable to load jobs right now." },
      { status: 500 },
    );
  }
}
