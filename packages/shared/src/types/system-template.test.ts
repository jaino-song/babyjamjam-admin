import { SYSTEM_TEMPLATE_REGISTRY } from "../../../../backend/domain/constants/system-template-registry";

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
} from "./system-template";

describe("resolveSystemTemplateDeliveryMode", () => {
  it("mirrors every key in the backend system-template registry", () => {
    expect(Object.keys(SYSTEM_TEMPLATE_REGISTRY).sort()).toEqual([...SYSTEM_TEMPLATE_KEYS].sort());
    expect(SYSTEM_TEMPLATE_KEYS).toEqual([
      "PRICE_INFO",
      "GREETING",
      "THANKS",
      "SURVEY",
      "SERVICE_INFO",
      "SERVICE_RECORD_LINK",
      "SERVICE_END_NOTICE",
      "REMINDER",
      "INFO",
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
      "service-feedback-link",
      "receipt-link",
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
