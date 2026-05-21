import type {
  BrowserShareRow,
  DeviceShareRow,
  FunnelByDevice,
  FunnelBySource,
  FunnelStep,
  FunnelSummary,
  FunnelTrendPoint,
  InquiriesSummary,
  InquiryByBranchRow,
  InquiryDailyPoint,
  InquiryHourlyPoint,
  PageDetailRow,
  PageEntryExitRow,
  PageNavSummary,
  PageTransitionRow,
  RecentInquiry,
  RegionShareRow,
  SourceShareRow,
  TopPageRow,
  TrafficSummary,
  TrafficTrendPoint,
} from "./types";

const POSTHOG_HOST = process.env.POSTHOG_HOST ?? "https://us.posthog.com";
const POSTHOG_API_KEY = process.env.POSTHOG_API_KEY ?? "";
const POSTHOG_PROJECT_ID = process.env.POSTHOG_PROJECT_ID ?? "";

const REVALIDATE_SECONDS = 60;

const FUNNEL_STEPS: Array<{ event: string; label: string }> = [
  { event: "pricing_viewed", label: "가격 페이지 진입" },
  { event: "pricing_quote_loaded", label: "견적 로딩 완료" },
  { event: "consultation_modal_opened", label: "상담 모달 오픈" },
  { event: "consultation_form_started", label: "폼 입력 시작" },
  { event: "consultation_submitted", label: "상담 제출 완료" },
];

interface HogQLResponse {
  results: unknown[][];
  columns?: string[];
  hasMore?: boolean;
  error?: string;
}

async function hogQL<Row extends unknown[]>(
  query: string,
  revalidate = REVALIDATE_SECONDS
): Promise<Row[]> {
  if (!POSTHOG_API_KEY || !POSTHOG_PROJECT_ID) {
    console.warn("[posthog] missing POSTHOG_API_KEY or POSTHOG_PROJECT_ID");
    return [];
  }
  try {
    const res = await fetch(
      `${POSTHOG_HOST}/api/projects/${POSTHOG_PROJECT_ID}/query/`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${POSTHOG_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
        next: { revalidate },
      }
    );
    if (!res.ok) {
      console.warn(`[posthog] ${res.status} - ${query.slice(0, 80)}`);
      return [];
    }
    const data = (await res.json()) as HogQLResponse;
    if (data.error) {
      console.warn("[posthog] query error", data.error);
      return [];
    }
    return (data.results ?? []) as Row[];
  } catch (err) {
    console.warn("[posthog] fetch failed", err);
    return [];
  }
}

function safeNumber(v: unknown): number {
  return typeof v === "number" ? v : Number(v ?? 0) || 0;
}

function safeString(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v);
  return s === "null" || s === "" ? null : s;
}

// ============================================================
// INQUIRIES
// ============================================================

export async function getInquiriesSummary(): Promise<InquiriesSummary> {
  const rows = await hogQL<[number, number, number, number, string | null]>(`
    SELECT
      countIf(toDate(timestamp) = today()) AS today,
      countIf(toDate(timestamp) = today() - 1) AS yesterday,
      countIf(timestamp >= now() - INTERVAL 7 DAY) AS seven_day,
      countIf(timestamp >= now() - INTERVAL 30 DAY) AS thirty_day,
      max(timestamp) AS last_at
    FROM events
    WHERE event = 'consultation_submitted'
      AND timestamp >= now() - INTERVAL 30 DAY
  `);

  const submittedSeven = await hogQL<[number]>(`
    SELECT count() FROM events
    WHERE event = 'consultation_submitted'
      AND timestamp >= now() - INTERVAL 7 DAY
  `);
  const viewedSeven = await hogQL<[number]>(`
    SELECT count() FROM events
    WHERE event = 'pricing_viewed'
      AND timestamp >= now() - INTERVAL 7 DAY
  `);
  const subs = safeNumber(submittedSeven[0]?.[0]);
  const views = safeNumber(viewedSeven[0]?.[0]);
  const conv = views > 0 ? (subs / views) * 100 : 0;

  const r = rows[0];
  return {
    today: safeNumber(r?.[0]),
    yesterday: safeNumber(r?.[1]),
    sevenDayTotal: safeNumber(r?.[2]),
    sevenDayAvg: safeNumber(r?.[2]) / 7,
    thirtyDayTotal: safeNumber(r?.[3]),
    lastSubmissionAt: safeString(r?.[4]),
    conversionRate: conv,
  };
}

