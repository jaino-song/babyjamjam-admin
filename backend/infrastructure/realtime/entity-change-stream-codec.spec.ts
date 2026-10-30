import type { EntityChangedEvent } from "application/services/entity-change-event-bus.service";
import { decodeBatchFields, encodeBatchFields } from "./entity-change-stream-codec";

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
    ])("skips (null) a batch with %s", (_label, fields) => {
        expect(decodeBatchFields("1-0", fields)).toBeNull();
    });
});
