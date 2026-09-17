"use client";

import Link from "next/link";
import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  STATS_PERIOD_OPTIONS,
  statsPeriodLabel,
  type StatsPeriod,
} from "@/lib/observability/stats-period";

interface StatsPeriodContextValue {
  period: StatsPeriod;
  setPeriod: (period: StatsPeriod) => void;
}

const StatsPeriodContext = createContext<StatsPeriodContextValue | null>(null);

export function StatsPeriodProvider({ initialPeriod, children }: { initialPeriod: StatsPeriod; children: ReactNode }) {
  const [period, setPeriod] = useState(initialPeriod);
  const selectPeriod = useCallback((nextPeriod: StatsPeriod) => {
    setPeriod(nextPeriod);
  }, []);

  return <StatsPeriodContext.Provider value={{ period, setPeriod: selectPeriod }}>{children}</StatsPeriodContext.Provider>;
}

export function useSelectedStatsPeriod(): StatsPeriodContextValue {
  const context = useContext(StatsPeriodContext);
  return context ?? {
    period: STATS_PERIOD_OPTIONS[0].value,
    setPeriod: () => undefined,
  };
}

interface StatsPeriodSelectorProps {
  basePath: string;
  period: StatsPeriod;
  dataComponent: string;
}

export function StatsPeriodSelector({
  basePath,
  period,
  dataComponent,
}: StatsPeriodSelectorProps) {
  const context = useSelectedStatsPeriod();
  const selectedPeriod = context.period ?? period;
  return (
    <div
      data-component={dataComponent}
      data-source-component="StatsPeriodSelector"
      className="flex items-center justify-end gap-2"
      aria-label="통계 기간 선택"
    >
      <span className="text-[0.7rem] font-semibold text-v3-text-muted">기간</span>
      <div className="flex items-center gap-1 rounded-full bg-v3-dim-white p-1">
        {STATS_PERIOD_OPTIONS.map((option) => (
          <Button
            key={option.value}
            asChild
            size="sm"
            variant={option.value === selectedPeriod ? "default" : "ghost"}
            aria-current={option.value === selectedPeriod ? "page" : undefined}
            data-component={`${dataComponent}_option-${option.value}`}
            onClick={(event) => {
              if (
                event.defaultPrevented ||
                event.button !== 0 ||
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey
              ) {
                return;
              }
              context.setPeriod(option.value);
            }}
          >
            <Link href={`${basePath}?period=${option.value}`}>
              {option.label}
            </Link>
          </Button>
        ))}
      </div>
      <span className="sr-only">현재 선택: {statsPeriodLabel(selectedPeriod)}</span>
    </div>
  );
}

interface StatsPeriodNoticeProps {
  title: string;
  dataComponent: string;
}

export function StatsPeriodNotice({
  title,
  dataComponent,
}: StatsPeriodNoticeProps) {
  return (
    <section
      data-component={dataComponent}
      className="flex flex-col gap-4 pb-10"
    >
      <Alert variant="destructive" data-component={`${dataComponent}_alert`}>
        <AlertTitle>{title}</AlertTitle>
        <AlertDescription>
          통계 기간은 7일 또는 30일만 선택할 수 있어요. 주소의 period 값을 확인해 주세요.
        </AlertDescription>
      </Alert>
    </section>
  );
}

interface StatsSourceNoticeProps {
  sources: readonly string[];
  dataComponent: string;
}

export function StatsSourceNotice({ sources, dataComponent }: StatsSourceNoticeProps) {
  return (
    <Alert variant="default" data-component={dataComponent}>
      <AlertTitle>통계 연결을 확인해 주세요</AlertTitle>
      <AlertDescription>
        {sources.join(" 및 ")} 연결이 설정되지 않아 해당 통계가 비어 있습니다.
      </AlertDescription>
    </Alert>
  );
}

export function StatsSourceEmpty({ source, dataComponent }: { source: string; dataComponent: string }) {
  return (
    <div
      data-component={dataComponent}
      className="rounded-md border border-dashed border-v3-border bg-v3-dim-white px-3 py-2 text-[0.78rem] text-v3-text-muted"
    >
      {source} 연결이 필요해요.
    </div>
  );
}

export function StatsUnavailableValue({ variant = "inline" }: { variant?: "inline" | "block" }) {
  if (variant === "block") {
    return <div className="text-[0.78rem] text-v3-text-muted">—</div>;
  }

  return <span className="ml-auto text-[0.7rem] font-semibold text-v3-text-muted">—</span>;
}