export async function getInquiriesDailyTrend(days = 30): Promise<InquiryDailyPoint[]> {
  const rows = await hogQL<[string, number]>(`
    SELECT toDate(timestamp) AS day, count() AS c
    FROM events
    WHERE event = 'consultation_submitted'
      AND timestamp >= now() - INTERVAL ${days} DAY
    GROUP BY day ORDER BY day ASC
  `);
  return rows.map(([day, count]) => ({ day: safeString(day) ?? "", count: safeNumber(count) }));
}

export async function getInquiriesHourlyToday(): Promise<InquiryHourlyPoint[]> {
  const rows = await hogQL<[number, number]>(`
    SELECT toHour(timestamp) AS hour, count() AS c
    FROM events
    WHERE event = 'consultation_submitted'
      AND toDate(timestamp) = today()
    GROUP BY hour ORDER BY hour ASC
  `);
  const map = new Map<number, number>();
  for (const [h, c] of rows) map.set(safeNumber(h), safeNumber(c));
  return Array.from({ length: 24 }, (_, hour) => ({ hour, count: map.get(hour) ?? 0 }));
}

export async function getInquiriesByBranch(days = 1): Promise<InquiryByBranchRow[]> {
  const rows = await hogQL<[string, number]>(`
    SELECT properties.branch_slug AS branch, count() AS c
    FROM events
    WHERE event = 'consultation_submitted'
      AND timestamp >= now() - INTERVAL ${days} DAY
      AND properties.branch_slug IS NOT NULL
    GROUP BY branch ORDER BY c DESC
  `);
  return rows.map(([branch, count]) => ({
    branchSlug: safeString(branch) ?? "unknown",
    count: safeNumber(count),
  }));
}

export async function getRecentInquiries(limit = 10): Promise<RecentInquiry[]> {
  const rows = await hogQL<[string, string | null, string | null, string | null, string | null, string]>(`
    SELECT
      distinct_id,
      properties.branch_slug AS branch,
      properties.source AS source,
      properties.pathname AS pathname,
      properties.$device_type AS device,
      timestamp
    FROM events
    WHERE event = 'consultation_submitted'
      AND timestamp >= now() - INTERVAL 7 DAY
    ORDER BY timestamp DESC
    LIMIT ${limit}
  `);
  return rows.map(([distinctId, branch, source, pathname, device, timestamp]) => ({
    distinctId: String(distinctId).slice(-8),
    branchSlug: safeString(branch),
    source: safeString(source),
    pathname: safeString(pathname),
    deviceType: safeString(device),
    timestamp: String(timestamp),
  }));
}

// ============================================================
// FUNNEL (pricing → consultation)
// ============================================================

async function countEventsInRange(event: string, days: number): Promise<number> {
  const rows = await hogQL<[number]>(`
    SELECT count() FROM events
    WHERE event = '${event}'
      AND timestamp >= now() - INTERVAL ${days} DAY
  `);
  return safeNumber(rows[0]?.[0]);
}

export async function getFunnelSummary(days = 7): Promise<FunnelSummary> {
  const counts = await Promise.all(
    FUNNEL_STEPS.map((s) => countEventsInRange(s.event, days))
  );

  const steps: FunnelStep[] = FUNNEL_STEPS.map((s, i) => {
    const count = counts[i];
    const pct = counts[0] > 0 ? (count / counts[0]) * 100 : 0;
    const dropFromPrev =
      i === 0 ? 0 : counts[i - 1] > 0 ? (1 - count / counts[i - 1]) * 100 : 0;
    return {
      step: i + 1,
      event: s.event,
      label: s.label,
      count,
      pct,
      dropFromPrevPct: dropFromPrev,
    };
  });

  // Biggest drop excluding step 1 (no prev)
  let biggestDropStep: number | null = null;
  let biggestDropValue = 0;
  for (let i = 1; i < steps.length; i++) {
    if (steps[i].dropFromPrevPct > biggestDropValue) {
      biggestDropValue = steps[i].dropFromPrevPct;
      biggestDropStep = steps[i].step;
    }
  }

  return {
    steps,
    conversionRate: steps[steps.length - 1]?.pct ?? 0,
    biggestDropStep,
    completedConversions: steps[steps.length - 1]?.count ?? 0,
    totalEntries: counts[0],
  };
}

