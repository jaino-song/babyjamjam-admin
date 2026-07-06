import {
  SMS_TRIGGER_TEMPLATE_KEYS,
  deriveAvailableTemplates,
  deriveEventTypesFromTemplates,
  deriveRecipientTypesFromTemplates,
  filterHistoryRecordsByChannel,
  getChannelTemplates,
  getTriggerTemplateChannel,
  isHistoryRecordInChannel,
  isTriggerTemplateInChannel,
  isUpcomingJobInChannel,
} from "./channel";
import type {
  AlimtalkHistoryRecord,
  TriggerTemplateCatalogItem,
  UpcomingAlimtalkJob,
} from "./types";

function templateItem(
  overrides: Partial<TriggerTemplateCatalogItem> &
    Pick<TriggerTemplateCatalogItem, "key">,
): TriggerTemplateCatalogItem {
  return {
    name: overrides.key,
    description: "",
    allowedEventTypes: [],
    allowedRecipientTypes: [],
    requiredVariables: [],
    providers: { aligo_alimtalk: { templateKey: overrides.key } },
    ...overrides,
  };
}

function historyRecord(overrides: Partial<AlimtalkHistoryRecord>): AlimtalkHistoryRecord {
  return {
    id: 1,
    provider: "aligo_alimtalk",
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

  it("routes CLIENT_GREETING template data to the sms channel", () => {
    expect(isTriggerTemplateInChannel("CLIENT_GREETING", "sms")).toBe(true);
    expect(isTriggerTemplateInChannel("CLIENT_GREETING", "alimtalk")).toBe(false);
  });

  it("sources the SMS template set and channel resolver from shared", () => {
    expect(SMS_TRIGGER_TEMPLATE_KEYS).toEqual([
      "SERVICE_INFO",
      "SERVICE_FEEDBACK_LINK",
      "CLIENT_GREETING",
      "PRICE_INFO",
      "REMINDER",
      "THANKS",
      "SURVEY",
      "INFO",
    ]);
    expect(getTriggerTemplateChannel("SERVICE_INFO")).toBe("sms");
    expect(getTriggerTemplateChannel("SERVICE_FEEDBACK_LINK")).toBe("sms");
    expect(getTriggerTemplateChannel("CLIENT_GREETING")).toBe("sms");
    expect(getTriggerTemplateChannel("CLIENT_WELCOME")).toBe("alimtalk");
    expect(getTriggerTemplateChannel("EMPLOYEE_ASSIGNED")).toBe("alimtalk");
  });
});

describe("catalog-driven form option derivation", () => {
  const serviceInfo = templateItem({
    key: "SERVICE_INFO",
    allowedEventTypes: ["SERVICE_START"],
    allowedRecipientTypes: ["CLIENT"],
  });
  const greeting = templateItem({
    key: "CLIENT_GREETING",
    allowedEventTypes: ["CLIENT_CREATED"],
    allowedRecipientTypes: ["CLIENT"],
  });
  const clientWelcome = templateItem({
    key: "CLIENT_WELCOME",
    allowedEventTypes: ["CLIENT_CREATED"],
    allowedRecipientTypes: ["CLIENT"],
  });
  const employeeAssigned = templateItem({
    key: "EMPLOYEE_ASSIGNED",
    allowedEventTypes: ["EMPLOYEE_ASSIGNED"],
    allowedRecipientTypes: ["PRIMARY_EMPLOYEE", "SECONDARY_EMPLOYEE"],
  });
  const allTemplates = [serviceInfo, greeting, clientWelcome, employeeAssigned];

  it("splits catalog templates by channel using the shared SMS set", () => {
    expect(getChannelTemplates(allTemplates, "sms").map((t) => t.key)).toEqual([
      "SERVICE_INFO",
      "CLIENT_GREETING",
    ]);
    expect(getChannelTemplates(allTemplates, "alimtalk").map((t) => t.key)).toEqual([
      "CLIENT_WELCOME",
      "EMPLOYEE_ASSIGNED",
    ]);
  });

  it("derives the SMS form's event options from the catalog (today: SERVICE_START + CLIENT_CREATED)", () => {
    const smsTemplates = getChannelTemplates(allTemplates, "sms");
    expect(new Set(deriveEventTypesFromTemplates(smsTemplates))).toEqual(
      new Set(["SERVICE_START", "CLIENT_CREATED"]),
    );

    // A future SMS template surfaces its event automatically — no hardcoded list to edit.
    const withFutureTemplate = [
      ...smsTemplates,
      templateItem({ key: "SERVICE_INFO", allowedEventTypes: ["SERVICE_END"] }),
    ];
    expect(deriveEventTypesFromTemplates(withFutureTemplate)).toContain("SERVICE_END");
  });

  it("derives recipient types for the selected event", () => {
    expect(deriveRecipientTypesFromTemplates(allTemplates, "SERVICE_START")).toEqual(["CLIENT"]);
    expect(new Set(deriveRecipientTypesFromTemplates(allTemplates, "EMPLOYEE_ASSIGNED"))).toEqual(
      new Set(["PRIMARY_EMPLOYEE", "SECONDARY_EMPLOYEE"]),
    );
  });

  it("derives templates available for the selected event + recipient", () => {
    const smsTemplates = getChannelTemplates(allTemplates, "sms");
    expect(
      deriveAvailableTemplates(smsTemplates, "SERVICE_START", "CLIENT").map((t) => t.key),
    ).toEqual(["SERVICE_INFO"]);
    expect(
      deriveAvailableTemplates(smsTemplates, "CLIENT_CREATED", "CLIENT").map((t) => t.key),
    ).toEqual(["CLIENT_GREETING"]);
    expect(deriveAvailableTemplates(smsTemplates, "SERVICE_END", "CLIENT")).toEqual([]);
  });
});

describe("alimtalk trigger channel routing", () => {
  it("routes upcoming jobs by trigger template", () => {
    expect(isUpcomingJobInChannel(upcomingJob({ templateKey: "SERVICE_INFO" }), "sms")).toBe(true);
    expect(isUpcomingJobInChannel(upcomingJob({ templateKey: "CLIENT_WELCOME" }), "alimtalk")).toBe(true);
  });

  it("routes history records by sms provider or sms trigger template", () => {
    const smsProviderRecord = historyRecord({ provider: "aligo_sms", templateKey: "CLIENT_WELCOME" });
    const smsTemplateRecord = historyRecord({ provider: "aligo_alimtalk", templateKey: "SERVICE_INFO" });
    const alimtalkRecord = historyRecord({ provider: "aligo_alimtalk", templateKey: "CLIENT_WELCOME" });

    expect(isHistoryRecordInChannel(smsProviderRecord, "sms")).toBe(true);
    expect(isHistoryRecordInChannel(smsTemplateRecord, "sms")).toBe(true);
    expect(isHistoryRecordInChannel(alimtalkRecord, "sms")).toBe(false);

    expect(filterHistoryRecordsByChannel([smsProviderRecord, smsTemplateRecord, alimtalkRecord], "alimtalk"))
      .toEqual([alimtalkRecord]);
  });
});
