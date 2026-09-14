import {
  getStatusCategory,
  mapDocStatusLabel,
  mapStatusToLabel,
  normalizeStatusCode,
} from "@/lib/eformsign/status-codes";

describe("status code aliases", () => {
  it("normalizes named eformsign statuses to numeric codes", () => {
    expect(normalizeStatusCode("doc_complete")).toBe("003");
    expect(normalizeStatusCode("doc_request_participant")).toBe("060");
    expect(normalizeStatusCode("doc_open_participant")).toBe("064");
  });

  it("maps named statuses to the right category", () => {
    expect(getStatusCategory("doc_complete")).toBe("completed");
    expect(getStatusCategory("doc_request_participant")).toBe("in-progress");
    expect(getStatusCategory("doc_expired")).toBe("expired");
    expect(getStatusCategory("090")).toBe("expired");
  });

  it.each([
    ["003", "completed", "계약 완료"],
    ["090", "expired", "기간 만료"],
    ["047", "expired", "기간 만료"],
    ["049", "expired", "기간 만료"],
    ["099", "unknown", "알 수 없음"],
    ["999", "unknown", "알 수 없음"],
    ["", "unknown", "알 수 없음"],
  ] as const)("uses the shared semantics for %s", (code, category, label) => {
    expect(getStatusCategory(code)).toBe(category);
    expect(mapStatusToLabel(code)).toBe(label);
  });

  it("keeps an empty document workflow status visibly unknown", () => {
    expect(mapDocStatusLabel({ status_type: "" })).toBe("알 수 없음");
  });
});

describe("mapDocStatusLabel", () => {
  it("does not treat a user participant step as review needed even when the upstream recipient is internal", () => {
    expect(
      mapDocStatusLabel({
        status_type: "060",
        step_type: "05",
        step_name: "이용자",
        step_recipients: [{ recipient_type: "01" }],
      }),
    ).toBe("서명 대기");
  });

  it("treats explicit provider review steps as review needed", () => {
    expect(
      mapDocStatusLabel({
        status_type: "060",
        step_type: "06",
        step_name: "제공기관 검토",
        step_recipients: [{ recipient_type: "01" }],
      }),
    ).toBe("검토 필요");
  });

  it("treats provider confirmation labels as review needed even when eformsign reuses participant step type", () => {
    expect(
      mapDocStatusLabel({
        status_type: "060",
        step_type: "05",
        step_name: "제공기관 확인",
        step_recipients: [{ recipient_type: "01" }],
      }),
    ).toBe("검토 필요");
  });
});