export async function getFunnelTrend(days = 30): Promise<FunnelTrendPoint[]> {
  const rows = await hogQL<[string, number, number]>(`
    SELECT
      toDate(timestamp) AS day,
      countIf(event = 'pricing_viewed') AS entries,
      countIf(event = 'consultation_submitted') AS completions
    FROM events
    WHERE event IN ('pricing_viewed', 'consultation_submitted')
      AND timestamp >= now() - INTERVAL ${days} DAY
    GROUP BY day ORDER BY day ASC
  `);
  return rows.map(([day, entries, completions]) => {
    const e = safeNumber(entries);
    const c = safeNumber(completions);
    return {
      day: safeString(day) ?? "",
      conversionRate: e > 0 ? (c / e) * 100 : 0,
    };
  });
}

export async function getFunnelByDevice(days = 7): Promise<FunnelByDevice[]> {
  const rows = await hogQL<[string, number, number]>(`
    SELECT
      properties.$device_type AS device,
      countIf(event = 'pricing_viewed') AS entries,
      countIf(event = 'consultation_submitted') AS completions
    FROM events
    WHERE event IN ('pricing_viewed', 'consultation_submitted')
      AND timestamp >= now() - INTERVAL ${days} DAY
      AND properties.$device_type IS NOT NULL
    GROUP BY device ORDER BY entries DESC
  `);
  return rows.map(([device, entries, completions]) => {
    const e = safeNumber(entries);
    const c = safeNumber(completions);
    return {
      device: safeString(device) ?? "unknown",
      entries: e,
      completions: c,
      conversionRate: e > 0 ? (c / e) * 100 : 0,
    };
  });
}

export async function getFunnelBySource(days = 7): Promise<FunnelBySource[]> {
  const rows = await hogQL<[string, number, number, number, number, number]>(`
    SELECT
      coalesce(properties.$initial_referring_domain, 'direct') AS source,
      countIf(event = 'pricing_viewed') AS entries,
      countIf(event = 'pricing_quote_loaded') AS loaded,
      countIf(event = 'consultation_modal_opened') AS modal,
      countIf(event = 'consultation_form_started') AS started,
      countIf(event = 'consultation_submitted') AS submitted
    FROM events
    WHERE event IN ('pricing_viewed','pricing_quote_loaded','consultation_modal_opened','consultation_form_started','consultation_submitted')
      AND timestamp >= now() - INTERVAL ${days} DAY
    GROUP BY source ORDER BY entries DESC LIMIT 10
  `);
  return rows.map(([source, entries, loaded, modal, started, submitted]) => {
    const e = safeNumber(entries);
    const s = safeNumber(submitted);
    return {
      source: safeString(source) ?? "direct",
      entries: e,
      loaded: safeNumber(loaded),
      modalOpened: safeNumber(modal),
      started: safeNumber(started),
      submitted: s,
      conversionRate: e > 0 ? (s / e) * 100 : 0,
    };
  });
}

// ============================================================
// TRAFFIC
// ============================================================

export async function getTrafficSummary(): Promise<TrafficSummary> {
  const rows = await hogQL<[number, number, number, number, number, number]>(`
    SELECT
      countIf(toDate(timestamp) = today()) AS pv_today,
      uniqIf(distinct_id, toDate(timestamp) = today()) AS u_today,
      countIf(toDate(timestamp) = today() - 1) AS pv_yest,
      uniqIf(distinct_id, toDate(timestamp) = today() - 1) AS u_yest,
      countIf(timestamp >= now() - INTERVAL 7 DAY) AS pv_7d,
      uniqIf(distinct_id, timestamp >= now() - INTERVAL 7 DAY) AS u_7d
    FROM events
    WHERE event = '$pageview'
      AND timestamp >= now() - INTERVAL 7 DAY
  `);
  const r = rows[0];

  // Bounce rate: sessions with only 1 pageview
  const bounceRows = await hogQL<[number, number]>(`
    SELECT
      countIf(pv_count = 1) AS bounces,
      count() AS total
    FROM (
      SELECT properties.$session_id AS sid, count() AS pv_count
      FROM events
      WHERE event = '$pageview'
        AND timestamp >= now() - INTERVAL 7 DAY
        AND properties.$session_id IS NOT NULL
      GROUP BY sid
    )
  `);
  const bounces = safeNumber(bounceRows[0]?.[0]);
  const totalSessions = safeNumber(bounceRows[0]?.[1]);
  const bounceRate = totalSessions > 0 ? (bounces / totalSessions) * 100 : 0;

  // Avg session: rough estimate via session duration
  const sessionRows = await hogQL<[number]>(`
    SELECT avg(duration_s) FROM (
      SELECT properties.$session_id AS sid,
        dateDiff('second', min(timestamp), max(timestamp)) AS duration_s
      FROM events
      WHERE timestamp >= now() - INTERVAL 7 DAY
        AND properties.$session_id IS NOT NULL
      GROUP BY sid
      HAVING count() >= 2
    )
  `);
  const avgSession = safeNumber(sessionRows[0]?.[0]);

  return {
    today: { pv: safeNumber(r?.[0]), unique: safeNumber(r?.[1]) },
    yesterday: { pv: safeNumber(r?.[2]), unique: safeNumber(r?.[3]) },
    sevenDayTotal: { pv: safeNumber(r?.[4]), unique: safeNumber(r?.[5]) },
    avgSessionSeconds: avgSession,
    bounceRate,
  };
}

