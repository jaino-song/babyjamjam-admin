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

type ApprovalModalSize = "compact" | "detail";
type ApprovalButtonVariant = "positive" | "destructive";

export interface ApprovalTwoButtonModalProps {
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
  dataComponent?: string;
  headerDataComponent?: string;
  titleDataComponent?: string;
  descriptionDataComponent?: string;
  bodyDataComponent?: string;
  footerDataComponent?: string;
  cancelButtonDataComponent?: string;
  approvalButtonDataComponent?: string;
}

export function ApprovalTwoButtonModal({
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
  dataComponent = "approval-two-button-modal",
  headerDataComponent,
  titleDataComponent,
  descriptionDataComponent,
  bodyDataComponent,
  footerDataComponent,
  cancelButtonDataComponent,
  approvalButtonDataComponent,
}: ApprovalTwoButtonModalProps) {
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && isPending) return;
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        data-component={dataComponent}
        className={cn(
          "flex flex-col",
          size === "compact" && "aspect-[5/3] sm:max-w-[300px]",
          size === "detail" && "min-h-0 sm:max-w-[420px]",
        )}
      >
        <DialogHeader
          data-component={headerDataComponent ?? `${dataComponent}-header`}
          className={cn(
            "justify-center pb-0 text-center sm:text-center",
            size === "compact" && "flex-1",
          )}
        >
          <DialogTitle
            data-component={titleDataComponent ?? `${dataComponent}-title`}
            aria-label={titleAriaLabel}
            className="text-[calc(14px*var(--v3-ui-scale,1))] leading-5"
          >
            {title}
          </DialogTitle>
          <DialogDescription
            data-component={descriptionDataComponent ?? `${dataComponent}-description`}
            className={cn(
              "mt-[calc(6px*var(--v3-ui-scale,1))] text-[calc(12px*var(--v3-ui-scale,1))] leading-[calc(20px*var(--v3-ui-scale,1))] text-v3-text-muted",
              isDescriptionVisuallyHidden && "sr-only",
            )}
          >
            {description}
          </DialogDescription>
        </DialogHeader>

        {children ? (
          <div
            data-component={bodyDataComponent ?? `${dataComponent}-body`}
            className={cn("min-h-0", size === "detail" && "overflow-y-auto")}
          >
            {children}
          </div>
        ) : null}

        <DialogFooter
          data-component={footerDataComponent ?? `${dataComponent}-footer`}
          className="flex-row pt-0 sm:justify-stretch"
        >
          <Button
            type="button"
            variant="neutral"
            size="sm"
            className="w-1/2"
            data-component={cancelButtonDataComponent ?? `${dataComponent}-cancel`}
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
            data-component={approvalButtonDataComponent ?? `${dataComponent}-approve`}
            disabled={isPending || approvalDisabled}
            aria-busy={isPending || undefined}
            onClick={onApprove}
          >
            {isPending ? (pendingLabel ?? approvalLabel) : approvalLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
