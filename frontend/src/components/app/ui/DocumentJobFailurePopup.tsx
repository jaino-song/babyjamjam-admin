"use client";

import { AlertCircle, X } from "lucide-react";

import { Button } from "@/components/ui/button";

const SOURCE_COMPONENT = "DocumentJobFailurePopup";

export interface DocumentJobFailurePopupProps {
  title: string;
  description?: string;
  actionLabel: string;
  onAction: () => void;
  onClose: () => void;
  closeLabel?: string;
  "data-component": string;
}

/**
 * One persistent failure notice. It stays until the user closes it, which is why it
 * is not built on the shared toast: that one holds a single message and fades away.
 */
export function DocumentJobFailurePopup({
  title,
  description,
  actionLabel,
  onAction,
  onClose,
  closeLabel = "알림 닫기",
  "data-component": dataComponent,
}: DocumentJobFailurePopupProps) {
  return (
    <div
      role="alert"
      data-component={dataComponent}
      data-slot="document-job-failure-popup"
      data-source-component={SOURCE_COMPONENT}
      className="pointer-events-auto relative flex items-start gap-[calc(10px*var(--glint-ui-scale,1))] rounded-[14px] border border-status-danger-line bg-card p-[calc(14px*var(--glint-ui-scale,1))] pr-[calc(40px*var(--glint-ui-scale,1))] text-v3-text shadow-lg animate-in slide-in-from-bottom-2 fade-in-0"
    >
      <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-v3-burgundy" aria-hidden="true" />
      <div data-slot="document-job-failure-popup-body" className="min-w-0">
        <p data-slot="document-job-failure-popup-title" className="text-[calc(14px*var(--glint-ui-scale,1))] font-bold text-v3-dark">
          {title}
        </p>
        {description ? (
          <p
            data-slot="document-job-failure-popup-description"
            className="mt-1 text-[calc(12px*var(--glint-ui-scale,1))] leading-relaxed text-v3-text-muted"
          >
            {description}
          </p>
        ) : null}
        <div data-slot="document-job-failure-popup-actions" className="mt-3 flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="destructive"
            data-component={`${dataComponent}_action`}
            onClick={onAction}
          >
            {actionLabel}
          </Button>
        </div>
      </div>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        data-component={`${dataComponent}_close`}
        className="absolute right-1 top-1 h-8 w-8 text-v3-text-muted"
        aria-label={closeLabel}
        onClick={onClose}
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );
}
