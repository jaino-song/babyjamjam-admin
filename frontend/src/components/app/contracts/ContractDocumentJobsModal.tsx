"use client";

import * as React from "react";

import { AnchoredNotificationModalShell } from "@/components/app/v3/AnchoredNotificationModalShell";
import { ContractDocumentJobsPanes, type ContractDocumentJobsPanesMemory, type ContractDocumentJobsPanesHandle } from "./ContractDocumentJobsPanes";
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
  const [preferredHeight, setPreferredHeight] = React.useState(INITIAL_PREFERRED_HEIGHT);
  const [memory, setMemory] = React.useState<ContractDocumentJobsPanesMemory>({});
  const remember = React.useCallback((next: ContractDocumentJobsPanesMemory) => setMemory(current => ({ ...current, ...next })), []);
  const panes = React.useRef<ContractDocumentJobsPanesHandle>(null);
  const rememberHeight = React.useCallback((height: number) => {
    setPreferredHeight(current => current === INITIAL_PREFERRED_HEIGHT ? height : current);
  }, []);
  return <AnchoredNotificationModalShell open={open} onClose={onClose} anchorRef={anchorRef} label="전자문서 작업" data-component={base} interactionPaused={interactionPaused}
    preferredHeight={preferredHeight} onEscapeKeyDown={event => panes.current?.onEscapeKeyDown(event)}>
    <ContractDocumentJobsPanes memory={memory} onRemember={remember} ref={panes} open={open} jobs={jobs} isLoading={isLoading} error={error} onRetry={onRetry} onRecover={onRecover}
      onClose={onClose} interactionPaused={interactionPaused} onNaturalHeight={rememberHeight} data-component={base ? `${base}_panes` : undefined} />
    {recoveryDialog}
  </AnchoredNotificationModalShell>;
}
