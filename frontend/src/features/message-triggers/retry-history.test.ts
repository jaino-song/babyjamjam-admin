import { AxiosError, AxiosHeaders } from "axios";
import { MESSAGE_JOB_RESEND_COPY } from "@babyjamjam/shared";
import { canRetryFailedHistory, canResendSetupJob, retryMessageHistory, resendMessageTriggerJob } from "./retry-history";

describe("shared resend feedback", () => {
  const conflict = new AxiosError("internal", "ERR_BAD_REQUEST", undefined, undefined, {
    status: 409, statusText: "Conflict", data: { message: "internal" }, headers: {}, config: { headers: new AxiosHeaders() },
  });
  it("uses conflict copy for log retry 409", async () => {
    expect(await retryMessageHistory(jest.fn().mockRejectedValue(conflict), 42))
      .toEqual({ variant: "destructive", description: MESSAGE_JOB_RESEND_COPY.conflict });
  });
  it("uses conflict copy for job resend 409", async () => {
    expect(await resendMessageTriggerJob(jest.fn().mockRejectedValue(conflict), "job"))
      .toEqual({ variant: "destructive", description: MESSAGE_JOB_RESEND_COPY.conflict });
  });
  it("requires a numeric failed log and management permission", () => {
    expect(canRetryFailedHistory({ id: 42, status: "failed" }, true)).toBe(true);
    expect(canRetryFailedHistory({ id: "42", status: "failed" }, true)).toBe(false);
    expect(canRetryFailedHistory({ id: 42, status: "failed" }, false)).toBe(false);
  });
  it("requires a setup job with a trigger job id and management permission", () => {
    const row = { provider: "message_job", status: "needs_setup", triggerJobId: "job" };
    expect(canResendSetupJob(row, true)).toBe(true);
    expect(canResendSetupJob(row, false)).toBe(false);
    expect(canResendSetupJob({ ...row, triggerJobId: null }, true)).toBe(false);
    expect(canResendSetupJob({ ...row, provider: "sms" }, true)).toBe(false);
  });
  it.each([
    ["sent", undefined, "success", MESSAGE_JOB_RESEND_COPY.success],
    ["needs_setup", undefined, "destructive", MESSAGE_JOB_RESEND_COPY.stillNeedsSetup],
    ["canceled", "사유", "destructive", `${MESSAGE_JOB_RESEND_COPY.notSent} 사유`],
    ["failed", undefined, "destructive", MESSAGE_JOB_RESEND_COPY.failure],
  ] as const)("keeps the global %s feedback", async (status, reason, variant, description) => {
    const resend = jest.fn().mockResolvedValue({ status, reason });
    expect(await resendMessageTriggerJob(resend, "job")).toEqual({ variant, description });
    expect(resend).toHaveBeenCalledWith("job");
  });
});
