import {
  INITIAL_DOCUMENT_STATE_CODES,
  initialNoProviderDocumentReasonSchema,
  type InitialNoProviderDocumentReason,
} from "@/lib/eformsign/initial-document-recovery-contract";
import type { EformsignDocumentJobResponse } from "@/services/eformsign";

export const DOCUMENT_JOB_MANUAL_RECOVERY_UNSUPPORTED = "이 작업은 수동 전송 화면을 지원하지 않아요. 전자문서 작업 목록에서 재시도하거나 취소해 주세요.";

export const SERVICE_RECORD_RECOVERY_COPY = {
  retryTitle: "제공기록지 생성을 재시도할까요?",
  retryDescription: "재시도하면 서버에서 제공기록지를 다시 생성합니다.",
  retryUnavailable: "이 제공기록지 작업은 지금 재시도할 수 없어요. 전자문서 작업 목록에서 상태를 다시 확인해 주세요.",
  retryFailed: "제공기록지 생성을 재시도하지 못했어요. 잠시 후 다시 시도해 주세요.",
  cancelTitle: "제공기록지 작업을 취소할까요?",
  cancelDescription: "취소하면 제공기록지 생성 작업이 닫혀요.",
  beforeDispatch: "아직 보낸 문서는 없어요.",
  afterDispatch: "이폼사인에 제공기록지가 이미 생성되었을 수 있어요. 이폼사인에서 문서 상태를 확인해 주세요.",
  cancelUnavailable: "이 제공기록지 작업은 지금 취소할 수 없어요. 전자문서 작업 목록에서 상태를 다시 확인해 주세요.",
  cancelFailed: "제공기록지 작업을 취소하지 못했어요. 잠시 후 다시 시도해 주세요.",
  recoveryUnsupported: "제공기록지 작업은 수동 전송 화면을 지원하지 않아요. 전자문서 작업 목록에서 재시도하거나 취소해 주세요.",
  nextAction: "전자문서 작업 목록에서 재시도하거나 취소해 주세요.",
} as const;

/** Dispatch evidence is independent of whether the backend currently permits a retry. */
export function serviceRecordMayExist({ progressStep, progressDetail }: Partial<Pick<EformsignDocumentJobResponse, "progressStep" | "progressDetail">>): boolean {
  return progressStep === "dispatch_authorized" || progressStep === "creating"
    || progressStep === "sent" || progressStep === "reconciling"
    || progressDetail === "client-started" || progressDetail === "info-inserted"
    || progressDetail === "creating" || progressDetail === "sent";
}

export const INITIAL_DOCUMENT_RECOVERY_COPY = {
  regenerateLabel: "재생성",
  regenerateTitle: "제공기록지를 재생성할까요?",
  regenerateDescription: "현재 확정된 제공기록지로 새 문서를 생성하고 전송합니다.",
  confirmLabel: "보낸 문서 없음 확인",
  confirmTitle: "보낸 문서가 없는지 확인할까요?",
  confirmDescription: "먼저 이폼사인 콘솔의 진행중, 완료, 반려/취소 목록에서 아래 접미사를 검색해 주세요. 확인을 누르면 서버가 이폼사인을 다시 조회한 뒤 결과를 반영합니다.",
  confirmEmptyOrdinals: "저장된 문서 조각 없음",
  unavailable: "문서 상태가 변경됐어요. 최신 상태를 확인해 주세요.",
  failed: "처리 결과를 확인하지 못했어요. 문서의 최신 상태를 먼저 확인해 주세요.",
} as const;

const NO_PROVIDER_DOCUMENT_CONFLICT_COPY: Record<InitialNoProviderDocumentReason, string> = {
  SERVICE_RECORD_INITIAL_NO_DOC_NOT_ELIGIBLE: "현재 상태에서는 보낸 문서 없음을 확인할 수 없어요. 문서 상태를 다시 확인해 주세요.",
  SERVICE_RECORD_INITIAL_NO_DOC_GENERATION_CHANGED: "대상 문서의 세대가 바뀌었어요. 목록에서 최신 문서 상태를 확인해 주세요.",
  SERVICE_RECORD_INITIAL_NO_DOC_SETTLING: "문서 취소 직후라 전송 결과를 기다리고 있어요. 잠시 후 다시 확인해 주세요.",
  SERVICE_RECORD_INITIAL_NO_DOC_VENDOR_CHECK_IN_PROGRESS: "다른 요청에서 이폼사인을 확인하고 있어요. 확인이 끝난 뒤 상태를 다시 확인해 주세요.",
  SERVICE_RECORD_INITIAL_NO_DOC_VENDOR_CHECK_INCOMPLETE: "이폼사인 목록을 모두 확인하지 못했어요. 잠시 후 다시 확인해 주세요.",
  SERVICE_RECORD_INITIAL_NO_DOC_PROVIDER_DOCUMENT_FOUND: "이폼사인에서 보낸 문서를 찾았어요. 이폼사인에서 해당 문서의 상태를 확인해 주세요.",
  SERVICE_RECORD_INITIAL_NO_DOC_LEFT_TO_PROVIDER_RECOVERY: "모든 문서 조각이 이미 연결됐어요. 이폼사인에서 문서 상태를 확인해 주세요.",
  SERVICE_RECORD_INITIAL_NO_DOC_STATE_CHANGED: "확인하는 동안 문서 상태가 바뀌었어요. 최신 상태를 다시 확인해 주세요.",
  SERVICE_RECORD_INITIAL_NO_DOC_NOT_READY_AFTER_OUTCOME: "재생성에 필요한 상태를 확인하지 못했어요. 최신 상태를 확인하거나 관리자에게 문의해 주세요.",
};

export function noProviderDocumentConflictCopy(reason: unknown): string | null {
  const parsed = initialNoProviderDocumentReasonSchema.safeParse(reason);
  return parsed.success ? NO_PROVIDER_DOCUMENT_CONFLICT_COPY[parsed.data] : null;
}

export function initialRegenerationBlockedCopy(reason: unknown): string | null {
  switch (reason) {
    case INITIAL_DOCUMENT_STATE_CODES.siblingInProgress:
      return "일부 문서가 아직 진행 중이에요. 이폼사인에서 진행 중인 문서를 확인해 주세요.";
    case INITIAL_DOCUMENT_STATE_CODES.siblingCompleted:
    case INITIAL_DOCUMENT_STATE_CODES.completedDocumentDeleted:
      return "일부 문서가 이미 완료됨 · 관리자 문의";
    case INITIAL_DOCUMENT_STATE_CODES.deletedStatusUnknown:
      return "삭제된 문서의 완료 여부를 확인할 수 없음 · 관리자 문의";
    case INITIAL_DOCUMENT_STATE_CODES.jobInProgress:
      return "문서 생성 작업이 아직 진행 중이에요. 처리 후 상태를 다시 확인해 주세요.";
    default:
      return null;
  }
}

/** 재생성 가능한 INITIAL 상태에서만 사용하는 종료 사유. */
export function isInitialRegenerationState(reason: string | null): boolean {
  return reason === INITIAL_DOCUMENT_STATE_CODES.noProviderDocument
    || reason === INITIAL_DOCUMENT_STATE_CODES.partialDispatch
    || reason === INITIAL_DOCUMENT_STATE_CODES.rejected
    || reason === INITIAL_DOCUMENT_STATE_CODES.voided;
}
