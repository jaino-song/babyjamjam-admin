"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { serviceRecordResetTarget, serviceRecordResetUrl } from "@babyjamjam/shared/utils";
import { TwoButtonModal } from "@/components/app/ui/TwoButtonModal";
import { serviceRecordsApi } from "@/features/service-records/api/service-records.api";
import { serviceRecordKeys } from "@/features/service-records/hooks/keys";
import { useToast } from "@/hooks/use-toast";
import { ServiceRecordLinkResetResultModal } from "./ServiceRecordLinkResetResultModal";

export interface ServiceRecordLinkResetSelection {
    caseId: string;
    scheduleId: number;
    employeeId: number;
}

export function ServiceRecordLinkResetDialog({
    target, onClose, dataComponent,
}: {
    target: (ServiceRecordLinkResetSelection & { clientId: number }) | null;
    onClose: () => void;
    dataComponent: string;
}) {
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const [url, setUrl] = useState<string | null>(null);
    const inFlight = useRef(false);
    const [pending, setPending] = useState(false);

    async function reset() {
        if (!target || inFlight.current) return;
        inFlight.current = true;
        setPending(true);
        try {
            const { clientId, caseId } = target;
            const { data } = await serviceRecordsApi.getClientOverview(clientId, caseId);
            const selection = serviceRecordResetTarget(data, caseId);
            if (!selection || !("members" in selection.request)
                || selection.scheduleId !== target.scheduleId || selection.request.employeeId !== target.employeeId) {
                toast({ description: "배정이 변경되었어요. 제공기록지를 다시 선택해 주세요", variant: "destructive" });
                return;
            }

            const { data: result } = await serviceRecordsApi.resetLink(selection.scheduleId, selection.request);
            const resetUrl = serviceRecordResetUrl(result, selection.request);
            if (!resetUrl) throw new Error("Unexpected service record reset target");
            onClose();
            setUrl(resetUrl);
            void queryClient.invalidateQueries({ queryKey: serviceRecordKeys.clientOverview(clientId) });
        } catch {
            toast({
                description: "제공기록지 링크를 재설정하지 못했어요. 잠시 후 다시 시도해 주세요",
                variant: "destructive",
            });
        } finally {
            setPending(false);
            inFlight.current = false;
        }
    }

    async function copy(value: string) {
        try {
            await navigator.clipboard.writeText(value);
            toast({ variant: "success", description: "제공기록지 링크를 복사했어요" });
        } catch {
            toast({
                description: "링크를 복사하지 못했어요. 링크를 직접 선택해 복사해 주세요",
                variant: "destructive",
            });
        }
    }

    return (
        <>
            <TwoButtonModal
                open={target !== null}
                onOpenChange={(open) => { if (!open && !pending) onClose(); }}
                data-component={dataComponent}
                title="제공기록지 링크를 재설정하시겠습니까?"
                description="기존 링크가 만료돼요. 메시지는 발송되지 않아요."
                isDescriptionVisuallyHidden={false}
                approvalLabel="링크 재설정"
                pendingLabel="재설정 중"
                isPending={pending}
                onApprove={() => void reset()}
            />
            <ServiceRecordLinkResetResultModal
                open={url !== null}
                serviceRecordUrl={url ?? ""}
                onClose={() => setUrl(null)}
                onCopy={(value) => void copy(value)}
            />
        </>
    );
}
