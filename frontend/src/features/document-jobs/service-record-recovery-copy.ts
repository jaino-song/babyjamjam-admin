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
export function serviceRecordMayExist(progressStep?: string | null): boolean {
  return progressStep === "dispatch_authorized" || progressStep === "creating"
    || progressStep === "sent" || progressStep === "reconciling";
}
