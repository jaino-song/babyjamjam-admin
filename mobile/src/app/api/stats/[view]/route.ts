import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/cookies";
import { getStatsView, isValidStatsBranchSlug, type StatsViewData } from "@/lib/observability/stats-server";
import { parseStatsPeriodParam } from "@/lib/observability/stats-period";

const STAT_VIEWS = new Set<keyof StatsViewData>(["overview", "errors", "inquiries", "funnel", "traffic"]);
const OWNER_ONLY_VIEWS = new Set<keyof StatsViewData>(["overview", "errors", "funnel", "traffic"]);

interface RouteContext {
  params: Promise<{ view: string }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const { view: rawView } = await context.params;
  if (!STAT_VIEWS.has(rawView as keyof StatsViewData)) {
    return NextResponse.json({ error: "Unknown stats view" }, { status: 404 });
  }

  const view = rawView as keyof StatsViewData;
  const isOwner = user.role === "owner";
  if (OWNER_ONLY_VIEWS.has(view) && !isOwner) {
    return NextResponse.json({ error: "Owner permission required" }, { status: 403 });
  }

  const branchSlug = isOwner ? null : ((user as { branchSlug?: string | null }).branchSlug ?? null);
  if (view === "inquiries" && !isOwner && !isValidStatsBranchSlug(branchSlug)) {
    return NextResponse.json({ error: "Branch context required" }, { status: 403 });
  }

  const rawPeriods = request.nextUrl.searchParams.getAll("period");
  const period = parseStatsPeriodParam(rawPeriods.length === 0 ? undefined : rawPeriods.length === 1 ? rawPeriods[0] : rawPeriods);
  if (period === null) return NextResponse.json({ error: "Invalid stats period" }, { status: 400 });

  const response = await getStatsView(view, branchSlug, period);
  return NextResponse.json(response, {
    status: response.state === "error" ? 502 : 200,
    headers: { "Cache-Control": "private, no-store" },
  });
}
