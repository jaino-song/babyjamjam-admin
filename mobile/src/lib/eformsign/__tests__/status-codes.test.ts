import {
  getStatusCategory,
  getStatusColor,
  mapStatusToLabel,
  normalizeStatusCode,
} from "../status-codes";

describe("eformsign status code helpers", () => {
  it("normalizes status codes to the 3-digit eformsign format", () => {
    expect(normalizeStatusCode("1")).toBe("001");
    expect(normalizeStatusCode(" 70 ")).toBe("070");
    expect(normalizeStatusCode("003")).toBe("003");
  });

  it("classifies only known in-progress status codes as in-progress", () => {
    expect(getStatusCategory("001")).toBe("in-progress");
    expect(getStatusCategory("070")).toBe("in-progress");
  });

  it("classifies completed and rejected status codes by eformsign buckets", () => {
    expect(getStatusCategory("003")).toBe("completed");
    expect(getStatusCategory("080")).toBe("rejected");
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
});
