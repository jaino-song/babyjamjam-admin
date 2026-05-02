"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useEformsign } from "@/hooks/useEformsign";
import { eformsignApi } from "@/services/api";
import type { EformsignDocumentOption, EformsignErrorResponse } from "@/lib/eformsign/types";

interface StaffCompletionDialogProps {
    documentId: string | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onCompleted?: (documentId: string) => void;
}

const STAFF_COMPLETION_IFRAME_ID = "staff_completion_iframe";

export function StaffCompletionDialog({
    documentId,
    open,
    onOpenChange,
    onCompleted,
}: StaffCompletionDialogProps) {
    const [documentOption, setDocumentOption] = useState<EformsignDocumentOption | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
    const { isLoaded, isLoading, error: sdkError, openDocument } = useEformsign();

    useEffect(() => {
        if (!open || !documentId) {
            setDocumentOption(null);
            setError(null);
            setFallbackUrl(null);
            return;
        }

        let isCancelled = false;

        setDocumentOption(null);
        setError(null);
        setFallbackUrl(null);

        void (async () => {
            try {
                await eformsignApi.authenticate(Date.now());
                const option = await eformsignApi.generateStaffDocument(documentId);

                if (!isCancelled) {
                    setDocumentOption(option);
                }
            } catch (caughtError) {
                if (isCancelled) {
                    return;
                }

                setError(caughtError instanceof Error ? caughtError.message : "옵션 생성 실패");
            }
        })();

        return () => {
            isCancelled = true;
        };
    }, [documentId, open]);

    useEffect(() => {
        if (!sdkError) {
            return;
        }

        setError(sdkError);
    }, [sdkError]);

    useEffect(() => {
        if (!open || !documentId || !documentOption || !isLoaded || fallbackUrl) {
            return;
        }

        openDocument(documentOption, STAFF_COMPLETION_IFRAME_ID, {
            onSuccess: () => {
                onCompleted?.(documentId);
                onOpenChange(false);
            },
            onError: (response: EformsignErrorResponse) => {
                setError(response.message || "iframe 오류");
                // TODO: if embedded type 02 proves unsupported in the tenant, derive a direct iframe URL
                // from the document payload (for example external_token or console URL) and setFallbackUrl here.
            },
        });
    }, [documentId, documentOption, fallbackUrl, isLoaded, onCompleted, onOpenChange, open, openDocument]);

    const effectiveError = error ?? sdkError;
    const shouldShowLoading = open && !effectiveError && !fallbackUrl && (isLoading || !documentOption);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="flex h-[90vh] max-w-5xl flex-col">
                <DialogHeader>
                    <DialogTitle>서비스 종료일 입력 및 확정</DialogTitle>
                </DialogHeader>
                {effectiveError && <div className="text-sm text-red-500">{effectiveError}</div>}
                {shouldShowLoading && (
                    <div className="flex min-h-[160px] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
                        문서를 불러오는 중입니다.
                    </div>
                )}
                {fallbackUrl ? (
                    <iframe
                        title="서비스 종료일 입력 및 확정"
                        src={fallbackUrl}
                        className="h-full w-full flex-1 rounded-md border"
                    />
                ) : (
                    <div id={STAFF_COMPLETION_IFRAME_ID} className="min-h-[480px] flex-1" />
                )}
            </DialogContent>
        </Dialog>
    );
}
