import { NextRequest, NextResponse } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import {
  errorResponse,
  getAuthHeaders,
  getAuthToken,
  sanitizeUpstreamClientError,
  withNoStore,
} from "@/lib/api/route-utils";
import { unauthorizedProblemResponse } from "@/lib/api/problem-responses";
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

function isAuthStatus(status: unknown): boolean {
  return status === 401 || status === 403;
}

/** HTTP status carried by a thrown upstream (axios-style) error, if any. */
function thrownStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const response = (error as { response?: { status?: unknown } }).response;
  return typeof response?.status === "number" ? response.status : undefined;
}

function unknownAnalytics(): DashboardAnalytics {
  return {
    activeClients: null,
    contractsNotSent: null,
    contractsPendingSignature: null,
    upcomingThisMonth: null,
    upcomingNextMonth: null,
    upcomingWithinWeek: null,
  };
}

/**
 * Loads every client row, or returns null when any page is unavailable (a partial list would
 * produce undercounts that look authoritative). Authentication failures are never swallowed:
 * they are returned as a response to send back to the caller.
 */
async function loadClients(
  headers: ReturnType<typeof getAuthHeaders>,
): Promise<{ clients: DashboardAnalyticsClient[] | null; authFailure?: NextResponse }> {
  const clients: DashboardAnalyticsClient[] = [];
  let page = 1;

  try {
    while (true) {
      const response = await serverAPIClient.get("/clients", {
        params: { page, limit: CLIENTS_ANALYTICS_PAGE_LIMIT },
        headers,
      });

      if (response.status >= 400) {
        if (isAuthStatus(response.status)) {
          return {
            clients: null,
            authFailure: withNoStore(
              NextResponse.json(
                sanitizeUpstreamClientError(response.data, "Failed to fetch dashboard analytics", response.status, "read"),
                { status: response.status },
              ),
            ),
          };
        }
        return { clients: null };
      }

      const pageClients = readClients(response.data);
      clients.push(...pageClients);

      if (Array.isArray(response.data) || pageClients.length === 0) break;

      const total = readNumber(response.data, "total");
      const responsePage = readNumber(response.data, "page") ?? page;
      const responseLimit = readNumber(response.data, "limit") ?? CLIENTS_ANALYTICS_PAGE_LIMIT;

      if (total !== undefined && responsePage * responseLimit >= total) break;
      if (pageClients.length < CLIENTS_ANALYTICS_PAGE_LIMIT) break;

      page += 1;
    }
  } catch (error) {
    if (isAuthStatus(thrownStatus(error))) {
      return { clients: null, authFailure: errorResponse(error, "fetch dashboard analytics", "read") };
    }
    // Network error, timeout or 5xx: the list is simply unavailable.
    return { clients: null };
  }

  return { clients };
}

export async function GET(request: NextRequest) {
  const token = getAuthToken(request);
  if (!token) {
    return unauthorizedProblemResponse();
  }

  const headers = getAuthHeaders(token);
  let backendAnalytics: DashboardAnalytics | null = null;

  try {
    // The branch stats endpoint is the single source for the contract counts, so the dashboard
    // numbers match the badges the client list shows.
    const response = await serverAPIClient.get("/clients/stats", { headers });
    if (isAuthStatus(response.status)) {
      return withNoStore(
        NextResponse.json(
          sanitizeUpstreamClientError(response.data, "Failed to fetch dashboard analytics", response.status, "read"),
          { status: response.status },
        ),
      );
    }
    if (response.status < 400) {
      const normalized = normalizeDashboardAnalyticsPayload(response.data);
      // An all-unknown payload carries nothing from the backend; treat it as unavailable stats.
      backendAnalytics =
        normalized && Object.values(normalized).some((value) => value !== null) ? normalized : null;
    }
  } catch (error) {
    if (isAuthStatus(thrownStatus(error))) {
      return errorResponse(error, "fetch dashboard analytics", "read");
    }
    // Unavailable stats: the contract counts stay unknown (rendered "-"), never a locally guessed number.
  }

  const { clients, authFailure } = await loadClients(headers);
  if (authFailure) return authFailure;

  // Backend values are returned as-is. Only the seven-day start count is added, from the same
  // client rows and rule as the dashboard list, because the backend has no seven-day count.
  // When an upstream is unavailable its counts are unknown (null, rendered "-"), never an error
  // and never zero.
  if (!clients) {
    return withNoStore(NextResponse.json(backendAnalytics ?? unknownAnalytics()));
  }

  const derivedAnalytics = deriveDashboardAnalyticsFromClients(clients);
  return withNoStore(
    NextResponse.json(
      backendAnalytics
        ? { ...backendAnalytics, upcomingWithinWeek: derivedAnalytics.upcomingWithinWeek }
        : derivedAnalytics,
    ),
  );
}
