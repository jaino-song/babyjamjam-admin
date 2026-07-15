import type { MessageLogRecord } from "@/features/message-triggers/types";

import {
  findRecentDuplicateSend,
  formatDuplicateSentAt,
} from "../TemplateSendForm";

function createHistoryRecord(
  overrides: Partial<MessageLogRecord> = {},
): MessageLogRecord {
  return {
    id: 1,
    provider: "aligo_sms",
    templateKey: "인사 메시지",
    triggerJobId: null,
    receiver: "010-6621-1878",
    clientId: null,
    recipientPhone: "010-6621-1878",
    messageBody: "안녕하세요",
    variables: {},
    status: "sent",
    aligoMid: "mid-1",
    errorMessage: null,
    attempts: 1,
    lastAttemptAt: "2026-06-19T09:20:00.000Z",
    nextRetryAt: null,
    createdAt: "2026-06-19T09:20:00.000Z",
    updatedAt: "2026-06-19T09:20:00.000Z",
    ruleId: null,
    ruleName: null,
    eventType: null,
    offsetType: null,
    offsetDays: 0,
    scheduledFor: null,
    recipientType: null,
    recipientName: null,
    clientName: null,
    employeeName: null,
    ...overrides,
  };
}

describe("TemplateSendForm duplicate send helpers", () => {
  it("finds a sent duplicate within 72 hours by normalized receiver and message", () => {
    const duplicate = createHistoryRecord({
      receiver: "01066211878",
      messageBody: "안녕하세요\n",
      lastAttemptAt: "2026-06-18T09:20:00.000Z",
    });

    expect(
      findRecentDuplicateSend([duplicate], {
        receiver: "010-6621-1878",
        message: "안녕하세요",
        now: new Date("2026-06-19T09:20:00.000Z"),
      }),
    ).toBe(duplicate);
  });

  it("ignores failed or expired duplicate candidates", () => {
    const failed = createHistoryRecord({
      id: 1,
      status: "failed",
      lastAttemptAt: "2026-06-19T09:20:00.000Z",
    });
    const expired = createHistoryRecord({
      id: 2,
      lastAttemptAt: "2026-06-15T09:19:00.000Z",
    });

    expect(
      findRecentDuplicateSend([failed, expired], {
        receiver: "010-6621-1878",
        message: "안녕하세요",
        now: new Date("2026-06-19T09:20:00.000Z"),
      }),
    ).toBeNull();
  });

  it("formats recent send timestamps as MM. DD 오전/오후 h:mm", () => {
    expect(formatDuplicateSentAt("2026-06-19T09:20:00")).toBe("06. 19 오전 9:20");
    expect(formatDuplicateSentAt("2026-06-19T18:05:00")).toBe("06. 19 오후 6:05");
  });
});
