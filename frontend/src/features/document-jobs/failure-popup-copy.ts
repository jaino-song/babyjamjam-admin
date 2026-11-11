import type { EformsignDocumentJobResponse } from "@/services/api";
import type { EformsignDocumentJobRecoveryKind } from "@/services/eformsign";

import { documentJobPipelineStep } from "./progress-step";

export interface FailurePopupCopy {
  title: string;
  description: string;
  actionLabel: string;
}

const FALLBACK_COPY: FailurePopupCopy = {
  title: "전자문서 작업 실패",
  description: "확인이 필요한 전자문서가 있어요.",
  actionLabel: "확인하기",
};

/**
 * Words for one failed contract job, chosen by what staff can do about it. A job
 * the list has not delivered yet (or one with no recovery kind) gets the generic
 * copy so the popup is never blank while its details load.
 */
export function describeFailurePopup(
  job: Pick<EformsignDocumentJobResponse, "jobType" | "recoveryKind" | "clientName"> | undefined,
): FailurePopupCopy {
  if (!job) return FALLBACK_COPY;
  const who = `${job.clientName?.trim() || "고객"} 님`;

  if (job.recoveryKind === "verify_result") {
    return {
      title: "전자문서 결과 확인 필요",
      description: `${who} · 전자문서 처리 결과를 확인하지 못했어요. 결과를 확인해 주세요.`,
      actionLabel: "결과 확인",
    };
  }

  if (job.recoveryKind === "manual_send") {
    if (job.jobType === "create_document") {
      return {
        title: "계약서 자동 전송 실패",
        description: `${who} · 계약서를 자동으로 보내지 못했어요. 저장된 내용을 확인하고 새로 작성할 수 있어요.`,
        actionLabel: "확인하기",
      };
    }
    if (job.jobType === "finalize_document") {
      return {
        title: "검토완료 자동 처리 실패",
        description: `${who} · 검토완료를 자동으로 처리하지 못했어요. 계약서에서 다시 처리해 주세요.`,
        actionLabel: "직접 처리하기",
      };
    }
  }

  return FALLBACK_COPY;
}

/**
 * True only for staff contract jobs the backend recovery contract accepts: a
 * `manual_send` or `verify_result` recovery kind. Auto-finalize jobs and any job
 * with no recovery kind have no recovery flow, so a recovery link would dead-end.
 */
export function isRecoverableJob(job: {
  source?: "staff" | "auto_finalize" | null;
  recoveryKind?: "manual_send" | "verify_result" | null;
}): boolean {
  if (job.source === "auto_finalize") return false;
  return job.recoveryKind === "manual_send" || job.recoveryKind === "verify_result";
}

export function recoverJobHref(jobId: string): string {
  return `/contracts?recoverJobId=${encodeURIComponent(jobId)}`;
}

