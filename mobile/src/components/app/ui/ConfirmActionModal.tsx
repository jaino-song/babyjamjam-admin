"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface ConfirmActionModalProps {
  open: boolean;
  title: string;
  description: string;
  cancelLabel: string;
  confirmLabel: string;
  loading?: boolean;
  onOpenChange: (open: boolean) => void;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}

export function ConfirmActionModal({
  open,
  title,
  description,
  cancelLabel,
  confirmLabel,
  loading = false,
  onOpenChange,
  onCancel,
  onConfirm,
}: ConfirmActionModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-component="confirm-action-modal"
        className="h-auto w-[90vw] max-w-md rounded-2xl p-6"
        showCloseButton={!loading}
      >
        <DialogHeader data-component="confirm-action-modal-header">
          <DialogTitle data-component="confirm-action-modal-title">{title}</DialogTitle>
          <DialogDescription data-component="confirm-action-modal-description">
            {description}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter data-component="confirm-action-modal-actions" className="mt-2">
          <Button variant="outline" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant="destructive" onClick={() => void onConfirm()} disabled={loading}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
