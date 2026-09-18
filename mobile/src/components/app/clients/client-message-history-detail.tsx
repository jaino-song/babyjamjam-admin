"use client";

import { ChevronLeft, CircleAlert, MessageCircle } from "lucide-react";

import { InfoCard, InfoRow } from "@/components/app/mobile-redesign/detail-sheet";
import { Button } from "@/components/ui/button";

export type MessageHistoryDetailTone =
  | "green"
  | "primary"
  | "orange"
  | "muted"
  | "burgundy"
  | "purple";

export interface ClientMessageHistoryDetailView {
  title: string;
  templateLabel: string;
  channelLabel: string;
  statusLabel: string;
  statusTone: MessageHistoryDetailTone;
  sentAtLabel: string;
  recipientName: string;
  recipientPhone: string;
  messageBody: string;
  failureReason: string | null;
}

const HERO_ICON_TONE_CLASS: Record<MessageHistoryDetailTone, string> = {
  green: "bg-v3-green-light text-v3-green",
  primary: "bg-v3-primary-light text-v3-primary",
  orange: "bg-v3-orange-light text-v3-orange",
  muted: "bg-v3-dim-white text-v3-text-muted",
  burgundy: "bg-v3-burgundy-light text-v3-burgundy",
  purple: "bg-v3-purple-light text-v3-purple",
};

/**
 * Read-only detail view for a single client message-history entry.
 * Presentational only — the caller resolves the display fields from the log record.
 * Mirrors the frontend MessageHistoryDetailPanel using mobile-redesign primitives.
 */
export function ClientMessageHistoryDetail({
  "data-component": dataComponent,
  view,
  onBack,
  showBackAction = true,
  showStatusBadge = true,
  canRetry = false,
  isRetrying = false,
  onRetry,
}: {
  "data-component": string;
  view: ClientMessageHistoryDetailView;
  onBack: () => void;
  showBackAction?: boolean;
  /** The SlidingCard header already renders the selected record status. */
  showStatusBadge?: boolean;
  canRetry?: boolean;
  isRetrying?: boolean;
  onRetry?: () => void;
}) {
  const isFailed = view.statusTone === "burgundy";
  const showRetry = isFailed && canRetry && Boolean(onRetry);
  const sub = (suffix: string) => `${dataComponent}_${suffix}`;

  return (
    <div className="message-detail pop-up" data-component={dataComponent}>
      {showBackAction ? (
        <button
          type="button"
          className="message-detail-back"
          data-component={sub("back")}
          onClick={onBack}
        >
          <ChevronLeft size={16} strokeWidth={2.5} />
          목록으로
        </button>
      ) : null}

      <section
        data-component={sub("head")}
        data-slot="detail-hero"
        className="flex items-center gap-[calc(12px*var(--glint-ui-scale,1))]"
      >
        <div
          className={`flex h-[calc(46px*var(--glint-ui-scale,1))] w-[calc(46px*var(--glint-ui-scale,1))] shrink-0 items-center justify-center rounded-[calc(14px*var(--glint-ui-scale,1))] ${HERO_ICON_TONE_CLASS[view.statusTone]}`}
          data-component={sub("icon")}
          aria-hidden="true"
        >
          {isFailed ? (
            <CircleAlert
              className="h-[calc(20px*var(--glint-ui-scale,1))] w-[calc(20px*var(--glint-ui-scale,1))]"
              strokeWidth={2.25}
            />
          ) : (
            <MessageCircle
              className="h-[calc(20px*var(--glint-ui-scale,1))] w-[calc(20px*var(--glint-ui-scale,1))]"
              strokeWidth={2.25}
            />
          )}
        </div>
        <div
          className="flex min-w-0 flex-1 flex-col gap-[calc(4px*var(--glint-ui-scale,1))]"
          data-component={sub("head-text")}
        >
          <h2
            className="text-[calc(0.94rem*var(--glint-ui-scale,1))] font-bold leading-[calc(1.25rem*var(--glint-ui-scale,1))] text-v3-dark"
            data-component={sub("title")}
          >
            {view.title}
          </h2>
          <p
            className="text-[calc(0.7rem*var(--glint-ui-scale,1))] leading-[calc(1.05rem*var(--glint-ui-scale,1))] text-v3-text-muted"
            data-component={sub("subtitle")}
          >
            {view.channelLabel} · {view.sentAtLabel}
          </p>
        </div>
        {showStatusBadge ? (
          <span
            className={`badge-mini ${view.statusTone}`}
            data-component={sub("status")}
          >
            {view.statusLabel}
          </span>
        ) : null}
      </section>

      <InfoCard data-component={sub("info-card")} title="발송 정보">
        <InfoRow label="수신자" value={view.recipientName} />
        <InfoRow label="연락처" value={view.recipientPhone} />
        <InfoRow label="템플릿" value={view.templateLabel} />
        <InfoRow label="채널" value={view.channelLabel} />
        {view.failureReason ? (
          <InfoRow label="실패 사유" value={view.failureReason} tone="burgundy" />
        ) : null}
      </InfoCard>

      {showRetry ? (
        <div className="detail-actions card-actions" data-component={sub("retry-actions")}>
          <Button
            type="button"
            variant="v3-outline"
            size="md"
            className="w-full"
            data-component={sub("retry-trigger")}
            disabled={isRetrying}
            aria-busy={isRetrying || undefined}
            onClick={onRetry}
          >
            {isRetrying ? "재발송 중..." : "재발송"}
          </Button>
        </div>
      ) : null}

      <InfoCard data-component={sub("info-card-2")} title="메시지 내용">
        <p
          className="message-detail-body"
          data-component={sub("body")}
        >
          {view.messageBody}
        </p>
      </InfoCard>
    </div>
  );
}