export async function getTrafficTrend(days = 7): Promise<TrafficTrendPoint[]> {
  const rows = await hogQL<[string, number, number]>(`
    SELECT toDate(timestamp) AS day, count() AS pv, uniq(distinct_id) AS u
    FROM events
    WHERE event = '$pageview' AND timestamp >= now() - INTERVAL ${days} DAY
    GROUP BY day ORDER BY day ASC
  `);
  return rows.map(([day, pv, unique]) => ({
    day: safeString(day) ?? "",
    pv: safeNumber(pv),
    unique: safeNumber(unique),
  }));
}

export async function getTopPages(days = 1, limit = 10): Promise<TopPageRow[]> {
  const rows = await hogQL<[string, number, number]>(`
    SELECT properties.$pathname AS path, count() AS pv, uniq(distinct_id) AS u
    FROM events
    WHERE event = '$pageview' AND timestamp >= now() - INTERVAL ${days} DAY
      AND properties.$pathname IS NOT NULL
    GROUP BY path ORDER BY pv DESC LIMIT ${limit}
  `);
  return rows.map(([path, pv, unique]) => ({
    path: safeString(path) ?? "(unknown)",
    pv: safeNumber(pv),
    unique: safeNumber(unique),
    avgTimeSeconds: 0,
  }));
}

export async function getDeviceBreakdown(days = 7): Promise<DeviceShareRow[]> {
  const rows = await hogQL<[string, number]>(`
    SELECT properties.$device_type AS device, count() AS c
    FROM events
    WHERE event = '$pageview' AND timestamp >= now() - INTERVAL ${days} DAY
      AND properties.$device_type IS NOT NULL
    GROUP BY device ORDER BY c DESC
  `);
  const total = rows.reduce((s, [, c]) => s + safeNumber(c), 0);
  return rows.map(([device, count]) => ({
    deviceType: safeString(device) ?? "unknown",
    count: safeNumber(count),
    pct: total > 0 ? (safeNumber(count) / total) * 100 : 0,
  }));
}

export async function getBrowserBreakdown(days = 7): Promise<BrowserShareRow[]> {
  const rows = await hogQL<[string, number]>(`
    SELECT
      concat(coalesce(properties.$browser, 'Other'), ' / ', coalesce(properties.$device_type, 'Unknown')) AS browser,
      count() AS c
    FROM events
    WHERE event = '$pageview' AND timestamp >= now() - INTERVAL ${days} DAY
    GROUP BY browser ORDER BY c DESC LIMIT 6
  `);
  const total = rows.reduce((s, [, c]) => s + safeNumber(c), 0);
  return rows.map(([browser, count]) => ({
    browser: safeString(browser) ?? "Other",
    count: safeNumber(count),
    pct: total > 0 ? (safeNumber(count) / total) * 100 : 0,
  }));
}

export async function getSourceBreakdown(days = 7): Promise<SourceShareRow[]> {
  const rows = await hogQL<[string, number]>(`
    SELECT coalesce(properties.$initial_referring_domain, 'direct') AS source, count() AS c
    FROM events
    WHERE event = '$pageview' AND timestamp >= now() - INTERVAL ${days} DAY
    GROUP BY source ORDER BY c DESC LIMIT 8
  `);
  const total = rows.reduce((s, [, c]) => s + safeNumber(c), 0);
  return rows.map(([source, count]) => ({
    source: safeString(source) ?? "direct",
    count: safeNumber(count),
    pct: total > 0 ? (safeNumber(count) / total) * 100 : 0,
  }));
}

