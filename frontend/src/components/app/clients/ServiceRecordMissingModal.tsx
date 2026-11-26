"use client";

import type { RefObject } from "react";
import { X } from "lucide-react";
import { AnchoredNotificationModalShell } from "@/components/app/v3/AnchoredNotificationModalShell";
import { PaneHeader } from "@/components/app/v3/PaneHeader";
import { Button } from "@/components/ui/button";
import type { ServiceRecordMissingClients } from "@/features/clients/types/service-record-missing";
import { ServiceRecordMissingList } from "./ServiceRecordMissingList";

interface ServiceRecordMissingModalProps {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
  items: ServiceRecordMissingClients["items"];
  error?: unknown;
  onRetry: () => void;
  onSelectClient: (clientId: number, caseId?: string) => void;
  "data-component": string;
}

export function ServiceRecordMissingModal({ open, onClose, anchorRef, items, error, onRetry, onSelectClient, "data-component": base }: ServiceRecordMissingModalProps) {
  return <AnchoredNotificationModalShell open={open} onClose={onClose} anchorRef={anchorRef} label="제공기록지 미작성" data-component={base}>
    <PaneHeader variant="title" title="제공기록지 미작성" data-component={`${base}_header`} actions={
      <Button type="button" variant="ghost" size="icon" aria-label="제공기록지 미작성 닫기" data-component={`${base}_header_close`}
        className="h-8 w-8 shrink-0 rounded-full border-0 bg-white text-v3-text-muted shadow-none hover:bg-v3-dim-white hover:text-v3-dark" onClick={onClose}>
        <X aria-hidden="true" className="h-4 w-4" />
      </Button>
    } />
    <div data-component={`${base}_body`} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pt-3 pb-6">
      <ServiceRecordMissingList items={items} error={error} onRetry={onRetry} onSelectClient={onSelectClient} data-component={`${base}_body_list`} />
    </div>
  </AnchoredNotificationModalShell>;
}
