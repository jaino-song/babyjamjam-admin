import { createKrBusinessDayCalendar, KR_BUILTIN_HOLIDAYS } from "@/lib/date/business-days";
import {
  contractStatusBadgeType,
  getStatusCategory,
  getStatusColor,
  isCustomerSignedDisplayStatus,
  mapDocStatusLabel,
  resolveDocDisplayStatus,
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

  it("does not change the 080 (expired) label", () => {
    expect(mapDocStatusLabel({ status_type: "080" })).toBe("기간 만료");
  });

  it("uses the warning (review) badge tone, distinct from the expired one", () => {
    expect(contractStatusBadgeType("철회 요청됨")).toBe("review");
    expect(contractStatusBadgeType("기간 만료")).toBe("expired");
  });
});

describe("042 (doc_revoke) / 090 (withdrawal) 철회됨", () => {
  it("is labelled 철회됨 from display_status, and from the status code when display_status is absent", () => {
    expect(mapDocStatusLabel({ status_type: "042" }, null, "revoked")).toBe("철회됨");
    for (const code of ["042", "090", "doc_revoke"]) {
      expect(mapDocStatusLabel({ status_type: code })).toBe("철회됨");
      expect(resolveDocDisplayStatus({ status_type: code })).toBe("revoked");
    }
    expect(mapDocStatusLabel({ status_type: "042", step_type: "06", step_name: "제공기관 확인" }, "2026-01-01")).toBe("철회됨");
  });

  it("keeps the expired category for filtering, tabs and stats", () => {
    expect(getStatusCategory("042")).toBe("expired");
    expect(getStatusCategory("090")).toBe("expired");
  });

  it("uses the danger (expired) badge token and the destructive variant, distinct from the 철회 요청됨 warning", () => {
    expect(contractStatusBadgeType("철회됨")).toBe("expired");
    expect(contractStatusBadgeType("철회 요청됨")).toBe("review");
    expect(getStatusColor("철회됨")).toBe("destructive");
    expect(getStatusColor("철회 요청됨")).not.toBe("destructive");
  });

  it("never counts as a customer signature", () => {
    expect(isCustomerSignedDisplayStatus("revoked")).toBe(false);
  });
});

describe("071 (doc_reject_reviewer) 반려됨, 계약-04", () => {
  const reviewStep = { step_type: "06", step_name: "제공기관 확인" };

  it("is labelled 반려됨 from display_status, and from the status code when display_status is absent", () => {
    expect(mapDocStatusLabel({ status_type: "071" }, null, "rejected_by_reviewer")).toBe("반려됨");
    for (const code of ["071", "doc_reject_reviewer"]) {
      expect(mapDocStatusLabel({ status_type: code })).toBe("반려됨");
      expect(resolveDocDisplayStatus({ status_type: code })).toBe("rejected_by_reviewer");
      expect(mapDocStatusLabel({ status_type: code, ...reviewStep }, "2027-12-31")).toBe("반려됨");
      expect(mapDocStatusLabel({ status_type: code, ...reviewStep }, "2025-01-01")).toBe("반려됨");
    }
  });

  it("is in progress (the 대기 tab), never expired or unknown; 080 stays 기간 만료", () => {
    expect(getStatusCategory("071")).toBe("in-progress");
    expect(getStatusCategory("080")).toBe("expired");
    expect(mapDocStatusLabel({ status_type: "080" })).toBe("기간 만료");
    expect(mapDocStatusLabel({ status_type: "061" })).toBe("기간 만료");
  });

  it("uses its own solid badge status, distinct from the soft danger of 기간 만료 / 철회됨", () => {
    expect(contractStatusBadgeType("반려됨")).toBe("rejected_by_reviewer");
    expect(contractStatusBadgeType("기간 만료")).toBe("expired");
    expect(contractStatusBadgeType("철회됨")).toBe("expired");
    expect(getStatusColor("반려됨")).toBe("destructive");
  });

  it("counts as a customer signature (the signature stays valid)", () => {
    expect(isCustomerSignedDisplayStatus("rejected_by_reviewer")).toBe(true);
  });
});

