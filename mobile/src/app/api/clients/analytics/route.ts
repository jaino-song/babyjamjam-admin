import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import {
  getAuthHeaders,
  getAuthToken,
  sanitizeUpstreamClientError,
  withNoStore,
} from "@/lib/api/route-utils";
import {
  deriveDashboardAnalyticsFromClients,
  normalizeDashboardAnalyticsPayload,
  type DashboardAnalytics,
  type DashboardAnalyticsClient,
} from "@/lib/dashboard/analytics";

const CLIENTS_ANALYTICS_PAGE_LIMIT = 100;

function readClients(payload: unknown): DashboardAnalyticsClient[] {
  if (Array.isArray(payload)) return payload as DashboardAnalyticsClient[];
  if (!payload || typeof payload !== "object") return [];

  const record = payload as Record<string, unknown>;
  if (Array.isArray(record.data)) return record.data as DashboardAnalyticsClient[];
  if (Array.isArray(record.clients)) return record.clients as DashboardAnalyticsClient[];
  return [];
}

function readNumber(payload: unknown, key: string): number | undefined {
  if (!payload || typeof payload !== "object") return undefined;

  const value = (payload as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export async function GET(request: NextRequest) {
  const token = getAuthToken(request);
  if (!token) {
    return withNoStore(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
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
    const clients: DashboardAnalyticsClient[] = [];
    let page = 1;

    while (true) {
      const response = await serverAPIClient.get("/clients", {
        params: { page, limit: CLIENTS_ANALYTICS_PAGE_LIMIT },
        headers,
      });

      if (response.status >= 400) {
        if (backendAnalytics) return withNoStore(NextResponse.json(backendAnalytics));
        return withNoStore(
          NextResponse.json(
            sanitizeUpstreamClientError(response.data, "Failed to fetch dashboard analytics"),
            { status: response.status },
          ),
        );
      }

      const pageClients = readClients(response.data);
      clients.push(...pageClients);

      if (Array.isArray(response.data) || pageClients.length === 0) {
        break;
      }

      const total = readNumber(response.data, "total");
      const responsePage = readNumber(response.data, "page") ?? page;
      const responseLimit = readNumber(response.data, "limit") ?? CLIENTS_ANALYTICS_PAGE_LIMIT;

      if (total !== undefined && responsePage * responseLimit >= total) {
        break;
      }

      if (pageClients.length < CLIENTS_ANALYTICS_PAGE_LIMIT) {
        break;
      }

      page += 1;
    }

    const derivedAnalytics = deriveDashboardAnalyticsFromClients(clients);
    return withNoStore(
      NextResponse.json({
        ...(backendAnalytics ?? derivedAnalytics),
        contractsNotSent: derivedAnalytics.contractsNotSent,
        upcomingThisMonth: derivedAnalytics.upcomingThisMonth,
      }),
    );
  } catch (error) {
    if (backendAnalytics) return withNoStore(NextResponse.json(backendAnalytics));
    console.error("[API] Error fetching dashboard analytics:", error);
    return withNoStore(
      NextResponse.json(
        { error: "Failed to fetch dashboard analytics" },
        { status: 500 },
      ),
    );
  }
}
