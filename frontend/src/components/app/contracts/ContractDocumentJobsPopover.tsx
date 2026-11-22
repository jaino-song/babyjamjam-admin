"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { documentJobRecoveryPresentation } from "@/features/document-jobs/recovery-presentation";
import { recoverJobHref } from "@/features/document-jobs/failure-popup-copy";
import { useActiveBranchId } from "@/features/system-templates/branch-context";
import { useIsMobile } from "@/hooks/useIsMobile";
import { cn } from "@/lib/utils";
import type { EformsignDocumentJobResponse } from "@/services/eformsign";

import type { DocumentJobCancelHandler, DocumentJobRetryHandler } from "./ContractDocumentJobDetail";
import { ContractDocumentJobRetryDialog } from "./ContractDocumentJobRetryDialog";
import { ContractDocumentJobCancelDialog } from "./ContractDocumentJobCancelDialog";
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
  cancellable?: boolean;
  retryable?: boolean;
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
  "data-component": string;
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
  const [recoveryOpening, setRecoveryOpening] = useState(0);
  const restoreRecoveryFocus = useRef<{ opening: number; scope: string; isOpen: boolean } | null>(null);
  const [cancelRequest, setCancelRequest] = useState<{ jobId: string; branchId: string | null; onCancelled?: () => void } | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const restoreCancelFocus = useRef(false);
  const cancelTrigger = useRef<HTMLButtonElement | null>(null);
  const cancelSucceeded = useRef(false);
  const [retryRequest, setRetryRequest] = useState<{ jobId: string; branchId: string | null; onRetried?: () => void } | null>(null);
  const [retryOpen, setRetryOpen] = useState(false);
  const restoreRetryFocus = useRef(false);
  const retryTrigger = useRef<HTMLButtonElement | null>(null);
  const retrySucceeded = useRef(false);
  const interactionPaused = retryRequest !== null || recoveryJobId !== null || cancelRequest !== null;
  const pathname = usePathname(), router = useRouter();
  const isOpen = open ?? internalOpen;
  const resolvedJobs = documentJobs ?? jobs ?? null;
  const resolvedLoading = loading || isJobsLoading;
  const resolvedError = error ?? jobsError ?? null;
  const resolvedRetry = onRetry ?? onRetryJobs;
  const sub = (suffix: string) => `${dataComponent}_${suffix}`;
  // Below lg the list is a bottom sheet. A Radix popper wrapper is a transformed, fixed box sized
  // to its content, so a `fixed inset-x-0` child inside it collapses to a sliver; the sheet is a
  // Dialog portal with no such wrapper.
  const isMobile = useIsMobile();
  // Use the same identity source as DocumentJobsProvider and its branch-keyed queries.
  const branchId = useActiveBranchId();
  const scope = JSON.stringify([pathname, isMobile, branchId]);
  const committedRecovery = useRef<{ jobId: string | null; opening: number; scope: string; isOpen: boolean }>({ jobId: null, opening: recoveryOpening, scope, isOpen });
  const [recoveryScope, setRecoveryScope] = useState(scope);
  if (recoveryScope !== scope) {
    setRecoveryScope(scope);
    setRecoveryJobId(null);
    setRecoveryOpening(opening => opening + 1);
    setCancelRequest(null);
    setCancelOpen(false);
    setRetryRequest(null);
    setRetryOpen(false);
  }
  const [recoveryIsOpen, setRecoveryIsOpen] = useState(isOpen);
  if (recoveryIsOpen !== isOpen) {
    setRecoveryIsOpen(isOpen);
    setRecoveryOpening(opening => opening + 1);
  }

  const focusAfterRecovery = useCallback(() => {
    const trigger = recoveryTrigger.current;
    if (trigger?.isConnected && !trigger.closest("[inert]")) trigger.focus({ preventScroll: true });
    else if (isOpen) panes.current?.focusCurrentPane();
    else anchorRef.current?.focus({ preventScroll: true });
  }, [isOpen]);

  useLayoutEffect(() => {
    committedRecovery.current = { jobId: recoveryJobId, opening: recoveryOpening, scope, isOpen };
  }, [recoveryJobId, recoveryOpening, scope, isOpen]);

  useEffect(() => {
    const pending = restoreRecoveryFocus.current;
    if (!pending) return;
    if (pending.opening !== recoveryOpening || pending.scope !== scope || pending.isOpen !== isOpen) {
      restoreRecoveryFocus.current = null;
      return;
    }
    if (recoveryJobId !== null) return;
    restoreRecoveryFocus.current = null;
    focusAfterRecovery();
  }, [recoveryJobId, recoveryOpening, scope, isOpen, focusAfterRecovery]);

  useEffect(() => {
    if (cancelRequest !== null || !restoreCancelFocus.current) return;
    restoreCancelFocus.current = false;
    const trigger = cancelTrigger.current;
    if (!isOpen) anchorRef.current?.focus({ preventScroll: true });
    else if (trigger?.isConnected && !trigger.closest("[inert]")) trigger.focus({ preventScroll: true });
    else panes.current?.focusCurrentPane();
  }, [cancelRequest, isOpen]);

  useEffect(() => {
    if (retryRequest !== null || !restoreRetryFocus.current) return;
    restoreRetryFocus.current = false;
    const trigger = retryTrigger.current;
    if (!isOpen) anchorRef.current?.focus({ preventScroll: true });
    else if (trigger?.isConnected && !trigger.closest("[inert]")) trigger.focus({ preventScroll: true });
    else panes.current?.focusCurrentPane();
  }, [retryRequest, isOpen]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (interactionPaused && !nextOpen) return;
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
    if (pathname === "/contracts" && documentJobRecoveryPresentation(job) === "iframe") { recoveryTrigger.current = triggerButton; setRecoveryOpening(opening => opening + 1); setRecoveryJobId(jobId); }
    else { handleOpenChange(false); router.push(recoverJobHref(jobId)); }
  };
  const onCancel: DocumentJobCancelHandler = (jobId, trigger, onCancelled) => {
    cancelTrigger.current = trigger;
    cancelSucceeded.current = false;
    setCancelRequest({ jobId, branchId, onCancelled });
    setCancelOpen(true);
  };
  const cancelJobOffered = !resolvedJobs || [...resolvedJobs.active, ...resolvedJobs.requiresAttention, ...resolvedJobs.recent].some(job => job.jobId === cancelRequest?.jobId && job.cancellable === true);
  const cancelDialog = cancelRequest ? <ContractDocumentJobCancelDialog key={cancelRequest.jobId} jobId={cancelRequest.jobId} isJobOffered={cancelJobOffered} branchId={cancelRequest.branchId} open={cancelOpen} data-component={sub("cancel")}
    onClose={() => setCancelOpen(false)} onCancelled={() => {
      cancelSucceeded.current = true;
      setCancelOpen(false);
    }} onCloseAutoFocus={event => {
      event.preventDefault();
      // Keep panes inert until Radix releases the confirmation's focus trap.
      // Panes.back() then restores list focus and scroll after removing inert.
      if (cancelSucceeded.current) cancelRequest.onCancelled?.();
      else restoreCancelFocus.current = true;
      setCancelRequest(null);
    }} /> : null;
  const onRetryJob: DocumentJobRetryHandler = (jobId, trigger, onRetried) => {
    retryTrigger.current = trigger;
    retrySucceeded.current = false;
    setRetryRequest({ jobId, branchId, onRetried });
    setRetryOpen(true);
  };
  const retryJobOffered = !resolvedJobs || resolvedJobs.requiresAttention.some(job => job.jobId === retryRequest?.jobId && job.retryable === true);
  const retryDialog = retryRequest ? <ContractDocumentJobRetryDialog key={retryRequest.jobId} jobId={retryRequest.jobId} isJobOffered={retryJobOffered} branchId={retryRequest.branchId} open={retryOpen} data-component={sub("retry")}
    onClose={() => setRetryOpen(false)} onRetried={() => {
      retrySucceeded.current = true;
      setRetryOpen(false);
    }} onCloseAutoFocus={event => {
      event.preventDefault();
      if (retrySucceeded.current) retryRequest.onRetried?.();
      else restoreRetryFocus.current = true;
      setRetryRequest(null);
    }} /> : null;
  const recoveryDialog = recoveryJobId !== null ? <DocumentJobRecoveryDialog presentation="iframe" jobId={recoveryJobId} data-component={sub("recovery")}
    onClose={() => setRecoveryJobId(null)} onCloseAutoFocus={event => {
      event.preventDefault();
      const committed = committedRecovery.current;
      if (committed.opening !== recoveryOpening || committed.scope !== scope || committed.isOpen !== isOpen) return;
      // The no-editor close callback can arrive before React removes inert from the panes.
      if (committed.jobId !== null) restoreRecoveryFocus.current = { opening: recoveryOpening, scope, isOpen };
      else focusAfterRecovery();
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
          onEscapeKeyDown={event => { if (interactionPaused) event.preventDefault(); else panes.current?.onEscapeKeyDown(event); }}
          onInteractOutside={event => { if (interactionPaused) event.preventDefault(); }}
        >
          <div data-component={sub("body")} data-slot="document-jobs-mobile-body" className="flex h-[85dvh] min-h-0 flex-col">
            <SheetTitle className="sr-only">전자문서 작업</SheetTitle>
            <SheetDescription className="sr-only">전자문서 처리 현황</SheetDescription>
            <div data-component={sub("body_handle")} data-slot="document-jobs-sheet-handle" aria-hidden="true" className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-v3-border" />
            <ContractDocumentJobsPanes key={scope} ref={panes} inset="compact" open={isOpen} jobs={resolvedJobs} isLoading={resolvedLoading} error={resolvedError} onRetry={resolvedRetry}
              onClose={() => handleOpenChange(false)} onRecover={onRecover} onCancel={onCancel} onRetryJob={onRetryJob} interactionPaused={interactionPaused} data-component={sub("body_panes")} />
          </div>
        </SheetContent>
      </Sheet>
      {recoveryDialog}
      {cancelDialog}
      {retryDialog}
      </>
    );
  }

  return (
    <Popover open={isOpen} onOpenChange={handleOpenChange}>
      <PopoverTrigger ref={anchorRef} asChild aria-controls={undefined} data-slot="document-jobs-trigger">{resolvedTrigger}</PopoverTrigger>
      <ContractDocumentJobsModal
        ref={panes}
        key={scope}
        open={isOpen}
        onClose={() => handleOpenChange(false)}
        anchorRef={anchorRef}
        summary={_summary}
        jobs={resolvedJobs}
        isLoading={resolvedLoading}
        error={resolvedError}
        onRetry={resolvedRetry}
        interactionPaused={interactionPaused}
        onRecover={onRecover}
        onCancel={onCancel} onRetryJob={onRetryJob}
        recoveryDialog={<>{recoveryDialog}{cancelDialog}{retryDialog}</>}
        data-component={dataComponent}
      />
    </Popover>
  );
}
