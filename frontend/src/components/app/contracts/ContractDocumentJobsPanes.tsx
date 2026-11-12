"use client";

import * as React from "react";
import { X } from "lucide-react";

import { PaneHeader } from "@/components/app/v3/PaneHeader";
import { SlidingDetailPanel } from "@/components/app/v3/SlidingDetailPanel";
import { Button } from "@/components/ui/button";

import { ContractDocumentJobDetail } from "./ContractDocumentJobDetail";
import { ContractDocumentJobSummary } from "./ContractDocumentJobSummary";
import { ContractDocumentJobsList, type ContractDocumentJobsSection } from "./ContractDocumentJobsList";
import type { ContractDocumentJobsData } from "./ContractDocumentJobsPopover";

export interface ContractDocumentJobsPanesHandle {
  onEscapeKeyDown: (event: KeyboardEvent) => void;
}
export interface ContractDocumentJobsPanesMemory {
  collapsed?: Record<ContractDocumentJobsSection, boolean>;
  naturalHeight?: number;
}
interface ContractDocumentJobsPanesProps {
  memory?: ContractDocumentJobsPanesMemory;
  onRemember?: (next: ContractDocumentJobsPanesMemory) => void;
  ref?: React.Ref<ContractDocumentJobsPanesHandle>;
  open: boolean;
  onClose: () => void;
  jobs?: ContractDocumentJobsData | null;
  isLoading: boolean;
  error?: unknown;
  onRetry?: () => void;
  onRecover?: (jobId: string, trigger: HTMLButtonElement) => void;
  interactionPaused?: boolean;
  inset?: "default" | "compact";
  onNaturalHeight?: (height: number) => void;
  "data-component"?: string;
}

export function ContractDocumentJobsPanes({ ref, memory, onRemember, open, onClose, jobs, isLoading, error, onRetry, onRecover, interactionPaused = false, inset = "default", onNaturalHeight, "data-component": base }: ContractDocumentJobsPanesProps): React.ReactElement {
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [collapsed, setCollapsed] = React.useState<Record<ContractDocumentJobsSection, boolean>>(memory?.collapsed ?? { processing: false, attention: false, recent: true });
  const cachedHeight = React.useRef<number | null>(memory?.naturalHeight ?? null);
  const [headerNode, setHeaderNode] = React.useState<HTMLDivElement | null>(null);
  const [innerNode, setInnerNode] = React.useState<HTMLDivElement | null>(null);
  const listScroller = React.useRef<HTMLDivElement>(null);
  const listClose = React.useRef<HTMLButtonElement>(null);
  const clickedCard = React.useRef<HTMLElement | null>(null);
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
    onRemember?.({ naturalHeight: height });
    onNaturalHeight?.(height);
  }, [open, isLoading, error, jobs, headerNode, innerNode, onNaturalHeight, onRemember]);

  React.useEffect(() => {
    if (!open || selected || interactionPaused || !restorePending.current) return;
    restorePending.current = false;
    if (listScroller.current) listScroller.current.scrollTop = savedScroll.current;
    const card = clickedCard.current;
    const target = card?.isConnected && !card.closest("[inert]") ? card : listClose.current;
    target?.focus({ preventScroll: true });
  }, [open, selected, selectedId, interactionPaused]);

  const close = () => {
    if (interactionPaused) return;
    restorePending.current = false;
    setSelectedId(null);
    onClose();
  };
  const back = () => { if (!interactionPaused) { restorePending.current = true; setSelectedId(null); } };
  React.useImperativeHandle(ref, () => ({
    onEscapeKeyDown(event: KeyboardEvent) {
      if (!event.defaultPrevented && !interactionPaused && selected) { event.preventDefault(); back(); }
    },
  }));
  const closeButton = (scope?: string, isList = false) => (
    <Button ref={isList ? listClose : undefined} type="button" variant="ghost" size="icon" aria-label="전자문서 작업 닫기" data-component={scope}
      className="h-8 w-8 shrink-0 rounded-full border-0 bg-white text-v3-text-muted shadow-none hover:bg-v3-dim-white hover:text-v3-dark" onClick={close}>
      <X aria-hidden="true" className="h-4 w-4" />
    </Button>
  );

  return (
      <div data-component={base} data-source-component="ContractDocumentJobsPanes" data-slot="document-jobs-interaction" inert={interactionPaused || undefined} className="flex min-h-0 flex-1 flex-col">
      {open ? <SlidingDetailPanel data-component={slide} motion="page" headerInset={inset} open={Boolean(selected)} onBack={back} backLabel="목록으로 돌아가기" interactionPaused={interactionPaused}
        list={<>
          <PaneHeader ref={setHeaderNode} variant="title" title="전자문서 작업" inset={inset} actions={closeButton(slide ? `${slide}_list-pane_header_actions_close` : undefined, true)} data-component={slide ? `${slide}_list-pane_header` : undefined} />
          <div ref={listScroller} data-component={slide ? `${slide}_list-pane_body` : undefined} data-slot="document-jobs-list-scroller" className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <div ref={setInnerNode} data-component={slide ? `${slide}_list-pane_body_content` : undefined} data-slot="document-jobs-natural-content" className={inset === "compact" ? "shrink-0 px-5 pt-2 pb-6" : "shrink-0 px-6 pt-3 pb-6"}>
              <ContractDocumentJobsList cardVariant="compact" jobs={jobs} isLoading={isLoading} error={error} onRetry={onRetry} collapsed={collapsed}
                data-component={slide ? `${slide}_list-pane_body_content_list` : undefined} onToggle={(section) => {
                  const next = { ...collapsed, [section]: !collapsed[section] };
                  setCollapsed(next);
                  onRemember?.({ collapsed: next });
                }}
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
        detail={selected ? <div data-component={slide ? `${slide}_detail-pane_body_scroll` : undefined} data-slot="document-jobs-detail-scroller" className={inset === "compact" ? "min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-4 pb-6" : "min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pt-4 pb-6"}>
          <div data-component={slide ? `${slide}_detail-pane_body_scroll_summary` : undefined} className="mb-4">
            <ContractDocumentJobSummary job={selected} data-component={slide ? `${slide}_detail-pane_body_scroll_summary_job` : undefined} />
          </div>
          <ContractDocumentJobDetail job={selected} onDocumentNavigate={close} onRecover={onRecover} data-component={slide ? `${slide}_detail-pane_body_scroll_job` : undefined} />
        </div> : null} /> : null}
      </div>
  );
}
