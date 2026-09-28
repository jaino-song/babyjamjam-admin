"use client";

import { LoaderCircle } from "lucide-react";

import {
  ContractDocumentJobsPopover,
  type ContractDocumentJob,
  type ContractDocumentJobsData,
  type ContractDocumentJobsPopoverProps,
  type ContractDocumentJobsSummary,
} from "@/components/app/contracts/ContractDocumentJobsPopover";
import { StatMini, type StatMiniDensity } from "@/components/app/v3/StatMini";
import type { StatsBarItem } from "@/components/app/v3/StatsBar";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ContractStatsBarProps {
  items: readonly StatsBarItem[];
  name: string;
  isLoading?: boolean;
  density?: StatMiniDensity;
  summary?: ContractDocumentJobsSummary | null;
  jobs?: ContractDocumentJobsData | null;
  documentJobs?: ContractDocumentJobsData | null;
  jobsLoading?: boolean;
  isJobsLoading?: boolean;
  jobsError?: unknown;
  error?: unknown;
  statsError?: unknown;
  statsHasData?: boolean;
  isStatsRefreshing?: boolean;
  onRetryJobs?: () => void;
  onRetry?: () => void;
  onRetryStats?: () => void;
  onJobsPopoverOpenChange?: (open: boolean) => void;
  className?: string;
  jobsPopoverClassName?: string;
  showDocumentJobs?: boolean;
}

type JobsPopoverProps = Pick<
  ContractDocumentJobsPopoverProps,
  "summary" | "jobs" | "documentJobs" | "isLoading" | "isJobsLoading" | "error" | "jobsError" | "onRetry" | "onRetryJobs"
>;

export function ContractStatsBar({
  items,
  name,
  isLoading = false,
  density = "default",
  summary,
  jobs,
  documentJobs,
  jobsLoading = false,
  isJobsLoading = false,
  jobsError,
  error,
  statsError,
  statsHasData = false,
  isStatsRefreshing = false,
  onRetryJobs,
  onRetry,
  onRetryStats,
  onJobsPopoverOpenChange,
  className,
  jobsPopoverClassName,
  showDocumentJobs = true,
}: ContractStatsBarProps) {
  const statsBase = `${name}_stats`;
  const resolvedJobsLoading = jobsLoading || isJobsLoading;
  const resolvedJobsError = jobsError ?? error;
  const resolvedRetry = onRetryJobs ?? onRetry;
  const activeCount = summary?.activeCount ?? 0;
  const hasStatsError = statsError !== undefined && statsError !== null;

  const popoverProps: JobsPopoverProps = {
    summary,
    jobs,
    documentJobs,
    isJobsLoading: resolvedJobsLoading,
    jobsError: resolvedJobsError,
    onRetryJobs: resolvedRetry,
  };

  return (
    <div
      data-component={statsBase}
      data-slot="contract-stats-bar"
      className={cn("flex flex-wrap gap-[calc(16px*var(--glint-ui-scale,1))]", className)}
    >
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

      {showDocumentJobs ? <ContractDocumentJobsPopover
        {...popoverProps}
        onOpenChange={onJobsPopoverOpenChange}
        className={jobsPopoverClassName}
        data-component={`${statsBase}_document-jobs-popover`}
        trigger={
          <StatMini
            data-component={`${statsBase}_document-jobs-popover_trigger`}
            icon={LoaderCircle}
            value={activeCount}
            label="전자문서 처리중"
            counter="건"
            colorIndex={2}
            animationDelay={`${items.length * 0.08}s`}
            isLoading={resolvedJobsLoading}
            density={density}
            interactive
            aria-label="전자문서 처리중 작업 보기"
            className="ms-auto max-lg:ms-0"
          />
        }
      /> : null}

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