export async function getRegionBreakdown(days = 7): Promise<RegionShareRow[]> {
  const rows = await hogQL<[string, number]>(`
    SELECT coalesce(properties.$geoip_subdivision_1_name, 'Unknown') AS region, count() AS c
    FROM events
    WHERE event = '$pageview' AND timestamp >= now() - INTERVAL ${days} DAY
    GROUP BY region ORDER BY c DESC LIMIT 8
  `);
  const total = rows.reduce((s, [, c]) => s + safeNumber(c), 0);
  return rows.map(([region, count]) => ({
    region: safeString(region) ?? "Unknown",
    count: safeNumber(count),
    pct: total > 0 ? (safeNumber(count) / total) * 100 : 0,
  }));
}

// ============================================================
// PAGE NAVIGATION (per-page traffic + transitions)
// ============================================================

/** Per-page details: PV, unique, entries, exits, bounce % */
export async function getPagesDetail(days = 7, limit = 30): Promise<PageDetailRow[]> {
  // Single CTE-style query: per session, classify each pathname as entry/exit/bounce
  const rows = await hogQL<[string, number, number, number, number, number]>(`
    SELECT
      pages.path,
      pages.pv,
      pages.unique,
      entries.cnt,
      exits.cnt,
      bounces.cnt
    FROM
      (SELECT properties.$pathname AS path, count() AS pv, uniq(distinct_id) AS unique
       FROM events
       WHERE event = '$pageview'
         AND timestamp >= now() - INTERVAL ${days} DAY
         AND properties.$pathname IS NOT NULL
       GROUP BY path) AS pages
      LEFT JOIN
      (SELECT first_path AS path, count() AS cnt FROM (
        SELECT argMin(properties.$pathname, timestamp) AS first_path
        FROM events
        WHERE event = '$pageview'
          AND timestamp >= now() - INTERVAL ${days} DAY
          AND properties.$session_id IS NOT NULL
          AND properties.$pathname IS NOT NULL
        GROUP BY properties.$session_id
      ) GROUP BY first_path) AS entries ON entries.path = pages.path
      LEFT JOIN
      (SELECT last_path AS path, count() AS cnt FROM (
        SELECT argMax(properties.$pathname, timestamp) AS last_path
        FROM events
        WHERE event = '$pageview'
          AND timestamp >= now() - INTERVAL ${days} DAY
          AND properties.$session_id IS NOT NULL
          AND properties.$pathname IS NOT NULL
        GROUP BY properties.$session_id
      ) GROUP BY last_path) AS exits ON exits.path = pages.path
      LEFT JOIN
      (SELECT first_path AS path, count() AS cnt FROM (
        SELECT argMin(properties.$pathname, timestamp) AS first_path, count() AS pv_in_session
        FROM events
        WHERE event = '$pageview'
          AND timestamp >= now() - INTERVAL ${days} DAY
          AND properties.$session_id IS NOT NULL
          AND properties.$pathname IS NOT NULL
        GROUP BY properties.$session_id
        HAVING pv_in_session = 1
      ) GROUP BY first_path) AS bounces ON bounces.path = pages.path
    ORDER BY pages.pv DESC
    LIMIT ${limit}
  `);
  return rows.map(([path, pv, unique, entries, exits, bounces]) => {
    const entryCount = safeNumber(entries);
    return {
      path: safeString(path) ?? "(unknown)",
      pv: safeNumber(pv),
      unique: safeNumber(unique),
      entries: entryCount,
      exits: safeNumber(exits),
      bouncePct: entryCount > 0 ? (safeNumber(bounces) / entryCount) * 100 : 0,
    };
  });
}

/** Top pages where sessions begin */
export async function getEntryPages(days = 7, limit = 8): Promise<PageEntryExitRow[]> {
  const rows = await hogQL<[string, number]>(`
    SELECT first_path AS path, count() AS c
    FROM (
      SELECT argMin(properties.$pathname, timestamp) AS first_path
      FROM events
      WHERE event = '$pageview'
        AND timestamp >= now() - INTERVAL ${days} DAY
        AND properties.$session_id IS NOT NULL
        AND properties.$pathname IS NOT NULL
      GROUP BY properties.$session_id
    )
    WHERE first_path IS NOT NULL
    GROUP BY path
    ORDER BY c DESC
    LIMIT ${limit}
  `);
  const total = rows.reduce((s, [, c]) => s + safeNumber(c), 0);
  return rows.map(([path, count]) => ({
    path: safeString(path) ?? "(unknown)",
    count: safeNumber(count),
    pct: total > 0 ? (safeNumber(count) / total) * 100 : 0,
  }));
}

