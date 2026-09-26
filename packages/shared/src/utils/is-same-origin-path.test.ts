import { isSameOriginPath } from "./is-same-origin-path";

describe("isSameOriginPath", () => {
    it.each([
        "/employees?x=1",
        "/",
        "/clients/1",
        "/service-record-admin/client-1",
    ])("accepts a plain same-origin path (%s)", (value) => {
        expect(isSameOriginPath(value)).toBe(true);
    });

    it.each([
        "/\\evil.test",
        "/\\evil.test/?d=x",
        "//evil.test",
        "/\t/evil.test",
        "https://evil.test",
        "http://evil.test/x",
        "javascript:alert(1)",
        "",
    ])("rejects an origin-escaping value (%s)", (value) => {
        expect(isSameOriginPath(value)).toBe(false);
    });

    it("rejects the already-decoded form of a %5C-encoded backslash the same as the raw backslash", () => {
        // A browser query-string API (URLSearchParams#get, Next's
        // useSearchParams) decodes "%5C" to "\" before user code ever sees
        // the value, so the attacker-controlled query string
        // "?returnTo=/%5Cevil.test" arrives here already decoded to
        // "/\evil.test" — the same string as the literal-backslash case
        // above, not the still-percent-encoded string.
        const decodedFromPercentEncodedBackslash = decodeURIComponent("/%5Cevil.test");
        expect(decodedFromPercentEncodedBackslash).toBe("/\\evil.test");
        expect(isSameOriginPath(decodedFromPercentEncodedBackslash)).toBe(false);
    });

    it("rejects non-string and nullish values", () => {
        expect(isSameOriginPath(null)).toBe(false);
        expect(isSameOriginPath(undefined)).toBe(false);
        expect(isSameOriginPath(42)).toBe(false);
    });

    it("negative control: a bare prefix check would wrongly accept the backslash form", () => {
        // Documents the vulnerable behaviour this helper replaces: a
        // startsWith("/")-only check (with a "//" exclusion) cannot see
        // that a backslash resolves as a path separator, so it lets an
        // origin-escaping value through.
        const vulnerable = (value: string) => value.startsWith("/") && !value.startsWith("//");
        expect(vulnerable("/\\evil.test")).toBe(true);
        expect(isSameOriginPath("/\\evil.test")).toBe(false);
    });
});
