import { compareCursors, isValidCursor, parseCursor } from "./entity-change-cursor";

const INC = "0123456789abcdef";

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
            expect(parseCursor(`1700000000000-5@${INC}`)).toEqual({ kind: "stream", ms: 1700000000000n, seq: 5n, inc: INC });
            expect(parseCursor("1700000000000-5")).toBeNull(); // a stream id without its incarnation is not a cursor
            expect(parseCursor("abc123:7")).toEqual({ kind: "ring", epoch: "abc123", seq: 7n });
            expect(parseCursor("garbage")).toBeNull();
            expect(parseCursor("1-2-3")).toBeNull();
            expect(parseCursor("1-2@nothex0000000000")).toBeNull();
            expect(parseCursor("epoch:")).toBeNull();
        });
    });

    describe("compareCursors", () => {
        it("orders stream ids by (ms, seq) numerically, not as strings", () => {
            expect(compareCursors(`100-9@${INC}`, `100-10@${INC}`)).toBeLessThan(0);
            expect(compareCursors(`100-10@${INC}`, `100-9@${INC}`)).toBeGreaterThan(0);
            expect(compareCursors(`99-5@${INC}`, `100-0@${INC}`)).toBeLessThan(0);
            expect(compareCursors(`1700000000000-0@${INC}`, `1700000000000-0@${INC}`)).toBe(0);
            expect(compareCursors(`9999999999999-0@${INC}`, `10000000000000-0@${INC}`)).toBeLessThan(0);
        });

        it("orders ring ids by seq within one epoch, numerically", () => {
            expect(compareCursors("e1:9", "e1:10")).toBeLessThan(0);
            expect(compareCursors("e1:10", "e1:9")).toBeGreaterThan(0);
            expect(compareCursors("e1:3", "e1:3")).toBe(0);
        });

        it("refuses to order across epochs, id spaces, or unparseable input", () => {
            expect(compareCursors("e1:1", "e2:1")).toBeNull();
            expect(compareCursors("e1:1", `100-1@${INC}`)).toBeNull();
            expect(compareCursors(`100-1@${INC}`, "100-1@fedcba9876543210")).toBeNull(); // another incarnation of the stream
            expect(compareCursors("nope", `100-1@${INC}`)).toBeNull();
        });
    });
});
