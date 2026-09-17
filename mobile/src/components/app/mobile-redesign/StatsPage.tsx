"use client";

import {
  AlertTriangle,
  ArrowRight,
  ClipboardList,
  FileBarChart,
  Gauge,
  MousePointer2,
  TrafficCone,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { SlidingCard } from "@/components/app/mobile-redesign/sliding-card";
import { StatsPeriodSelector } from "@/components/app/mobile-redesign/StatsPeriodSelector";
import { PolicyInfoRows } from "@/components/app/mobile-redesign/settings/PolicyInfoRows";
import {
  SettingsListCard,
  SettingsListItem,
  SettingsListRowsSkeleton,
} from "@/components/app/mobile-redesign/settings/SettingsListCard";
import { StatusPill } from "@/components/app/ui/status-badge";
import { Button } from "@/components/ui/button";
import { InfoCard } from "@/components/app/v3/InfoCard";
import { InfoRow } from "@/components/app/v3/InfoRow";
import { getStatsView } from "@/lib/api/stats";
import type {
  ErrorSummary,
  FunnelSummary,
  InquirySummary,
  StatsViewData,
  StatsViewResponse,
  TrafficSummary,
} from "@/lib/observability/stats-server";
import {
  DEFAULT_STATS_PERIOD,
  getEffectiveStatsPeriod,
  parseStatsPeriodParam,
  reconcileOptimisticStatsPeriod,
  type StatsPeriod,
} from "@/lib/observability/stats-period";
import { useInitialUser } from "@/providers/UserProvider";

import "@/components/app/mobile-redesign/redesign.css";

const PAGE_BASE = "mobile_stats_page";
const SLIDING_BASE = `${PAGE_BASE}_screen_content_sliding-card`;
const LIST_BASE = `${SLIDING_BASE}_stage_list-pane_stats-list`;
const DETAIL_BASE = `${SLIDING_BASE}_stage_detail-pane_body`;

type DetailView = Exclude<keyof StatsViewData, "overview">;

interface StatsListDefinition {
  id: DetailView;
  title: string;
  subtitle: string;
  icon: LucideIcon;
}

const STATS_LIST: readonly StatsListDefinition[] = [
  { id: "errors", title: "오류", subtitle: "Sentry 미해결 이슈와 발생 추이", icon: AlertTriangle },
  { id: "inquiries", title: "상담", subtitle: "상담 문의와 전환 흐름", icon: ClipboardList },
  { id: "funnel", title: "페이지 이동", subtitle: "페이지별 조회와 이동 경로", icon: MousePointer2 },
  { id: "traffic", title: "트래픽", subtitle: "페이지뷰와 방문자 분석", icon: TrafficCone },
];

function formatNumber(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("ko-KR") : "—";
}

function formatPercent(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)}%` : "—";
}

function formatConversionRate(value: number | null | undefined): string {
  return value === null ? "집계 불가" : formatPercent(value);
}

function relativeTime(value: string | null | undefined): string {
  if (!value) return "—";
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "—";
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.floor(hours / 24)}일 전`;
}

function DetailContent({
  view,
  period,
  onPeriodChange,
  children,
}: {
  view: DetailView;
  period: StatsPeriod;
  onPeriodChange: (period: StatsPeriod) => void;
  children: ReactNode;
}): ReactElement {
  const definition = STATS_LIST.find((item) => item.id === view) ?? STATS_LIST[0];
  const Icon = definition.icon;
  return (
    <div data-component={`${DETAIL_BASE}_${view}`} data-source-component="DetailContent" className="flex min-h-full flex-col gap-[calc(18px*var(--glint-ui-scale,1))]">
      <section data-component={`${DETAIL_BASE}_${view}_hero`} className="flex items-center gap-[calc(12px*var(--glint-ui-scale,1))]">
        <span data-component={`${DETAIL_BASE}_${view}_hero_icon`} className="flex h-[calc(46px*var(--glint-ui-scale,1))] w-[calc(46px*var(--glint-ui-scale,1))] shrink-0 items-center justify-center rounded-[calc(14px*var(--glint-ui-scale,1))] bg-v3-primary-light text-v3-primary" aria-hidden="true"><Icon className="h-[calc(20px*var(--glint-ui-scale,1))] w-[calc(20px*var(--glint-ui-scale,1))]" strokeWidth={2.25} /></span>
        <span data-component={`${DETAIL_BASE}_${view}_hero_copy`} className="flex min-w-0 flex-1 flex-col gap-[calc(4px*var(--glint-ui-scale,1))]"><h2 data-component={`${DETAIL_BASE}_${view}_hero_copy_title`} className="text-[calc(0.94rem*var(--glint-ui-scale,1))] font-bold leading-[calc(1.25rem*var(--glint-ui-scale,1))] text-v3-dark">{definition.title} 통계</h2><p data-component={`${DETAIL_BASE}_${view}_hero_copy_description`} className="text-[calc(0.7rem*var(--glint-ui-scale,1))] leading-[calc(1.05rem*var(--glint-ui-scale,1))] text-v3-text-muted">{definition.subtitle}</p></span>
      </section>
      <StatsPeriodSelector dataComponent={`${DETAIL_BASE}_${view}_period-selector`} period={period} onChange={onPeriodChange} />
      {children}
    </div>
  );
}

