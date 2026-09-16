import type { SentryIssue, SentryLevel, SentrySummary } from "./types";

const SENTRY_BASE = "https://sentry.io/api/0";
const SENTRY_ORG = process.env.SENTRY_ORG ?? "";
const SENTRY_PROJECT_ID = process.env.SENTRY_PROJECT_ID ?? "4511387543011328";
const SENTRY_TOKEN = process.env.SENTRY_AUTH_TOKEN ?? "";

const REVALIDATE_SECONDS = 60;

interface RawIssue {
  id: string;
  title: string;
  level: SentryLevel;
  count: string | number;
  userCount: number;
  lastSeen: string;
  firstSeen: string;
  permalink: string;
  culprit?: string | null;
  metadata?: { filename?: string; function?: string };
  stats?: { "24h"?: Array<[number, number]>; "30d"?: Array<[number, number]> };
}

async function sentryGet<T>(path: string, revalidate = REVALIDATE_SECONDS): Promise<T> {
  if (!SENTRY_TOKEN || !SENTRY_ORG) {
    throw new Error("Sentry statistics are not configured");
  }
  const url = path.startsWith("http") ? path : `${SENTRY_BASE}${path}`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${SENTRY_TOKEN}` },
      next: { revalidate },
    });
    if (!res.ok) {
      throw new Error("Sentry query failed");
    }
    return (await res.json()) as T;
  } catch {
    throw new Error("Sentry statistics are unavailable");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validCount(value: unknown): boolean {
  return (typeof value === "number" || (typeof value === "string" && value.trim() !== "")) &&
    Number.isSafeInteger(Number(value)) && Number(value) >= 0;
}

function validSeries(value: unknown): boolean {
  return Array.isArray(value) && value.every((point) =>
    Array.isArray(point) && point.length === 2 &&
    typeof point[0] === "number" && Number.isFinite(new Date(point[0] * 1000).getTime()) &&
    typeof point[1] === "number" && validCount(point[1])
  );
}

function validIssue(value: unknown): value is RawIssue {
  if (!isRecord(value)) return false;
  if (!["id", "title", "level", "permalink"].every((key) =>
    typeof value[key] === "string" && value[key].trim() !== ""
  )) return false;
  if (!validCount(value.count) || typeof value.userCount !== "number" || !validCount(value.userCount)) return false;
  if (!["firstSeen", "lastSeen"].every((key) =>
    typeof value[key] === "string" && Number.isFinite(Date.parse(value[key]))
  )) return false;
  if (value.culprit != null && typeof value.culprit !== "string") return false;
  if (value.metadata != null && (!isRecord(value.metadata) ||
    ![value.metadata.filename, value.metadata.function].every((item) => item == null || typeof item === "string")
  )) return false;
  const stats = value.stats;
  if (stats != null && (!isRecord(stats) ||
    !["24h", "30d"].every((key) => !(key in stats) || validSeries(stats[key]))
  )) return false;
  return true;
}

function parseIssues(value: unknown): RawIssue[] {
  if (!Array.isArray(value) || !value.every(validIssue)) {
    throw new Error("Invalid Sentry statistics response");
  }
  return value;
}

function normalizeIssue(raw: RawIssue): SentryIssue {
  return {
    id: raw.id,
    title: raw.title,
    level: raw.level,
    count: Number(raw.count ?? 0),
    userCount: raw.userCount ?? 0,
    lastSeen: raw.lastSeen,
    firstSeen: raw.firstSeen,
    permalink: raw.permalink,
    culprit: raw.culprit ?? null,
    filename: raw.metadata?.filename ?? null,
    function: raw.metadata?.function ?? null,
  };
}

export async function getOpenIssues(
  options: { limit?: number; statsPeriod?: "24h" | "7d" | "30d"; query?: string } = {}
): Promise<SentryIssue[]> {
  const { limit = 25, statsPeriod = "24h", query = "is:unresolved" } = options;
  const params = new URLSearchParams({
    project: SENTRY_PROJECT_ID,
    query,
    limit: String(limit),
    sort: "freq",
    statsPeriod,
  });
  const path = `/organizations/${SENTRY_ORG}/issues/?${params.toString()}`;
  const data = parseIssues(await sentryGet<unknown>(path));
  return data.map(normalizeIssue);
}

export async function getIssuesWithStats(): Promise<{ issues: SentryIssue[]; raw: RawIssue[] }> {
  const params = new URLSearchParams({
    project: SENTRY_PROJECT_ID,
    query: "is:unresolved",
    limit: "100",
    sort: "freq",
    statsPeriod: "7d",
  });
  const path = `/organizations/${SENTRY_ORG}/issues/?${params.toString()}`;
  const data = parseIssues(await sentryGet<unknown>(path));
  return { issues: data.map(normalizeIssue), raw: data };
}

export async function getSummary(): Promise<SentrySummary> {
  const { issues, raw } = await getIssuesWithStats();

  const oneDay = 24 * 60 * 60 * 1000;
  const now = Date.now();

  const newIn24h = issues.filter(
    (i) => now - new Date(i.firstSeen).getTime() < oneDay
  ).length;

  const severity = {
    critical: issues.filter((i) => i.level === "fatal").length,
    error: issues.filter((i) => i.level === "error").length,
    warning: issues.filter((i) => i.level === "warning").length,
    info: issues.filter((i) => i.level === "info").length,
  };

  const topIssue = issues[0] ?? null;
  const totalEvents7d = issues.reduce((sum, i) => sum + i.count, 0);
  const affectedUsers = issues.reduce((sum, i) => sum + i.userCount, 0);
  const lastErrorAt = issues.reduce<string | null>((latest, i) => {
    if (!latest) return i.lastSeen;
    return new Date(i.lastSeen).getTime() > new Date(latest).getTime() ? i.lastSeen : latest;
  }, null);

  // Daily event counts from 30d stats (aggregate across issues)
  const dailyMap = new Map<string, number>();
  for (const r of raw) {
    const series = r.stats?.["30d"] ?? r.stats?.["24h"] ?? [];
    for (const [ts, count] of series) {
      const dayKey = new Date(ts * 1000).toISOString().slice(0, 10);
      dailyMap.set(dayKey, (dailyMap.get(dayKey) ?? 0) + count);
    }
  }
  const sortedDays = Array.from(dailyMap.keys()).sort();
  const last7Days = sortedDays.slice(-7);
  const sparkline7d = last7Days.map((d) => dailyMap.get(d) ?? 0);
  while (sparkline7d.length < 7) sparkline7d.unshift(0);

  return {
    openCount: issues.length,
    newIn24h,
    severity,
    topIssue,
    totalEvents7d,
    affectedUsers,
    lastErrorAt,
    sparkline7d,
  };
}

export async function get24hEventTrend(): Promise<Array<{ timestamp: string; count: number }>> {
  // Aggregate 24h stats from all open issues
  const { raw } = await getIssuesWithStats();
  const map = new Map<number, number>();
  for (const r of raw) {
    const series = r.stats?.["24h"] ?? [];
    for (const [ts, count] of series) {
      map.set(ts, (map.get(ts) ?? 0) + count);
    }
  }
  const sorted = Array.from(map.entries()).sort(([a], [b]) => a - b);
  return sorted.map(([ts, count]) => ({
    timestamp: new Date(ts * 1000).toISOString(),
    count,
  }));
}

export function formatSentryRelativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  return `${days}일 전`;
}
