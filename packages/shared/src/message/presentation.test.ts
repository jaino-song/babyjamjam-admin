import type { MessageLogRecord } from "../types/message";
import {
  MESSAGE_JOB_RESEND_COPY,
  MESSAGE_JOB_STATUS_BADGE_VARIANT,
  MESSAGE_JOB_STATUS_LABELS,
  MESSAGE_LOG_STATUS_BADGE_VARIANT,
  MESSAGE_SETUP_REASON_LABEL,
  formatMessageFailureReason,
  normalizeMessageHistoryPresentation,
} from "./presentation";

function historyRecord(overrides: Partial<MessageLogRecord> = {}): MessageLogRecord {
  return {
    id: 1,
    provider: "aligo_sms",
    templateKey: "service_record_link_sms",
    triggerJobId: "job-1",
    receiver: "01012345678",
    clientId: 10,
    recipientPhone: "01012345678",
    messageBody: "",
    variables: {},
    status: "needs_setup",
    aligoMid: null,
    errorMessage: null,
    attempts: 0,
    lastAttemptAt: null,
    nextRetryAt: null,
    createdAt: "2026-07-16T12:00:00.000Z",
    updatedAt: "2026-07-16T12:10:00.000Z",
    ruleId: null,
    ruleName: null,
    eventType: null,
    offsetType: null,
    offsetDays: 0,
    scheduledFor: null,
    recipientType: "CLIENT",
    recipientName: "김고객",
    clientName: "김고객",
    employeeName: null,
    ...overrides,
  };
}

describe("needs_setup presentation", () => {
  it("labels the status 설정 필요 with the warning tone in every map", () => {
    expect(MESSAGE_JOB_STATUS_LABELS.needs_setup).toBe("설정 필요");
    expect(MESSAGE_LOG_STATUS_BADGE_VARIANT.needs_setup).toBe("warning");
    expect(MESSAGE_JOB_STATUS_BADGE_VARIANT.needs_setup).toBe("warning");
  });

  it("puts the reason in setupReason and leaves failureReason unset", () => {
    const presentation = normalizeMessageHistoryPresentation(
      historyRecord({ errorMessage: "수신자 연락처가 필요합니다." }),
    );
    expect(presentation.status).toBe("needs_setup");
    expect(presentation.setupReason).toBe("수신자 연락처가 필요합니다.");
    expect(presentation.failureReason).toBeUndefined();
  });

  it("leaves setupReason unset for other statuses, even with an error message", () => {
    const failed = normalizeMessageHistoryPresentation(
      historyRecord({ status: "failed", errorMessage: "발송 실패: 번호 오류" }),
    );
    expect(failed.failureReason).toBe("발송 실패: 번호 오류");
    expect(failed.setupReason).toBeUndefined();
    expect(
      normalizeMessageHistoryPresentation(historyRecord({ status: "sent" })).setupReason,
    ).toBeUndefined();
  });

  it("leaves setupReason unset when a needs_setup row has no error message", () => {
    expect(normalizeMessageHistoryPresentation(historyRecord()).setupReason).toBeUndefined();
  });

  it("exposes the reason label and the resend copy", () => {
    expect(MESSAGE_SETUP_REASON_LABEL).toBe("설정 필요 사유");
    expect(Object.keys(MESSAGE_JOB_RESEND_COPY).sort()).toEqual(
      ["action", "failure", "notSent", "pending", "stillNeedsSetup", "success"],
    );
    expect(MESSAGE_JOB_RESEND_COPY).toEqual({
      action: "재발송",
      pending: "재발송 중",
      success: "재발송했습니다.",
      stillNeedsSetup: "아직 설정이 필요합니다. 사유를 확인해 주세요.",
      notSent: "재발송하지 않았습니다.",
      failure: "재발송하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    });
  });
});

describe("formatMessageFailureReason", () => {
  it.each(["잔액 부족", "인증 오류", "수신 거부", "잘못된 번호"])(
    "preserves the permanent-failure prefix for %s", (reason) => {
      const message = `발송 실패: ${reason}`;
      expect(formatMessageFailureReason(message)).toBe(message);
      expect(formatMessageFailureReason(formatMessageFailureReason(message))).toBe(message);
    },
  );

  it("still removes provider internals and punctuation from legacy reasons", () => {
    expect(formatMessageFailureReason("Aligo SMS API error (403): 등록되지 않은 IP 입니다."))
      .toBe("등록되지 않은 입니다.");
  });

  it("sanitizes the reason rather than allowing arbitrary provider punctuation", () => {
    expect(formatMessageFailureReason("발송 실패: Aligo (403): 잔액 부족!"))
      .toBe("발송 실패: 잔액 부족");
    expect(formatMessageFailureReason(null)).toBe("");
  });
});
