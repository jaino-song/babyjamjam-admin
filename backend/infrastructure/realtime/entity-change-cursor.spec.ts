import { compareCursors, isValidCursor, parseCursor } from "./entity-change-cursor";

describe("entity change cursors", () => {
    describe("isValidCursor", () => {
        it.each(["1700000000000-0", "abc123def456:7", "A.b_c-d:9", "x".repeat(64)])("accepts %s", (cursor) => {
            expect(isValidCursor(cursor)).toBe(true);
        });

        it.each(["", "x".repeat(65), "has space", "semi;colon", "slash/", "ünicode", undefined, 12, ["a"]])(
            "rejects %p",
            (cursor) => {
                expect(isValidCursor(cursor)).toBe(false);
            },
        );
    });

    describe("parseCursor", () => {
        it("reads a Valkey stream id and a ring id, and nothing else", () => {
            expect(parseCursor("1700000000000-5")).toEqual({ kind: "stream", ms: 1700000000000n, seq: 5n });
            expect(parseCursor("abc123:7")).toEqual({ kind: "ring", epoch: "abc123", seq: 7n });
            expect(parseCursor("garbage")).toBeNull();
            expect(parseCursor("1-2-3")).toBeNull();
            expect(parseCursor("epoch:")).toBeNull();
        });
    });

    describe("compareCursors", () => {
        it("orders stream ids by (ms, seq) numerically, not as strings", () => {
            expect(compareCursors("100-9", "100-10")).toBeLessThan(0);
            expect(compareCursors("100-10", "100-9")).toBeGreaterThan(0);
            expect(compareCursors("99-5", "100-0")).toBeLessThan(0);
            expect(compareCursors("1700000000000-0", "1700000000000-0")).toBe(0);
            expect(compareCursors("9999999999999-0", "10000000000000-0")).toBeLessThan(0);
        });

        it("orders ring ids by seq within one epoch, numerically", () => {
            expect(compareCursors("e1:9", "e1:10")).toBeLessThan(0);
            expect(compareCursors("e1:10", "e1:9")).toBeGreaterThan(0);
            expect(compareCursors("e1:3", "e1:3")).toBe(0);
        });

        it("refuses to order across epochs, id spaces, or unparseable input", () => {
            expect(compareCursors("e1:1", "e2:1")).toBeNull();
            expect(compareCursors("e1:1", "100-1")).toBeNull();
            expect(compareCursors("nope", "100-1")).toBeNull();
        });
    });
});
