export interface DashboardAnalytics {
  activeClients: number;
  contractsNotSent: number;
  contractsPendingSignature: number;
  upcomingThisMonth: number;
  upcomingNextMonth: number;
}

export interface DashboardAnalyticsClient {
  serviceStatus: string | null;
  startDate: string | null;
  eDocId: string | null;
  documentStatus: string | null;
}

const CONTRACT_START_WINDOW_DAYS = 7;
const SERVICE_START_WINDOW_DAYS = 7;
const EXCLUDED_CONTRACT_START_SERVICE_STATUSES = new Set(["completed", "terminated"]);
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

function startOfDay(date: Date) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  return start;
}

function endOfDay(date: Date) {
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  return end;
}

export function isContractIncompleteNearServiceStart(
  client: DashboardAnalyticsClient,
  now = new Date(),
): boolean {
  const serviceStatus = client.serviceStatus ?? "";
  if (EXCLUDED_CONTRACT_START_SERVICE_STATUSES.has(serviceStatus)) return false;
  if (client.documentStatus === "completed") return false;

  const startDate = dateValue(client.startDate);
  if (!startDate) return false;

  const windowStart = startOfDay(now);
  windowStart.setDate(windowStart.getDate() - CONTRACT_START_WINDOW_DAYS);

  const windowEnd = endOfDay(now);
  windowEnd.setDate(windowEnd.getDate() + CONTRACT_START_WINDOW_DAYS);

  return startDate >= windowStart && startDate <= windowEnd;
}

export function isServiceStartingWithinWeek(
  client: DashboardAnalyticsClient,
  now = new Date(),
): boolean {
  const serviceStatus = client.serviceStatus ?? "";
  if (EXCLUDED_UPCOMING_SERVICE_STATUSES.has(serviceStatus)) return false;

  const startDate = dateValue(client.startDate);
  if (!startDate) return false;

  const windowStart = startOfDay(now);
  const windowEnd = endOfDay(now);
  windowEnd.setDate(windowEnd.getDate() + SERVICE_START_WINDOW_DAYS);

  return startDate >= windowStart && startDate <= windowEnd;
}

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
    numberValue(schedules.startingNextMonth) ??
    0;

  if (
    activeClients === undefined &&
    contractsNotSent === undefined &&
    contractsPendingSignature === undefined &&
    upcomingThisMonth === undefined
  ) {
    return null;
  }

  return {
    activeClients: activeClients ?? 0,
    contractsNotSent: contractsNotSent ?? 0,
    contractsPendingSignature: contractsPendingSignature ?? 0,
    upcomingThisMonth: upcomingThisMonth ?? 0,
    upcomingNextMonth,
  };
}

export function deriveDashboardAnalyticsFromClients(
  clients: DashboardAnalyticsClient[],
  now = new Date(),
): DashboardAnalytics {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  const followingMonth = new Date(today.getFullYear(), today.getMonth() + 2, 1);

  return clients.reduce<DashboardAnalytics>(
    (acc, client) => {
      if (client.serviceStatus === "active") {
        acc.activeClients += 1;
      }

      const startDate = dateValue(client.startDate);
      if (isServiceStartingWithinWeek(client, today)) {
        acc.upcomingThisMonth += 1;
      }

      if (startDate && client.serviceStatus !== "terminated") {
        startDate.setHours(0, 0, 0, 0);
        if (startDate >= nextMonth && startDate < followingMonth) {
          acc.upcomingNextMonth += 1;
        }
      }

      if (client.eDocId && client.documentStatus && client.documentStatus !== "completed") {
        acc.contractsPendingSignature += 1;
      }

      if (isContractIncompleteNearServiceStart(client, today)) {
        acc.contractsNotSent += 1;
      }

      return acc;
    },
    {
      activeClients: 0,
      contractsNotSent: 0,
      contractsPendingSignature: 0,
      upcomingThisMonth: 0,
      upcomingNextMonth: 0,
    },
  );
}
