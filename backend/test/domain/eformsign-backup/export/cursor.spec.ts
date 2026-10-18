import {
    encodeExportCursor, isValidIdempotencyKey, parseExportLimit, resolveExportPage,
} from "domain/eformsign-backup/export";

const SNAP = "123e4567-e89b-42d3-a456-426614174000";
const OTHER = "223e4567-e89b-42d3-a456-426614174000";
const b64 = (raw: unknown) => Buffer.from(typeof raw === "string" ? raw : JSON.stringify(raw), "utf8").toString("base64url");
const valid = { v: 1, s: SNAP, o: 5, l: 25 };

describe("parseExportLimit", () => {
    it("defaults to 100 when omitted", () => {
        expect(parseExportLimit(undefined)).toBe(100);
    });
    it.each([["1", 1], ["100", 100], ["50", 50]])("accepts %j", (raw, n) => {
        expect(parseExportLimit(raw)).toBe(n);
    });
    it.each(["0", "101", "abc", "-1", "1.5", "", " 10", "10 ", "1e1", "0x10", "010", "+5"])(
        "rejects %j with INVALID_REQUEST", (raw) => {
            expect(parseExportLimit(raw)).toBe("INVALID_REQUEST");
        });
});

describe("encodeExportCursor", () => {
    it("is base64url of the exact JSON {v,s,o,l}", () => {
        const cursor = encodeExportCursor({ snapshotId: SNAP, lastOrdinal: 5, limit: 25 });
        expect(cursor).toBe(Buffer.from(`{"v":1,"s":"${SNAP}","o":5,"l":25}`, "utf8").toString("base64url"));
        expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    });
    it("rejects values the decoder would refuse", () => {
        expect(() => encodeExportCursor({ snapshotId: SNAP, lastOrdinal: -1, limit: 10 })).toThrow();
        expect(() => encodeExportCursor({ snapshotId: SNAP, lastOrdinal: 1.5, limit: 10 })).toThrow();
        expect(() => encodeExportCursor({ snapshotId: SNAP, lastOrdinal: 1, limit: 101 })).toThrow();
        expect(() => encodeExportCursor({ snapshotId: "nope", lastOrdinal: 1, limit: 10 })).toThrow();
    });
});

