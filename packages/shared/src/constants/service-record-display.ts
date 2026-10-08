import type { StatusBadgeVariant } from "../tokens/status-badge";
import {
    EFORMSIGN_REVOKE_REQUESTED_STATUS_CODE,
    getEformsignStatusCategory,
    isDeletedEformsignStatusCode,
    normalizeEformsignStatusCode,
} from "./eformsign-status-codes";

/**
 * 제공기록지 상태/서명 문서 상태의 표시 규칙 — frontend/mobile이 각자 들고 있던
 * switch 사본(ClientServiceRecordsTab / client-service-records)을 단일화한 것.
 * 두 앱은 여기서 label(+variant)만 읽어 표시한다.
 */
export interface ServiceRecordStatusMeta {
    label: string;
    variant: StatusBadgeVariant;
}

export const SERVICE_RECORD_STATUS_META: Record<string, ServiceRecordStatusMeta> = {
    WAITING_FOR_DETAILS: { label: "정보 대기", variant: "neutral" },
    WAITING_FOR_ASSIGNMENT: { label: "배정 대기", variant: "warning" },
    SCHEDULED: { label: "시작 전", variant: "primary" },
    IN_PROGRESS: { label: "작성 중", variant: "primary" },
    WAITING_FOR_END: { label: "종료 대기", variant: "success" },
    AWAITING_COMPLETION: { label: "기록 미완료", variant: "warning" },
    READY_TO_FINALIZE: { label: "문서 생성 대기", variant: "primary" },
    FINALIZING: { label: "문서 생성 중", variant: "primary" },
    DOCUMENTS_CREATED: { label: "기관 검토 중", variant: "success" },
    COMPLETED: { label: "완료", variant: "success" },
    FINALIZATION_FAILED: { label: "문서 생성 실패", variant: "danger" },
    TERMINATED_REVIEW_REQUIRED: { label: "중단 확인 필요", variant: "warning" },
    MIGRATION_REVIEW_REQUIRED: { label: "데이터 확인 필요", variant: "warning" },
};

export const SERVICE_RECORD_STATUS_FALLBACK_META: ServiceRecordStatusMeta = {
    label: "상태 확인",
    variant: "neutral",
};

export function getServiceRecordStatusMeta(status: string | null | undefined): ServiceRecordStatusMeta {
    return (status && SERVICE_RECORD_STATUS_META[status]) || SERVICE_RECORD_STATUS_FALLBACK_META;
}

export interface SignatureStatusInput {
    statusType?: string | null;
    statusDetail?: string | null;
}

export type SignatureStatusMeta = ServiceRecordStatusMeta;

/**
 * 제공기록지 서명 문서의 표시 규칙. tone/label은 eformsign status code(statusType)로만
 * 정한다. statusDetail은 백엔드가 한국어로 저장하는 표시용 원문("완료", "거부", 단계명 등)이라
 * 영어 키워드로 분기하면 거부 문서가 중립 톤으로 새어 나간다 — 라벨 본문으로만 쓴다.
 * 코드 집합은 eformsign-status-codes의 정본(완료/거부·만료/삭제/진행 중)을 그대로 쓴다.
 *
 * 040(doc_request_revoke)은 정본 집합에서 거부·만료 묶음에 들어 있지만 철회가 "요청"된
 * 상태일 뿐 종료가 아니다(백엔드도 040을 비종료로 취급). 그래서 묶음 분기보다 먼저 처리하고,
 * 저장된 statusDetail("거부" 등)이 무엇이든 무시한다.
 */
/** eformsign doc_request_revoke — 문서 취소가 요청됐을 뿐 아직 철회되지 않은 비종료 상태. */
export const SIGNATURE_REVOKE_REQUESTED_STATUS_CODE = EFORMSIGN_REVOKE_REQUESTED_STATUS_CODE;

export function getSignatureStatusMeta(doc: SignatureStatusInput): SignatureStatusMeta {
    const detail = (doc.statusDetail ?? "").trim();
    const hasType = (doc.statusType ?? "").toString().trim() !== "";
    if (hasType && normalizeEformsignStatusCode(doc.statusType) === SIGNATURE_REVOKE_REQUESTED_STATUS_CODE) {
        return { label: "철회 요청됨", variant: "warning" };
    }
    const category = hasType ? getEformsignStatusCategory(doc.statusType) : "unknown";

    if (category === "completed") return { label: "서명 완료", variant: "success" };
    if (category === "expired") {
        if (isDeletedEformsignStatusCode(doc.statusType)) {
            return { label: detail || "삭제됨", variant: "neutral" };
        }
        return { label: detail || "거부·만료", variant: "danger" };
    }
    if (category === "in-progress") return { label: detail || "진행 중", variant: "primary" };
    return { label: detail || "상태 확인", variant: "neutral" };
}
