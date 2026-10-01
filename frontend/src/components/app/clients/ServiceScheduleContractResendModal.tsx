"use client";

import { TwoButtonModal } from "@/components/app/ui/TwoButtonModal";

interface ServiceScheduleContractResendModalProps {
    open: boolean;
    dataComponent: string;
    onKeep: () => void;
    onResend: () => void;
}

/** Asked right after a service schedule change: keep the signed contract, or send a revised one. */
export function ServiceScheduleContractResendModal({
    open,
    dataComponent,
    onKeep,
    onResend,
}: ServiceScheduleContractResendModalProps) {
    return (
        <TwoButtonModal
            open={open}
            onOpenChange={(nextOpen) => {
                if (!nextOpen) onKeep();
            }}
            dataComponent={dataComponent}
            title="계약서도 새로 보낼까요?"
            description={
                <>
                    <span>서비스 일정이 바뀌어 계약 기간이 달라졌어요.</span>
                    <br />
                    <span>바뀐 일정으로 계약서를 수정해 보낼 수 있어요.</span>
                </>
            }
            isDescriptionVisuallyHidden={false}
            size="detail"
            cancelLabel="그대로 두기"
            approvalLabel="수정 전송"
            onApprove={onResend}
        />
    );
}
