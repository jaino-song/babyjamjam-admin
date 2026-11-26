"use client";

import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * compact: 300px wide with a fixed 5:3 ratio, for a title-only confirmation.
 * review: the same 300px width, but its height follows a short review body.
 * detail: 420px wide with a scrolling body.
 */
type ApprovalModalSize = "compact" | "review" | "detail";
type ApprovalButtonVariant = "positive" | "destructive";

const SOURCE_COMPONENT = "TwoButtonModal";
const DEFAULT_DATA_COMPONENT = "desktop_v3_two-button-modal";

export type TwoButtonModalSize = ApprovalModalSize;

/**
 * A sentence ends at ".", "?" or "!" after a character that is not a digit,
 * so "1. 항목" and "2.5" stay whole.
 */
const SENTENCE_GAP = /([^\d\s][.?!])[ \t]+(?=\S)/g;

/** Starts each sentence of a visible text description on its own line. */
function breakBetweenSentences(description: ReactNode): ReactNode {
  return typeof description === "string"
    ? description.replace(SENTENCE_GAP, "$1\n")
    : description;
}

export interface TwoButtonModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  titleAriaLabel?: string;
  description: ReactNode;
  children?: ReactNode;
  cancelLabel?: ReactNode;
  approvalLabel: ReactNode;
  pendingLabel?: ReactNode;
  onApprove: () => void;
  isPending?: boolean;
  approvalDisabled?: boolean;
  approvalVariant?: ApprovalButtonVariant;
  isDescriptionVisuallyHidden?: boolean;
  size?: ApprovalModalSize;
  layer?: "default" | "nested";
  onCloseAutoFocus?: (event: Event) => void;
  "data-component"?: string;
  /** @internal Zero-DOM wrapper ownership only. */
  sourceComponent?: typeof SOURCE_COMPONENT | "InitialDocumentRecoveryDialog";
  dataComponent?: string;
  headerDataComponent?: string;
  titleDataComponent?: string;
  descriptionDataComponent?: string;
  bodyDataComponent?: string;
  footerDataComponent?: string;
  cancelButtonDataComponent?: string;
  approvalButtonDataComponent?: string;
}

export function TwoButtonModal({
  open,
  onOpenChange,
  title,
  titleAriaLabel,
  description,
  children,
  cancelLabel = "취소",
  approvalLabel,
  pendingLabel,
  onApprove,
  isPending = false,
  approvalDisabled = false,
  approvalVariant = "positive",
  isDescriptionVisuallyHidden = true,
  size = "compact",
  layer = "default",
  onCloseAutoFocus,
  "data-component": canonicalDataComponent,
  sourceComponent = SOURCE_COMPONENT,
  dataComponent: legacyDataComponent,
  headerDataComponent,
  titleDataComponent,
  descriptionDataComponent,
  bodyDataComponent,
  footerDataComponent,
  cancelButtonDataComponent,
  approvalButtonDataComponent,
}: TwoButtonModalProps) {
  const canonicalDataComponentBase = canonicalDataComponent || undefined;
  const dataComponent =
    canonicalDataComponentBase ?? legacyDataComponent ?? DEFAULT_DATA_COMPONENT;
  const sub = (suffix: string) =>
    canonicalDataComponentBase
      ? `${canonicalDataComponentBase}_${suffix}`
      : `${dataComponent}-${suffix}`;

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && isPending) return;
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        data-component={dataComponent}
        data-source-component={sourceComponent}
        onCloseAutoFocus={onCloseAutoFocus}
        overlayClassName={layer === "nested" ? "z-[1009]" : undefined}
        className={cn(
          "flex flex-col",
          layer === "nested" && "z-[1010]",
          size === "compact" && "aspect-[5/3] sm:max-w-[300px]",
          size === "review" && "min-h-0 sm:max-w-[300px]",
          size === "detail" && "min-h-0 sm:max-w-[420px]",
        )}
      >
        <DialogHeader
          data-component={headerDataComponent ?? sub("header")}
          className={cn(
            "gap-1 justify-center text-left sm:text-left",
            size === "compact" ? "flex-1 pb-0" : "pb-3",
          )}
        >
          <DialogTitle
            data-component={titleDataComponent ?? sub("title")}
            aria-label={titleAriaLabel}
            className="break-keep [overflow-wrap:anywhere] text-center text-[calc(16px*var(--v3-ui-scale,1))] leading-[calc(24px*var(--v3-ui-scale,1))]"
          >
            {title}
          </DialogTitle>
          <DialogDescription
            data-component={descriptionDataComponent ?? sub("description")}
            className={cn(
              "mt-0 break-keep [overflow-wrap:anywhere] text-left text-[calc(12px*var(--v3-ui-scale,1))] leading-[calc(20px*var(--v3-ui-scale,1))] text-v3-text-muted",
              isDescriptionVisuallyHidden
                ? "sr-only"
                : "mx-auto w-fit max-w-full whitespace-pre-line",
            )}
          >
            {isDescriptionVisuallyHidden
              ? description
              : breakBetweenSentences(description)}
          </DialogDescription>
        </DialogHeader>

        {children ? (
          <div
            data-component={bodyDataComponent ?? sub("body")}
            className={cn(
              "min-h-0 pb-3 empty:hidden",
              (size === "detail" || size === "review") && "overflow-y-auto",
            )}
          >
            {children}
          </div>
        ) : null}

        <DialogFooter
          data-component={footerDataComponent ?? sub("footer")}
          className="flex-row pt-0 sm:justify-stretch"
        >
          <Button
            type="button"
            variant="neutral"
            size="sm"
            className="w-1/2"
            data-component={cancelButtonDataComponent ?? sub("cancel")}
            disabled={isPending}
            onClick={() => handleOpenChange(false)}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={approvalVariant}
            size="sm"
            className="w-1/2"
            data-component={approvalButtonDataComponent ?? sub("approve")}
            disabled={isPending || approvalDisabled}
            loading={isPending}
            loadingLabel={pendingLabel ?? "처리 중"}
            aria-busy={isPending || undefined}
            onClick={onApprove}
          >
            {approvalLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