describe("resolveExportPage", () => {
    it("no cursor, no limit: afterOrdinal 0, limit 100", () => {
        expect(resolveExportPage({ snapshotId: SNAP })).toEqual({ ok: true, afterOrdinal: 0, limit: 100 });
    });
    it("no cursor, explicit limit", () => {
        expect(resolveExportPage({ snapshotId: SNAP, limit: "7" })).toEqual({ ok: true, afterOrdinal: 0, limit: 7 });
    });
    it("no cursor, bad limit -> INVALID_REQUEST", () => {
        expect(resolveExportPage({ snapshotId: SNAP, limit: "0" })).toEqual({ ok: false, code: "INVALID_REQUEST" });
        expect(resolveExportPage({ snapshotId: SNAP, limit: "101" })).toEqual({ ok: false, code: "INVALID_REQUEST" });
        expect(resolveExportPage({ snapshotId: SNAP, limit: "abc" })).toEqual({ ok: false, code: "INVALID_REQUEST" });
    });
    it("round trip: encode then resolve returns the same position and limit", () => {
        const cursor = encodeExportCursor({ snapshotId: SNAP, lastOrdinal: 42, limit: 30 });
        expect(resolveExportPage({ snapshotId: SNAP, cursor })).toEqual({ ok: true, afterOrdinal: 42, limit: 30 });
    });
    it("replay is deterministic", () => {
        const cursor = encodeExportCursor({ snapshotId: SNAP, lastOrdinal: 9, limit: 3 });
        expect(resolveExportPage({ snapshotId: SNAP, cursor })).toEqual(resolveExportPage({ snapshotId: SNAP, cursor }));
    });
    it("cursor with an explicit equal limit is accepted", () => {
        const cursor = encodeExportCursor({ snapshotId: SNAP, lastOrdinal: 9, limit: 30 });
        expect(resolveExportPage({ snapshotId: SNAP, cursor, limit: "30" })).toEqual({ ok: true, afterOrdinal: 9, limit: 30 });
    });
    it("cursor + explicit different limit -> CURSOR_PARAMETER_MISMATCH", () => {
        const cursor = encodeExportCursor({ snapshotId: SNAP, lastOrdinal: 9, limit: 30 });
        expect(resolveExportPage({ snapshotId: SNAP, cursor, limit: "31" })).toEqual({ ok: false, code: "CURSOR_PARAMETER_MISMATCH" });
    });
    it("cursor from another snapshot -> CURSOR_PARAMETER_MISMATCH", () => {
        const cursor = encodeExportCursor({ snapshotId: OTHER, lastOrdinal: 9, limit: 30 });
        expect(resolveExportPage({ snapshotId: SNAP, cursor })).toEqual({ ok: false, code: "CURSOR_PARAMETER_MISMATCH" });
    });
    it("an out-of-range explicit limit alongside a valid cursor is INVALID_REQUEST", () => {
        const cursor = encodeExportCursor({ snapshotId: SNAP, lastOrdinal: 9, limit: 30 });
        expect(resolveExportPage({ snapshotId: SNAP, cursor, limit: "500" })).toEqual({ ok: false, code: "INVALID_REQUEST" });
    });

    it.each([
        ["not base64url", "!!!not-a-cursor!!!"],
        ["empty string", ""],
        ["base64url of non-JSON", b64("hello")],
        ["JSON array", b64([1, 2, 3])],
        ["JSON null", b64("null")],
        ["extra key", b64({ ...valid, x: 1 })],
        ["missing key", b64({ v: 1, s: SNAP, o: 5 })],
        ["wrong version", b64({ ...valid, v: 2 })],
        ["string version", b64({ ...valid, v: "1" })],
        ["negative ordinal", b64({ ...valid, o: -1 })],
        ["non-integer ordinal", b64({ ...valid, o: 1.5 })],
        ["string ordinal", b64({ ...valid, o: "5" })],
        ["unsafe-integer ordinal", b64({ ...valid, o: 2 ** 53 })],
        ["zero limit", b64({ ...valid, l: 0 })],
        ["limit above max", b64({ ...valid, l: 101 })],
        ["non-integer limit", b64({ ...valid, l: 2.5 })],
        ["non-uuid snapshot id", b64({ ...valid, s: "not-a-uuid" })],
        ["numeric snapshot id", b64({ ...valid, s: 5 })],
        ["padded base64", `${b64(valid)}==`],
        ["oversized", "A".repeat(4000)],
    ])("garbage cursor (%s) -> INVALID_CURSOR", (_label, cursor) => {
        expect(resolveExportPage({ snapshotId: SNAP, cursor })).toEqual({ ok: false, code: "INVALID_CURSOR" });
    });

    it("accepts the boundary values o=0 and l=1 / l=100", () => {
        expect(resolveExportPage({ snapshotId: SNAP, cursor: b64({ ...valid, o: 0, l: 1 }) })).toEqual({ ok: true, afterOrdinal: 0, limit: 1 });
        expect(resolveExportPage({ snapshotId: SNAP, cursor: b64({ ...valid, o: 0, l: 100 }) })).toEqual({ ok: true, afterOrdinal: 0, limit: 100 });
    });

    it("a malformed cursor is reported before a mismatching limit", () => {
        expect(resolveExportPage({ snapshotId: SNAP, cursor: "garbage!", limit: "5" })).toEqual({ ok: false, code: "INVALID_CURSOR" });
    });
});

describe("isValidIdempotencyKey (contract 3.1)", () => {
    it.each(["a", "abc-123", "Key_1.2:3", "A".repeat(128)])("accepts %j", (key) => {
        expect(isValidIdempotencyKey(key)).toBe(true);
    });
    it.each([undefined, "", "A".repeat(129), "has space", "slash/x", "한글", "new\nline", "trailing\n", "semi;colon"])(
        "rejects %j", (key) => {
            expect(isValidIdempotencyKey(key)).toBe(false);
        });
});