describe("045 (doc_request_reject) is treated exactly like 040", () => {
  it("is labelled 철회 요청됨 with the warning tone and keeps the expired category", () => {
    expect(mapDocStatusLabel({ status_type: "045" })).toBe("철회 요청됨");
    expect(mapDocStatusLabel({ status_type: "doc_request_reject" })).toBe("철회 요청됨");
    expect(mapDocStatusLabel({ status_type: "045", step_type: "06", step_name: "제공기관 확인" }, "2026-01-01")).toBe("철회 요청됨");
    expect(mapDocStatusLabel({ status_type: "045" }, null, "revoke_requested")).toBe("철회 요청됨");
    expect(getStatusCategory("045")).toBe("expired");
    expect(contractStatusBadgeType(mapDocStatusLabel({ status_type: "045" }))).toBe("review");
  });
});

describe("041 (doc_refuse_revoke) reads exactly like 060", () => {
  const customerStep = { step_type: "05", step_name: "이용자 서명" };
  const reviewStep = { step_type: "06", step_name: "제공기관 확인" };

  it("is in progress and labelled by step and review window like 060", () => {
    expect(getStatusCategory("041")).toBe("in-progress");
    expect(getStatusCategory("doc_refuse_revoke")).toBe("in-progress");
    for (const step of [customerStep, reviewStep]) {
      for (const endDate of [null, "2027-12-31", "2025-01-01"]) {
        expect(mapDocStatusLabel({ status_type: "041", ...step }, endDate)).toBe(
          mapDocStatusLabel({ status_type: "060", ...step }, endDate),
        );
      }
    }
    expect(mapDocStatusLabel({ status_type: "041", ...customerStep })).toBe("서명 대기");
    expect(mapDocStatusLabel({ status_type: "041", ...reviewStep }, "2025-01-01")).toBe("검토 필요");
  });
});

describe("customer-signed (contracts stepper) is decided from the display status, not the label text", () => {
  const customerStep = { step_type: "05", step_name: "이용자 서명" };
  const reviewStep = { step_type: "06", step_name: "제공기관 확인" };
  const signedFor = (status: Parameters<typeof resolveDocDisplayStatus>[0], endDate: string | null, displayStatus?: string | null) =>
    isCustomerSignedDisplayStatus(resolveDocDisplayStatus(status, endDate, displayStatus));

  it("060 on the customer step is not signed; 062 / 070 at review / 050 / 003 are", () => {
    expect(signedFor({ status_type: "060", ...customerStep }, null)).toBe(false);
    expect(signedFor({ status_type: "062", ...customerStep }, null)).toBe(true);
    expect(signedFor({ status_type: "070", ...reviewStep }, "2027-12-31")).toBe(true);
    expect(signedFor({ status_type: "070", ...reviewStep }, "2025-01-01")).toBe(true);
    expect(signedFor({ status_type: "072", ...reviewStep }, null)).toBe(true);
    expect(signedFor({ status_type: "050", ...reviewStep }, null)).toBe(true);
    expect(signedFor({ status_type: "003", ...reviewStep }, null)).toBe(true);
  });

  it("an unassigned document (고객 등록 필요) at the review step counts as customer-signed", () => {
    // The label is 고객 등록 필요, which the old label comparison did not recognise.
    expect(mapDocStatusLabel({ status_type: "070", ...reviewStep }, null, "unassigned")).toBe("고객 등록 필요");
    expect(signedFor({ status_type: "070", ...reviewStep }, null, "unassigned")).toBe(true);
  });

  it("040 / 045 / expired statuses claim no signature, and 041 follows 060", () => {
    for (const code of ["040", "045", "042", "080"]) {
      expect(signedFor({ status_type: code, ...reviewStep }, null)).toBe(false);
    }
    expect(signedFor({ status_type: "041", ...customerStep }, null)).toBe(false);
    expect(signedFor({ status_type: "041", ...reviewStep }, "2025-01-01")).toBe(true);
  });
});
