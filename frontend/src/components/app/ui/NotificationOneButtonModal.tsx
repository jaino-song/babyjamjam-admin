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

type NotificationButtonVariant = "positive" | "destructive" | "neutral";

export interface NotificationOneButtonModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  titleAriaLabel?: string;
  description: ReactNode;
  buttonLabel?: ReactNode;
  buttonVariant?: NotificationButtonVariant;
  onAcknowledge: () => void;
  isDescriptionVisuallyHidden?: boolean;
  dataComponent?: string;
}

export function NotificationOneButtonModal({
  open,
  onOpenChange,
  title,
  titleAriaLabel,
  description,
  buttonLabel = "확인",
  buttonVariant = "positive",
  onAcknowledge,
  isDescriptionVisuallyHidden = true,
  dataComponent = "notification-one-button-modal",
}: NotificationOneButtonModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-component={dataComponent}
        className="flex aspect-[5/3] flex-col sm:max-w-[300px]"
      >
        <DialogHeader
          data-component={`${dataComponent}-header`}
          className="flex-1 justify-center pb-0 text-center sm:text-center"
        >
          <DialogTitle
            data-component={`${dataComponent}-title`}
            aria-label={titleAriaLabel}
            className="text-[calc(14px*var(--v3-ui-scale,1))] leading-5"
          >
            {title}
          </DialogTitle>
          <DialogDescription
            data-component={`${dataComponent}-description`}
            className={cn(
              "mt-[calc(6px*var(--v3-ui-scale,1))] text-[calc(12px*var(--v3-ui-scale,1))] leading-[calc(20px*var(--v3-ui-scale,1))] text-v3-text-muted",
              isDescriptionVisuallyHidden && "sr-only",
            )}
          >
            {description}
          </DialogDescription>
        </DialogHeader>

        <DialogFooter
          data-component={`${dataComponent}-footer`}
          className="pt-0 sm:justify-stretch"
        >
          <Button
            type="button"
            variant={buttonVariant}
            size="sm"
            className="w-full"
            data-component={`${dataComponent}-acknowledge`}
            onClick={onAcknowledge}
          >
            {buttonLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
