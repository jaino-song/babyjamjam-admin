"use client";

import type { ReactNode } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ApprovalTwoButtonModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description: ReactNode;
  cancelLabel?: ReactNode;
  approvalLabel: ReactNode;
  pendingLabel?: ReactNode;
  onApprove: () => void | Promise<void>;
  isPending?: boolean;
  approvalDisabled?: boolean;
  approvalVariant?: "positive" | "destructive";
  isDescriptionVisuallyHidden?: boolean;
  dataComponent?: string;
}

export function ApprovalTwoButtonModal({
  open,
  onOpenChange,
  title,
  description,
  cancelLabel = "취소",
  approvalLabel,
  pendingLabel,
  onApprove,
  isPending = false,
  approvalDisabled = false,
  approvalVariant = "positive",
  isDescriptionVisuallyHidden = true,
  dataComponent = "approval-two-button-modal",
}: ApprovalTwoButtonModalProps) {
  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && isPending) return;
    onOpenChange(nextOpen);
  };

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          data-component={`${dataComponent}-overlay`}
          className="fixed inset-0 z-[250] bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0"
        />
        <DialogPrimitive.Content
          data-component={dataComponent}
          className="fixed left-1/2 top-1/2 z-[251] flex aspect-[5/3] w-[calc(100vw-2.5rem)] max-w-[300px] -translate-x-1/2 -translate-y-1/2 flex-col rounded-[28px] border-0 bg-v3-dim-white p-4 shadow-[0_20px_60px_hsla(214,50%,20%,0.15)] outline-none duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95"
        >
          <div
            data-component={`${dataComponent}-header`}
            className="flex flex-1 flex-col items-center justify-center gap-2 text-center"
          >
            <DialogPrimitive.Title
              data-component={`${dataComponent}-title`}
              className="text-[0.875rem] font-bold leading-5 text-v3-dark"
            >
              {title}
            </DialogPrimitive.Title>
            <DialogPrimitive.Description
              data-component={`${dataComponent}-description`}
              className={cn(
                "text-[0.75rem] leading-5 text-v3-text-muted",
                isDescriptionVisuallyHidden && "sr-only",
              )}
            >
              {description}
            </DialogPrimitive.Description>
          </div>

          <div data-component={`${dataComponent}-footer`} className="flex gap-2">
            <Button
              type="button"
              variant="v3-outline"
              size="sm"
              className="w-1/2"
              data-component={`${dataComponent}-cancel`}
              disabled={isPending}
              onClick={() => handleOpenChange(false)}
            >
              {cancelLabel}
            </Button>
            <Button
              type="button"
              variant={approvalVariant === "destructive" ? "destructive" : "v3"}
              size="sm"
              className="w-1/2 rounded-full"
              data-component={`${dataComponent}-approve`}
              disabled={isPending || approvalDisabled}
              aria-busy={isPending || undefined}
              onClick={() => void onApprove()}
            >
              {isPending ? (pendingLabel ?? approvalLabel) : approvalLabel}
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
