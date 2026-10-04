import { isProviderReviewWorkflowStep, normalizeEformsignStatusCode } from "./eformsign-status-code";

export const COMPLETED_DOCUMENT_STATUS_TYPES = new Set(["003", "012", "022", "032", "050", "062", "072", "092"]);
export const OPENED_DOCUMENT_STATUS_TYPES = new Set(["020"]);
export const CREATED_DOCUMENT_STATUS_TYPES = new Set(["001", "002", "010", "043"]);
export const REQUESTED_DOCUMENT_STATUS_TYPES = new Set(["030", "060", "070"]);

/** 재발행 취소는 알려진 미서명 진행 상태에서만 허용한다. */
export function isCancellableUnsignedContract(contract: {
    statusType: string;
    stepType: string | null;
    stepName: string | null;
} | null | undefined): boolean {
    if (!contract) return false;

    const statusType = normalizeEformsignStatusCode(contract.statusType);
    const isInProgress = CREATED_DOCUMENT_STATUS_TYPES.has(statusType)
        || OPENED_DOCUMENT_STATUS_TYPES.has(statusType)
        || REQUESTED_DOCUMENT_STATUS_TYPES.has(statusType);
    return isInProgress && !isProviderReviewWorkflowStep(contract);
}

/** 완료 상태 또는 고객 서명 이후의 제공기관 검토 단계만 서명 근거로 사용한다. */
export function hasCustomerSigned(contract: {
    statusType: string;
    stepType: string | null;
    stepName: string | null;
} | null | undefined): boolean {
    if (!contract) return false;

    const statusType = normalizeEformsignStatusCode(contract.statusType);
    if (COMPLETED_DOCUMENT_STATUS_TYPES.has(statusType)) return true;

    const isInProgress = CREATED_DOCUMENT_STATUS_TYPES.has(statusType)
        || OPENED_DOCUMENT_STATUS_TYPES.has(statusType)
        || REQUESTED_DOCUMENT_STATUS_TYPES.has(statusType);
    return isInProgress && isProviderReviewWorkflowStep(contract);
}
