/**
 * A `null` count is "unknown", never zero: the dashboard renders it as "-". The server stats
 * endpoint is the only source for the contract counts, so when it is unavailable they stay null
 * instead of being re-derived from the client list under a different rule.
 */
export interface DashboardAnalytics {
  activeClients: number | null;
  /** Clients whose list row carries the "발송 필요" contract badge (server-decided). */
  contractsNotSent: number | null;
  contractsPendingSignature: number | null;
  /** Server count of waiting clients starting anywhere in the current month. */
  upcomingThisMonth: number | null;
  upcomingNextMonth: number | null;
  /** Clients starting within the next seven days, counted with the same rule as the dashboard list. */
  upcomingWithinWeek: number | null;
}

export interface DashboardAnalyticsClient {
  serviceStatus: string | null;
  startDate: string | null;
  endDate?: string | null;
  eDocId: string | null;
  documentStatus: string | null;
}

const SERVICE_START_WINDOW_DAYS = 7;
const EXCLUDED_UPCOMING_SERVICE_STATUSES = new Set(["completed", "terminated"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function dateValue(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

// Business time is KST regardless of server timezone (Vercel runs UTC, so
// local-TZ setHours() shifted every window by 9 hours in production). KST is
// a fixed UTC+9 offset with no DST, so day/month boundaries reduce to plain
// offset arithmetic.
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function startOfKstDay(date: Date) {
  const shifted = new Date(date.getTime() + KST_OFFSET_MS);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - KST_OFFSET_MS);
}

function endOfKstDay(date: Date) {
  return new Date(startOfKstDay(date).getTime() + DAY_MS - 1);
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * DAY_MS);
}

function kstMonthIndex(date: Date) {
  const shifted = new Date(date.getTime() + KST_OFFSET_MS);
  return shifted.getUTCFullYear() * 12 + shifted.getUTCMonth();
}

export function isServiceStartingWithinWeek(
  client: DashboardAnalyticsClient,
  now = new Date(),
): boolean {
  const serviceStatus = client.serviceStatus ?? "";
  if (EXCLUDED_UPCOMING_SERVICE_STATUSES.has(serviceStatus)) return false;

  const startDate = dateValue(client.startDate);
  if (!startDate) return false;

  const windowStart = startOfKstDay(now);
  const windowEnd = addDays(endOfKstDay(now), SERVICE_START_WINDOW_DAYS);

  return startDate >= windowStart && startDate <= windowEnd;
}

/**
 * A well-formed payload whose counts are all missing/null is valid: it means "everything unknown"
 * (backend unavailable) and renders as "-". Only a non-object payload is rejected.
 */
export function normalizeDashboardAnalyticsPayload(payload: unknown): DashboardAnalytics | null {
  if (!isRecord(payload)) return null;

  const clients = isRecord(payload.clients) ? payload.clients : {};
  const schedules = isRecord(payload.schedules) ? payload.schedules : {};
  const documents = isRecord(payload.documents) ? payload.documents : {};

  const activeClients =
    numberValue(payload.activeClients) ??
    numberValue(clients.active);
  const contractsNotSent =
    numberValue(payload.contractsNotSent) ??
    numberValue(documents.notSent) ??
    numberValue(documents.pendingSend);
  const contractsPendingSignature =
    numberValue(payload.contractsPendingSignature) ??
    numberValue(documents.pendingSignatures);
  const upcomingThisMonth =
    numberValue(payload.upcomingThisMonth) ??
    numberValue(schedules.startingThisMonth) ??
    numberValue(schedules.upcomingThisMonth);
  const upcomingNextMonth =
    numberValue(payload.upcomingNextMonth) ??
    numberValue(schedules.startingNextMonth);
  const upcomingWithinWeek = numberValue(payload.upcomingWithinWeek);

  return {
    activeClients: activeClients ?? null,
    contractsNotSent: contractsNotSent ?? null,
    contractsPendingSignature: contractsPendingSignature ?? null,
    upcomingThisMonth: upcomingThisMonth ?? null,
    upcomingNextMonth: upcomingNextMonth ?? null,
    upcomingWithinWeek: upcomingWithinWeek ?? null,
  };
}

/**
 * Counts that can honestly be derived from the client rows the dashboard already shows. The contract
 * counts (발송 필요 / 검토 필요) are decided by the server and are deliberately left `null`.
 */
export function deriveDashboardAnalyticsFromClients(
  clients: DashboardAnalyticsClient[],
  now = new Date(),
): DashboardAnalytics {
  const today = startOfKstDay(now);
  const nextMonthIndex = kstMonthIndex(now) + 1;
  let activeClients = 0;
  let upcomingWithinWeek = 0;
  let upcomingNextMonth = 0;

  for (const client of clients) {
    if (client.serviceStatus === "active") activeClients += 1;
    if (isServiceStartingWithinWeek(client, today)) upcomingWithinWeek += 1;

    const startDate = dateValue(client.startDate);
    if (startDate && client.serviceStatus !== "terminated" && kstMonthIndex(startDate) === nextMonthIndex) {
      upcomingNextMonth += 1;
    }
  }

  return {
    activeClients,
    contractsNotSent: null,
    contractsPendingSignature: null,
    upcomingThisMonth: null,
    upcomingNextMonth,
    upcomingWithinWeek,
  };
}

/** Display form of an analytics count: a real number, or "-" when it is unknown. */
export function formatAnalyticsCount(value: number | null | undefined): string {
  return typeof value === "number" ? String(value) : "-";
}