type FailureDetailJob = Partial<Pick<EformsignDocumentJobResponse, "source" | "recoveryKind" | "progressStep" | "progressDetail" | "lastErrorCode">> & {
  status: string;
  failureReasonCode?: string | null;
};
interface JobFailureDetailCopy {
  reason: string;
  nextAction: string;
  actionKind?: EformsignDocumentJobRecoveryKind;
  actionLabel?: string;
}
type FailureStage = "처리 대기" | "전송 준비" | "문서 작성" | "전송" | "전송 결과 확인";
const STAGE_COPY: Record<FailureStage, string> = {
  "처리 대기": "작업을 시작하지 못했어요.",
  "전송 준비": "전송을 준비하지 못했어요.",
  "문서 작성": "이폼사인에서 문서를 작성하지 못했어요.",
  "전송": "이폼사인에 전송하지 못했어요.",
  "전송 결과 확인": "전송 결과를 확인하지 못했어요.",
};
const CODE_STAGE: Record<string, FailureStage> = {
  JOB_TARGET_NOT_OWNED_BY_BRANCH: "처리 대기",
  MISSING_JOB_PAYLOAD: "처리 대기",
  INVALID_FINALIZE_JOB_PAYLOAD: "처리 대기",
  dispatch_already_claimed: "처리 대기",
  ownership_changed: "처리 대기",
  job_not_active: "처리 대기",
  invalid_job_claim: "처리 대기",
  RECOVERY_PAYLOAD_EXPIRED: "처리 대기",
  SERVICE_RECORD_REVISION_CAPABILITY_UNVERIFIED: "처리 대기",
  SERVICE_RECORD_REVISION_MANUAL_REVIEW_REQUIRED: "처리 대기",
  INVALID_CREATE_JOB_PAYLOAD: "전송 준비",
  template_workflow_config_unavailable: "전송 준비",
  template_workflow_config_invalid: "전송 준비",
  template_workflow_config_unsupported: "전송 준비",
  operation_lock_unavailable: "전송 준비",
  HEADLESS_EXECUTION_FAILURE: "전송 준비",
  HEADLESS_CREATE_PRE_SEND_FAILURE: "문서 작성",
  HEADLESS_FINALIZE_PRE_SEND_FAILURE: "문서 작성",
  PROVIDER_TERMINAL_FAILURE: "전송",
  PROVIDER_STATE_UNAVAILABLE: "전송 결과 확인",
  PROVIDER_DOCUMENT_NOT_FOUND: "전송 결과 확인",
  AMBIGUOUS_PROVIDER_STATE: "전송 결과 확인",
  PROVIDER_STATE_UNFINISHED: "전송 결과 확인",
  MISSING_PROVIDER_DOCUMENT_ID: "전송 결과 확인",
  MISSING_CREATION_RECONCILIATION_HINTS: "전송 결과 확인",
  MISSING_CLIENT_FOR_ADOPTION: "전송 결과 확인",
  ADOPTION_FAILED: "전송 결과 확인",
  RECOVERY_PENDING: "전송 결과 확인",
  COMPLETION_MIRROR_FAILED: "전송 결과 확인",
};
function stageFromStep(step?: string | null): FailureStage {
  if (step === "dispatch_authorized") return "전송 준비";
  if (step === "client-started" || step === "info-inserted") return "문서 작성";
  if (step === "creating") return "전송";
  if (step === "sent" || step === "reconciling") return "전송 결과 확인";
  return "처리 대기";
}
function describeFailureReason(job: FailureDetailJob): string {
  const code = job.lastErrorCode ?? job.failureReasonCode;
  const stage = code && Object.prototype.hasOwnProperty.call(CODE_STAGE, code)
    ? CODE_STAGE[code] : stageFromStep(documentJobPipelineStep(job) ?? job.progressStep);
  return STAGE_COPY[stage];
}

export function describeJobFailureDetail(job: FailureDetailJob): JobFailureDetailCopy | null {
  if (job.progressStep === "manual_in_progress" || job.progressStep?.startsWith("manual_in_progress:")) {
    return {
      reason: "담당자가 이 작업을 직접 처리하고 있습니다.",
      nextAction: "처리가 끝날 때까지 기다린 뒤 상태를 다시 확인해 주세요.",
    };
  }
  if (job.status !== "failed" && job.status !== "requires_attention") return null;
  const code = job.failureReasonCode;
  const reason = describeFailureReason(job);
  const actionKind = isRecoverableJob(job) ? job.recoveryKind ?? undefined : undefined;
  let nextAction = "문서의 처리 상태를 확인하고 관리자에게 문의해 주세요.";
  if (code === "JOB_TARGET_NOT_OWNED_BY_BRANCH") {
    nextAction = "작업을 만든 지점의 관리자에게 확인을 요청해 주세요.";
  } else if (code === "RECOVERY_PAYLOAD_EXPIRED") {
    nextAction = "원래 문서와 처리 결과를 확인하고 관리자에게 다시 진행할 방법을 문의해 주세요.";
  } else if (code === "SERVICE_RECORD_REVISION_CAPABILITY_UNVERIFIED" || code === "SERVICE_RECORD_REVISION_MANUAL_REVIEW_REQUIRED") {
    nextAction = "제공기록지의 내용과 처리 결과를 확인하고 관리자에게 문의해 주세요.";
  } else if (actionKind === "verify_result") {
    nextAction = "문서의 실제 처리 결과를 먼저 확인해 주세요. 확인 전에는 다시 전송하지 마세요.";
  } else if (actionKind === "manual_send") {
    nextAction = "저장된 내용과 수신 정보를 확인한 후 수동 전송을 진행해 주세요.";
  }
  return { reason, nextAction, ...(actionKind ? {
    actionKind, actionLabel: actionKind === "manual_send" ? "수동 전송" : "결과 확인",
  } : {}) };
}
