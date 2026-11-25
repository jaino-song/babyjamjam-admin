"use client";

import * as React from "react";
import { X } from "lucide-react";

import { InfoCard } from "@/components/app/v3/InfoCard";
import { PaneHeader } from "@/components/app/v3/PaneHeader";
import { SlidingDetailPanel } from "@/components/app/v3/SlidingDetailPanel";
import { Button } from "@/components/ui/button";
import { initialDocumentRecoveryItems } from "@/features/document-jobs/initial-document-recovery";
import type { InitialDocumentRecoveryProjections } from "@/services/eformsign";

import { ContractDocumentJobDetail, InitialDocumentJobDetail, type DocumentJobCancelHandler, type DocumentJobRetryHandler, type InitialDocumentActionHandler } from "./ContractDocumentJobDetail";
import { ContractDocumentJobSummary } from "./ContractDocumentJobSummary";
import { ContractDocumentJobsList, type ContractDocumentJobsSection } from "./ContractDocumentJobsList";
import type { ContractDocumentJobsData } from "./ContractDocumentJobsPopover";

export interface ContractDocumentJobsPanesHandle {
  onEscapeKeyDown: (event: KeyboardEvent) => void;
  focusCurrentPane: () => void;
}
export interface ContractDocumentJobsPanesMemory {
  collapsed?: Record<ContractDocumentJobsSection, boolean>;
}
interface ContractDocumentJobsPanesProps {
  memory?: ContractDocumentJobsPanesMemory;
  onRemember?: (next: ContractDocumentJobsPanesMemory) => void;
  ref?: React.Ref<ContractDocumentJobsPanesHandle>;
  open: boolean;
  onClose: () => void;
  jobs?: ContractDocumentJobsData | null;
  recoveryProjections?: InitialDocumentRecoveryProjections | null;
  isLoading: boolean;
  error?: unknown;
  onRetry?: () => void;
  onRetryJob?: DocumentJobRetryHandler;
  onCancel?: DocumentJobCancelHandler;
  onInitialAction?: InitialDocumentActionHandler;
  onRecover?: (jobId: string, trigger: HTMLButtonElement) => void;
  interactionPaused?: boolean;
  inset?: "default" | "compact";
  height?: "half-viewport";
  "data-component": string;
}

