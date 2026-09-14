import { buildSystemTemplateSendHref } from "./page";

describe("buildSystemTemplateSendHref", () => {
  it("preserves the system template key when opening the send form", () => {
    const href = buildSystemTemplateSendHref(
      "SERVICE_END_NOTICE",
      "{{name}} 산모님 영수증: {{receiptUrl}}",
    );

    const url = new URL(href, "https://m.admin.babyjamjam.com");
    expect(url.pathname).toBe("/messages/new");
    expect(url.searchParams.get("template")).toBe("SERVICE_END_NOTICE");
    expect(url.searchParams.get("body")).toBe("{{name}} 산모님 영수증: {{receiptUrl}}");
  });
});
