"use client";

import * as React from "react";

import { AnchoredNotificationModalShell } from "@/components/app/v3/AnchoredNotificationModalShell";

import type { DocumentJobCancelHandler, DocumentJobRetryHandler, InitialDocumentActionHandler } from "./ContractDocumentJobDetail";
import { ContractDocumentJobsPanes, type ContractDocumentJobsPanesMemory, type ContractDocumentJobsPanesHandle } from "./ContractDocumentJobsPanes";
import type { ContractDocumentJobsData, ContractDocumentJobsSummary } from "./ContractDocumentJobsPopover";

interface ContractDocumentJobsModalProps {
  ref?: React.Ref<ContractDocumentJobsPanesHandle>;
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLElement | null>;
  summary?: ContractDocumentJobsSummary | null;
  jobs?: ContractDocumentJobsData | null;
  isLoading: boolean;
  error?: unknown;
  onRetry?: () => void;
  onRetryJob?: DocumentJobRetryHandler;
  onCancel?: DocumentJobCancelHandler;
  onInitialAction?: InitialDocumentActionHandler;
  onRecover?: (jobId: string, trigger: HTMLButtonElement) => void;
  recoveryDialog?: React.ReactNode;
  interactionPaused?: boolean;
  "data-component": string;
}

export function ContractDocumentJobsModal({ ref, open, onClose, anchorRef, jobs, summary, isLoading, error, onRetry, onRecover, onCancel, onRetryJob, onInitialAction, recoveryDialog, interactionPaused = false, "data-component": base }: ContractDocumentJobsModalProps): React.ReactElement {
  const [memory, setMemory] = React.useState<ContractDocumentJobsPanesMemory>({});
  const remember = React.useCallback((next: ContractDocumentJobsPanesMemory) => setMemory(current => ({ ...current, ...next })), []);
  const panes = React.useRef<ContractDocumentJobsPanesHandle>(null);
  React.useImperativeHandle(ref, () => ({
    focusCurrentPane: () => panes.current?.focusCurrentPane(),
    onEscapeKeyDown: event => panes.current?.onEscapeKeyDown(event),
  }));
  return <AnchoredNotificationModalShell open={open} onClose={onClose} anchorRef={anchorRef} label="전자문서 작업" data-component={base} interactionPaused={interactionPaused}
    onEscapeKeyDown={event => panes.current?.onEscapeKeyDown(event)}>
    <ContractDocumentJobsPanes memory={memory} onRemember={remember} ref={panes} open={open} jobs={jobs} recoveryProjections={jobs ?? summary} isLoading={isLoading} error={error} onRetry={onRetry} onRecover={onRecover} onCancel={onCancel} onRetryJob={onRetryJob} onInitialAction={onInitialAction}
      onClose={onClose} interactionPaused={interactionPaused} height="half-viewport" data-component={`${base}_panes`} />
    {recoveryDialog}
  </AnchoredNotificationModalShell>;
}
