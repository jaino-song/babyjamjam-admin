"use client";

import { ApprovalTwoButtonModal } from "@/components/app/ui/ApprovalTwoButtonModal";

interface ServiceScheduleContractResendModalProps {
    "data-component": string;
    open: boolean;
    onKeep: () => void;
    onResend: () => void;
}

/** Asked right after a service schedule change: keep the signed contract, or send a revised one. */
export function ServiceScheduleContractResendModal({
    "data-component": dataComponent,
    open,
    onKeep,
    onResend,
}: ServiceScheduleContractResendModalProps) {
    return (
        <ApprovalTwoButtonModal
            open={open}
            data-component={dataComponent}
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
            onOpenChange={(nextOpen) => {
                if (!nextOpen) onKeep();
            }}
            onApprove={onResend}
        />
    );
}
