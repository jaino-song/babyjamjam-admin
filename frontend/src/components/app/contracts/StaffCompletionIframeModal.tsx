"use client";

import { useEffect, useRef } from "react";
import type {
  EformsignActionResponse,
  EformsignDocumentOption,
  EformsignErrorResponse,
  EformsignSuccessResponse,
} from "@/lib/eformsign/types";
import { useEformsign } from "@/hooks/useEformsign";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const STAFF_COMPLETION_IFRAME_ID = "contracts_staff_completion_iframe";

interface StaffCompletionIframeModalProps {
  documentOption: EformsignDocumentOption | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (response: EformsignSuccessResponse) => void;
  onError: (message: string) => void;
  onCancel: () => void;
}

export function StaffCompletionIframeModal({
  documentOption,
  open,
  onOpenChange,
  onSuccess,
  onError,
  onCancel,
}: StaffCompletionIframeModalProps) {
  const { isLoaded, isLoading, error: sdkError, openDocument } = useEformsign();
  const hasOpenedRef = useRef(false);

  useEffect(() => {
    if (!open) {
      hasOpenedRef.current = false;
    }
  }, [open]);

  useEffect(() => {
    if (!open || !sdkError) {
      return;
    }

    hasOpenedRef.current = false;
    onError(sdkError);
  }, [onError, open, sdkError]);

  useEffect(() => {
    if (!open || !documentOption || !isLoaded || hasOpenedRef.current) {
      return;
    }

    let raf1 = 0;
    let raf2 = 0;

    raf1 = window.requestAnimationFrame(() => {
      raf2 = window.requestAnimationFrame(() => {
        const iframe = document.getElementById(STAFF_COMPLETION_IFRAME_ID);
        if (!iframe) {
          return;
        }

        hasOpenedRef.current = true;

        openDocument(documentOption, STAFF_COMPLETION_IFRAME_ID, {
          onSuccess,
          onError: (response: EformsignErrorResponse) => {
            hasOpenedRef.current = false;
            onError(response.message || "최종 확인 중 오류가 발생했습니다.");
          },
          onAction: (response: EformsignActionResponse) => {
            const actionType = response.type.toLowerCase();
            if (actionType.includes("cancel") || actionType.includes("close")) {
              hasOpenedRef.current = false;
              onCancel();
            }
          },
        });
      });
    });

    return () => {
      window.cancelAnimationFrame(raf1);
      window.cancelAnimationFrame(raf2);
    };
  }, [documentOption, isLoaded, onCancel, onError, onSuccess, open, openDocument]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[90vh] max-w-5xl flex-col">
        <DialogHeader>
          <DialogTitle>최종 확인</DialogTitle>
        </DialogHeader>
        <div className="relative flex flex-1 min-h-0">
          <iframe
            id={STAFF_COMPLETION_IFRAME_ID}
            title="최종 확인"
            className="absolute inset-0 h-full w-full border-none"
          />
          {(isLoading || !isLoaded || !documentOption) && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/80 text-sm text-muted-foreground">
              문서를 불러오는 중입니다.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
