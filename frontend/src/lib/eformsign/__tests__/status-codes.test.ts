import { createKrBusinessDayCalendar, KR_BUILTIN_HOLIDAYS } from "@/lib/date/business-days";
import {
  contractStatusBadgeType,
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

describe("mapDocStatusLabel with a branch calendar", () => {
  const reviewStep = {
    status_type: "060",
    step_type: "06",
    step_name: "제공기관 검토",
    step_recipients: [{ recipient_type: "01" }],
  };

  beforeEach(() => {
    jest.useFakeTimers();
    // Sat 2026-08-01, KST.
    jest.setSystemTime(new Date("2026-08-01T03:00:00.000Z"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("flips 서명 완료 to 검토 필요 earlier when the branch closes a day in the window", () => {
    const branchCalendar = createKrBusinessDayCalendar([...KR_BUILTIN_HOLIDAYS, "2026-08-03"], {
      version: "kr-db-test",
      supportedYears: [2025, 2026, 2027],
    });
    expect(mapDocStatusLabel(reviewStep, "2026-08-04")).toBe("서명 완료");
    expect(mapDocStatusLabel(reviewStep, "2026-08-04", null, branchCalendar)).toBe("검토 필요");
  });

  it("does not throw when the review window reaches back past New Year", () => {
    const narrowCalendar = createKrBusinessDayCalendar([], { version: "kr-db-test", supportedYears: [2026] });
    expect(mapDocStatusLabel(reviewStep, "2026-01-02", null, narrowCalendar)).toBe("검토 필요");
  });

  it("does not throw for an end date outside the branch calendar's years", () => {
    const narrowCalendar = createKrBusinessDayCalendar([], { version: "kr-db-test", supportedYears: [2026] });
    expect(mapDocStatusLabel(reviewStep, "2024-12-31", null, narrowCalendar)).toBe("검토 필요");
  });
});

describe("040 (doc_request_revoke) 철회 요청됨", () => {
  it("is labelled 철회 요청됨 from display_status, and from the status code when display_status is absent", () => {
    expect(mapDocStatusLabel({ status_type: "040" }, null, "revoke_requested")).toBe("철회 요청됨");
    expect(mapDocStatusLabel({ status_type: "040" })).toBe("철회 요청됨");
    expect(mapDocStatusLabel({ status_type: "040", step_type: "06", step_name: "제공기관 확인" }, "2026-01-01")).toBe("철회 요청됨");
    expect(mapDocStatusLabel({ status_type: "doc_request_revoke" })).toBe("철회 요청됨");
  });

  it("keeps the expired category for filtering, tabs and stats", () => {
    expect(getStatusCategory("040")).toBe("expired");
  });

  it("does not change 042/090 (revoked) or 080 (expired) labels", () => {
    for (const code of ["042", "090", "080"]) {
      expect(mapDocStatusLabel({ status_type: code })).toBe("기간 만료");
    }
  });

  it("uses the warning (review) badge tone, distinct from the expired one", () => {
    expect(contractStatusBadgeType("철회 요청됨")).toBe("review");
    expect(contractStatusBadgeType("기간 만료")).toBe("expired");
  });
});
