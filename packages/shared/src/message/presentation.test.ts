import type { MessageLogRecord } from "../types/message";
import {
  type MessageResendBlock,
  MESSAGE_JOB_RESEND_COPY,
  MESSAGE_JOB_STATUS_BADGE_VARIANT,
  MESSAGE_JOB_STATUS_LABELS,
  MESSAGE_LOG_STATUS_BADGE_VARIANT,
  MESSAGE_SETUP_REASON_LABEL,
  formatMessageFailureReason,
  getMessageResendBlockCard,
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
  it("labels the status 추가 정보 필요 with the warning tone in every map", () => {
    expect(MESSAGE_JOB_STATUS_LABELS.needs_setup).toBe("추가 정보 필요");
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

  it("builds resendBlock for needs_setup rows the server would refuse to resend, and for no others", () => {
    expect(
      normalizeMessageHistoryPresentation(historyRecord({
        resendBlockedBy: "recipient",
        resendBlockedRecipient: { kind: "client", id: 10 },
        ruleId: "rule-1",
        ruleName: "서비스 시작 안내",
      })).resendBlock,
    ).toEqual({
      level: "recipient",
      recipient: { kind: "client", id: 10 },
      recipientName: "김고객",
      ruleId: "rule-1",
      ruleName: "서비스 시작 안내",
    });
    expect(
      normalizeMessageHistoryPresentation(historyRecord({ resendBlockedBy: null })).resendBlock,
    ).toBeUndefined();
    expect(normalizeMessageHistoryPresentation(historyRecord()).resendBlock).toBeUndefined();
    expect(
      normalizeMessageHistoryPresentation(
        historyRecord({ status: "failed", resendBlockedBy: "branch" }),
      ).resendBlock,
    ).toBeUndefined();
  });

  describe("getMessageResendBlockCard", () => {
    const block = (overrides: Partial<MessageResendBlock> = {}): MessageResendBlock => ({
      level: "recipient",
      recipient: { kind: "employee", id: 7 },
      recipientName: "송진호",
      ruleId: "rule-1",
      ruleName: "제공기록지 작성 링크",
      ...overrides,
    });

    it.each([
      [{ kind: "client", id: 10 }, "고객", "고객 정보에서 켜기 →", "/clients?id=10", "/clients?id=10"],
      [{ kind: "employee", id: 7 }, "관리사", "관리사 정보에서 켜기 →", "/employees", "/employees"],
      [
        { kind: "user", id: "u-1" },
        "사용자",
        "계정 관리에서 켜기 →",
        "/system-admin?section=accounts",
        "/system-admin?section=accounts&item=u-1",
      ],
    ] as const)("names the %j recipient and links to where the switch lives", (recipient, noun, label, desktopHref, mobileHref) => {
      const desktop = getMessageResendBlockCard(block({ recipient }), "desktop");
      expect(desktop).toEqual({
        title: "자동 문자가 꺼져 있어요",
        emphasis: "송진호",
        description: `${noun}의 ‘자동 문자 발송’이 꺼져 있어 재발송할 수 없어요.`,
        action: { label, href: desktopHref },
      });
      expect(getMessageResendBlockCard(block({ recipient }), "mobile").action).toEqual({ label, href: mobileHref });
    });

    it("drops the name and the link when the recipient is unknown", () => {
      expect(getMessageResendBlockCard(block({ recipient: null, recipientName: null }), "desktop")).toEqual({
        title: "자동 문자가 꺼져 있어요",
        emphasis: null,
        description: "받는 사람의 ‘자동 문자 발송’이 꺼져 있어 재발송할 수 없어요.",
        action: null,
      });
    });

    it("explains a branch block and points at the 자동 전송 실행 switch", () => {
      const copy = { title: "지점 자동 전송이 꺼져 있어요", emphasis: null, description: "이 지점의 ‘자동 전송 실행’이 꺼져 있어 재발송할 수 없어요." };
      expect(getMessageResendBlockCard(block({ level: "branch", recipient: null }), "desktop")).toEqual({
        ...copy,
        action: { label: "자동화 설정 열기 →", href: "/messages?section=settings" },
      });
      expect(getMessageResendBlockCard(block({ level: "branch", recipient: null }), "mobile").action).toEqual({
        label: "자동화 설정 열기 →",
        href: "/messages/settings?item=trigger-dispatch",
      });
    });

    it("names the rule and links to the automation screen", () => {
      expect(getMessageResendBlockCard(block({ level: "rule", recipient: null }), "desktop")).toEqual({
        title: "자동화 규칙이 꺼져 있어요",
        emphasis: "제공기록지 작성 링크",
        description: "규칙이 꺼져 있어 재발송할 수 없어요.",
        action: { label: "규칙 보기 →", href: "/messages?section=triggers" },
      });
      expect(getMessageResendBlockCard(block({ level: "rule", recipient: null }), "mobile").action?.href)
        .toBe("/messages/automation?item=rule-1");
      const unnamed = getMessageResendBlockCard(block({ level: "rule", recipient: null, ruleName: null, ruleId: null }), "mobile");
      expect(unnamed.emphasis).toBeNull();
      expect(unnamed.description).toBe("자동화 규칙이 꺼져 있어 재발송할 수 없어요.");
      expect(unnamed.action?.href).toBe("/messages/automation");
    });
  });

  it("exposes the reason label and the resend copy", () => {
    expect(MESSAGE_SETUP_REASON_LABEL).toBe("추가 필요 정보");
    expect(Object.keys(MESSAGE_JOB_RESEND_COPY).sort()).toEqual(
      ["action", "conflict", "failure", "notSent", "pending", "stillNeedsSetup", "success"],
    );
    expect(MESSAGE_JOB_RESEND_COPY).toEqual({
      action: "재발송",
      pending: "재발송 중",
      success: "재발송했습니다.",
      stillNeedsSetup: "아직 추가 정보가 필요합니다. 사유를 확인해 주세요.",
      notSent: "재발송하지 않았습니다.",
      conflict: "지금은 재발송할 수 없습니다. 자동 전송 설정과 받는 사람의 자동 문자 설정을 확인해 주세요.",
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

  it("keeps the digits, colon and commas of a carrier-check failure reason", () => {
    expect(formatMessageFailureReason("통신사 전달 실패: 1234 가입자없음, 5678 결번"))
      .toBe("통신사 전달 실패: 1234 가입자없음, 5678 결번");
    // Digits and commas stay removed from every other reason.
    expect(formatMessageFailureReason("전달 실패: 1234 가입자없음, 5678 결번"))
      .toBe("전달 실패 가입자없음 결번");
  });

  it("applies both rules to a permanent failure whose rest is a carrier reason", () => {
    expect(formatMessageFailureReason("발송 실패: 통신사 전달 실패: 1234 가입자없음"))
      .toBe("발송 실패: 통신사 전달 실패: 1234 가입자없음");
    expect(formatMessageFailureReason("발송 실패: 잔액 부족 1234"))
      .toBe("발송 실패: 잔액 부족");
  });
});
