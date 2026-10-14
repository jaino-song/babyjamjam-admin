import {
  getStatusCategory,
  getStatusColor,
  isDeletedStatusCode,
  isReceiptSendableOnCalendar,
  mapDocStatusLabel,
  mapStatusToLabel,
  normalizeStatusCode,
} from "../status-codes";
import { createKrBusinessDayCalendar, getKoreanHolidays, KR_BUILTIN_CALENDAR } from "@/lib/date/business-days";

describe("eformsign status code helpers", () => {
  it("normalizes status codes to the 3-digit eformsign format", () => {
    expect(normalizeStatusCode("1")).toBe("001");
    expect(normalizeStatusCode(" 70 ")).toBe("070");
    expect(normalizeStatusCode("003")).toBe("003");
    expect(normalizeStatusCode("doc_request_participant")).toBe("060");
  });

  it("classifies only known in-progress status codes as in-progress", () => {
    expect(getStatusCategory("001")).toBe("in-progress");
    expect(getStatusCategory("070")).toBe("in-progress");
  });

  it("classifies completed and expired status codes by eformsign buckets", () => {
    expect(getStatusCategory("003")).toBe("completed");
    expect(getStatusCategory("080")).toBe("expired");
    expect(getStatusCategory("090")).toBe("expired");
    expect(mapStatusToLabel("090")).toBe("기간 만료");
  });

  it("keeps deleted document codes out of rejected expiration buckets", () => {
    expect(isDeletedStatusCode("047")).toBe(true);
    expect(isDeletedStatusCode("049")).toBe(true);
    expect(isDeletedStatusCode("099")).toBe(true);
    expect(getStatusCategory("047")).toBe("expired");
    expect(getStatusCategory("049")).toBe("expired");
    expect(getStatusCategory("099")).toBe("unknown");
    expect(mapStatusToLabel("049")).toBe("기간 만료");
  });

  it("classifies unsupported, blank, and missing status codes as unknown", () => {
    expect(getStatusCategory("999")).toBe("unknown");
    expect(getStatusCategory("")).toBe("unknown");
    expect(getStatusCategory(null)).toBe("unknown");
    expect(getStatusCategory(undefined)).toBe("unknown");
  });

  it("maps unknown status values to a distinct label and neutral badge color", () => {
    expect(mapStatusToLabel("999")).toBe("알 수 없음");
    expect(getStatusColor("알 수 없음")).toBe("info");
  });

  it("does not mark user participant steps as review needed when upstream marks the recipient internal", () => {
    expect(
      mapDocStatusLabel({
        status_type: "060",
        step_type: "05",
        step_name: "이용자",
        step_recipients: [{ recipient_type: "01" }],
      }),
    ).toBe("서명 대기");
  });

  it("marks provider confirmation steps as review needed", () => {
    expect(
      mapDocStatusLabel({
        status_type: "060",
        step_type: "05",
        step_name: "제공기관 확인",
        step_recipients: [{ recipient_type: "01" }],
      }),
    ).toBe("검토 필요");
  });

  describe("review window on a branch calendar", () => {
    const providerReviewStep = {
      status_type: "060",
      step_type: "05",
      step_name: "제공기관 확인",
      step_recipients: [{ recipient_type: "01" }],
    };

    beforeEach(() => {
      // Friday 2026-07-10, noon KST.
      jest.useFakeTimers({ now: new Date("2026-07-10T03:00:00Z") });
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    it("opens the review window a business day earlier when the branch closes the day before the end date", () => {
      const branchCalendar = createKrBusinessDayCalendar([...getKoreanHolidays(2026), "2026-07-13"], {
        version: "kr-db-test",
        supportedYears: [2026],
      });

      // End date Tuesday 07-14: the window opens one business day before it.
      expect(mapDocStatusLabel(providerReviewStep, "2026-07-14", null, KR_BUILTIN_CALENDAR)).toBe("서명 완료");
      expect(mapDocStatusLabel(providerReviewStep, "2026-07-14", null, branchCalendar)).toBe("검토 필요");
    });

    it("reads an end date in a year the branch calendar did not load on the built-in list", () => {
      const branchCalendar = createKrBusinessDayCalendar([...getKoreanHolidays(2026)], {
        version: "kr-db-test",
        supportedYears: [2026],
      });

      expect(mapDocStatusLabel(providerReviewStep, "2025-07-14", null, branchCalendar)).toBe("검토 필요");
    });

    it("gates the receipt action on the built-in list for an end date the branch calendar did not load", () => {
      const branchCalendar = createKrBusinessDayCalendar([...getKoreanHolidays(2026)], {
        version: "kr-db-test",
        supportedYears: [2026],
      });
      const params = {
        displayStatus: null,
        category: "in-progress" as const,
        currentStatus: providerReviewStep,
        contractEndDate: "2024-12-20",
      };

      expect(() => isReceiptSendableOnCalendar({ ...params, calendar: branchCalendar })).not.toThrow();
      expect(isReceiptSendableOnCalendar({ ...params, calendar: branchCalendar })).toBe(
        isReceiptSendableOnCalendar({ ...params, calendar: KR_BUILTIN_CALENDAR }),
      );
      expect(isReceiptSendableOnCalendar({ ...params, calendar: branchCalendar })).toBe(true);
    });
  });
});

describe("040 (doc_request_revoke) 철회 요청됨", () => {
  it("is labelled 철회 요청됨 from display_status, and from the status code when display_status is absent", () => {
    expect(mapDocStatusLabel({ status_type: "040" }, null, "revoke_requested")).toBe("철회 요청됨");
    expect(mapDocStatusLabel({ status_type: "040" })).toBe("철회 요청됨");
    expect(mapDocStatusLabel({ status_type: "040", step_type: "06", step_name: "제공기관 확인" }, "2026-01-01")).toBe("철회 요청됨");
  });

  it("keeps the expired category and leaves 080 labelled 기간 만료", () => {
    expect(getStatusCategory("040")).toBe("expired");
    expect(mapDocStatusLabel({ status_type: "080" })).toBe("기간 만료");
  });
});

describe("042 (doc_revoke) / 090 (withdrawal) 철회됨", () => {
  it("is labelled 철회됨 from display_status, and from the status code when display_status is absent", () => {
    expect(mapDocStatusLabel({ status_type: "042" }, null, "revoked")).toBe("철회됨");
    for (const code of ["042", "090", "doc_revoke"]) {
      expect(mapDocStatusLabel({ status_type: code })).toBe("철회됨");
    }
    expect(mapDocStatusLabel({ status_type: "042", step_type: "06", step_name: "제공기관 확인" }, "2026-01-01")).toBe("철회됨");
  });

  it("keeps the expired category for filtering, tabs and stats", () => {
    expect(getStatusCategory("042")).toBe("expired");
    expect(getStatusCategory("090")).toBe("expired");
  });

  it("uses the destructive variant, distinct from the 철회 요청됨 one", () => {
    expect(getStatusColor("철회됨")).toBe("destructive");
    expect(getStatusColor("철회 요청됨")).not.toBe("destructive");
  });
});

describe("071 (doc_reject_reviewer) 반려됨, 계약-04", () => {
  const reviewStep = { step_type: "06", step_name: "제공기관 확인" };

  it("is labelled 반려됨 from display_status, and from the status code when display_status is absent", () => {
    expect(mapDocStatusLabel({ status_type: "071" }, null, "rejected_by_reviewer")).toBe("반려됨");
    for (const code of ["071", "doc_reject_reviewer"]) {
      expect(mapDocStatusLabel({ status_type: code })).toBe("반려됨");
      expect(mapDocStatusLabel({ status_type: code, ...reviewStep }, "2027-12-31")).toBe("반려됨");
      expect(mapDocStatusLabel({ status_type: code, ...reviewStep }, "2025-01-01")).toBe("반려됨");
    }
  });

  it("is in progress, never expired; 080 stays 기간 만료", () => {
    expect(getStatusCategory("071")).toBe("in-progress");
    expect(getStatusCategory("080")).toBe("expired");
    expect(mapDocStatusLabel({ status_type: "080" })).toBe("기간 만료");
    expect(mapDocStatusLabel({ status_type: "061" })).toBe("기간 만료");
  });

  it("is destructive-toned in the badge colour helper", () => {
    expect(getStatusColor("반려됨")).toBe("destructive");
  });
});

describe("045 (doc_request_reject) is treated exactly like 040", () => {
  it("is labelled 철회 요청됨 with the expired category kept for the filter tab", () => {
    expect(mapDocStatusLabel({ status_type: "045" })).toBe("철회 요청됨");
    expect(mapDocStatusLabel({ status_type: "doc_request_reject" })).toBe("철회 요청됨");
    expect(mapDocStatusLabel({ status_type: "045", step_type: "06", step_name: "제공기관 확인" }, "2026-01-01")).toBe("철회 요청됨");
    expect(getStatusCategory("045")).toBe("expired");
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
  });
});

describe("voided (계약 파기, BJJ-439) 파기됨", () => {
  const reviewStep = { step_type: "06", step_name: "제공기관 확인" };

  it("is labelled 파기됨 from display_status whatever the provider code says", () => {
    for (const code of ["003", "060", "070", "042", "080"]) {
      expect(mapDocStatusLabel({ status_type: code, ...reviewStep }, null, "voided")).toBe("파기됨");
    }
  });

  it("uses the neutral (secondary) variant, not a danger tone", () => {
    expect(getStatusColor("파기됨")).toBe("secondary");
    expect(getStatusColor("파기됨")).not.toBe("destructive");
  });

  it("is never receipt-sendable", () => {
    expect(isReceiptSendableOnCalendar({
      category: "completed",
      displayStatus: "voided",
      currentStatus: { status_type: "003", ...reviewStep },
      contractEndDate: null,
    })).toBe(false);
  });
});
