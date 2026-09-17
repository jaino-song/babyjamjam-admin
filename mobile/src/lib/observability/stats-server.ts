import type { SentryIssue, SentryLevel } from "./stats-types";
import type { StatsPeriod } from "./stats-period";

const POSTHOG_HOST = process.env.POSTHOG_HOST ?? "https://us.posthog.com";
const POSTHOG_API_KEY = process.env.POSTHOG_API_KEY ?? "";
const POSTHOG_PROJECT_ID = process.env.POSTHOG_PROJECT_ID ?? "";
const SENTRY_BASE = "https://sentry.io/api/0";
const SENTRY_ORG = process.env.SENTRY_ORG ?? "";
const SENTRY_PROJECT_ID = process.env.SENTRY_PROJECT_ID ?? "4511387543011328";
const SENTRY_AUTH_TOKEN = process.env.SENTRY_AUTH_TOKEN ?? "";
const REVALIDATE_SECONDS = 60;

export type StatsSourceState = "ready" | "unavailable" | "error";

export interface StatsAvailability {
  posthog: StatsSourceState;
  sentry: StatsSourceState;
}

export interface InquirySummary {
  today: number;
  yesterday: number;
  sevenDayTotal: number;
  sevenDayAvg: number;
  thirtyDayTotal: number;
  lastSubmissionAt: string | null;
  /** Null when the source does not carry enough dimensions to attribute conversion. */
  conversionRate: number | null;
  selectedRange: {
    days: StatsPeriod;
    total: number;
    average: number;
    conversionRate: number | null;
  };
}

export interface InquiryDailyPoint { day: string; count: number }
export interface InquiryHourlyPoint { hour: number; count: number }
export interface InquiryByBranchRow { branchSlug: string; count: number }
export interface RecentInquiry {
  distinctId: string;
  branchSlug: string | null;
  source: string | null;
  pathname: string | null;
  deviceType: string | null;
  timestamp: string;
}

export interface FunnelStep {
  step: number;
  event: string;
  label: string;
  count: number;
  pct: number;
  dropFromPrevPct: number;
}
export interface FunnelSummary {
  steps: FunnelStep[];
  conversionRate: number;
  biggestDropStep: number | null;
  completedConversions: number;
  totalEntries: number;
}
export interface FunnelTrendPoint { day: string; conversionRate: number }
export interface PageDetailRow { path: string; pv: number; unique: number; entries: number; exits: number; bouncePct: number }
export interface PageEntryExitRow { path: string; count: number; pct: number }
export interface PageTransitionRow { fromPath: string; toPath: string; count: number; pct: number }
export interface PageNavSummary { activePages: number; totalPv: number; avgPvPerPage: number; avgBouncePct: number }

export interface TrafficSummary {
  today: { pv: number; unique: number };
  yesterday: { pv: number; unique: number };
  sevenDayTotal: { pv: number; unique: number };
  avgSessionSeconds: number;
  bounceRate: number;
  selectedRange: {
    days: StatsPeriod;
    total: { pv: number; unique: number };
    avgSessionSeconds: number;
    bounceRate: number;
  };
}
export interface TrafficTrendPoint { day: string; pv: number; unique: number }
export interface TopPageRow { path: string; pv: number; unique: number; avgTimeSeconds: number | null }
export interface ShareRow { label: string; count: number; pct: number }
export interface ErrorSummary {
  openCount: number;
  newIn24h: number;
  totalEvents7d: number;
  affectedUsers: number;
  lastErrorAt: string | null;
  severity: { critical: number; error: number; warning: number; info: number };
  sparkline7d: number[];
  topIssue: SentryIssue | null;
  selectedRange: {
    days: StatsPeriod;
    totalEvents: number;
    affectedUsers: number;
    sparkline: number[];
  };
}
export interface ErrorTrendPoint { timestamp: string; count: number }

export interface StatsViewData {
  overview: {
    errors: ErrorSummary | null;
    inquiries: InquirySummary | null;
    funnel: FunnelSummary | null;
    traffic: TrafficSummary | null;
    topPages: TopPageRow[] | null;
    devices: ShareRow[] | null;
  };
  errors: { summary: ErrorSummary; trend: ErrorTrendPoint[]; issues: SentryIssue[] };
  inquiries: { summary: InquirySummary; daily: InquiryDailyPoint[]; hourly: InquiryHourlyPoint[]; byBranch: InquiryByBranchRow[]; recent: RecentInquiry[] };
  funnel: { summary: FunnelSummary; trend: FunnelTrendPoint[]; nav: PageNavSummary; pages: PageDetailRow[]; entries: PageEntryExitRow[]; exits: PageEntryExitRow[]; transitions: PageTransitionRow[] };
  traffic: { summary: TrafficSummary; trend: TrafficTrendPoint[]; topPages: TopPageRow[]; devices: ShareRow[]; browsers: ShareRow[]; sources: ShareRow[]; regions: ShareRow[] };
}