export function ContractDocumentJobsPanes({ ref, memory, onRemember, open, onClose, jobs, recoveryProjections, isLoading, error, onRetry, onRecover, onCancel, onRetryJob, onInitialAction, interactionPaused = false, inset = "default", height, "data-component": base }: ContractDocumentJobsPanesProps): React.ReactElement {
  const [selectedId, setSelectedId] = React.useState<{ kind: "job" | "initial"; id: string } | null>(null);
  const [collapsed, setCollapsed] = React.useState<Record<ContractDocumentJobsSection, boolean>>(memory?.collapsed ?? { processing: false, attention: false, recent: true });
  const focusRoot = React.useRef<HTMLDivElement>(null);
  const listScroller = React.useRef<HTMLDivElement>(null);
  const listClose = React.useRef<HTMLButtonElement>(null);
  const clickedCard = React.useRef<HTMLElement | null>(null);
  const savedScroll = React.useRef(0);
  const restorePending = React.useRef(false);
  const allJobs = [...(jobs?.active ?? []), ...(jobs?.requiresAttention ?? []), ...(jobs?.recent ?? [])];
  const initialItems = onInitialAction && !error && !isLoading ? initialDocumentRecoveryItems(recoveryProjections) : [];
  const selected = open && selectedId?.kind === "job" ? allJobs.find(job => job.jobId === selectedId.id) : undefined;
  const selectedInitial = open && selectedId?.kind === "initial" ? initialItems.find(item => item.stateId === selectedId.id) : undefined;
  const hasSelection = Boolean(selected || selectedInitial);
  const initialCustomer = (clientId?: number) => clientId === undefined
    ? undefined
    : allJobs.find(job => job.clientId === clientId && job.clientName?.trim())?.clientName?.trim() ?? `고객 번호 ${clientId}`;
  const select = (kind: "job" | "initial", id: string, button: HTMLElement) => {
    clickedCard.current = button;
    savedScroll.current = listScroller.current?.scrollTop ?? 0;
    restorePending.current = false;
    button.focus({ preventScroll: true });
    setSelectedId({ kind, id });
  };
  const slide = `${base}_slide`;

  React.useLayoutEffect(() => {
    if (!open) {
      restorePending.current = false;
      setSelectedId(null);
    } else if (selectedId && !hasSelection && !interactionPaused) {
      restorePending.current = true;
      setSelectedId(null);
    }
  }, [open, selectedId, hasSelection, interactionPaused]);

  React.useEffect(() => {
    if (!open || hasSelection || interactionPaused || !restorePending.current) return;
    restorePending.current = false;
    if (listScroller.current) listScroller.current.scrollTop = savedScroll.current;
    const card = clickedCard.current;
    const target = card?.isConnected && !card.closest("[inert]") ? card : listClose.current;
    if (target !== document.activeElement) target?.focus({ preventScroll: true });
  }, [open, hasSelection, selectedId, interactionPaused]);

  const close = () => {
    if (interactionPaused) return;
    restorePending.current = false;
    setSelectedId(null);
    onClose();
  };
  const back = () => { if (!interactionPaused) { restorePending.current = true; setSelectedId(null); } };
  React.useImperativeHandle(ref, () => ({
    focusCurrentPane() {
      if (!open) return;
      const card = clickedCard.current;
      const target = hasSelection
        ? focusRoot.current?.querySelector<HTMLButtonElement>('[data-slot="pane-header-back"]')
        : card?.isConnected && !card.closest("[inert]") ? card : listClose.current;
      if (target?.isConnected && !target.closest("[inert]") && (hasSelection || target !== document.activeElement)) target.focus({ preventScroll: true });
    },
    onEscapeKeyDown(event: KeyboardEvent) {
      if (!event.defaultPrevented && !interactionPaused && hasSelection) { event.preventDefault(); back(); }
    },
  }));
  const closeButton = (scope?: string, isList = false) => (
    <Button ref={isList ? listClose : undefined} type="button" variant="ghost" size="icon" aria-label="전자문서 작업 닫기" data-component={scope}
      className="shrink-0 rounded-full border-0 bg-white text-v3-text-muted shadow-none hover:bg-v3-dim-white hover:text-v3-dark" onClick={close}>
      <X aria-hidden="true" className="h-4 w-4" />
    </Button>
  );

  return (
      <div ref={focusRoot} data-component={base} data-source-component="ContractDocumentJobsPanes" data-slot="document-jobs-interaction" inert={interactionPaused || undefined} className={height === "half-viewport" ? "flex min-h-0 flex-initial flex-col h-[50vh]" : "flex min-h-0 flex-1 flex-col"}>
      {open ? <SlidingDetailPanel data-component={slide} motion="page" headerInset={inset} open={hasSelection} onBack={back} backLabel="목록으로 돌아가기" interactionPaused={interactionPaused}
        list={<>
          <PaneHeader variant="title" title="전자문서 작업" inset={inset} actions={closeButton(`${slide}_list-pane_header_actions_close`, true)} data-component={`${slide}_list-pane_header`} />
          <div ref={listScroller} data-component={`${slide}_list-pane_body`} data-slot="document-jobs-list-scroller" className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <div data-component={`${slide}_list-pane_body_content`} data-slot="document-jobs-natural-content" className={inset === "compact" ? "shrink-0 px-5 pt-2 pb-6" : "shrink-0 px-6 pt-3 pb-6"}>
              {initialItems.length > 0 && <InfoCard
                title="제공기록지 복구"
                contentClassName="flex flex-col gap-2"
                data-component={`${slide}_list-pane_body_content_initial-recovery`}
              >
                {initialItems.map(({ stateId, regeneration, confirmation }, index) => {
                  const label = initialCustomer(regeneration?.clientId) ?? confirmation?.suffix;
                  return <Button key={stateId} type="button" variant="outline"
                    data-component={`${slide}_list-pane_body_content_initial-recovery_body_item-${index + 1}`}
                    data-slot="initial-document-recovery-item"
                    onClick={event => select("initial", stateId, event.currentTarget)}
                  >{label} · 복구 상태 보기</Button>;
                })}
              </InfoCard>}
              <ContractDocumentJobsList cardVariant="compact" jobs={jobs} isLoading={isLoading} error={error} onRetry={onRetry} collapsed={collapsed}
                data-component={`${slide}_list-pane_body_content_list`} onToggle={(section) => {
                  const next = { ...collapsed, [section]: !collapsed[section] };
                  setCollapsed(next);
                  onRemember?.({ collapsed: next });
                }}
                onSelect={(id, button) => select("job", id, button)} />
            </div>
          </div>
        </>}
        headerActions={closeButton(`${slide}_detail-pane_header_row_actions_close`)}
        detail={selected ? <div data-component={`${slide}_detail-pane_body_scroll`} data-slot="document-jobs-detail-scroller" className={inset === "compact" ? "min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-4 pb-6" : "min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pt-4 pb-6"}>
          <div data-component={`${slide}_detail-pane_body_scroll_summary`} className="mb-4">
            <ContractDocumentJobSummary job={selected} data-component={`${slide}_detail-pane_body_scroll_summary_job`} />
          </div>
          <ContractDocumentJobDetail job={selected} onDocumentNavigate={close} onRecover={onRecover} onCancel={onCancel} onRetryJob={onRetryJob} onCancelled={back} data-component={`${slide}_detail-pane_body_scroll_job`} />
        </div> : selectedInitial && onInitialAction ? (
          <div data-component={`${slide}_detail-pane_body_scroll`} data-slot="document-jobs-detail-scroller" className={inset === "compact" ? "min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-4 pb-6" : "min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pt-4 pb-6"}>
            <InitialDocumentJobDetail
              regeneration={selectedInitial.regeneration} confirmation={selectedInitial.confirmation}
              clientName={initialCustomer(selectedInitial.regeneration?.clientId)}
              onInitialAction={onInitialAction} data-component={`${slide}_detail-pane_body_scroll_initial-recovery`}
            />
          </div>
        ) : null} /> : null}
      </div>
  );
}
