"use client";

import * as React from "react";
import { X } from "lucide-react";

import { AnchoredNotificationModalShell } from "@/components/app/v3/AnchoredNotificationModalShell";
import { PanelTitleGroup } from "@/components/app/v3/PanelTitleGroup";
import { SlidingDetailPanel } from "@/components/app/v3/SlidingDetailPanel";
import { Button } from "@/components/ui/button";

import { ContractDocumentJobDetail } from "./ContractDocumentJobDetail";
import { ContractDocumentJobSummary } from "./ContractDocumentJobSummary";
import { ContractDocumentJobsList, type ContractDocumentJobsSection } from "./ContractDocumentJobsList";
import type { ContractDocumentJobsData, ContractDocumentJobsSummary } from "./ContractDocumentJobsPopover";

interface ContractDocumentJobsModalProps {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  summary?: ContractDocumentJobsSummary | null;
  jobs?: ContractDocumentJobsData | null;
  isLoading: boolean;
  error?: unknown;
  onRetry?: () => void;
  onRecover?: (jobId: string, trigger: HTMLButtonElement) => void;
  recoveryDialog?: React.ReactNode;
  interactionPaused?: boolean;
  "data-component"?: string;
}

// Explicit height keeps absolute sliding panes out of the shell's natural measurement path.
const INITIAL_PREFERRED_HEIGHT = Number.MAX_SAFE_INTEGER;

export function ContractDocumentJobsModal({ open, onClose, anchorRef, jobs, isLoading, error, onRetry, onRecover, recoveryDialog, interactionPaused = false, "data-component": base }: ContractDocumentJobsModalProps): React.ReactElement {
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [collapsed, setCollapsed] = React.useState<Record<ContractDocumentJobsSection, boolean>>({ processing: false, attention: false, recent: false });
  const [preferredHeight, setPreferredHeight] = React.useState(INITIAL_PREFERRED_HEIGHT);
  const cachedHeight = React.useRef<number | null>(null);
  const [headerNode, setHeaderNode] = React.useState<HTMLDivElement | null>(null);
  const [innerNode, setInnerNode] = React.useState<HTMLDivElement | null>(null);
  const listScroller = React.useRef<HTMLDivElement>(null);
  const listClose = React.useRef<HTMLButtonElement>(null);
  const clickedCard = React.useRef<HTMLButtonElement | null>(null);
  const savedScroll = React.useRef(0);
  const restorePending = React.useRef(false);
  const selected = open ? [...(jobs?.active ?? []), ...(jobs?.requiresAttention ?? []), ...(jobs?.recent ?? [])].find((job) => job.jobId === selectedId) : undefined;
  const slide = base ? `${base}_slide` : undefined;

  React.useLayoutEffect(() => {
    if (!open) {
      restorePending.current = false;
      setSelectedId(null);
    } else if (selectedId && !selected) {
      restorePending.current = true;
      setSelectedId(null);
    }
  }, [open, selectedId, selected]);

  React.useLayoutEffect(() => {
    if (!open || isLoading || error || !jobs || !headerNode || !innerNode || cachedHeight.current !== null) return;
    const height = headerNode.getBoundingClientRect().height + innerNode.scrollHeight;
    if (height <= 0) return;
    cachedHeight.current = height;
    setPreferredHeight(height);
  }, [open, isLoading, error, jobs, headerNode, innerNode]);

  React.useEffect(() => {
    if (!open || selected || !restorePending.current) return;
    restorePending.current = false;
    if (listScroller.current) listScroller.current.scrollTop = savedScroll.current;
    const card = clickedCard.current;
    const target = card?.isConnected && !card.closest("[inert]") ? card : listClose.current;
    target?.focus({ preventScroll: true });
  }, [open, selected, selectedId]);

  const close = () => {
    if (interactionPaused) return;
    restorePending.current = false;
    setSelectedId(null);
    onClose();
  };
  const back = () => { if (!interactionPaused) { restorePending.current = true; setSelectedId(null); } };
  const closeButton = (scope?: string, ref?: React.Ref<HTMLButtonElement>) => (
    <Button ref={ref} type="button" variant="ghost" size="icon" aria-label="전자문서 작업 닫기" data-component={scope}
      className="h-8 w-8 shrink-0 rounded-full border-0 bg-white text-v3-text-muted shadow-none hover:bg-v3-dim-white hover:text-v3-dark" onClick={close}>
      <X aria-hidden="true" className="h-4 w-4" />
    </Button>
  );

  return (
    <AnchoredNotificationModalShell open={open} onClose={close} anchorRef={anchorRef} label="전자문서 작업" data-component={base || undefined} interactionPaused={interactionPaused}
      preferredHeight={preferredHeight} onEscapeKeyDown={(event) => {
        if (event.defaultPrevented || interactionPaused) return;
        if (selected) { event.preventDefault(); back(); }
      }}>
      <div data-slot="document-jobs-interaction" inert={interactionPaused || undefined} className="flex min-h-0 flex-1 flex-col">
      {open ? <SlidingDetailPanel data-component={slide} motion="page" open={Boolean(selected)} onBack={back} backLabel="목록으로 돌아가기" interactionPaused={interactionPaused}
        list={<>
          <div ref={setHeaderNode} data-component={slide ? `${slide}_list-pane_header` : undefined} data-slot="document-jobs-list-header" className="flex shrink-0 items-start justify-between p-6 pb-4">
            <PanelTitleGroup data-component={slide ? `${slide}_list-pane_header_title-group` : undefined} title="전자문서 작업" titleClassName="text-xl" />
            {closeButton(slide ? `${slide}_list-pane_header_close` : undefined, listClose)}
          </div>
          <div ref={listScroller} data-component={slide ? `${slide}_list-pane_body` : undefined} data-slot="document-jobs-list-scroller" className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <div ref={setInnerNode} data-component={slide ? `${slide}_list-pane_body_content` : undefined} data-slot="document-jobs-natural-content" className="shrink-0 px-6 pt-3 pb-6">
              <ContractDocumentJobsList jobs={jobs} isLoading={isLoading} error={error} onRetry={onRetry} collapsed={collapsed}
                data-component={slide ? `${slide}_list-pane_body_content_list` : undefined} onToggle={(section) => setCollapsed((current) => ({ ...current, [section]: !current[section] }))}
                onSelect={(id, button) => {
                  clickedCard.current = button;
                  savedScroll.current = listScroller.current?.scrollTop ?? 0;
                  restorePending.current = false;
                  button.focus({ preventScroll: true });
                  setSelectedId(id);
                }} />
            </div>
          </div>
        </>}
        headerActions={closeButton(slide ? `${slide}_detail-pane_header_row_actions_close` : undefined)}
        headerSummary={selected ? <ContractDocumentJobSummary job={selected} data-component={slide ? `${slide}_detail-pane_header_summary_job` : undefined} /> : null}
        detail={selected ? <div data-component={slide ? `${slide}_detail-pane_body_scroll` : undefined} data-slot="document-jobs-detail-scroller" className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pt-3 pb-6">
          <ContractDocumentJobDetail job={selected} onDocumentNavigate={close} onRecover={onRecover} data-component={slide ? `${slide}_detail-pane_body_scroll_job` : undefined} />
        </div> : null} /> : null}
      </div>
      {recoveryDialog}
    </AnchoredNotificationModalShell>
  );
}
