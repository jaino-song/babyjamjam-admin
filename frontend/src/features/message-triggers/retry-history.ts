import { MESSAGE_JOB_RESEND_COPY, normalizeApiError } from "@babyjamjam/shared";

export function canRetryFailedHistory(
  record: { id: number | string; status: string } | null,
  canManage: boolean,
): boolean {
  return canManage && record !== null && typeof record.id === "number" && record.status === "failed";
}

export function canResendSetupJob(
  record: { provider: string; status: string; triggerJobId: string | null } | null,
  canManage: boolean,
): boolean {
  return canManage && record?.provider === "message_job" && record.status === "needs_setup" && !!record.triggerJobId;
}

export async function resendMessageTriggerJob(
  resend: (id: string) => Promise<{ status: string; reason?: string | null }>,
  id: string,
): Promise<{ variant: "success" | "destructive"; description: string }> {
  try {
    const result = await resend(id);
    if (result.status === "sent") return { variant: "success", description: MESSAGE_JOB_RESEND_COPY.success };
    if (result.status === "needs_setup") return { variant: "destructive", description: MESSAGE_JOB_RESEND_COPY.stillNeedsSetup };
    if (result.status === "canceled") return {
      variant: "destructive",
      description: result.reason ? `${MESSAGE_JOB_RESEND_COPY.notSent} ${result.reason}` : MESSAGE_JOB_RESEND_COPY.notSent,
    };
    return { variant: "destructive", description: MESSAGE_JOB_RESEND_COPY.failure };
  } catch (error) {
    const normalized = normalizeApiError(error, { locale: "ko-KR", operation: "mutation" });
    return {
      variant: "destructive",
      description: normalized.status === 409 ? MESSAGE_JOB_RESEND_COPY.conflict
        : normalized.verified ? normalized.message : MESSAGE_JOB_RESEND_COPY.failure,
    };
  }
}

/** The global and client detail flows share locally authored, safe retry feedback. */
export async function retryMessageHistory(
  retry: (id: number) => Promise<{ status: string }>,
  id: number,
): Promise<{ variant: "success" | "destructive"; description: string }> {
  try {
    const record = await retry(id);
    return record.status === "failed"
      ? { variant: "destructive", description: "메시지를 재발송하지 못했어요" }
      : { variant: "success", description: "재발송 요청을 접수했어요" };
  } catch (error) {
    const normalized = normalizeApiError(error, { locale: "ko-KR", operation: "mutation" });
    return {
      variant: "destructive",
      description: normalized.status === 409
        ? MESSAGE_JOB_RESEND_COPY.conflict
        : normalized.verified ? normalized.message : "재발송을 요청하지 못했어요",
    };
  }
}
