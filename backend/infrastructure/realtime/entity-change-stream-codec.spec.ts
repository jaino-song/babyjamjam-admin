import type { EntityChangedEvent } from "application/services/entity-change-event-bus.service";
import { decodeBatchFields, decodeStreamEntry, encodeBatchFields, entryIncarnation } from "./entity-change-stream-codec";

const G = "0123456789abcdef";

const roundTrip = (event: EntityChangedEvent) => decodeBatchFields("1-0", encodeBatchFields(event));

describe("stream entry codec", () => {
    it("keeps a null branch, an empty-string branch and a real branch apart", () => {
        expect(roundTrip({ branchId: null, entities: ["client"] })?.branchId).toBeNull();
        expect(roundTrip({ branchId: "", entities: ["client"] })?.branchId).toBe("");
        expect(roundTrip({ branchId: "branch-1", entities: ["client"] })?.branchId).toBe("branch-1");
    });

    it("writes no branch field at all for a broadcast, and one for any string (including empty)", () => {
        expect(encodeBatchFields({ branchId: null, entities: ["message"] })).toEqual(["e", '["message"]']);
        expect(encodeBatchFields({ branchId: "", entities: ["message"] })).toEqual(["b", "", "e", '["message"]']);
        expect(encodeBatchFields({ branchId: "b1", entities: ["message", "client"] })).toEqual(["b", "b1", "e", '["message","client"]']);
    });

    it("round-trips the kinds in order and stamps the stream id as the cursor", () => {
        const batch = decodeBatchFields("1793326101367-3", encodeBatchFields({ branchId: "b1", entities: ["service-record", "client"] }));

        expect(batch).toEqual({ type: "batch", cursor: "1793326101367-3", branchId: "b1", entities: ["service-record", "client"] });
    });

    it.each<[string, string[]]>([
        ["an odd number of fields", ["e", '["client"]', "b"]],
        ["no entities field", ["b", "b1"]],
        ["an empty field list", []],
        ["an unknown field", ["b", "b1", "e", '["client"]', "x", "1"]],
        ["a duplicated branch field", ["b", "b1", "b", "b2", "e", '["client"]']],
        ["a duplicated entities field", ["e", '["client"]', "e", '["call"]']],
        ["entities that are not JSON", ["e", "client"]],
        ["entities that are not an array", ["e", '"client"']],
        ["an empty entities array", ["e", "[]"]],
        ["a kind outside the closed set", ["e", '["client","payroll"]']],
        ["a non-string kind", ["e", '["client",1]']],
        ["a prototype-ish kind", ["e", '["constructor"]']],
        ["a duplicated incarnation field", ["e", '["client"]', "g", G, "g", G]],
        ["an incarnation that is not 16 lowercase hex digits", ["e", '["client"]', "g", "0123456789ABCDEF"]],
        ["a short incarnation", ["e", '["client"]', "g", "0123"]],
        ["an empty incarnation", ["e", '["client"]', "g", ""]],
    ])("skips (null) a batch with %s", (_label, fields) => {
        expect(decodeBatchFields("1-0", fields)).toBeNull();
    });

    it("accepts the incarnation field `g` and exposes it, still strict about everything else", () => {
        expect(decodeStreamEntry(["b", "b1", "e", '["client"]', "g", G])).toEqual({ branchId: "b1", entities: ["client"], incarnation: G });
        expect(decodeStreamEntry(["e", '["client"]'])).toEqual({ branchId: null, entities: ["client"], incarnation: null });
        expect(decodeBatchFields("1-0", ["g", G, "e", '["client"]'])).toEqual({ type: "batch", cursor: "1-0", branchId: null, entities: ["client"] });
        expect(decodeStreamEntry(["e", '["client"]', "g", G, "h", "1"])).toBeNull();
    });

    describe("entryIncarnation (evidence of origin, independent of the body)", () => {
        it("reads exactly one well-formed g, wherever it sits and whatever else is wrong with the entry", () => {
            expect(entryIncarnation(["b", "b1", "e", '["client"]', "g", G])).toBe(G);
            expect(entryIncarnation(["g", G])).toBe(G);
            expect(entryIncarnation(["e", "not json", "x", "1", "g", G])).toBe(G);
        });

        it.each<[string, string[]]>([
            ["no g", ["e", '["client"]']],
            ["an empty entry", []],
            ["a duplicated g", ["g", G, "g", G]],
            ["a malformed g", ["g", "xyz"]],
            ["g appearing as a value rather than a field name", ["b", "g", "e", '["client"]']],
        ])("is null for %s", (_label, fields) => {
            expect(entryIncarnation(fields)).toBeNull();
        });
    });
});
