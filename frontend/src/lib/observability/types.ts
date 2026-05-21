export type SentryLevel = "fatal" | "error" | "warning" | "info";

export interface SentryIssue {
  id: string;
  title: string;
  level: SentryLevel;
  count: number;
  userCount: number;
  lastSeen: string;
  firstSeen: string;
  permalink: string;
  culprit: string | null;
  filename: string | null;
  function: string | null;
}

export interface SentrySummary {
  openCount: number;
  newIn24h: number;
  severity: {
    critical: number;
    error: number;
    warning: number;
    info: number;
  };
  topIssue: SentryIssue | null;
  totalEvents7d: number;
  affectedUsers: number;
  lastErrorAt: string | null;
  sparkline7d: number[];
}

export interface InquiriesSummary {
  today: number;
  yesterday: number;
  sevenDayTotal: number;
  sevenDayAvg: number;
  thirtyDayTotal: number;
  lastSubmissionAt: string | null;
  conversionRate: number;
}

export interface InquiryDailyPoint {
  day: string;
  count: number;
}

export interface InquiryHourlyPoint {
  hour: number;
  count: number;
}

export interface InquiryByBranchRow {
  branchSlug: string;
  count: number;
}

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

export interface FunnelTrendPoint {
  day: string;
  conversionRate: number;
}

export interface FunnelByDevice {
  device: string;
  entries: number;
  completions: number;
  conversionRate: number;
}

export interface FunnelBySource {
  source: string;
  entries: number;
  loaded: number;
  modalOpened: number;
  started: number;
  submitted: number;
  conversionRate: number;
}

export interface TrafficSummary {
  today: { pv: number; unique: number };
  yesterday: { pv: number; unique: number };
  sevenDayTotal: { pv: number; unique: number };
  avgSessionSeconds: number;
  bounceRate: number;
}

export interface TrafficTrendPoint {
  day: string;
  pv: number;
  unique: number;
}

export interface TopPageRow {
  path: string;
  pv: number;
  unique: number;
  avgTimeSeconds: number;
}

export interface DeviceShareRow {
  deviceType: string;
  count: number;
  pct: number;
}

export interface BrowserShareRow {
  browser: string;
  count: number;
  pct: number;
}

export interface SourceShareRow {
  source: string;
  count: number;
  pct: number;
}

export interface RegionShareRow {
  region: string;
  count: number;
  pct: number;
}

// ============================================================
// PAGE NAVIGATION (used by /stats/funnel "페이지 이동 통계")
// ============================================================
export interface PageDetailRow {
  path: string;
  pv: number;
  unique: number;
  entries: number;
  exits: number;
  bouncePct: number;
}

export interface PageEntryExitRow {
  path: string;
  count: number;
  pct: number;
}

export interface PageTransitionRow {
  fromPath: string;
  toPath: string;
  count: number;
  pct: number;
}

export interface PageNavSummary {
  activePages: number;
  totalPv: number;
  avgPvPerPage: number;
  avgBouncePct: number;
}