function ReportCard({
  dataComponent,
  title,
  children,
}: {
  dataComponent: string;
  title: string;
  children: ReactNode;
}): ReactElement {
  return <section data-component={dataComponent} data-slot="stats-report-card" className="flex min-h-[calc(100% - 76px)] flex-1 flex-col gap-3 rounded-[calc(18px*var(--glint-ui-scale,1))] bg-v3-dim-white p-[calc(16px*var(--glint-ui-scale,1))]"><div className="flex items-center gap-2"><FileBarChart className="h-4 w-4 text-v3-primary" /><h3 className="text-[calc(0.7rem*var(--glint-ui-scale,1))] font-bold uppercase tracking-[0.08em] text-v3-text-muted">{title}</h3></div>{children}</section>;
}

function MetricRows({ rows, dataComponent }: { rows: readonly { id: string; label: string; value: string }[]; dataComponent: string }): ReactElement {
  return <PolicyInfoRows data-component={dataComponent} title="핵심 지표" rows={rows.map((row) => ({ id: row.id, label: row.label, value: row.value }))} />;
}

function BarSeries({ values, labels, color = "bg-v3-primary", dataComponent }: { values: readonly number[]; labels?: readonly string[]; color?: string; dataComponent: string }): ReactElement {
  const max = Math.max(1, ...values);
  const labelCount = values.length > 7 ? Math.min(6, values.length) : values.length;
  const labelIndexes = new Set(Array.from({ length: labelCount }, (_, index) => labelCount <= 1 ? 0 : Math.round((index * (values.length - 1)) / (labelCount - 1))));
  const compactLabel = (label: string | undefined): string => label ? label.replace(/^(\d{4})-/, "").replace("-", ".") : "";
  return <div data-component={dataComponent} data-source-component="BarSeries" className="flex min-h-[116px] flex-1 items-end gap-1.5 overflow-hidden rounded-[calc(12px*var(--glint-ui-scale,1))] bg-white px-2 py-3">{values.length === 0 ? <span className="m-auto text-[calc(0.68rem*var(--glint-ui-scale,1))] text-v3-text-muted">데이터가 없습니다.</span> : values.map((value, index) => <span key={`${labels?.[index] ?? index}`} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1"><span className={`w-full max-w-4 rounded-t ${color}`} style={{ height: `${Math.max(4, (value / max) * 76)}px` }} title={labels?.[index] ?? undefined} /><small className="h-3 w-full truncate text-center text-[calc(0.55rem*var(--glint-ui-scale,1))] text-v3-text-muted">{labelIndexes.has(index) ? compactLabel(labels?.[index]) : ""}</small></span>)}</div>;
}

function ErrorReport({ data }: { data: StatsViewData["errors"] }): ReactElement {
  const summary: ErrorSummary = data.summary;
  const selected = summary.selectedRange ?? { days: 7 as StatsPeriod, totalEvents: summary.totalEvents7d, affectedUsers: summary.affectedUsers, sparkline: summary.sparkline7d };
  return <ReportCard dataComponent={`${DETAIL_BASE}_errors_report`} title={`Sentry 오류 모니터링 · 최근 ${selected.days}일`}><MetricRows dataComponent={`${DETAIL_BASE}_errors_metrics`} rows={[{ id: "open", label: "미해결", value: `${formatNumber(summary.openCount)}건` }, { id: "new", label: "24시간 신규", value: `${formatNumber(summary.newIn24h)}건` }, { id: "events", label: `${selected.days}일 발생`, value: `${formatNumber(selected.totalEvents)}건` }, { id: "users", label: `${selected.days}일 영향 사용자`, value: `${formatNumber(selected.affectedUsers)}명` }, { id: "last", label: "최근 오류", value: relativeTime(summary.lastErrorAt) }]} /><BarSeries dataComponent={`${DETAIL_BASE}_errors_report_bars`} values={selected.sparkline} color="bg-red-500" /><InfoCard data-component={`${DETAIL_BASE}_errors_severity`} title="심각도"><InfoRow label="Critical" value={summary.severity.critical} /><InfoRow label="Error" value={summary.severity.error} /><InfoRow label="Warning" value={summary.severity.warning} /></InfoCard>{data.issues.length > 0 ? <InfoCard data-component={`${DETAIL_BASE}_errors_issues`} title="주요 이슈">{data.issues.slice(0, 5).map((issue) => <InfoRow key={issue.id} label={issue.title} value={`${formatNumber(issue.count)}건`} />)}</InfoCard> : <p className="rounded-[calc(12px*var(--glint-ui-scale,1))] bg-white p-3 text-[calc(0.68rem*var(--glint-ui-scale,1))] text-v3-text-muted">미해결 이슈가 없습니다.</p>}</ReportCard>;
}

function InquiryReport({ data }: { data: StatsViewData["inquiries"] }): ReactElement {
  const summary: InquirySummary = data.summary;
  const selected = summary.selectedRange ?? { days: 7 as StatsPeriod, total: summary.sevenDayTotal, average: summary.sevenDayAvg, conversionRate: summary.conversionRate };
  return <ReportCard dataComponent={`${DETAIL_BASE}_inquiries_report`} title={`PostHog 상담 문의 · 최근 ${selected.days}일`}><MetricRows dataComponent={`${DETAIL_BASE}_inquiries_metrics`} rows={[{ id: "today", label: "오늘", value: `${formatNumber(summary.today)}건` }, { id: "yesterday", label: "어제", value: `${formatNumber(summary.yesterday)}건` }, { id: "range", label: `${selected.days}일 합계`, value: `${formatNumber(selected.total)}건` }, { id: "average", label: `${selected.days}일 일평균`, value: `${formatNumber(selected.average)}건` }, { id: "conversion", label: `${selected.days}일 전환율`, value: formatConversionRate(selected.conversionRate) }, { id: "last", label: "최근 문의", value: relativeTime(summary.lastSubmissionAt) }]} />{selected.conversionRate === null ? <p data-component={`${DETAIL_BASE}_inquiries_conversion-unavailable`} className="rounded-[calc(12px*var(--glint-ui-scale,1))] bg-white p-3 text-[calc(0.68rem*var(--glint-ui-scale,1))] leading-relaxed text-v3-text-muted">지점별 가격표 조회 수를 확인할 수 없어 전환율을 집계할 수 없습니다.</p> : null}<BarSeries dataComponent={`${DETAIL_BASE}_inquiries_report_bars`} values={data.daily.map((point) => point.count)} labels={data.daily.map((point) => point.day.slice(5))} color="bg-emerald-500" /><InfoCard data-component={`${DETAIL_BASE}_inquiries_hourly`} title="오늘 시간대">{data.hourly.filter((point) => point.count > 0).slice(0, 8).map((point) => <InfoRow key={point.hour} label={`${String(point.hour).padStart(2, "0")}시`} value={`${formatNumber(point.count)}건`} />)}{data.hourly.every((point) => point.count === 0) ? <p className="text-[0.7rem] text-v3-text-muted">오늘 문의가 없습니다.</p> : null}</InfoCard>{data.recent.length > 0 ? <InfoCard data-component={`${DETAIL_BASE}_inquiries_recent`} title="최근 문의">{data.recent.slice(0, 5).map((item) => <InfoRow key={`${item.distinctId}-${item.timestamp}`} label={item.branchSlug ?? "지점 미상"} value={relativeTime(item.timestamp)} />)}</InfoCard> : null}</ReportCard>;
}

function FunnelReport({ data }: { data: StatsViewData["funnel"] }): ReactElement {
  const summary: FunnelSummary = data.summary;
  return <ReportCard dataComponent={`${DETAIL_BASE}_funnel_report`} title="PostHog 페이지 이동 · 전환 퍼널"><MetricRows dataComponent={`${DETAIL_BASE}_funnel_metrics`} rows={[{ id: "pages", label: "활성 페이지", value: `${formatNumber(data.nav.activePages)}개` }, { id: "pv", label: "총 조회수", value: formatNumber(data.nav.totalPv) }, { id: "avg", label: "평균 조회수/페이지", value: data.nav.avgPvPerPage.toFixed(1) }, { id: "bounce", label: "평균 이탈률", value: formatPercent(data.nav.avgBouncePct) }, { id: "conversion", label: "전환율", value: formatPercent(summary.conversionRate) }]} /><div data-component={`${DETAIL_BASE}_funnel_steps`} className="flex flex-col gap-2">{summary.steps.map((step) => <div key={step.event} className="flex items-center gap-2 rounded-[calc(12px*var(--glint-ui-scale,1))] bg-white p-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-v3-primary-light text-[0.65rem] font-bold text-v3-primary">{step.step}</span><span className="min-w-0 flex-1"><strong className="block truncate text-[0.72rem] text-v3-dark">{step.label}</strong><small className="text-[0.64rem] text-v3-text-muted">{formatNumber(step.count)}건 · {formatPercent(step.pct)}</small></span><ArrowRight className="h-3.5 w-3.5 text-v3-text-muted" /></div>)}</div><InfoCard data-component={`${DETAIL_BASE}_funnel_pages`} title="인기 페이지">{data.pages.slice(0, 8).map((page) => <InfoRow key={page.path} label={page.path} value={`${formatNumber(page.pv)} PV`} />)}</InfoCard></ReportCard>;
}

function TrafficReport({ data }: { data: StatsViewData["traffic"] }): ReactElement {
  const summary: TrafficSummary = data.summary;
  const selected = summary.selectedRange ?? { days: 7 as StatsPeriod, total: summary.sevenDayTotal, avgSessionSeconds: summary.avgSessionSeconds, bounceRate: summary.bounceRate };
  return <ReportCard dataComponent={`${DETAIL_BASE}_traffic_report`} title={`PostHog 사이트 트래픽 · 최근 ${selected.days}일`}><MetricRows dataComponent={`${DETAIL_BASE}_traffic_metrics`} rows={[{ id: "pv", label: "오늘 페이지뷰", value: formatNumber(summary.today.pv) }, { id: "unique", label: "오늘 방문자", value: formatNumber(summary.today.unique) }, { id: "range-pv", label: `${selected.days}일 페이지뷰`, value: formatNumber(selected.total.pv) }, { id: "range-unique", label: `${selected.days}일 방문자`, value: formatNumber(selected.total.unique) }, { id: "session", label: `${selected.days}일 평균 세션`, value: `${Math.round(selected.avgSessionSeconds)}초` }, { id: "bounce", label: `${selected.days}일 이탈률`, value: formatPercent(selected.bounceRate) }]} /><BarSeries dataComponent={`${DETAIL_BASE}_traffic_report_bars`} values={data.trend.map((point) => point.pv)} labels={data.trend.map((point) => point.day.slice(5))} color="bg-v3-primary" /><InfoCard data-component={`${DETAIL_BASE}_traffic_top-pages`} title="인기 페이지">{data.topPages.slice(0, 8).map((page) => <InfoRow key={page.path} label={page.path} value={`${formatNumber(page.pv)} PV`} />)}</InfoCard><InfoCard data-component={`${DETAIL_BASE}_traffic_devices`} title="디바이스">{data.devices.slice(0, 5).map((device) => <InfoRow key={device.label} label={device.label} value={formatPercent(device.pct)} />)}</InfoCard><InfoCard data-component={`${DETAIL_BASE}_traffic_sources`} title="유입 경로">{data.sources.slice(0, 5).map((source) => <InfoRow key={source.label} label={source.label} value={formatPercent(source.pct)} />)}</InfoCard></ReportCard>;
}

function detailStatus(view: DetailView, response: StatsViewResponse<DetailView> | undefined): { label: string; variant: "success" | "warning" | "info" } {
  if (!response || response.state === "unavailable") return { label: "연결 필요", variant: "warning" };
  if (response.state === "error") return { label: "조회 오류", variant: "warning" };
  return { label: view === "errors" ? "Sentry" : "PostHog", variant: "info" };
}

export function StatsPage({ view = "overview" }: { view?: keyof StatsViewData }): ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const user = useInitialUser();
  const isOwner = user?.role === "owner";
  const branchSlug = (user as (typeof user & { branchSlug?: string | null }) | null)?.branchSlug ?? null;
  const urlPeriod = parseStatsPeriodParam(params.get("period")) ?? DEFAULT_STATS_PERIOD;
  const [optimisticSelection, setOptimisticSelection] = useState<{
    period: StatsPeriod;
    sourcePeriod: StatsPeriod;
  } | null>(null);
  const periodRef = useRef<StatsPeriod>(urlPeriod);
  const optimisticPeriod = reconcileOptimisticStatsPeriod(urlPeriod, optimisticSelection);
  /* eslint-disable react-hooks/set-state-in-effect -- Clear the optimistic selection once the URL is authoritative. */
  useEffect(() => {
    if (optimisticSelection && optimisticPeriod === null) {
      setOptimisticSelection(null);
    }
  }, [optimisticPeriod, optimisticSelection]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const period = getEffectiveStatsPeriod(urlPeriod, optimisticPeriod);
  useEffect(() => {
    periodRef.current = period;
  }, [period]);
  const visibleStatsList = isOwner ? STATS_LIST : STATS_LIST.filter((item) => item.id === "inquiries");
  const requestedDetailView = view !== "overview" ? view : (STATS_LIST.some((item) => item.id === params.get("item")) ? params.get("item") as DetailView : null);
  const detailView: DetailView | null = isOwner || requestedDetailView === "inquiries" ? requestedDetailView : null;
  const overviewQuery = useQuery<StatsViewResponse<"overview"> | StatsViewResponse<"inquiries">>({ queryKey: ["stats", isOwner ? "overview" : "inquiries", period, user?.id ?? null, user?.role ?? null, branchSlug], queryFn: () => isOwner ? getStatsView("overview", period) : getStatsView("inquiries", period), enabled: detailView === null || isOwner, staleTime: 60_000 });
  const detailQuery = useQuery({ queryKey: ["stats", detailView, period, user?.id ?? null, user?.role ?? null, branchSlug], queryFn: () => getStatsView(detailView as DetailView, period), enabled: detailView !== null, staleTime: 60_000 });
  const overview = isOwner ? overviewQuery.data?.data as StatsViewData["overview"] | null | undefined : null;
  const branchInquirySummary = !isOwner ? (overviewQuery.data?.data as StatsViewData["inquiries"] | null | undefined)?.summary : null;
  const handlePeriodChange = (nextPeriod: StatsPeriod) => {
    setOptimisticSelection(nextPeriod === urlPeriod
      ? null
      : { period: nextPeriod, sourcePeriod: urlPeriod });
    periodRef.current = nextPeriod;
    const nextParams = new URLSearchParams(params.toString());
    nextParams.set("period", String(nextPeriod));
    router.replace(`${pathname}?${nextParams.toString()}`, { scroll: false });
  };
  const list = <SettingsListCard data-component={LIST_BASE} title="운영 통계" count={visibleStatsList.length} subtitle="실시간 운영 지표를 한눈에 확인할 수 있어요.">
    <StatsPeriodSelector dataComponent={`${LIST_BASE}_period-selector`} period={period} onChange={handlePeriodChange} />
    {overviewQuery.isLoading && !overview ? <SettingsListRowsSkeleton data-component={`${LIST_BASE}_loading`} rowCount={visibleStatsList.length} /> : visibleStatsList.map((definition) => {
      const value = definition.id === "errors" ? formatNumber(overview?.errors?.openCount) : definition.id === "inquiries" ? formatNumber(overview?.inquiries?.selectedRange.total ?? overview?.inquiries?.sevenDayTotal ?? branchInquirySummary?.selectedRange.total ?? branchInquirySummary?.sevenDayTotal) : definition.id === "funnel" ? formatPercent(overview?.funnel?.conversionRate) : formatNumber(overview?.traffic?.selectedRange.total.pv ?? overview?.traffic?.today.pv);
      return <SettingsListItem key={definition.id} data-component={`${LIST_BASE}_item-${definition.id}`} icon={definition.icon} title={definition.title} subtitle={definition.subtitle} ariaLabel={`${definition.title} 통계 보기`} isSelected={detailView === definition.id} onSelect={() => { const nextParams = new URLSearchParams(params.toString()); nextParams.set("period", String(periodRef.current)); router.push(`/stats/${definition.id}?${nextParams.toString()}`, { scroll: false }); }} control={<StatusPill data-component={`${LIST_BASE}_item-${definition.id}_value`} variant={overviewQuery.data?.state === "ready" ? "primary" : "neutral"} className="!rounded-[calc(999px*var(--glint-ui-scale,1))] !px-[calc(8px*var(--glint-ui-scale,1))] !py-[calc(4px*var(--glint-ui-scale,1))] !text-[calc(0.62rem*var(--glint-ui-scale,1))]">{value}</StatusPill>} />;
    })}
    {overviewQuery.isError ? <div className="flex items-center justify-between gap-2 rounded-[calc(14px*var(--glint-ui-scale,1))] bg-v3-dim-white p-3 text-[calc(0.68rem*var(--glint-ui-scale,1))] text-v3-text-muted"><span>통계 개요를 불러오지 못했습니다.</span><Button type="button" variant="outline" size="sm" onClick={() => void overviewQuery.refetch()} data-component={`${LIST_BASE}_retry`}>다시 시도</Button></div> : null}
  </SettingsListCard>;

  let detail: ReactNode = null;
  if (detailView) {
    const status = detailStatus(detailView, detailQuery.data as StatsViewResponse<DetailView> | undefined);
    const data = detailQuery.data?.data;
    detail = <DetailContent view={detailView} period={period} onPeriodChange={handlePeriodChange}>{detailQuery.isLoading ? <ReportCard dataComponent={`${DETAIL_BASE}_${detailView}_loading`} title="데이터를 불러오는 중…"><div className="flex flex-1 items-center justify-center text-[calc(0.72rem*var(--glint-ui-scale,1))] text-v3-text-muted">최근 데이터를 확인하고 있습니다.</div></ReportCard> : detailQuery.isError || !data ? <ReportCard dataComponent={`${DETAIL_BASE}_${detailView}_unavailable`} title="통계 연결 상태"><div className="flex flex-1 flex-col items-center justify-center gap-2 text-center"><Gauge className="h-7 w-7 text-v3-text-muted" /><p className="text-[calc(0.74rem*var(--glint-ui-scale,1))] font-semibold text-v3-dark">{detailQuery.data?.state === "unavailable" ? "데이터 연결이 필요합니다." : "통계 데이터를 불러오지 못했습니다."}</p><p className="text-[calc(0.68rem*var(--glint-ui-scale,1))] text-v3-text-muted">서버에 설정된 Sentry/PostHog 연결 상태를 확인해 주세요.</p><Button type="button" variant="outline" size="sm" onClick={() => void detailQuery.refetch()} data-component={`${DETAIL_BASE}_${detailView}_retry`}>다시 시도</Button></div></ReportCard> : detailView === "errors" ? <ErrorReport data={data as StatsViewData["errors"]} /> : detailView === "inquiries" ? <InquiryReport data={data as StatsViewData["inquiries"]} /> : detailView === "funnel" ? <FunnelReport data={data as StatsViewData["funnel"]} /> : <TrafficReport data={data as StatsViewData["traffic"]} />}</DetailContent>;
    return <section data-component={PAGE_BASE} data-slot="messages-page" data-page={`stats-${detailView}`} className="messages-page flex min-h-0 w-full flex-1"><div data-component={`${PAGE_BASE}_screen`} className="relative flex min-h-0 w-full flex-1 overflow-hidden"><div data-component={`${PAGE_BASE}_screen_content`} data-slot="messages-content" className="shell-content relative min-h-0 flex-1 flex-col gap-[calc(8px*var(--glint-ui-scale,1))] !overflow-hidden"><SlidingCard data-component={SLIDING_BASE} open onBack={() => router.replace(`/stats?period=${periodRef.current}`, { scroll: false })} backLabel="운영 통계" detailKey={detailView} list={list} detail={detail} detailHeaderTrailing={<StatusPill data-component={`${SLIDING_BASE}_stage_detail-pane_header_status`} variant={status.variant} className="!rounded-[calc(999px*var(--glint-ui-scale,1))] !px-[calc(8px*var(--glint-ui-scale,1))] !py-[calc(4px*var(--glint-ui-scale,1))] !text-[calc(0.62rem*var(--glint-ui-scale,1))]">{status.label}</StatusPill>} /></div></div></section>;
  }

  return <section data-component={PAGE_BASE} data-slot="messages-page" data-page="stats" className="messages-page flex min-h-0 w-full flex-1"><div data-component={`${PAGE_BASE}_screen`} className="relative flex min-h-0 w-full flex-1 overflow-hidden"><div data-component={`${PAGE_BASE}_screen_content`} data-slot="messages-content" className="shell-content relative min-h-0 flex-1 flex-col gap-[calc(8px*var(--glint-ui-scale,1))] !overflow-hidden"><SlidingCard data-component={SLIDING_BASE} open={false} onBack={() => router.replace(`/stats?period=${periodRef.current}`, { scroll: false })} backLabel="운영 통계" detailKey={null} list={list} detail={null} /></div></div></section>;
}
