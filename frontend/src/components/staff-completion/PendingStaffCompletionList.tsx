"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { eformsignApi, type PendingStaffCompletionItem } from "@/services/api";
import { StaffCompletionDialog } from "./StaffCompletionDialog";

export function PendingStaffCompletionList() {
    const [items, setItems] = useState<PendingStaffCompletionItem[]>([]);
    const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        setIsLoading(true);
        setError(null);

        try {
            const data = await eformsignApi.getPendingStaffCompletionDocs();
            setItems(data);
        } catch (caughtError) {
            setError(caughtError instanceof Error ? caughtError.message : "문서 목록을 불러오지 못했습니다.");
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        void refresh();
    }, [refresh]);

    return (
        <div className="space-y-4 p-4 md:p-6">
            <div className="space-y-1">
                <h2 className="text-xl font-semibold">서명 후 종료일 입력 대기 문서</h2>
                <p className="text-sm text-muted-foreground">
                    이용자 서명 완료 후 직원 확정이 남아 있는 계약서를 처리합니다.
                </p>
            </div>

            {error && (
                <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-600">
                    {error}
                </div>
            )}

            <div className="overflow-hidden rounded-lg border bg-white">
                {isLoading ? (
                    <div className="p-4 text-sm text-muted-foreground">문서를 불러오는 중입니다.</div>
                ) : items.length === 0 ? (
                    <div className="p-4 text-sm text-muted-foreground">대기 중인 문서가 없습니다.</div>
                ) : (
                    items.map((item) => (
                        <div
                            key={item.documentId}
                            className="flex flex-col gap-3 border-b p-4 last:border-b-0 md:flex-row md:items-center md:justify-between"
                        >
                            <div className="space-y-1">
                                <div className="font-medium text-foreground">{item.clientName}</div>
                                <div className="text-sm text-muted-foreground">
                                    서명 일시: {new Date(item.signedAt).toLocaleString("ko-KR")}
                                </div>
                                <div className="text-sm text-muted-foreground">상태: {item.statusDetail}</div>
                            </div>
                            <Button
                                onClick={() => {
                                    setSelectedDocId(item.documentId);
                                    setDialogOpen(true);
                                }}
                            >
                                열기
                            </Button>
                        </div>
                    ))
                )}
            </div>

            <StaffCompletionDialog
                key={selectedDocId ?? "none"}
                documentId={selectedDocId}
                open={dialogOpen}
                onOpenChange={(nextOpen) => {
                    setDialogOpen(nextOpen);
                    if (!nextOpen) {
                        setSelectedDocId(null);
                        void refresh();
                    }
                }}
                onCompleted={() => {
                    void refresh();
                }}
            />
        </div>
    );
}
