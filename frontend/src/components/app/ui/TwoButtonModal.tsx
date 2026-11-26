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
/**
 * default: the title asks and the description explains.
 * question: the description is the question itself. The title stays for screen readers only;
 * the description is centered, semibold and dark with balanced lines, 20px above and below,
 * and keeps its sentences on shared lines. The modal is at least 180px tall, the height of a
 * compact one, and the spare height splits evenly above and below the description.
 */
type TwoButtonModalLayout = "default" | "question";

const SOURCE_COMPONENT = "TwoButtonModal";
const DEFAULT_DATA_COMPONENT = "desktop_v3_two-button-modal";

export type TwoButtonModalSize = ApprovalModalSize;
export type { TwoButtonModalLayout };

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
  /**
   * Runs on the left button in place of closing, when that button is the other choice
   * rather than a way out. Escape and the overlay still close.
   */
  onCancel?: () => void;
  cancelDisabled?: boolean;
  approvalLabel: ReactNode;
  pendingLabel?: ReactNode;
  onApprove: () => void;
  isPending?: boolean;
  approvalDisabled?: boolean;
  approvalVariant?: ApprovalButtonVariant;
  isDescriptionVisuallyHidden?: boolean;
  size?: ApprovalModalSize;
  layout?: TwoButtonModalLayout;
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
  onCancel,
  cancelDisabled = false,
  approvalLabel,
  pendingLabel,
  onApprove,
  isPending = false,
  approvalDisabled = false,
  approvalVariant = "positive",
  isDescriptionVisuallyHidden = true,
  size = "compact",
  layout = "default",
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

  const isQuestion = layout === "question";
  // The question layout always shows its description, since the description asks.
  const isDescriptionHidden = !isQuestion && isDescriptionVisuallyHidden;

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
          isQuestion && "min-h-[180px]",
        )}
      >
        <DialogHeader
          data-component={headerDataComponent ?? sub("header")}
          className={cn(
            "gap-1 justify-center text-left sm:text-left",
            size === "compact" ? "flex-1 pb-0" : "pb-3",
            isQuestion && "flex-1 justify-start",
          )}
        >
          <DialogTitle
            data-component={titleDataComponent ?? sub("title")}
            aria-label={titleAriaLabel}
            className={cn(
              "break-keep [overflow-wrap:anywhere] text-center text-[calc(16px*var(--v3-ui-scale,1))] leading-[calc(24px*var(--v3-ui-scale,1))]",
              isQuestion && "sr-only",
            )}
          >
            {title}
          </DialogTitle>
          <DialogDescription
            data-component={descriptionDataComponent ?? sub("description")}
            className={cn(
              "break-keep [overflow-wrap:anywhere] text-[calc(12px*var(--v3-ui-scale,1))] leading-[calc(20px*var(--v3-ui-scale,1))]",
              isQuestion
                ? "my-auto py-5 text-center text-balance font-semibold text-v3-dark"
                : "mt-0 text-left text-v3-text-muted",
              isDescriptionHidden && "sr-only",
              !isQuestion && !isDescriptionHidden && "mx-auto w-fit max-w-full whitespace-pre-line",
            )}
          >
            {isQuestion || isDescriptionHidden
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
            disabled={isPending || cancelDisabled}
            onClick={() => (onCancel ? onCancel() : handleOpenChange(false))}
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
