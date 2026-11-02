"use client";

import {
  type ContractDocumentJob,
  type ContractDocumentJobsData,
  type ContractDocumentJobsSummary,
} from "@/components/app/contracts/ContractDocumentJobsPopover";
import { DocumentJobsStatMini } from "@/components/app/contracts/DocumentJobsStatMini";
import { StatMini, type StatMiniDensity } from "@/components/app/v3/StatMini";
import type { StatsBarItem } from "@/components/app/v3/StatsBar";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The "전자문서 처리중" card now reads the app-wide DocumentJobsProvider, so the job-data
 * props below are accepted for backward compatibility only and are ignored.
 */
export interface ContractStatsBarProps {
  items: readonly StatsBarItem[];
  name: string;
  isLoading?: boolean;
  density?: StatMiniDensity;
  /** @deprecated Ignored; the jobs card reads DocumentJobsProvider. */
  summary?: ContractDocumentJobsSummary | null;
  /** @deprecated Ignored; the jobs card reads DocumentJobsProvider. */
  jobs?: ContractDocumentJobsData | null;
  /** @deprecated Ignored; the jobs card reads DocumentJobsProvider. */
  documentJobs?: ContractDocumentJobsData | null;
  /** @deprecated Ignored; the jobs card reads DocumentJobsProvider. */
  summaryError?: unknown;
  /** @deprecated Ignored; the jobs card reads DocumentJobsProvider. */
  summaryHasData?: boolean;
  /** @deprecated Ignored; the jobs card reads DocumentJobsProvider. */
  isSummaryRefreshing?: boolean;
  /** @deprecated Ignored; the jobs card retries through DocumentJobsProvider. */
  onRetrySummary?: () => void;
  /** @deprecated Ignored; the jobs card reads DocumentJobsProvider. */
  jobsLoading?: boolean;
  /** @deprecated Ignored; the jobs card reads DocumentJobsProvider. */
  isJobsLoading?: boolean;
  /** @deprecated Ignored; the jobs card reads DocumentJobsProvider. */
  jobsError?: unknown;
  /** @deprecated Ignored; the jobs card reads DocumentJobsProvider. */
  error?: unknown;
  statsError?: unknown;
  statsHasData?: boolean;
  isStatsRefreshing?: boolean;
  /** @deprecated Ignored; the jobs card retries through DocumentJobsProvider. */
  onRetryJobs?: () => void;
  /** @deprecated Ignored; the jobs card retries through DocumentJobsProvider. */
  onRetry?: () => void;
  onRetryStats?: () => void;
  /** Still called when the jobs popover opens or closes. */
  onJobsPopoverOpenChange?: (open: boolean) => void;
  className?: string;
  jobsPopoverClassName?: string;
  /** Pass false to render no jobs card and stay independent of the provider. Defaults to true. */
  showDocumentJobs?: boolean;
}

export function ContractStatsBar({
  items,
  name,
  isLoading = false,
  density = "default",
  statsError,
  statsHasData = false,
  isStatsRefreshing = false,
  onRetryStats,
  onJobsPopoverOpenChange,
  className,
  jobsPopoverClassName,
  showDocumentJobs = true,
}: ContractStatsBarProps) {
  const statsBase = `${name}_stats`;
  const hasStatsError = statsError !== undefined && statsError !== null;

  return (
    <div
      data-component={statsBase}
      data-slot="contract-stats-bar"
      className={cn("flex flex-wrap gap-[calc(16px*var(--glint-ui-scale,1))]", className)}
    >
      {showDocumentJobs ? (
        <DocumentJobsStatMini
          mode="always"
          name={name}
          density={density}
          className={jobsPopoverClassName}
          onOpenChange={onJobsPopoverOpenChange}
        />
      ) : null}

      {items.map((item, idx) => (
        <StatMini
          key={item.label}
          data-component={`${statsBase}_stat-${idx}`}
          icon={item.icon}
          value={item.value}
          label={item.label}
          counter={item.counter}
          colorIndex={item.colorIndex ?? idx}
          animationDelay={`${idx * 0.08}s`}
          isLoading={isLoading}
          density={density}
        />
      ))}

      {hasStatsError ? (
        <Alert
          data-component={`${statsBase}_status-alert`}
          className="basis-full"
          variant={statsHasData ? "warning" : "destructive"}
        >
          <AlertTitle>
            {statsHasData
              ? "계약 통계를 최신 상태로 불러오지 못했어요"
              : "계약 통계를 불러오지 못했어요"}
          </AlertTitle>
          <AlertDescription>
            <p>
              {statsHasData
                ? "최근 성공한 통계를 표시하고 있어요. 다시 시도해 주세요."
                : "통계를 확인할 수 없어요. 다시 시도해 주세요."}
            </p>
            {onRetryStats ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-component={`${statsBase}_status-alert_retry`}
                className="mt-3"
                onClick={onRetryStats}
                disabled={isStatsRefreshing}
                aria-label="계약 통계 다시 시도"
              >
                {isStatsRefreshing ? "다시 시도 중…" : "다시 시도"}
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

export type {
  ContractDocumentJob,
  ContractDocumentJobsData,
  ContractDocumentJobsSummary,
};
