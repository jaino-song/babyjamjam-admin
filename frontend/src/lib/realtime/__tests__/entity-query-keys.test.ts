import { allQueryKeyRoots, queryKeyRootsForKinds } from "../entity-query-keys";

describe("queryKeyRootsForKinds", () => {
    it.each([
        ["client", [["clients"], ["dashboard"]]],
        ["employee", [["employees"]]],
        [
            "document",
            [
                ["eformsign-documents"],
                ["eformsign-docs"],
                ["eformsign-client-names"],
                ["eformsign-status-counts"],
                ["eformsign-document-jobs"],
                ["dashboard"],
            ],
        ],
        ["message", [["message-triggers"]]],
        ["service-record", [["service-records"]]],
    ])("maps %s to its query roots", (kind, expected) => {
        expect(queryKeyRootsForKinds([kind])).toEqual(expected);
    });

    it("ignores unknown kinds and malformed entries", () => {
        expect(queryKeyRootsForKinds(["voucher", 7, null, "constructor", "__proto__"])).toEqual([]);
    });

    it("keeps the known kinds when mixed with unknown ones", () => {
        expect(queryKeyRootsForKinds(["voucher", "employee"])).toEqual([["employees"]]);
    });

    it("de-duplicates a root shared by several kinds", () => {
        const roots = queryKeyRootsForKinds(["client", "document"]);
        expect(roots.filter((root) => root[0] === "dashboard")).toHaveLength(1);
    });
});

describe("allQueryKeyRoots", () => {
    it("is the de-duplicated union of every root in the map", () => {
        const roots = allQueryKeyRoots().map((root) => root[0]);
        expect(new Set(roots).size).toBe(roots.length);
        expect(roots.sort()).toEqual(
            [
                "clients",
                "dashboard",
                "eformsign-client-names",
                "eformsign-docs",
                "eformsign-document-jobs",
                "eformsign-documents",
                "eformsign-status-counts",
                "employees",
                "message-triggers",
                "service-records",
            ].sort(),
        );
    });
});
