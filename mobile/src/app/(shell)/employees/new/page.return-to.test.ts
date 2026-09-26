import { sanitizeReturnTo } from "./page";

describe("sanitizeReturnTo", () => {
  it.each([
    ["a raw backslash-as-separator path", "/\\evil.test"],
    ["a backslash-as-separator path with a trailing query", "/\\evil.test/?d=x"],
    ["a protocol-relative path", "//evil.test"],
    ["a tab character before the host segment", "/\t/evil.test"],
    ["an absolute URL", "https://evil.test"],
    // searchParams.get() already decodes a "%5C"-encoded query value to a
    // literal backslash before this function ever sees it, so the decoded
    // form is the value under test here, not the still-percent-encoded
    // string.
    ["the decoded form of a %5C-encoded backslash", decodeURIComponent("/%5Cevil.test")],
  ])("falls back to null for %s (%p)", (_label, value) => {
    expect(sanitizeReturnTo(value)).toBeNull();
  });

  it("keeps a plain same-origin path with a query string", () => {
    expect(sanitizeReturnTo("/employees?x=1")).toBe("/employees?x=1");
  });

  it("falls back to null for a missing value", () => {
    expect(sanitizeReturnTo(null)).toBeNull();
  });

  it("negative control: a bare startsWith(\"/\") prefix check would wrongly accept the backslash form", () => {
    // Documents the vulnerable behaviour this fix replaces: a
    // startsWith("/")-only check (with a "//" exclusion) lets an
    // origin-escaping value through because it never resolves the value the
    // way a browser does.
    const vulnerable = (path: string | null) => {
      if (!path) return null;
      if (!path.startsWith("/") || path.startsWith("//")) return null;
      return path;
    };
    expect(vulnerable("/\\evil.test")).toBe("/\\evil.test");
    expect(sanitizeReturnTo("/\\evil.test")).toBeNull();
  });
});
