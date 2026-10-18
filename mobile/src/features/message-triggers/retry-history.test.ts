import { AxiosError, AxiosHeaders } from "axios";
import { MESSAGE_JOB_RESEND_COPY } from "@babyjamjam/shared";
import { canRetryFailedHistory, getResendableJobId, retryMessageHistory } from "./retry-history";

describe("getResendableJobId", () => {
  it.each([
    [{ provider: "message_job", status: "needs_setup", triggerJobId: "uuid" }, "uuid"],
    [{ provider: "message_job", status: "needs_setup", triggerJobId: null }, null],
    [{ provider: "message_job", status: "needs_setup", triggerJobId: "   " }, null],
    [{ provider: "message_job", status: "needs_setup" }, null],
    [{ provider: "aligo_sms", status: "needs_setup", triggerJobId: "uuid" }, null],
    [{ provider: "message_job", status: "sent", triggerJobId: "uuid" }, null],
    [null, null],
  ] as const)("returns only eligible job ids (%j)", (row, expected) => {
    expect(getResendableJobId(row)).toBe(expected);
  });
});

describe("shared history retry", () => {
  it.each([
    [{ id: 42, status: "failed" }, true, true],
    [{ id: 42, status: "failed" }, false, false],
    [{ id: "job", status: "failed" }, true, false],
    [{ id: 42, status: "sent" }, true, false],
    [null, true, false],
  ] as const)("uses the global numeric failed-log eligibility", (record, manage, expected) => {
    expect(canRetryFailedHistory(record, manage)).toBe(expected);
  });
  it("sends the log id and reports success", async () => {
    const retry = jest.fn().mockResolvedValue({ status: "sent" });
    expect(await retryMessageHistory(retry, 42)).toEqual({ variant: "success", description: "재발송 요청을 접수했어요" });
    expect(retry).toHaveBeenCalledWith(42);
  });
  it("uses conflict copy for any 409 without exposing upstream text", async () => {
    const error = new AxiosError("internal", "ERR_BAD_REQUEST", undefined, undefined, {
      status: 409, statusText: "Conflict", data: { message: "internal" }, headers: {}, config: { headers: new AxiosHeaders() },
    });
    const retry = jest.fn().mockRejectedValue(error);
    expect(await retryMessageHistory(retry, 42)).toEqual({ variant: "destructive", description: MESSAGE_JOB_RESEND_COPY.conflict });
  });
  it("does not expose a failed retry's upstream error", async () => {
    expect(await retryMessageHistory(jest.fn().mockResolvedValue({ status: "failed", errorMessage: "internal" }), 42))
      .toEqual({ variant: "destructive", description: "메시지를 재발송하지 못했어요" });
  });
});
