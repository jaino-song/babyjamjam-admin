import { SYSTEM_TEMPLATE_REGISTRY } from "../../../../backend/domain/constants/system-template-registry";

import {
  SYSTEM_TEMPLATE_DELIVERY_MODES_BY_KEY,
  SYSTEM_TEMPLATE_KEYS,
  resolveSystemTemplateDeliveryMode,
  type SystemTemplateDeliveryMode,
} from "./system-template";

describe("resolveSystemTemplateDeliveryMode", () => {
  it("mirrors every key in the backend system-template registry", () => {
    expect(Object.keys(SYSTEM_TEMPLATE_REGISTRY).sort()).toEqual([...SYSTEM_TEMPLATE_KEYS].sort());
    expect(SYSTEM_TEMPLATE_KEYS).toEqual([
      "CLIENT_WELCOME",
      "SERVICE_START_REMINDER",
      "SERVICE_END_REMINDER",
      "EMPLOYEE_ASSIGNED",
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
