"use client";

import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export interface QueryErrorStateProps {
  /** Caller-context canonical value for the root; the title/description/retry parts append to it. */
  dataComponent: string;
  onRetry: () => void;
  /** True while the refetch triggered by retry is in flight: disables the button and shows a spinner. */
  isRetrying?: boolean;
  title?: string;
  description?: string;
  /** panel: centred block for a whole list/detail area. inline: one row for a small section. */
  size?: "panel" | "inline";
  className?: string;
}

/**
 * In-area "failed to load" state for a query that still failed after its automatic retries.
 * It is deliberately unlike the empty states: it always carries role="alert" and a retry button,
 * so "the load failed" can never be mistaken for "there is nothing here".
 * Route-level error.tsx boundaries keep using ErrorFallback.
 */
export function QueryErrorState({
  dataComponent,
  onRetry,
  isRetrying = false,
  title = "불러오지 못했습니다",
  description,
  size = "panel",
  className,
}: QueryErrorStateProps) {
  const isPanel = size === "panel";

  return (
    <div
      role="alert"
      data-component={dataComponent}
      data-slot="query-error-state"
      data-size={size}
      className={cn(
        isPanel
          ? "flex flex-col items-center justify-center gap-3 px-4 py-12 text-center"
          : "flex flex-wrap items-center gap-x-3 gap-y-2 py-2",
        className,
      )}
    >
      <div
        data-component={`${dataComponent}_text`}
        className={cn("flex flex-col gap-1", isPanel ? "items-center" : "min-w-0 flex-1")}
      >
        <p
          data-component={`${dataComponent}_title`}
          data-slot="title"
          className="flex items-center gap-1.5 text-[0.85rem] font-bold text-v3-dark"
        >
          <AlertTriangle aria-hidden="true" className="h-4 w-4 shrink-0 text-v3-burgundy" />
          {title}
        </p>
        {description ? (
          <p
            data-component={`${dataComponent}_description`}
            data-slot="description"
            className="text-[0.73rem] text-v3-text-muted"
          >
            {description}
          </p>
        ) : null}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        data-component={`${dataComponent}_retry`}
        data-slot="retry"
        disabled={isRetrying}
        onClick={onRetry}
      >
        {isRetrying ? (
          <Spinner size="sm" aria-hidden="true" data-component={`${dataComponent}_retry_spinner`} />
        ) : null}
        다시 시도
      </Button>
    </div>
  );
}
