import { isCaregiverSystemTemplateKey, SYSTEM_TEMPLATE_REGISTRY } from "../../../../backend/domain/constants/system-template-registry";

import {
  SYSTEM_TEMPLATE_DELIVERY_MODES_BY_KEY,
  SYSTEM_TEMPLATE_KEYS,
  customVariableSchema,
  previewSystemTemplateSchema,
  resolveSystemTemplateDeliveryMode,
  systemTemplateKeySchema,
  updateSystemTemplateSchema,
  validateSystemTemplateSchema,
  type SystemTemplateDeliveryMode,
  type SystemTemplateContract,
} from "./system-template";

describe("resolveSystemTemplateDeliveryMode", () => {
  it("mirrors every key in the backend system-template registry", () => {
    expect(Object.keys(SYSTEM_TEMPLATE_REGISTRY).sort()).toEqual([...SYSTEM_TEMPLATE_KEYS].sort());
    expect(SYSTEM_TEMPLATE_KEYS).toEqual([
      "GREETING",
      "SERVICE_INFO",
      "PRICE_INFO",
      "REMINDER",
      "THANKS",
      "INFO",
      "CONTRACT_GUIDE",
      "CONTRACT_REMINDER",
      "MATERNAL_NOTICE",
      "SERVICE_END_NOTICE",
      "SURVEY",
      "PROVIDER_NOTICE",
      "SERVICE_RECORD_LINK",
      "SERVICE_RECORD_REMINDER",
      "CAREGIVER_SERVICE_START_NOTICE",
      "CAREGIVER_SERVICE_END_NOTICE",
    ]);
  });

  it("has an explicit delivery mode for every registry key", () => {
    expect(Object.keys(SYSTEM_TEMPLATE_DELIVERY_MODES_BY_KEY)).toEqual(SYSTEM_TEMPLATE_KEYS);
  });

  it("classifies every current system template", () => {
    const modes = SYSTEM_TEMPLATE_KEYS.map((key) => resolveSystemTemplateDeliveryMode(key));

    expect(modes).toHaveLength(SYSTEM_TEMPLATE_KEYS.length);
    expect(modes).toEqual([
      "sms",
      "sms",
      "sms",
      "sms",
      "sms",
      "sms",
      "sms",
      "sms",
      "sms",
      "receipt-link",
      "sms",
      "sms",
      "service-feedback-link",
      "sms",
      "sms",
      "sms",
    ] satisfies SystemTemplateDeliveryMode[]);
  });

  it("keeps the link templates out of generic SMS delivery", () => {
    expect(resolveSystemTemplateDeliveryMode("SERVICE_RECORD_LINK")).toBe("service-feedback-link");
    expect(resolveSystemTemplateDeliveryMode("SERVICE_END_NOTICE")).toBe("receipt-link");
  });

  it("mirrors the backend DTO validation for update, validate, and preview", () => {
    expect(systemTemplateKeySchema.safeParse("GREETING").success).toBe(true);
    expect(systemTemplateKeySchema.safeParse("GREETING/preview").success).toBe(false);
    expect(systemTemplateKeySchema.safeParse("NOT_A_TEMPLATE").success).toBe(false);
    expect(systemTemplateKeySchema.safeParse("MANUAL_SMS").success).toBe(false);

    expect(updateSystemTemplateSchema.safeParse({ content: "hello" }).success).toBe(true);
    expect(updateSystemTemplateSchema.safeParse({ content: "hello", customVariables: [
      { key: "clientName", label: "Client", required: true },
    ] }).success).toBe(true);
    expect(updateSystemTemplateSchema.safeParse({ content: "hello", extra: true }).success).toBe(false);
    expect(updateSystemTemplateSchema.safeParse({ content: "hello", customVariables: [
      { key: "clientName", label: "Client", required: true, extra: "nope" },
    ] }).success).toBe(false);
    expect(updateSystemTemplateSchema.safeParse({ content: "" }).success).toBe(false);

    expect(validateSystemTemplateSchema.safeParse({ content: "hello" }).success).toBe(true);
    expect(validateSystemTemplateSchema.safeParse({ content: "" }).success).toBe(false);
    expect(validateSystemTemplateSchema.safeParse({ content: "hello", data: {} }).success).toBe(false);

    expect(previewSystemTemplateSchema.safeParse({ data: { clientName: 7 } }).success).toBe(true);
    expect(previewSystemTemplateSchema.safeParse({ content: "", data: {} }).success).toBe(true);
    expect(previewSystemTemplateSchema.safeParse({ data: [] }).success).toBe(false);
    expect(previewSystemTemplateSchema.safeParse({ data: null }).success).toBe(false);
  });

  it("validates custom variables as the backend nested DTO", () => {
    expect(customVariableSchema.safeParse({ key: "x", label: "X", required: false }).success).toBe(true);
    expect(customVariableSchema.safeParse({ key: "", label: "X", required: false }).success).toBe(false);
  });
});


describe("caregiver system-template compatibility", () => {
  it.each([
    ["CAREGIVER_SERVICE_START_NOTICE", "제공인력 서비스 시작 안내", "serviceStartDate",
      "{{employeeName}} 관리사님, {{clientName}} 고객님의 서비스가 {{serviceStartDate}}에 시작됩니다. 배정 일정과 근무 안내를 확인해 주세요. - {{branchName}}"],
    ["CAREGIVER_SERVICE_END_NOTICE", "제공인력 서비스 종료 안내", "serviceEndDate",
      "{{employeeName}} 관리사님, {{clientName}} 고객님의 서비스가 {{serviceEndDate}}에 종료됩니다. 마무리 안내를 확인해 주세요. - {{branchName}}"],
  ] as const)("retains %s content, provider presentation and lifecycle eligibility", (key, name, dateKey, defaultContent) => {
    expect(systemTemplateKeySchema.safeParse(key).success).toBe(true);
    expect(isCaregiverSystemTemplateKey(key)).toBe(true);
    expect(resolveSystemTemplateDeliveryMode(key)).toBe("sms");
    const contract: SystemTemplateContract = SYSTEM_TEMPLATE_REGISTRY[key];
    expect(contract).toMatchObject({ key, name, defaultContent, group: "provider", groupLabel: "제공인력 대상" });
    expect(contract.requiredVariables.map((variable) => variable.key)).toEqual([
      "employeeName", "clientName", dateKey, "branchName",
    ]);
  });

  it("keeps ordinary and private keys outside caregiver lifecycle", () => {
    expect(isCaregiverSystemTemplateKey("GREETING")).toBe(false);
    expect(isCaregiverSystemTemplateKey("MANUAL_SMS")).toBe(false);
    expect(SYSTEM_TEMPLATE_REGISTRY).not.toHaveProperty("MANUAL_SMS");
  });
});
