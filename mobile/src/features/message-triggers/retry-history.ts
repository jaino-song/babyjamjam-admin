import { MESSAGE_JOB_RESEND_COPY, normalizeApiError } from "@babyjamjam/shared";

/** Return the bare job id, never the prefixed history row id. */
export function getResendableJobId(
  record: { provider: string; status: string; triggerJobId?: string | null } | null,
): string | null {
  if (record?.provider !== "message_job" || record.status !== "needs_setup") return null;
  return record.triggerJobId?.trim() ? record.triggerJobId : null;
}

export function canRetryFailedHistory(
  record: { id: number | string; status: string } | null,
  canManage: boolean,
): boolean {
  return canManage && record !== null && typeof record.id === "number" && record.status === "failed";
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
