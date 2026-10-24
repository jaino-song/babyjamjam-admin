"use client";

import { LoaderCircle } from "lucide-react";
import { useEffect, useId } from "react";

import { ContractDocumentJobsPopover } from "@/components/app/contracts/ContractDocumentJobsPopover";
import { StatMini, type StatMiniDensity } from "@/components/app/v3/StatMini";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useDocumentJobs } from "@/features/document-jobs/DocumentJobsProvider";

export type DocumentJobsStatMode = "always" | "whenActive";

export interface DocumentJobsStatMiniProps {
  /** "always" keeps the card at 0; "whenActive" shows it only while there is something to see. */
  mode: DocumentJobsStatMode;
  density?: StatMiniDensity;
  /** The stats bar's name; data-component values derive from `${name}_stats`. */
  name: string;
  className?: string;
  onOpenChange?: (open: boolean) => void;
}

/**
 * Whether the card renders anything. A stats bar with no other items uses this to
 * avoid drawing an empty row.
 */
export function useDocumentJobsStatVisible(mode: DocumentJobsStatMode | undefined): boolean {
  const { summary, total } = useDocumentJobs();
  if (mode === "always") return true;
  if (mode === "whenActive") return summary !== undefined && total > 0;
  return false;
}

export function DocumentJobsStatMini({
  mode,
  density = "default",
  name,
  className,
  onOpenChange,
}: DocumentJobsStatMiniProps) {
  const cardId = useId();
  const {
    summary,
    summaryError,
    isSummaryLoading,
    isSummaryFetching,
    refetchSummary,
    jobs,
    jobsError,
    isJobsLoading,
    refetchJobs,
    total,
    unresolvedCount,
    isPopoverOpen,
    setPopoverOpen,
    registerCard,
    primaryCardId,
  } = useDocumentJobs();
  const visible = useDocumentJobsStatVisible(mode);

  useEffect(() => {
    if (!visible) return undefined;
    return registerCard(cardId);
  }, [visible, registerCard, cardId]);

  if (!visible) return null;

  const base = `${name}_stats_document-jobs`;
  const hasSummary = summary !== undefined;
  const hasSummaryError = summaryError !== undefined && summaryError !== null;
  const isOpen = isPopoverOpen && primaryCardId === cardId;
  const handleOpenChange = (open: boolean) => {
    setPopoverOpen(open);
    onOpenChange?.(open);
  };

  return (
    <>
      <ContractDocumentJobsPopover
        open={isOpen}
        onOpenChange={handleOpenChange}
        // The popover header adds activeCount and requiresAttentionCount; feed it the
        // card's unresolved figure so its count matches the number on the card.
        summary={summary ? { activeCount: summary.activeCount, requiresAttentionCount: summary.unresolvedCount } : null}
        documentJobs={jobs ?? null}
        isJobsLoading={isJobsLoading}
        jobsError={jobsError}
        onRetryJobs={refetchJobs}
        className={className}
        data-component={`${base}-popover`}
        trigger={
          <StatMini
            data-component={`${base}-popover_trigger`}
            icon={LoaderCircle}
            value={hasSummary ? total : "—"}
            label="전자문서 처리중"
            counter="건"
            marker={hasSummary && unresolvedCount > 0 ? `실패 ${unresolvedCount}` : undefined}
            colorIndex={2}
            animationDelay="0s"
            isLoading={isSummaryLoading}
            density={density}
            interactive
            aria-label="전자문서 처리중 작업 보기"
          />
        }
      />

      {mode === "always" && hasSummaryError ? (
        <Alert
          data-component={`${base}-summary-alert`}
          className="order-last basis-full"
          variant={hasSummary ? "warning" : "destructive"}
        >
          <AlertTitle>
            {hasSummary
              ? "전자문서 처리 현황을 최신 상태로 불러오지 못했어요"
              : "전자문서 처리 현황을 불러오지 못했어요"}
          </AlertTitle>
          <AlertDescription>
            <p>
              {hasSummary
                ? "최근 성공한 처리 현황을 표시하고 있어요. 다시 시도해 주세요."
                : "처리 중인 전자문서 수를 확인할 수 없어요. 다시 시도해 주세요."}
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-component={`${base}-summary-alert_retry`}
              className="mt-3"
              onClick={refetchSummary}
              disabled={isSummaryFetching}
              aria-label="전자문서 처리 현황 다시 시도"
            >
              {isSummaryFetching ? "다시 시도 중…" : "다시 시도"}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
    </>
  );
}
