"use client";

import { TwoButtonModal } from "@/components/app/ui/TwoButtonModal";

interface ServiceScheduleContractResendModalProps {
    open: boolean;
    dataComponent: string;
    isPending?: boolean;
    onKeep: () => void;
    onResend: () => void;
}

/** Asked right after a service schedule change: keep the current contract, or send a revised one. */
export function ServiceScheduleContractResendModal({
    open,
    dataComponent,
    isPending = false,
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
                    <span>수정 전송하면 서명 전인 기존 계약서는 새 계약서 전송 후 취소돼요.</span>
                </>
            }
            isDescriptionVisuallyHidden={false}
            size="detail"
            cancelLabel="그대로 두기"
            approvalLabel="수정 전송"
            pendingLabel="준비 중..."
            isPending={isPending}
            onApprove={onResend}
        />
    );
}