export interface StatsViewResponse<TView extends keyof StatsViewData = keyof StatsViewData> {
  view: TView;
  /** The selected historical range. Optional for callers that still deserialize a legacy response. */
  period?: StatsPeriod;
  availability: StatsAvailability;
  state: StatsSourceState;
  data: StatsViewData[TView] | null;
}

interface HogQLResponse { results?: unknown[][]; error?: string }
interface RawSentryIssue {
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

function safeNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function safeString(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  const result = String(value);
  return result === "null" ? null : result;
}

function sanitizeBranchSlug(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || !/^[a-zA-Z0-9_-]+$/.test(value)) return null;
  return value;
}

export function isValidStatsBranchSlug(value: unknown): value is string {
  return sanitizeBranchSlug(value) !== null;
}

function branchFilter(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  const branch = sanitizeBranchSlug(value);
  return branch ? `AND properties.branch_slug = '${branch}'` : "AND 1 = 0";
}

function posthogConfigured(): boolean {
  return Boolean(POSTHOG_API_KEY && POSTHOG_PROJECT_ID);
}

async function hogQL<Row extends unknown[]>(query: string): Promise<{ rows: Row[]; state: StatsSourceState }> {
  if (!posthogConfigured()) return { rows: [], state: "unavailable" };
  try {
    const response = await fetch(`${POSTHOG_HOST}/api/projects/${POSTHOG_PROJECT_ID}/query/`, {
      method: "POST",
      headers: { Authorization: `Bearer ${POSTHOG_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
      next: { revalidate: REVALIDATE_SECONDS },
    });
    if (!response.ok) return { rows: [], state: "error" };
    const payload = (await response.json()) as HogQLResponse;
    if (payload.error) return { rows: [], state: "error" };
    return { rows: (payload.results ?? []) as Row[], state: "ready" };
  } catch {
    return { rows: [], state: "error" };
  }
}

function posthogAvailability(results: readonly { state: StatsSourceState }[]): StatsSourceState {
  if (!posthogConfigured()) return "unavailable";
  if (results.some((result) => result.state === "error")) return "error";
  return "ready";
}

async function queryInquirySummary(branchSlug: string | null, days: StatsPeriod): Promise<{ value: InquirySummary | null; state: StatsSourceState }> {
  const filter = branchFilter(branchSlug);
  const submittedSevenQuery = hogQL<[number]>(`SELECT count() FROM events WHERE event = 'consultation_submitted' AND timestamp >= now() - INTERVAL 7 DAY ${filter}`);
  const submittedSelectedQuery = days === 7
    ? submittedSevenQuery
    : hogQL<[number]>(`SELECT count() FROM events WHERE event = 'consultation_submitted' AND timestamp >= now() - INTERVAL ${days} DAY ${filter}`);
  const viewedSevenQuery = branchSlug === null
    ? hogQL<[number]>("SELECT count() FROM events WHERE event = 'pricing_viewed' AND timestamp >= now() - INTERVAL 7 DAY")
    : Promise.resolve({ rows: [] as [number][], state: "unavailable" as StatsSourceState });
  const viewedSelectedQuery = days === 7
    ? viewedSevenQuery
    : branchSlug === null
      ? hogQL<[number]>(`SELECT count() FROM events WHERE event = 'pricing_viewed' AND timestamp >= now() - INTERVAL ${days} DAY`)
      : Promise.resolve({ rows: [] as [number][], state: "unavailable" as StatsSourceState });
  const [summary, submittedSeven, submitted, viewedSeven, viewed] = await Promise.all([
    hogQL<[number, number, number, number, string | null]>(`SELECT countIf(toDate(timestamp) = today()), countIf(toDate(timestamp) = today() - 1), countIf(timestamp >= now() - INTERVAL 7 DAY), countIf(timestamp >= now() - INTERVAL 30 DAY), max(timestamp) FROM events WHERE event = 'consultation_submitted' AND timestamp >= now() - INTERVAL 30 DAY ${filter}`),
    submittedSevenQuery,
    submittedSelectedQuery,
    viewedSevenQuery,
    viewedSelectedQuery,
  ]);
  const state = posthogAvailability(branchSlug === null ? [summary, submittedSeven, submitted, viewedSeven, viewed] : [summary, submittedSeven, submitted]);
  if (state !== "ready") return { value: null, state };
  const row = summary.rows[0];
  const sevenDay = safeNumber(row?.[2]);
  const selectedTotal = days === 30 ? safeNumber(row?.[3]) : safeNumber(submitted.rows[0]?.[0]);
  const views = safeNumber(viewedSeven.rows[0]?.[0]);
  const selectedViews = safeNumber(viewed.rows[0]?.[0]);
  return {
    state,
    value: {
      today: safeNumber(row?.[0]),
      yesterday: safeNumber(row?.[1]),
      sevenDayTotal: sevenDay,
      sevenDayAvg: sevenDay / 7,
      thirtyDayTotal: safeNumber(row?.[3]),
      lastSubmissionAt: safeString(row?.[4]),
      conversionRate: branchSlug === null ? (views > 0 ? (safeNumber(submittedSeven.rows[0]?.[0]) / views) * 100 : 0) : null,
      selectedRange: {
        days,
        total: selectedTotal,
        average: selectedTotal / days,
        conversionRate: branchSlug === null ? (selectedViews > 0 ? (selectedTotal / selectedViews) * 100 : 0) : null,
      },
    },
  };
}

async function queryInquiries(branchSlug: string | null, days: StatsPeriod): Promise<{ data: StatsViewData["inquiries"] | null; state: StatsSourceState }> {
  const filter = branchFilter(branchSlug);
  const [summary, daily, hourly, byBranch, recent] = await Promise.all([
    queryInquirySummary(branchSlug, days),
    hogQL<[string, number]>(`SELECT toDate(timestamp), count() FROM events WHERE event = 'consultation_submitted' AND timestamp >= now() - INTERVAL ${days} DAY ${filter} GROUP BY toDate(timestamp) ORDER BY toDate(timestamp) ASC`),
    hogQL<[number, number]>(`SELECT toHour(timestamp), count() FROM events WHERE event = 'consultation_submitted' AND toDate(timestamp) = today() ${filter} GROUP BY toHour(timestamp) ORDER BY toHour(timestamp) ASC`),
    hogQL<[string, number]>(`SELECT properties.branch_slug, count() FROM events WHERE event = 'consultation_submitted' AND timestamp >= now() - INTERVAL ${days} DAY AND properties.branch_slug IS NOT NULL ${filter} GROUP BY properties.branch_slug ORDER BY count() DESC`),
    hogQL<[string, string | null, string | null, string | null, string | null, string]>(`SELECT distinct_id, properties.branch_slug, properties.source, properties.pathname, properties.$device_type, timestamp FROM events WHERE event = 'consultation_submitted' AND timestamp >= now() - INTERVAL ${days} DAY ${filter} ORDER BY timestamp DESC LIMIT 10`),
  ]);
  const states = [summary, daily, hourly, byBranch, recent];
  const state = summary.state === "unavailable" ? "unavailable" : posthogAvailability(states.map((item) => "state" in item ? item : { state: "ready" }));
  if (state !== "ready" || !summary.value) return { data: null, state };
  return {
    state,
    data: {
      summary: summary.value,
      daily: daily.rows.map(([day, count]) => ({ day: safeString(day) ?? "", count: safeNumber(count) })),
      hourly: Array.from({ length: 24 }, (_, hour) => ({ hour, count: safeNumber(hourly.rows.find(([candidate]) => safeNumber(candidate) === hour)?.[1]) })),
      byBranch: byBranch.rows.map(([branch, count]) => ({ branchSlug: safeString(branch) ?? "unknown", count: safeNumber(count) })),
      recent: recent.rows.map(([distinctId, branch, source, pathname, device, timestamp]) => ({ distinctId: String(distinctId).slice(-8), branchSlug: safeString(branch), source: safeString(source), pathname: safeString(pathname), deviceType: safeString(device), timestamp: String(timestamp) })),
    },
  };
}

const FUNNEL_STEPS: ReadonlyArray<{ event: string; label: string }> = [
  { event: "pricing_viewed", label: "가격 페이지 진입" },
  { event: "pricing_quote_loaded", label: "견적 로딩 완료" },
  { event: "consultation_modal_opened", label: "상담 모달 오픈" },
  { event: "consultation_form_started", label: "폼 입력 시작" },
  { event: "consultation_submitted", label: "상담 제출 완료" },
];

async function queryFunnelSummary(days = 7): Promise<{ value: FunnelSummary | null; state: StatsSourceState }> {
  const results = await Promise.all(FUNNEL_STEPS.map((step) => hogQL<[number]>(`SELECT count() FROM events WHERE event = '${step.event}' AND timestamp >= now() - INTERVAL ${days} DAY`)));
  const state = posthogAvailability(results);
  if (state !== "ready") return { value: null, state };
  const counts = results.map((result) => safeNumber(result.rows[0]?.[0]));
  const steps = FUNNEL_STEPS.map((step, index) => ({ step: index + 1, event: step.event, label: step.label, count: counts[index], pct: counts[0] > 0 ? (counts[index] / counts[0]) * 100 : 0, dropFromPrevPct: index === 0 ? 0 : counts[index - 1] > 0 ? (1 - counts[index] / counts[index - 1]) * 100 : 0 }));
  let biggestDropStep: number | null = null;
  let biggestDrop = 0;
  for (const step of steps.slice(1)) {
    if (step.dropFromPrevPct > biggestDrop) { biggestDrop = step.dropFromPrevPct; biggestDropStep = step.step; }
  }
  return { state, value: { steps, conversionRate: steps.at(-1)?.pct ?? 0, biggestDropStep, completedConversions: counts.at(-1) ?? 0, totalEntries: counts[0] ?? 0 } };
}

async function queryFunnel(days: StatsPeriod): Promise<{ data: StatsViewData["funnel"] | null; state: StatsSourceState }> {
  const [summary, trend, nav, bounce, pages, entries, exits, transitions] = await Promise.all([
    queryFunnelSummary(days),
    hogQL<[string, number, number]>(`SELECT toDate(timestamp), countIf(event = 'pricing_viewed'), countIf(event = 'consultation_submitted') FROM events WHERE event IN ('pricing_viewed', 'consultation_submitted') AND timestamp >= now() - INTERVAL ${days} DAY GROUP BY toDate(timestamp) ORDER BY toDate(timestamp) ASC`),
    hogQL<[number, number]>(`SELECT uniq(properties.$pathname), count() FROM events WHERE event = '$pageview' AND timestamp >= now() - INTERVAL ${days} DAY AND properties.$pathname IS NOT NULL`),
    hogQL<[number, number]>(`SELECT countIf(pv_count = 1), count() FROM (SELECT properties.$session_id, count() AS pv_count FROM events WHERE event = '$pageview' AND timestamp >= now() - INTERVAL ${days} DAY AND properties.$session_id IS NOT NULL GROUP BY properties.$session_id)`),
    hogQL<[string, number, number, number, number, number]>(`SELECT pages.path, pages.pv, pages.unique, entries.cnt, exits.cnt, bounces.cnt FROM (SELECT properties.$pathname AS path, count() AS pv, uniq(distinct_id) AS unique FROM events WHERE event = '$pageview' AND timestamp >= now() - INTERVAL ${days} DAY AND properties.$pathname IS NOT NULL GROUP BY path) AS pages LEFT JOIN (SELECT first_path AS path, count() AS cnt FROM (SELECT argMin(properties.$pathname, timestamp) AS first_path FROM events WHERE event = '$pageview' AND timestamp >= now() - INTERVAL ${days} DAY AND properties.$session_id IS NOT NULL AND properties.$pathname IS NOT NULL GROUP BY properties.$session_id) GROUP BY first_path) AS entries ON entries.path = pages.path LEFT JOIN (SELECT last_path AS path, count() AS cnt FROM (SELECT argMax(properties.$pathname, timestamp) AS last_path FROM events WHERE event = '$pageview' AND timestamp >= now() - INTERVAL ${days} DAY AND properties.$session_id IS NOT NULL AND properties.$pathname IS NOT NULL GROUP BY properties.$session_id) GROUP BY last_path) AS exits ON exits.path = pages.path LEFT JOIN (SELECT first_path AS path, count() AS cnt FROM (SELECT argMin(properties.$pathname, timestamp) AS first_path, count() AS pv_in_session FROM events WHERE event = '$pageview' AND timestamp >= now() - INTERVAL ${days} DAY AND properties.$session_id IS NOT NULL AND properties.$pathname IS NOT NULL GROUP BY properties.$session_id HAVING pv_in_session = 1) GROUP BY first_path) AS bounces ON bounces.path = pages.path ORDER BY pages.pv DESC LIMIT 20`),
    hogQL<[string, number]>(`SELECT first_path, count() FROM (SELECT argMin(properties.$pathname, timestamp) AS first_path FROM events WHERE event = '$pageview' AND timestamp >= now() - INTERVAL ${days} DAY AND properties.$session_id IS NOT NULL AND properties.$pathname IS NOT NULL GROUP BY properties.$session_id) WHERE first_path IS NOT NULL GROUP BY first_path ORDER BY count() DESC LIMIT 8`),
    hogQL<[string, number]>(`SELECT last_path, count() FROM (SELECT argMax(properties.$pathname, timestamp) AS last_path FROM events WHERE event = '$pageview' AND timestamp >= now() - INTERVAL ${days} DAY AND properties.$session_id IS NOT NULL AND properties.$pathname IS NOT NULL GROUP BY properties.$session_id) WHERE last_path IS NOT NULL GROUP BY last_path ORDER BY count() DESC LIMIT 8`),
    hogQL<[string, string, number]>(`SELECT pair.1, pair.2, count() FROM (SELECT arrayJoin(arrayMap(i -> tuple(paths[i], paths[i+1]), range(1, length(paths)))) AS pair FROM (SELECT arrayMap(x -> x.2, arraySort(x -> x.1, groupArray(tuple(timestamp, properties.$pathname)))) AS paths FROM events WHERE event = '$pageview' AND timestamp >= now() - INTERVAL ${days} DAY AND properties.$session_id IS NOT NULL AND properties.$pathname IS NOT NULL GROUP BY properties.$session_id HAVING length(paths) >= 2)) WHERE pair.1 != pair.2 GROUP BY pair.1, pair.2 ORDER BY count() DESC LIMIT 12`),
  ]);
  const queryResults = [trend, nav, bounce, pages, entries, exits, transitions];
  const state = summary.state === "unavailable" ? "unavailable" : posthogAvailability([summary, ...queryResults]);
  if (state !== "ready" || !summary.value) return { data: null, state };
  const pageRows = pages.rows.map(([path, pv, unique, entry, exit, bounceCount]) => { const entriesCount = safeNumber(entry); return { path: safeString(path) ?? "(unknown)", pv: safeNumber(pv), unique: safeNumber(unique), entries: entriesCount, exits: safeNumber(exit), bouncePct: entriesCount > 0 ? (safeNumber(bounceCount) / entriesCount) * 100 : 0 }; });
  const makeShare = (rows: Array<[string, number]>): PageEntryExitRow[] => { const total = rows.reduce((sum, row) => sum + safeNumber(row[1]), 0); return rows.map(([path, count]) => ({ path: safeString(path) ?? "(unknown)", count: safeNumber(count), pct: total > 0 ? (safeNumber(count) / total) * 100 : 0 })); };
  const transitionsTotal = transitions.rows.reduce((sum, row) => sum + safeNumber(row[2]), 0);
  const activePages = safeNumber(nav.rows[0]?.[0]);
  const totalPv = safeNumber(nav.rows[0]?.[1]);
  const totalSessions = safeNumber(bounce.rows[0]?.[1]);
  return { state, data: { summary: summary.value, trend: trend.rows.map(([day, entriesCount, completions]) => { const e = safeNumber(entriesCount); return { day: safeString(day) ?? "", conversionRate: e > 0 ? (safeNumber(completions) / e) * 100 : 0 }; }), nav: { activePages, totalPv, avgPvPerPage: activePages > 0 ? totalPv / activePages : 0, avgBouncePct: totalSessions > 0 ? (safeNumber(bounce.rows[0]?.[0]) / totalSessions) * 100 : 0 }, pages: pageRows, entries: makeShare(entries.rows), exits: makeShare(exits.rows), transitions: transitions.rows.map(([fromPath, toPath, count]) => ({ fromPath: safeString(fromPath) ?? "(unknown)", toPath: safeString(toPath) ?? "(unknown)", count: safeNumber(count), pct: transitionsTotal > 0 ? (safeNumber(count) / transitionsTotal) * 100 : 0 })) } };
}

async function queryTrafficSummary(days: StatsPeriod): Promise<{ value: TrafficSummary | null; state: StatsSourceState }> {
  const bounceSevenQuery = hogQL<[number, number]>("SELECT countIf(pv_count = 1), count() FROM (SELECT properties.$session_id, count() AS pv_count FROM events WHERE event = '$pageview' AND timestamp >= now() - INTERVAL 7 DAY AND properties.$session_id IS NOT NULL GROUP BY properties.$session_id)");
  const bounceSelectedQuery = days === 7
    ? bounceSevenQuery
    : hogQL<[number, number]>(`SELECT countIf(pv_count = 1), count() FROM (SELECT properties.$session_id, count() AS pv_count FROM events WHERE event = '$pageview' AND timestamp >= now() - INTERVAL ${days} DAY AND properties.$session_id IS NOT NULL GROUP BY properties.$session_id)`);
  const sessionsSevenQuery = hogQL<[number]>("SELECT avg(duration_s) FROM (SELECT properties.$session_id, dateDiff('second', min(timestamp), max(timestamp)) AS duration_s FROM events WHERE timestamp >= now() - INTERVAL 7 DAY AND properties.$session_id IS NOT NULL GROUP BY properties.$session_id HAVING count() >= 2)");
  const sessionsSelectedQuery = days === 7
    ? sessionsSevenQuery
    : hogQL<[number]>(`SELECT avg(duration_s) FROM (SELECT properties.$session_id, dateDiff('second', min(timestamp), max(timestamp)) AS duration_s FROM events WHERE timestamp >= now() - INTERVAL ${days} DAY AND properties.$session_id IS NOT NULL GROUP BY properties.$session_id HAVING count() >= 2)`);
  const [summary, bounceSeven, bounceSelected, sessionsSeven, sessionsSelected] = await Promise.all([
    hogQL<[number, number, number, number, number, number, number, number]>(`SELECT countIf(toDate(timestamp) = today()), uniqIf(distinct_id, toDate(timestamp) = today()), countIf(toDate(timestamp) = today() - 1), uniqIf(distinct_id, toDate(timestamp) = today() - 1), countIf(timestamp >= now() - INTERVAL 7 DAY), uniqIf(distinct_id, timestamp >= now() - INTERVAL 7 DAY), countIf(timestamp >= now() - INTERVAL ${days} DAY), uniqIf(distinct_id, timestamp >= now() - INTERVAL ${days} DAY) FROM events WHERE event = '$pageview' AND timestamp >= now() - INTERVAL ${days} DAY`),
    bounceSevenQuery,
    bounceSelectedQuery,
    sessionsSevenQuery,
    sessionsSelectedQuery,
  ]);
  const state = posthogAvailability([summary, bounceSeven, bounceSelected, sessionsSeven, sessionsSelected]);
  if (state !== "ready") return { value: null, state };
  const row = summary.rows[0];
  const sevenSessions = safeNumber(bounceSeven.rows[0]?.[1]);
  const selectedSessions = safeNumber(bounceSelected.rows[0]?.[1]);
  return {
    state,
    value: {
      today: { pv: safeNumber(row?.[0]), unique: safeNumber(row?.[1]) },
      yesterday: { pv: safeNumber(row?.[2]), unique: safeNumber(row?.[3]) },
      sevenDayTotal: { pv: safeNumber(row?.[4]), unique: safeNumber(row?.[5]) },
      avgSessionSeconds: safeNumber(sessionsSeven.rows[0]?.[0]),
      bounceRate: sevenSessions > 0 ? (safeNumber(bounceSeven.rows[0]?.[0]) / sevenSessions) * 100 : 0,
      selectedRange: {
        days,
        total: { pv: safeNumber(row?.[6]), unique: safeNumber(row?.[7]) },
        avgSessionSeconds: safeNumber(sessionsSelected.rows[0]?.[0]),
        bounceRate: selectedSessions > 0 ? (safeNumber(bounceSelected.rows[0]?.[0]) / selectedSessions) * 100 : 0,
      },
    },
  };
}

async function queryTraffic(days: StatsPeriod): Promise<{ data: StatsViewData["traffic"] | null; state: StatsSourceState }> {
  const [summary, trend, topPages, devices, browsers, sources, regions] = await Promise.all([
    queryTrafficSummary(days),
    hogQL<[string, number, number]>(`SELECT toDate(timestamp), count(), uniq(distinct_id) FROM events WHERE event = '$pageview' AND timestamp >= now() - INTERVAL ${days} DAY GROUP BY toDate(timestamp) ORDER BY toDate(timestamp) ASC`),
    hogQL<[string, number, number]>(`SELECT properties.$pathname, count(), uniq(distinct_id) FROM events WHERE event = '$pageview' AND timestamp >= now() - INTERVAL ${days} DAY AND properties.$pathname IS NOT NULL GROUP BY properties.$pathname ORDER BY count() DESC LIMIT 10`),
    hogQL<[string, number]>(`SELECT properties.$device_type, count() FROM events WHERE event = '$pageview' AND timestamp >= now() - INTERVAL ${days} DAY AND properties.$device_type IS NOT NULL GROUP BY properties.$device_type ORDER BY count() DESC`),
    hogQL<[string, number]>(`SELECT coalesce(properties.$browser, 'Other'), count() FROM events WHERE event = '$pageview' AND timestamp >= now() - INTERVAL ${days} DAY GROUP BY properties.$browser ORDER BY count() DESC LIMIT 6`),
    hogQL<[string, number]>(`SELECT coalesce(properties.$initial_referring_domain, 'direct'), count() FROM events WHERE event = '$pageview' AND timestamp >= now() - INTERVAL ${days} DAY GROUP BY properties.$initial_referring_domain ORDER BY count() DESC LIMIT 8`),
    hogQL<[string, number]>(`SELECT coalesce(properties.$geoip_subdivision_1_name, 'Unknown'), count() FROM events WHERE event = '$pageview' AND timestamp >= now() - INTERVAL ${days} DAY GROUP BY properties.$geoip_subdivision_1_name ORDER BY count() DESC LIMIT 10`),
  ]);
  const state = summary.state === "unavailable" ? "unavailable" : posthogAvailability([summary, trend, topPages, devices, browsers, sources, regions]);
  if (state !== "ready" || !summary.value) return { data: null, state };
  const makeShare = (rows: Array<[string, number]>): ShareRow[] => { const total = rows.reduce((sum, row) => sum + safeNumber(row[1]), 0); return rows.map(([label, count]) => ({ label: safeString(label) ?? "Unknown", count: safeNumber(count), pct: total > 0 ? (safeNumber(count) / total) * 100 : 0 })); };
  return { state, data: { summary: summary.value, trend: trend.rows.map(([day, pv, unique]) => ({ day: safeString(day) ?? "", pv: safeNumber(pv), unique: safeNumber(unique) })), topPages: topPages.rows.map(([path, pv, unique]) => ({ path: safeString(path) ?? "(unknown)", pv: safeNumber(pv), unique: safeNumber(unique), avgTimeSeconds: null })), devices: makeShare(devices.rows), browsers: makeShare(browsers.rows), sources: makeShare(sources.rows), regions: makeShare(regions.rows) } };
}

function normalizeIssue(raw: RawSentryIssue): SentryIssue {
  return { id: raw.id, title: raw.title, level: raw.level, count: safeNumber(raw.count), userCount: safeNumber(raw.userCount), lastSeen: raw.lastSeen, firstSeen: raw.firstSeen, permalink: raw.permalink, culprit: raw.culprit ?? null, filename: raw.metadata?.filename ?? null, function: raw.metadata?.function ?? null };
}

async function sentryGet<T>(path: string): Promise<{ value: T | null; state: StatsSourceState }> {
  if (!SENTRY_AUTH_TOKEN || !SENTRY_ORG) return { value: null, state: "unavailable" };
  try {
    const response = await fetch(path.startsWith("http") ? path : `${SENTRY_BASE}${path}`, { headers: { Authorization: `Bearer ${SENTRY_AUTH_TOKEN}` }, next: { revalidate: REVALIDATE_SECONDS } });
    if (!response.ok) return { value: null, state: "error" };
    return { value: (await response.json()) as T, state: "ready" };
  } catch {
    return { value: null, state: "error" };
  }
}

type SentryStatsPeriod = "7d" | "30d";

function rawStatsForPeriod(raw: RawSentryIssue, period: SentryStatsPeriod): Array<[number, number]> {
  const direct = raw.stats?.[period];
  if (direct?.length) return direct;
  const fallback = raw.stats?.["30d"] ?? raw.stats?.["24h"] ?? [];
  if (period === "30d") return fallback;
  const cutoff = Date.now() / 1000 - 7 * 86_400;
  return fallback.filter(([timestamp]) => timestamp >= cutoff);
}

function issueDailySeries(rawIssues: RawSentryIssue[], period: StatsPeriod): number[] {
  const daily = new Map<string, number>();
  const statsPeriod: SentryStatsPeriod = period === 30 ? "30d" : "7d";
  for (const raw of rawIssues) {
    for (const [timestamp, count] of rawStatsForPeriod(raw, statsPeriod)) {
      const day = new Date(timestamp * 1000).toISOString().slice(0, 10);
      daily.set(day, (daily.get(day) ?? 0) + safeNumber(count));
    }
  }
  const values = [...daily.entries()].sort(([first], [second]) => first.localeCompare(second)).map(([, count]) => count).slice(-period);
  while (values.length < period) values.unshift(0);
  return values;
}

function issueTrend(rawIssues: RawSentryIssue[], period: StatsPeriod): ErrorTrendPoint[] {
  const trend = new Map<number, number>();
  const statsPeriod: SentryStatsPeriod = period === 30 ? "30d" : "7d";
  for (const raw of rawIssues) {
    for (const [timestamp, count] of rawStatsForPeriod(raw, statsPeriod)) trend.set(timestamp, (trend.get(timestamp) ?? 0) + safeNumber(count));
  }
  return [...trend.entries()].sort(([first], [second]) => first - second).map(([timestamp, count]) => ({ timestamp: new Date(timestamp * 1000).toISOString(), count }));
}

async function queryErrors(days: StatsPeriod): Promise<{ data: StatsViewData["errors"] | null; state: StatsSourceState }> {
  const selectedStatsPeriod: SentryStatsPeriod = days === 30 ? "30d" : "7d";
  const selectedParams = new URLSearchParams({ project: SENTRY_PROJECT_ID, query: "is:unresolved", limit: "100", sort: "freq", statsPeriod: selectedStatsPeriod });
  const selectedResponse = await sentryGet<RawSentryIssue[]>(`/organizations/${encodeURIComponent(SENTRY_ORG)}/issues/?${selectedParams.toString()}`);
  if (selectedResponse.state !== "ready" || !Array.isArray(selectedResponse.value)) return { data: null, state: selectedResponse.state };
  const legacyResponse = days === 7
    ? selectedResponse
    : await sentryGet<RawSentryIssue[]>(`/organizations/${encodeURIComponent(SENTRY_ORG)}/issues/?${new URLSearchParams({ project: SENTRY_PROJECT_ID, query: "is:unresolved", limit: "100", sort: "freq", statsPeriod: "7d" }).toString()}`);
  if (legacyResponse.state !== "ready" || !Array.isArray(legacyResponse.value)) return { data: null, state: legacyResponse.state };

  const selectedRaw = selectedResponse.value;
  const legacyRaw = legacyResponse.value;
  const issues = selectedRaw.map(normalizeIssue);
  const now = Date.now();
  const newIn24h = issues.filter((issue) => now - new Date(issue.firstSeen).getTime() < 86_400_000).length;
  const severity = { critical: issues.filter((issue) => issue.level === "fatal").length, error: issues.filter((issue) => issue.level === "error").length, warning: issues.filter((issue) => issue.level === "warning").length, info: issues.filter((issue) => issue.level === "info").length };
  const sparkline7d = issueDailySeries(legacyRaw, 7);
  const selectedSparkline = issueDailySeries(selectedRaw, days);
  const lastErrorAt = issues.reduce<string | null>((latest, issue) => !latest || new Date(issue.lastSeen).getTime() > new Date(latest).getTime() ? issue.lastSeen : latest, null);
  const summary: ErrorSummary = {
    openCount: issues.length,
    newIn24h,
    totalEvents7d: legacyRaw.reduce((total, issue) => total + safeNumber(issue.count), 0),
    affectedUsers: legacyRaw.reduce((total, issue) => total + safeNumber(issue.userCount), 0),
    lastErrorAt,
    severity,
    sparkline7d,
    topIssue: issues[0] ?? null,
    selectedRange: {
      days,
      totalEvents: selectedRaw.reduce((total, issue) => total + safeNumber(issue.count), 0),
      affectedUsers: selectedRaw.reduce((total, issue) => total + safeNumber(issue.userCount), 0),
      sparkline: selectedSparkline,
    },
  };
  return { state: "ready", data: { summary, trend: issueTrend(selectedRaw, days), issues } };
}

function unavailableResponse<TView extends keyof StatsViewData>(view: TView, availability: StatsAvailability, period: StatsPeriod): StatsViewResponse<TView> { return { view, period, availability, state: "unavailable", data: null }; }

export async function getStatsView<TView extends keyof StatsViewData>(view: TView, branchSlug: string | null, period: StatsPeriod = 7): Promise<StatsViewResponse<TView>> {
  const availability: StatsAvailability = { posthog: posthogConfigured() ? "ready" : "unavailable", sentry: SENTRY_AUTH_TOKEN && SENTRY_ORG ? "ready" : "unavailable" };
  if (view === "errors") {
    const result = await queryErrors(period);
    return { view, period, availability: { ...availability, sentry: result.state }, state: result.state, data: result.data as StatsViewData[TView] | null };
  }
  if (view === "inquiries") {
    const result = await queryInquiries(branchSlug, period);
    return { view, period, availability: { ...availability, posthog: result.state }, state: result.state, data: result.data as StatsViewData[TView] | null };
  }
  if (view === "funnel") {
    const result = await queryFunnel(period);
    return { view, period, availability: { ...availability, posthog: result.state }, state: result.state, data: result.data as StatsViewData[TView] | null };
  }
  if (view === "traffic") {
    const result = await queryTraffic(period);
    return { view, period, availability: { ...availability, posthog: result.state }, state: result.state, data: result.data as StatsViewData[TView] | null };
  }
  const [errors, inquiries, funnel, traffic] = await Promise.all([queryErrors(period), queryInquirySummary(branchSlug, period), queryFunnelSummary(period), queryTrafficSummary(period)]);
  const topPages = posthogConfigured() ? await hogQL<[string, number, number]>(`SELECT properties.$pathname, count(), uniq(distinct_id) FROM events WHERE event = '$pageview' AND timestamp >= now() - INTERVAL ${period} DAY AND properties.$pathname IS NOT NULL GROUP BY properties.$pathname ORDER BY count() DESC LIMIT 4`) : { rows: [], state: "unavailable" as StatsSourceState };
  const devices = posthogConfigured() ? await hogQL<[string, number]>(`SELECT properties.$device_type, count() FROM events WHERE event = '$pageview' AND timestamp >= now() - INTERVAL ${period} DAY AND properties.$device_type IS NOT NULL GROUP BY properties.$device_type ORDER BY count() DESC`) : { rows: [], state: "unavailable" as StatsSourceState };
  const posthogState = posthogAvailability([inquiries, funnel, traffic, topPages, devices]);
  const state: StatsSourceState = errors.state === "error" || posthogState === "error" ? "error" : errors.state === "ready" || posthogState === "ready" ? "ready" : "unavailable";
  if (state === "unavailable") return unavailableResponse(view, { posthog: posthogState, sentry: errors.state }, period);
  const toTopPages = topPages.rows.map(([path, pv, unique]) => ({ path: safeString(path) ?? "(unknown)", pv: safeNumber(pv), unique: safeNumber(unique), avgTimeSeconds: null }));
  const totalDevices = devices.rows.reduce((sum, [, count]) => sum + safeNumber(count), 0);
  const deviceRows = devices.rows.map(([label, count]) => ({ label: safeString(label) ?? "Unknown", count: safeNumber(count), pct: totalDevices > 0 ? (safeNumber(count) / totalDevices) * 100 : 0 }));
  return { view, period, availability: { posthog: posthogState, sentry: errors.state }, state, data: { errors: errors.data?.summary ?? null, inquiries: inquiries.value ?? null, funnel: funnel.value ?? null, traffic: traffic.value ?? null, topPages: toTopPages, devices: deviceRows } as StatsViewData[TView] };
}
