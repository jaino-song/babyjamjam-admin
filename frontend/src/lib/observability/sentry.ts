import type { SentryIssue, SentryLevel, SentrySummary } from "./types";
import type { StatsPeriod } from "./stats-period";

const SENTRY_BASE = "https://sentry.io/api/0";
const SENTRY_ORG = process.env.SENTRY_ORG ?? "";
const SENTRY_PROJECT_ID = process.env.SENTRY_PROJECT_ID ?? "4511387543011328";
const SENTRY_TOKEN = process.env.SENTRY_AUTH_TOKEN ?? "";

const REVALIDATE_SECONDS = 60;

export function isSentryConfigured(): boolean {
  return Boolean(SENTRY_TOKEN && SENTRY_ORG);
}

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
  stats?: { "24h"?: Array<[number, number]>; "7d"?: Array<[number, number]>; "30d"?: Array<[number, number]> };
}

async function sentryGet<T>(path: string, revalidate = REVALIDATE_SECONDS): Promise<T | null> {
  if (!isSentryConfigured()) {
    console.warn("[sentry] missing SENTRY_AUTH_TOKEN or SENTRY_ORG");
    return null;
  }
  const url = path.startsWith("http") ? path : `${SENTRY_BASE}${path}`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${SENTRY_TOKEN}` },
      next: { revalidate },
    });
    if (!res.ok) {
      console.warn(`[sentry] ${res.status} ${path}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.warn("[sentry] fetch failed", path, err);
    return null;
  }
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
  const data = await sentryGet<RawIssue[]>(path);
  if (!Array.isArray(data)) return [];
  return data.map(normalizeIssue);
}

export async function getIssuesWithStats(
  statsPeriod: "7d" | "30d" = "7d",
): Promise<{ issues: SentryIssue[]; raw: RawIssue[] }> {
  const params = new URLSearchParams({
    project: SENTRY_PROJECT_ID,
    query: "is:unresolved",
    limit: "100",
    sort: "freq",
    statsPeriod,
  });
  const path = `/organizations/${SENTRY_ORG}/issues/?${params.toString()}`;
  const data = await sentryGet<RawIssue[]>(path);
  if (!Array.isArray(data)) return { issues: [], raw: [] };
  return { issues: data.map(normalizeIssue), raw: data };
}

function seriesForPeriod(raw: RawIssue, statsPeriod: "7d" | "30d"): Array<[number, number]> {
  return raw.stats?.[statsPeriod] ?? raw.stats?.["30d"] ?? raw.stats?.["24h"] ?? [];
}

function buildSparkline(raw: RawIssue[], statsPeriod: "7d" | "30d"): number[] {
  const dailyMap = new Map<string, number>();
  for (const issue of raw) {
    for (const [timestamp, count] of seriesForPeriod(issue, statsPeriod)) {
      const dayKey = new Date(timestamp * 1000).toISOString().slice(0, 10);
      dailyMap.set(dayKey, (dailyMap.get(dayKey) ?? 0) + count);
    }
  }
  const values = Array.from(dailyMap.keys()).sort().map((day) => dailyMap.get(day) ?? 0);
  const length = statsPeriod === "30d" ? 30 : 7;
  const sparkline = values.slice(-length);
  while (sparkline.length < length) sparkline.unshift(0);
  return sparkline;
}

function totalFromSeries(raw: RawIssue[], statsPeriod: "7d" | "30d"): number {
  return raw.reduce(
    (total, issue) => total + seriesForPeriod(issue, statsPeriod).reduce((sum, [, count]) => sum + count, 0),
    0,
  );
}

export async function getSummary(
  options: { statsPeriod?: "7d" | "30d" } = {},
): Promise<SentrySummary> {
  const selectedPeriod = options.statsPeriod ?? "7d";
  const selected = await getIssuesWithStats(selectedPeriod);
  const legacy = selectedPeriod === "7d" ? selected : await getIssuesWithStats("7d");
  const { issues, raw } = selected;
  const legacyIssues = legacy.issues;

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
  const totalEvents7d = legacyIssues.reduce((sum, i) => sum + i.count, 0);
  const affectedUsers = legacyIssues.reduce((sum, i) => sum + i.userCount, 0);
  const lastErrorAt = issues.reduce<string | null>((latest, i) => {
    if (!latest) return i.lastSeen;
    return new Date(i.lastSeen).getTime() > new Date(latest).getTime() ? i.lastSeen : latest;
  }, null);

  const sparkline7d = buildSparkline(legacy.raw, "7d");
  const selectedSparkline = buildSparkline(raw, selectedPeriod);

  return {
    openCount: issues.length,
    newIn24h,
    severity,
    topIssue,
    totalEvents7d,
    affectedUsers,
    lastErrorAt,
    sparkline7d,
    selectedRange: {
      days: selectedPeriod === "30d" ? 30 : 7,
      totalEvents: totalFromSeries(raw, selectedPeriod),
      affectedUsers: issues.reduce((sum, i) => sum + i.userCount, 0),
      sparkline: selectedSparkline,
    },
  };
}

export async function getEventTrend(
  period: StatsPeriod = 7,
): Promise<Array<{ timestamp: string; count: number }>> {
  const statsPeriod = period === 30 ? "30d" : "7d";
  const { raw } = await getIssuesWithStats(statsPeriod);
  const map = new Map<number, number>();
  for (const issue of raw) {
    for (const [timestamp, count] of seriesForPeriod(issue, statsPeriod)) {
      map.set(timestamp, (map.get(timestamp) ?? 0) + count);
    }
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a - b)
    .map(([timestamp, count]) => ({
      timestamp: new Date(timestamp * 1000).toISOString(),
      count,
    }));
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
