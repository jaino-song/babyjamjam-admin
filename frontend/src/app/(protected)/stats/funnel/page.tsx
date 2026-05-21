import { Block } from "@/components/app/v3/Block";
import {
  getFunnelSummary,
  getFunnelTrend,
  getFunnelByDevice,
  getFunnelBySource,
} from "@/lib/observability/posthog";
import { StatsHero } from "../_components/StatsHero";
import { KpiCard } from "../_components/KpiCard";
import { FunnelBars } from "../_components/FunnelBars";

export const metadata = { title: "페이지 이동 통계 · 통계" };
export const revalidate = 60;

export default async function FunnelDetailPage() {
  const [summary, trend, byDevice, bySource] = await Promise.all([
    getFunnelSummary(7),
    getFunnelTrend(30),
    getFunnelByDevice(7),
    getFunnelBySource(7),
  ]);

  // Conversion-trend line chart geometry (30 days)
  const trendValues = trend.map((p) => p.conversionRate);
  const maxConv = Math.max(1, ...trendValues);
  const chartW = 500;
  const chartH = 160;
  const padL = 36;
  const padR = 16;
  const usableW = chartW - padL - padR;
  const yFor = (v: number) => chartH - 22 - (v / maxConv) * (chartH - 40);
  const points = trend.map((p, i) => {
    const x = padL + (trend.length > 1 ? (i / (trend.length - 1)) * usableW : 0);
    return `${x.toFixed(1)},${yFor(p.conversionRate).toFixed(1)}`;
  });
  const linePath = points.length ? `M${points.join(" L")}` : "";

  return (
    <section data-component="stats-funnel" className="flex flex-col gap-6 pb-10">
      <Block name="stats-funnel-hero" className="shrink-0">
        <StatsHero
          title="페이지 이동 통계"
          subtitle="PostHog · 5단계 전환 분석 + 단계별 drop-off + 세그멘트"
          rightLabel="전환율"
          rightValue={`${summary.conversionRate.toFixed(1)}%`}
          rightAccent={summary.conversionRate < 5 ? "warn" : "default"}
          backHref="/stats"
          backLabel="통계 overview로"
          dataComponent="stats-funnel-hero"
        />
      </Block>

      <Block name="stats-funnel-kpi" className="shrink-0">
        <div
          data-component="stats-funnel-kpi-grid"
          className="grid grid-cols-2 lg:grid-cols-4 gap-3"
        >
          <KpiCard
            iconEmoji="🔀"
            label="전체 전환율"
            value={summary.conversionRate.toFixed(1)}
            unit="%"
            meta={`100 진입 중 ${summary.completedConversions} 제출`}
            dataComponent="stats-funnel-kpi-conversion"
          />
          <KpiCard
            iconEmoji="▼"
            label="최대 누수"
            value={summary.biggestDropStep ? `Step ${summary.biggestDropStep}` : "—"}
            tone={summary.biggestDropStep ? "warn" : "default"}
            meta={
              summary.biggestDropStep && summary.steps[summary.biggestDropStep - 1]
                ? `${summary.steps[summary.biggestDropStep - 1].label} · −${summary.steps[summary.biggestDropStep - 1].dropFromPrevPct.toFixed(0)}%`
                : "균등 누수"
            }
            dataComponent="stats-funnel-kpi-drop"
            valueSize="sm"
          />
          <KpiCard
            iconEmoji="📥"
            label="진입 (7일)"
            value={summary.totalEntries}
            unit="명"
            dataComponent="stats-funnel-kpi-entries"
          />
          <KpiCard
            iconEmoji="✓"
            label="완료된 전환"
            value={summary.completedConversions}
            unit="건"
            tone="success"
            dataComponent="stats-funnel-kpi-completions"
          />
        </div>
      </Block>

      <Block name="stats-funnel-main">
        <div
          data-component="stats-funnel-main-card"
          className="bg-white rounded-[28px] shadow-v3 p-6"
        >
          <header className="flex items-center gap-2.5 pb-3.5 border-b border-v3-border mb-4">
            <h3 className="text-[0.95rem] font-bold text-v3-text">
              5단계 페이지 이동 (지난 7일)
            </h3>
            <span className="text-[0.6rem] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 bg-purple-100 text-purple-700">
              PostHog
            </span>
          </header>
          <FunnelBars
            steps={summary.steps}
            biggestDropStep={summary.biggestDropStep}
            variant="verbose"
          />
        </div>
      </Block>

      <Block
        name="stats-funnel-segments"
        className="grid grid-cols-1 lg:grid-cols-2 gap-4"
      >
        {/* Conversion-rate trend */}
        <div
          data-component="stats-funnel-trend-card"
          className="bg-white rounded-[28px] shadow-v3 p-6"
        >
          <header className="flex items-center gap-2.5 pb-3.5 border-b border-v3-border mb-4">
            <h3 className="text-[0.95rem] font-bold text-v3-text">전환율 추이 (30일)</h3>
            <span className="text-[0.6rem] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 bg-purple-100 text-purple-700">
              PostHog
            </span>
          </header>
          {trend.length === 0 ? (
            <p className="text-center py-6 text-[0.85rem] text-v3-text-muted">
              30일간 펀널 데이터가 없어요.
            </p>
          ) : (
            <svg
              viewBox={`0 0 ${chartW} ${chartH}`}
              preserveAspectRatio="none"
              style={{ width: "100%", height: chartH }}
            >
              <line x1={padL} y1={chartH - 22} x2={chartW - padR} y2={chartH - 22} stroke="hsl(214 32% 91%)" />
              <line x1={padL} y1={yFor(maxConv * 0.5)} x2={chartW - padR} y2={yFor(maxConv * 0.5)} stroke="hsl(214 32% 91%)" strokeDasharray="3,3" />
              <line x1={padL} y1={yFor(maxConv)} x2={chartW - padR} y2={yFor(maxConv)} stroke="hsl(214 32% 91%)" strokeDasharray="3,3" />
              <text x={8} y={yFor(maxConv) + 4} fontSize={10} fill="hsl(215 16% 47%)">
                {maxConv.toFixed(0)}%
              </text>
              <text x={8} y={yFor(maxConv * 0.5) + 4} fontSize={10} fill="hsl(215 16% 47%)">
                {(maxConv * 0.5).toFixed(0)}%
              </text>
              <text x={8} y={chartH - 18} fontSize={10} fill="hsl(215 16% 47%)">
                0%
              </text>
              {linePath && <path d={linePath} stroke="hsl(214 100% 34%)" strokeWidth={2} fill="none" />}
              {trend.length > 0 && (() => {
                const last = trend[trend.length - 1];
                const x = padL + usableW;
                const y = yFor(last.conversionRate);
                return (
                  <>
                    <circle cx={x} cy={y} r={4} fill="hsl(214 100% 34%)" />
                    <text
                      x={x}
                      y={y - 8}
                      fontSize={11}
                      fontWeight={600}
                      fill="hsl(214 100% 34%)"
                      textAnchor="middle"
                    >
                      {last.conversionRate.toFixed(1)}%
                    </text>
                  </>
                );
              })()}
            </svg>
          )}
        </div>

        {/* By device */}
        <div
          data-component="stats-funnel-device-card"
          className="bg-white rounded-[28px] shadow-v3 p-6"
        >
          <header className="flex items-center gap-2.5 pb-3.5 border-b border-v3-border mb-4">
            <h3 className="text-[0.95rem] font-bold text-v3-text">디바이스별 전환율</h3>
            <span className="text-[0.6rem] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 bg-purple-100 text-purple-700">
              PostHog
            </span>
          </header>
          {byDevice.length === 0 ? (
            <p className="text-center py-6 text-[0.85rem] text-v3-text-muted">
              디바이스별 데이터가 없어요.
            </p>
          ) : (
            <div className="flex flex-col gap-4">
              {byDevice.slice(0, 4).map((d) => {
                const isLow = d.conversionRate < 5;
                return (
                  <div key={d.device}>
                    <div className="flex justify-between mb-1.5">
                      <span className="text-[0.85rem] font-semibold">
                        {d.device === "Mobile" ? "📱" : d.device === "Desktop" ? "💻" : "📱"}{" "}
                        {d.device}
                      </span>
                      <span
                        className={`text-[0.85rem] font-bold tabular-nums ${
                          isLow ? "text-red-600" : "text-green-700"
                        }`}
                      >
                        {d.conversionRate.toFixed(1)}%
                      </span>
                    </div>
                    <div className="h-2.5 rounded-full bg-v3-dim-white overflow-hidden">
                      <div
                        className={`h-full rounded-full ${
                          isLow
                            ? "bg-gradient-to-r from-red-500 to-red-600"
                            : "bg-gradient-to-r from-green-600 to-green-700"
                        }`}
                        style={{ width: `${Math.min(d.conversionRate * 5, 100)}%` }}
                      />
                    </div>
                    <div className="text-[0.65rem] text-v3-text-muted mt-1">
                      진입 {d.entries} · 제출 {d.completions}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Block>

      {/* By source */}
      <Block name="stats-funnel-source">
        <div
          data-component="stats-funnel-source-card"
          className="bg-white rounded-[28px] shadow-v3 p-6"
        >
          <header className="flex items-center gap-2.5 pb-3.5 border-b border-v3-border mb-3">
            <h3 className="text-[0.95rem] font-bold text-v3-text">유입 소스별 전환율</h3>
            <span className="text-[0.6rem] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 bg-purple-100 text-purple-700">
              PostHog
            </span>
          </header>
          {bySource.length === 0 ? (
            <p className="text-center py-6 text-[0.85rem] text-v3-text-muted">
              유입 소스 데이터가 없어요.
            </p>
          ) : (
            <table className="w-full text-[0.82rem]">
              <thead>
                <tr className="bg-v3-dim-white border-b border-v3-border">
                  <th className="text-left font-semibold uppercase tracking-wider text-[0.65rem] text-v3-text-muted px-3 py-2.5">유입 소스</th>
                  <th className="text-right font-semibold uppercase tracking-wider text-[0.65rem] text-v3-text-muted px-3 py-2.5">진입</th>
                  <th className="text-right font-semibold uppercase tracking-wider text-[0.65rem] text-v3-text-muted px-3 py-2.5">견적</th>
                  <th className="text-right font-semibold uppercase tracking-wider text-[0.65rem] text-v3-text-muted px-3 py-2.5">모달</th>
                  <th className="text-right font-semibold uppercase tracking-wider text-[0.65rem] text-v3-text-muted px-3 py-2.5">시작</th>
                  <th className="text-right font-semibold uppercase tracking-wider text-[0.65rem] text-v3-text-muted px-3 py-2.5">제출</th>
                  <th className="text-right font-semibold uppercase tracking-wider text-[0.65rem] text-v3-text-muted px-3 py-2.5">전환율</th>
                </tr>
              </thead>
              <tbody>
                {bySource.slice(0, 8).map((s, i) => {
                  const isLow = s.conversionRate < 5;
                  return (
                    <tr
                      key={`${s.source}-${i}`}
                      data-component="stats-funnel-source-row"
                      className="border-b border-v3-border last:border-0 hover:bg-v3-dim-white"
                    >
                      <td className="px-3 py-3 font-semibold">{s.source}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{s.entries}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{s.loaded}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{s.modalOpened}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{s.started}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{s.submitted}</td>
                      <td
                        className={`px-3 py-3 text-right font-bold tabular-nums ${
                          isLow ? "text-red-600" : "text-green-700"
                        }`}
                      >
                        {s.conversionRate.toFixed(1)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </Block>
    </section>
  );
}
