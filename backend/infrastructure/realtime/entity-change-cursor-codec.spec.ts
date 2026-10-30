import { randomBytes } from "node:crypto";

import { CursorCodec, deriveRealtimeCursorKey, randomRealtimeCursorKey } from "./entity-change-cursor-codec";

// The desktop and mobile proxies validate a cursor with exactly this expression.
const CLIENT_CURSOR = /^[0-9A-Za-z:._-]{1,64}$/;
const INC = "0123456789abcdef";
const MAX_MS = ((1n << 48n) - 1n).toString();
const MAX_SEQ = ((1n << 32n) - 1n).toString();
// Ring sequences are parsed as at most 15 digits (see parseCursor); far beyond what 10k-batch retention ever reaches.
const MAX_RING_SEQ = "999999999999999";

describe("CursorCodec", () => {
    const codec = new CursorCodec(randomRealtimeCursorKey());

    it.each([`1793326101367-0@${INC}`, `1793326101367-42@${INC}`, `0-0@${INC}`, `${MAX_MS}-${MAX_SEQ}@ffffffffffffffff`, "abcdef012345:0", "abcdef012345:7", `0123456789ab:${MAX_RING_SEQ}`])(
        "round-trips %s",
        (cursor) => {
            expect(codec.decode(codec.encode(cursor))).toBe(cursor);
        },
    );

    it("two issues of the same cursor are different strings, and both decode to it", () => {
        const first = codec.encode(`1793326101367-5@${INC}`);
        const second = codec.encode(`1793326101367-5@${INC}`);

        expect(first).not.toBe(second);
        expect(codec.decode(first)).toBe(`1793326101367-5@${INC}`);
        expect(codec.decode(second)).toBe(`1793326101367-5@${INC}`);
    });

    it.each([`1793326101367-5@${INC}`, `${MAX_MS}-${MAX_SEQ}@ffffffffffffffff`, "abcdef012345:3", `ffffffffffff:${MAX_RING_SEQ}`])(
        "tokens for %s match the client cursor contract (charset and at most 64 chars)",
        (cursor) => {
            for (let i = 0; i < 20; i += 1) {
                const token = codec.encode(cursor);
                expect(token).toMatch(CLIENT_CURSOR);
                expect(token.length).toBeLessThanOrEqual(64);
            }
        },
    );

    it("tokens do not contain the cursor's digits or epoch in the clear", () => {
        const token = codec.encode(`1793326101367-5@${INC}`);
        expect(token).not.toContain("1793326101367");
        expect(codec.encode("abcdef012345:3")).not.toContain("abcdef012345");
    });

    it("rejects a token that was altered anywhere (every position, flipped)", () => {
        const token = codec.encode(`1793326101367-5@${INC}`);
        for (let i = 0; i < token.length; i += 1) {
            const replacement = token[i] === "A" ? "B" : "A";
            expect({ i, decoded: codec.decode(`${token.slice(0, i)}${replacement}${token.slice(i + 1)}`) }).toEqual({
                i,
                decoded: null,
            });
        }
    });

    it("rejects a token issued under another key, including one derived from a different secret", () => {
        const token = codec.encode(`1793326101367-5@${INC}`);

        expect(new CursorCodec(randomBytes(32)).decode(token)).toBeNull();
        expect(new CursorCodec(deriveRealtimeCursorKey("secret-a")).decode(new CursorCodec(deriveRealtimeCursorKey("secret-b")).encode(`1-1@${INC}`))).toBeNull();
    });

    it.each([
        ["empty", ""],
        ["not base64url", "not a token!"],
        ["raw stream id", `1793326101367-5@${INC}`],
        ["raw ring cursor", "abcdef012345:3"],
        ["too short", randomBytes(10).toString("base64url")],
        ["too long", randomBytes(60).toString("base64url")],
        ["right length, random bytes", randomBytes(45).toString("base64url")],
        ["ring length, random bytes", randomBytes(43).toString("base64url")],
        ["truncated", codec.encode(`1-1@${INC}`).slice(0, -2)],
        ["extended", `${codec.encode(`1-1@${INC}`)}AA`],
    ])("rejects %s", (_label, token) => {
        expect(codec.decode(token)).toBeNull();
    });

    it("refuses to issue a token for something no transport of ours produces", () => {
        expect(() => codec.encode("garbage")).toThrow();
        expect(() => codec.encode("not-hex-epoch:3")).toThrow();
        expect(() => codec.encode(`${(1n << 48n).toString()}-0@${INC}`)).toThrow(); // ms does not fit 48 bits
        expect(() => codec.encode(`1-${(1n << 32n).toString()}@${INC}`)).toThrow(); // seq does not fit 32 bits
        expect(() => codec.encode("1-1")).toThrow(); // a stream id must carry its incarnation
    });

    it("needs a 32-byte key", () => {
        expect(() => new CursorCodec(randomBytes(16))).toThrow();
    });
});

describe("deriveRealtimeCursorKey", () => {
    it("is deterministic per secret (so every instance agrees), 32 bytes, and not the secret", () => {
        const a = deriveRealtimeCursorKey("shared-jwt-secret");
        const b = deriveRealtimeCursorKey("shared-jwt-secret");

        expect(a.equals(b)).toBe(true);
        expect(a).toHaveLength(32);
        expect(a.toString()).not.toContain("shared-jwt-secret");
        expect(a.equals(deriveRealtimeCursorKey("another-secret"))).toBe(false);
    });

    it("lets a token issued by one instance be read by another sharing the secret", () => {
        const one = new CursorCodec(deriveRealtimeCursorKey("shared-jwt-secret"));
        const other = new CursorCodec(deriveRealtimeCursorKey("shared-jwt-secret"));

        expect(other.decode(one.encode(`1793326101367-9@${INC}`))).toBe(`1793326101367-9@${INC}`);
    });
});
