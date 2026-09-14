import {
  SYSTEM_TEMPLATE_KEYS,
  resolveSystemTemplateDeliveryMode,
  type SystemTemplateDeliveryMode,
} from "./system-template";

describe("resolveSystemTemplateDeliveryMode", () => {
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
});
