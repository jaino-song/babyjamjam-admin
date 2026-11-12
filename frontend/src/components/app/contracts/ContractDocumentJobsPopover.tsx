"use client";

import { useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { documentJobRecoveryPresentation } from "@/features/document-jobs/recovery-presentation";
import { recoverJobHref } from "@/features/document-jobs/failure-popup-copy";
import { useIsMobile } from "@/hooks/useIsMobile";
import { cn } from "@/lib/utils";
import type { EformsignDocumentJobResponse } from "@/services/eformsign";

import { ContractDocumentJobsModal } from "./ContractDocumentJobsModal";
import { ContractDocumentJobsPanes, type ContractDocumentJobsPanesHandle } from "./ContractDocumentJobsPanes";
import { DocumentJobRecoveryDialog } from "./DocumentJobRecoveryDialog";

const SOURCE_COMPONENT = "ContractDocumentJobsPopover";

export type ContractDocumentJobStatus =
  | "queued"
  | "processing"
  | "reconciling"
  | "completed"
  | "failed"
  | "requires_attention"
  | (string & {});

export interface ContractDocumentJob extends Pick<
  EformsignDocumentJobResponse,
  "documentKind" | "displayOperation" | "failureReasonCode" | "recoveryPresentation"
> {
  jobId: string;
  jobType: string;
  source?: "staff" | "auto_finalize";
  status: ContractDocumentJobStatus;
  clientId?: number | null;
  clientName?: string | null;
  recoveryKind?: "manual_send" | "verify_result" | null;
  documentId?: string | null;
  progressStep?: string | null;
  progressDetail?: string | null;
  lastErrorCode?: string | null;
  attempts?: number;
  nextAttemptAt?: string;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface ContractDocumentJobsSummary {
  activeCount: number;
  requiresAttentionCount: number;
}

export interface ContractDocumentJobsData {
  active: readonly ContractDocumentJob[];
  requiresAttention: readonly ContractDocumentJob[];
  recent: readonly ContractDocumentJob[];
}

export interface ContractDocumentJobsPopoverProps {
  trigger?: React.ReactElement;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  summary?: ContractDocumentJobsSummary | null;
  jobs?: ContractDocumentJobsData | null;
  documentJobs?: ContractDocumentJobsData | null;
  isLoading?: boolean;
  isJobsLoading?: boolean;
  error?: unknown;
  jobsError?: unknown;
  onRetry?: () => void;
  onRetryJobs?: () => void;
  "data-component"?: string;
  className?: string;
}

export function ContractDocumentJobsPopover({
  trigger,
  open,
  defaultOpen = false,
  onOpenChange,
  summary: _summary,
  jobs,
  documentJobs,
  isLoading: loading = false,
  isJobsLoading = false,
  error,
  jobsError,
  onRetry,
  onRetryJobs,
  "data-component": dataComponent,
  className,
}: ContractDocumentJobsPopoverProps) {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const panes = useRef<ContractDocumentJobsPanesHandle>(null);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const recoveryTrigger = useRef<HTMLButtonElement | null>(null);
  const [recoveryJobId, setRecoveryJobId] = useState<string | null>(null);
  const pathname = usePathname(), router = useRouter();
  const isOpen = open ?? internalOpen;
  const resolvedJobs = documentJobs ?? jobs ?? null;
  const resolvedLoading = loading || isJobsLoading;
  const resolvedError = error ?? jobsError ?? null;
  const resolvedRetry = onRetry ?? onRetryJobs;
  const sub = (suffix: string) => (dataComponent ? `${dataComponent}_${suffix}` : undefined);
  // Below lg the list is a bottom sheet. A Radix popper wrapper is a transformed, fixed box sized
  // to its content, so a `fixed inset-x-0` child inside it collapses to a sliver; the sheet is a
  // Dialog portal with no such wrapper.
  const isMobile = useIsMobile();
  const scope = `${pathname}:${isMobile}`;
  const [recoveryScope, setRecoveryScope] = useState(scope);
  if (recoveryScope !== scope) { setRecoveryScope(scope); setRecoveryJobId(null); }

  const handleOpenChange = (nextOpen: boolean) => {
    if (recoveryJobId !== null && !nextOpen) return;
    setInternalOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };

  const resolvedTrigger = trigger ?? (
    <Button type="button" variant="outline" size="sm" aria-label="전자문서 처리중">
      전자문서 처리중
    </Button>
  );

  const onRecover = (jobId: string, triggerButton: HTMLButtonElement) => {
    const job = [...(resolvedJobs?.active ?? []), ...(resolvedJobs?.requiresAttention ?? []), ...(resolvedJobs?.recent ?? [])].find(job => job.jobId === jobId);
    if (pathname === "/contracts" && documentJobRecoveryPresentation(job) === "iframe") { recoveryTrigger.current = triggerButton; setRecoveryJobId(jobId); }
    else { handleOpenChange(false); router.push(recoverJobHref(jobId)); }
  };
  const recoveryDialog = recoveryJobId !== null ? <DocumentJobRecoveryDialog presentation="iframe" jobId={recoveryJobId} data-component={sub("recovery")}
    onClose={() => setRecoveryJobId(null)} onCloseAutoFocus={event => {
      event.preventDefault();
      const trigger = recoveryTrigger.current;
      (trigger?.isConnected && !trigger.closest("[inert]") ? trigger : anchorRef.current)?.focus({ preventScroll: true });
    }} /> : null;

  if (isMobile) {
    return (
      <>
      <Sheet open={isOpen} onOpenChange={handleOpenChange}>
        <SheetTrigger ref={anchorRef} asChild data-slot="document-jobs-trigger">{resolvedTrigger}</SheetTrigger>
        <SheetContent
          side="bottom"
          data-component={dataComponent}
          data-slot="document-jobs-popover"
          data-source-component={SOURCE_COMPONENT}
          className={cn(
            "!z-[60] max-h-[85dvh] gap-0 overflow-hidden rounded-t-[28px] border-b-0 p-0 pb-[env(safe-area-inset-bottom)]",
            className,
          )}
          onEscapeKeyDown={event => { if (recoveryJobId !== null) event.preventDefault(); else panes.current?.onEscapeKeyDown(event); }}
          onInteractOutside={event => { if (recoveryJobId !== null) event.preventDefault(); }}
        >
          <div data-component={sub("body")} data-slot="document-jobs-mobile-body" className="flex h-[85dvh] min-h-0 flex-col">
            <SheetTitle className="sr-only">전자문서 작업</SheetTitle>
            <SheetDescription className="sr-only">전자문서 처리 현황</SheetDescription>
            <div data-component={sub("body_handle")} data-slot="document-jobs-sheet-handle" aria-hidden="true" className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-v3-border" />
            <ContractDocumentJobsPanes ref={panes} inset="compact" open={isOpen} jobs={resolvedJobs} isLoading={resolvedLoading} error={resolvedError} onRetry={resolvedRetry}
              onClose={() => handleOpenChange(false)} onRecover={onRecover} interactionPaused={recoveryJobId !== null} data-component={sub("body_panes")} />
          </div>
        </SheetContent>
      </Sheet>
      {recoveryDialog}
      </>
    );
  }

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger ref={anchorRef} asChild aria-controls={undefined} data-slot="document-jobs-trigger">{resolvedTrigger}</PopoverTrigger>
      <ContractDocumentJobsModal
        open={isOpen}
        onClose={() => handleOpenChange(false)}
        anchorRef={anchorRef}
        summary={_summary}
        jobs={resolvedJobs}
        isLoading={resolvedLoading}
        error={resolvedError}
        onRetry={resolvedRetry}
        interactionPaused={recoveryJobId !== null}
        onRecover={onRecover}
        recoveryDialog={recoveryDialog}
        data-component={dataComponent}
      />
    </Popover>
  );
}
