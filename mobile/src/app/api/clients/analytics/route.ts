import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import { getAuthHeaders, getAuthToken, sanitizeUpstreamClientError } from "@/lib/api/route-utils";
import {
  deriveDashboardAnalyticsFromClients,
  normalizeDashboardAnalyticsPayload,
  type DashboardAnalytics,
  type DashboardAnalyticsClient,
} from "@/lib/dashboard/analytics";

function readClients(payload: unknown): DashboardAnalyticsClient[] {
  if (Array.isArray(payload)) return payload as DashboardAnalyticsClient[];
  if (!payload || typeof payload !== "object") return [];

  const record = payload as Record<string, unknown>;
  if (Array.isArray(record.data)) return record.data as DashboardAnalyticsClient[];
  if (Array.isArray(record.clients)) return record.clients as DashboardAnalyticsClient[];
  return [];
}

export async function GET(request: NextRequest) {
  const token = getAuthToken(request);
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const headers = getAuthHeaders(token);
  let backendAnalytics: DashboardAnalytics | null = null;

  try {
    const response = await serverAPIClient.get("/clients/analytics", { headers });
    if (response.status < 400) {
      backendAnalytics = normalizeDashboardAnalyticsPayload(response.data);
    }
  } catch {
    // Fall through to client-derived analytics when the backend has no dedicated endpoint.
  }

  try {
    const response = await serverAPIClient.get("/clients", {
      params: { page: 1, limit: 10000 },
      headers,
    });

    if (response.status >= 400) {
      if (backendAnalytics) return NextResponse.json(backendAnalytics);
      return NextResponse.json(
        sanitizeUpstreamClientError(response.data, "Failed to fetch dashboard analytics"),
        { status: response.status },
      );
    }

    const derivedAnalytics = deriveDashboardAnalyticsFromClients(readClients(response.data));
    return NextResponse.json({
      ...(backendAnalytics ?? derivedAnalytics),
      contractsNotSent: derivedAnalytics.contractsNotSent,
      upcomingThisMonth: derivedAnalytics.upcomingThisMonth,
    });
  } catch (error) {
    if (backendAnalytics) return NextResponse.json(backendAnalytics);
    console.error("[API] Error fetching dashboard analytics:", error);
    return NextResponse.json(
      { error: "Failed to fetch dashboard analytics" },
      { status: 500 },
    );
  }
}
