import {
  CONFIGURABLE_SMS_TRIGGER_TEMPLATE_KEYS,
  MESSAGE_TRIGGER_EVENT_TYPES,
  MESSAGE_TRIGGER_OFFSET_TYPES,
  MESSAGE_TRIGGER_RECIPIENT_TYPES,
  MESSAGE_TRIGGER_TEMPLATE_KEYS,
  createMessageTriggerRuleSchema,
  updateMessageTriggerRuleSchema,
} from "./message";

const validRule = {
  name: "서비스 종료 안내",
  isActive: true,
  eventType: "SERVICE_END",
  offsetType: "SAME_DAY",
  offsetDays: 0,
  recipientType: "CLIENT",
  templateKey: "SERVICE_END_NOTICE",
} as const;

describe("message trigger shared contract", () => {
  it("derives the public option unions from canonical tuples", () => {
    expect(MESSAGE_TRIGGER_EVENT_TYPES).toEqual([
      "CLIENT_CREATED", "SERVICE_START", "SERVICE_END", "EMPLOYEE_ASSIGNED",
    ]);
    expect(MESSAGE_TRIGGER_OFFSET_TYPES).toEqual([
      "IMMEDIATE", "SAME_DAY", "BEFORE_DAYS", "AFTER_DAYS",
    ]);
    expect(MESSAGE_TRIGGER_RECIPIENT_TYPES).toEqual([
      "CLIENT", "PRIMARY_EMPLOYEE", "SECONDARY_EMPLOYEE",
    ]);
    expect(MESSAGE_TRIGGER_TEMPLATE_KEYS).toContain("SERVICE_END_NOTICE");
    expect(CONFIGURABLE_SMS_TRIGGER_TEMPLATE_KEYS).toContain("SERVICE_END_NOTICE");
  });

  it("accepts SERVICE_END_NOTICE and preserves backend-owned fields", () => {
    expect(createMessageTriggerRuleSchema.parse({ ...validRule, backendOnly: "kept" })).toEqual({
      ...validRule,
      backendOnly: "kept",
    });
  });

  it.each([
    ["invalid template key", { templateKey: "NOT_A_TEMPLATE" }],
    ["negative offset", { offsetDays: -1 }],
    ["fractional offset", { offsetDays: 1.5 }],
    ["empty name", { name: "" }],
  ])("rejects %s", (_label, override) => {
    expect(createMessageTriggerRuleSchema.safeParse({ ...validRule, ...override }).success).toBe(false);
  });

  it("keeps update fields optional while applying the same enum constraints", () => {
    expect(updateMessageTriggerRuleSchema.parse({ templateKey: "SERVICE_END_NOTICE" })).toEqual({
      templateKey: "SERVICE_END_NOTICE",
    });
    expect(updateMessageTriggerRuleSchema.safeParse({ offsetDays: 2.25 }).success).toBe(false);
    expect(updateMessageTriggerRuleSchema.safeParse({ templateKey: "NOPE" }).success).toBe(false);
  });
});
