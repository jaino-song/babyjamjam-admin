import {
  filterHistoryRecordsByChannel,
  isHistoryRecordInChannel,
  isTriggerTemplateInChannel,
  isUpcomingJobInChannel,
} from "./channel";
import type {
  AlimtalkHistoryRecord,
  UpcomingAlimtalkJob,
} from "./types";

function historyRecord(overrides: Partial<AlimtalkHistoryRecord>): AlimtalkHistoryRecord {
  return {
    id: 1,
    provider: "aligo",
    templateKey: "CLIENT_WELCOME",
    triggerJobId: null,
    receiver: "010-0000-0000",
    clientId: null,
    messageBody: "message",
    variables: {},
    status: "sent",
    aligoMid: null,
    errorMessage: null,
    attempts: 1,
    lastAttemptAt: null,
    nextRetryAt: null,
    createdAt: "2026-06-19T00:00:00.000Z",
    updatedAt: "2026-06-19T00:00:00.000Z",
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

function upcomingJob(overrides: Partial<UpcomingAlimtalkJob>): UpcomingAlimtalkJob {
  return {
    id: "job-1",
    ruleId: "rule-1",
    ruleName: "rule",
    eventType: "SERVICE_START",
    offsetType: "BEFORE_DAYS",
    offsetDays: 7,
    recipientType: "CLIENT",
    recipientPhone: "010-0000-0000",
    templateKey: "CLIENT_WELCOME",
    status: "pending",
    scheduledFor: "2026-06-19T00:00:00.000Z",
    sentAt: null,
    canceledAt: null,
    cancelReason: null,
    clientId: null,
    employeeScheduleId: null,
    payload: {
      memberId: "member-1",
      recipientName: "수신자",
      recipientPhone: "010-0000-0000",
      templateVariables: {},
    },
    createdAt: "2026-06-19T00:00:00.000Z",
    updatedAt: "2026-06-19T00:00:00.000Z",
    ...overrides,
  };
}

describe("alimtalk trigger channel helpers", () => {
  it("routes SERVICE_INFO template data to the sms channel", () => {
    expect(isTriggerTemplateInChannel("SERVICE_INFO", "sms")).toBe(true);
    expect(isTriggerTemplateInChannel("SERVICE_INFO", "alimtalk")).toBe(false);
    expect(isTriggerTemplateInChannel("CLIENT_WELCOME", "sms")).toBe(false);
    expect(isTriggerTemplateInChannel("CLIENT_WELCOME", "alimtalk")).toBe(true);
  });

  it("routes upcoming jobs by trigger template", () => {
    expect(isUpcomingJobInChannel(upcomingJob({ templateKey: "SERVICE_INFO" }), "sms")).toBe(true);
    expect(isUpcomingJobInChannel(upcomingJob({ templateKey: "CLIENT_WELCOME" }), "alimtalk")).toBe(true);
  });

  it("routes history records by sms provider or sms trigger template", () => {
    const smsProviderRecord = historyRecord({ provider: "aligo_sms", templateKey: "CLIENT_WELCOME" });
    const smsTemplateRecord = historyRecord({ provider: "aligo", templateKey: "SERVICE_INFO" });
    const alimtalkRecord = historyRecord({ provider: "aligo", templateKey: "CLIENT_WELCOME" });

    expect(isHistoryRecordInChannel(smsProviderRecord, "sms")).toBe(true);
    expect(isHistoryRecordInChannel(smsTemplateRecord, "sms")).toBe(true);
    expect(isHistoryRecordInChannel(alimtalkRecord, "sms")).toBe(false);

    expect(filterHistoryRecordsByChannel([smsProviderRecord, smsTemplateRecord, alimtalkRecord], "alimtalk"))
      .toEqual([alimtalkRecord]);
  });
});
