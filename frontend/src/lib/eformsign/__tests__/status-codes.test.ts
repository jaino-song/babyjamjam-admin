import { getStatusCategory, normalizeStatusCode } from "@/lib/eformsign/status-codes";

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
  });
});