/** Top pages where sessions end (last PV in session) */
export async function getExitPages(days = 7, limit = 8): Promise<PageEntryExitRow[]> {
  const rows = await hogQL<[string, number]>(`
    SELECT last_path AS path, count() AS c
    FROM (
      SELECT argMax(properties.$pathname, timestamp) AS last_path
      FROM events
      WHERE event = '$pageview'
        AND timestamp >= now() - INTERVAL ${days} DAY
        AND properties.$session_id IS NOT NULL
        AND properties.$pathname IS NOT NULL
      GROUP BY properties.$session_id
    )
    WHERE last_path IS NOT NULL
    GROUP BY path
    ORDER BY c DESC
    LIMIT ${limit}
  `);
  const total = rows.reduce((s, [, c]) => s + safeNumber(c), 0);
  return rows.map(([path, count]) => ({
    path: safeString(path) ?? "(unknown)",
    count: safeNumber(count),
    pct: total > 0 ? (safeNumber(count) / total) * 100 : 0,
  }));
}

/** Top page transitions: count of times users went from A → B in the same session */
export async function getPageTransitions(days = 7, limit = 15): Promise<PageTransitionRow[]> {
  const rows = await hogQL<[string, string, number]>(`
    SELECT
      pair.1 AS from_path,
      pair.2 AS to_path,
      count() AS c
    FROM (
      SELECT arrayJoin(arrayMap(i -> tuple(paths[i], paths[i+1]), range(1, length(paths)))) AS pair
      FROM (
        SELECT arrayMap(x -> x.2, arraySort(x -> x.1, groupArray(tuple(timestamp, properties.$pathname)))) AS paths
        FROM events
        WHERE event = '$pageview'
          AND timestamp >= now() - INTERVAL ${days} DAY
          AND properties.$session_id IS NOT NULL
          AND properties.$pathname IS NOT NULL
        GROUP BY properties.$session_id
        HAVING length(paths) >= 2
      )
    )
    WHERE pair.1 != pair.2
    GROUP BY from_path, to_path
    ORDER BY c DESC
    LIMIT ${limit}
  `);
  const total = rows.reduce((s, [, , c]) => s + safeNumber(c), 0);
  return rows.map(([from, to, count]) => ({
    fromPath: safeString(from) ?? "(unknown)",
    toPath: safeString(to) ?? "(unknown)",
    count: safeNumber(count),
    pct: total > 0 ? (safeNumber(count) / total) * 100 : 0,
  }));
}

/** Site-wide page navigation summary (top-of-page KPIs) */
export async function getPageNavSummary(days = 7): Promise<PageNavSummary> {
  const rows = await hogQL<[number, number]>(`
    SELECT
      uniq(properties.$pathname) AS active_pages,
      count() AS total_pv
    FROM events
    WHERE event = '$pageview'
      AND timestamp >= now() - INTERVAL ${days} DAY
      AND properties.$pathname IS NOT NULL
  `);
  const bounceRows = await hogQL<[number, number]>(`
    SELECT
      countIf(pv_count = 1) AS bounces,
      count() AS total
    FROM (
      SELECT properties.$session_id AS sid, count() AS pv_count
      FROM events
      WHERE event = '$pageview'
        AND timestamp >= now() - INTERVAL ${days} DAY
        AND properties.$session_id IS NOT NULL
      GROUP BY sid
    )
  `);
  const activePages = safeNumber(rows[0]?.[0]);
  const totalPv = safeNumber(rows[0]?.[1]);
  const bounces = safeNumber(bounceRows[0]?.[0]);
  const totalSessions = safeNumber(bounceRows[0]?.[1]);
  return {
    activePages,
    totalPv,
    avgPvPerPage: activePages > 0 ? totalPv / activePages : 0,
    avgBouncePct: totalSessions > 0 ? (bounces / totalSessions) * 100 : 0,
  };
}

// Helper: format Korean relative time. Guards against epoch-zero / "no data"
// sentinel timestamps that some PostHog queries return when there are no rows.
export function formatRelativeKo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts) || ts <= 0) return "—";
  const diff = Date.now() - ts;
  // Anything more than a year old is treated as "no recent data" for the
  // observability dashboard. The widgets all use < 30-day windows.
  if (diff > 365 * 24 * 60 * 60 * 1000) return "—";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  return `${days}일 전`;
}
