import {
  buildSystemTemplateCatalog,
  type ServerSystemTemplate,
} from "./catalog";

function template(overrides: Partial<ServerSystemTemplate> = {}): ServerSystemTemplate {
  return {
    id: "template-1",
    templateKey: "GREETING",
    name: "인사(소개)",
    description: "소개",
    content: "안녕하세요 {{name}}",
    customVariables: [],
    requiredVariables: [],
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("system template catalog", () => {
  it("does not manufacture legacy rows when the server response is absent", () => {
    expect(buildSystemTemplateCatalog(undefined)).toEqual([]);
    expect(buildSystemTemplateCatalog(null)).toEqual([]);
    expect(buildSystemTemplateCatalog([])).toEqual([]);
  });

  it("keeps server order and title while exposing new registry keys", () => {
    const items = buildSystemTemplateCatalog([
      template({ templateKey: "FUTURE_TEMPLATE", name: "새 서버 템플릿" }),
      template({ templateKey: "SERVICE_END_NOTICE", name: "서비스 종료 안내", content: "영수증 {{receiptUrl}}" }),
      template({ templateKey: "GREETING", name: "서버가 정한 인사 제목" }),
    ]);

    expect(items.map((item) => item.templateKey)).toEqual([
      "FUTURE_TEMPLATE",
      "SERVICE_END_NOTICE",
      "GREETING",
    ]);
    expect(items[0]).toMatchObject({
      id: "builtin:system:FUTURE_TEMPLATE",
      label: "새 서버 템플릿",
      legacyType: null,
      manualSendAvailability: "disabled",
    });
    expect(items[1]).toMatchObject({
      id: "builtin:system:SERVICE_END_NOTICE",
      label: "서비스 종료 안내",
      content: "영수증 {{receiptUrl}}",
      legacyType: "service-end-notice",
      manualSendAvailability: "available",
    });
    expect(items[2]).toMatchObject({
      id: "builtin:greeting",
      label: "서버가 정한 인사 제목",
      legacyType: "greeting",
      manualSendAvailability: "available",
    });
  });

  it("retains the eight legacy ids for existing links", () => {
    const items = buildSystemTemplateCatalog([
      template({ templateKey: "GREETING" }),
      template({ templateKey: "SERVICE_INFO" }),
      template({ templateKey: "SERVICE_RECORD_LINK" }),
      template({ templateKey: "PRICE_INFO" }),
      template({ templateKey: "REMINDER" }),
      template({ templateKey: "THANKS" }),
      template({ templateKey: "SURVEY" }),
      template({ templateKey: "INFO" }),
    ]);

    expect(items.map((item) => item.id)).toEqual([
      "builtin:greeting",
      "builtin:service-info",
      "builtin:service-feedback-link",
      "builtin:price-info",
      "builtin:reminder",
      "builtin:thanks",
      "builtin:survey",
      "builtin:info",
    ]);
    expect(items.find((item) => item.id === "builtin:service-feedback-link")?.legacyType).toBe(
      "service-feedback-link",
    );
    expect(items.find((item) => item.id === "builtin:system:SERVICE_END_NOTICE")).toBeUndefined();
  });

  it("omits retired automation-only rows while preserving SERVICE_END_NOTICE and unknown rows", () => {
    const items = buildSystemTemplateCatalog([
      template({ templateKey: "CLIENT_WELCOME" }),
      template({ templateKey: "SERVICE_START_REMINDER" }),
      template({ templateKey: "SERVICE_END_REMINDER" }),
      template({ templateKey: "EMPLOYEE_ASSIGNED" }),
      template({ templateKey: "SERVICE_END_NOTICE" }),
      template({ templateKey: "FUTURE_TEMPLATE" }),
    ]);

    expect(items.map((item) => item.templateKey)).toEqual([
      "SERVICE_END_NOTICE",
      "FUTURE_TEMPLATE",
    ]);
  });

  it("does not treat prototype keys as manual template types", () => {
    const items = buildSystemTemplateCatalog([
      template({ templateKey: "toString" }),
      template({ templateKey: "__proto__" }),
    ]);

    expect(items).toHaveLength(2);
    expect(items.every((item) => item.manualSendAvailability === "disabled")).toBe(true);
    expect(items.every((item) => item.legacyType === null)).toBe(true);
  });

  it("skips malformed records without falling back to a different template", () => {
    const items = buildSystemTemplateCatalog([
      template({ templateKey: "" }),
      template({ templateKey: "FUTURE_TEMPLATE", name: "미래 템플릿" }),
    ]);

    expect(items).toHaveLength(1);
    expect(items[0].templateKey).toBe("FUTURE_TEMPLATE");
  });
});
