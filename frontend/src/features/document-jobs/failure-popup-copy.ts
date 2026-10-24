import type { EformsignDocumentJobResponse } from "@/services/api";

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
        description: `${who} · 계약서를 자동으로 보내지 못했어요. 입력한 내용 그대로 직접 작성할 수 있어요.`,
        actionLabel: "직접 작성하기",
      };
    }
    if (job.jobType === "finalize_document") {
      return {
        title: "검토완료 자동 처리 실패",
        description: `${who} · 검토완료를 자동으로 처리하지 못했어요. 직접 처리해 주세요.`,
        actionLabel: "직접 처리하기",
      };
    }
  }

  return FALLBACK_COPY;
}

export function recoverJobHref(jobId: string): string {
  return `/contracts?recoverJobId=${encodeURIComponent(jobId)}`;
}
