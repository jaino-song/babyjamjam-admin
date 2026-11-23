// Single source for automation policy values. A later endpoint exposes these
// values to the 설정 UI, so runtime code must import from here rather than
// inlining numbers.
export {
    SMS_DELIVERY_MAX_ATTEMPTS,
    SMS_DELIVERY_RETRY_DELAY_MS,
} from "domain/entities/message-log.entity";

export const TRIGGER_DISPATCH_CRON = "*/1 * * * *";
export const SEND_HOUR_KST = 9;
export const TRIGGER_JOB_MAX_ATTEMPTS = 3;
export const TRIGGER_JOB_RETRY_DELAY_MS = 5 * 60 * 1000;
export const TRIGGER_JOB_PROCESSING_RECLAIM_MS = 10 * 60 * 1000;
export const PAST_OCCURRENCE_GRACE_MS = 24 * 60 * 60 * 1000;
export const MESSAGE_SENDER_APPROVAL_REQUIRED_CANCEL_REASON = "메시지 발송 승인 필요";

export function isSenderApprovalCancellation(job: { status: string; cancelReason: string | null }): boolean {
    return job.status === "canceled" && job.cancelReason === MESSAGE_SENDER_APPROVAL_REQUIRED_CANCEL_REASON;
}


export const AUTOMATION_CONSENT_CANCEL_REASON = "문자 동의 또는 발송 대상 확인이 필요합니다";
export const MISSING_CATCH_UP_PREDECESSOR_CANCEL_REASON = "보충 발송 이전 순위 job 없음";

export function expiredPendingJobCancelReason(hours: number): string {
    return `기존 발송 예정 ${hours}시간 경과`;
}
