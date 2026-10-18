import {
    assertExclusiveCounts, classifyExportDocument, countExportClassifications,
    EXPORT_CLASSIFICATIONS,
} from "domain/eformsign-backup/export";

const T = new Date("2026-10-01T00:00:00Z");
const BOTH = ["document", "audit_trail"];

// Defaults describe an ordinary completed contract with both files.
function classify(over: Partial<Parameters<typeof classifyExportDocument>[0]> = {}) {
    return classifyExportDocument({
        documentId: "D001", documentKind: "contract", statusType: "003",
        permanentPurgeRequestedAt: null, voidedAt: null, detailPayloadIsNull: false,
        fileTypesPresent: BOTH, ...over,
    });
}

describe("classifyExportDocument (contract D4)", () => {
    it("lists the five classifications in priority order", () => {
        expect(EXPORT_CLASSIFICATIONS).toEqual([
            "inaccessible", "unknown_template", "policy_pending", "excluded_by_policy", "included",
        ]);
    });

    it("row 1: purge requested is inaccessible/purge-pending", () => {
        expect(classify({ permanentPurgeRequestedAt: T })).toEqual({
            classification: "inaccessible", reasons: ["purge-pending"], statusType: "003",
        });
    });

    it("row 1 outranks row 2: purge-pending with NULL kind is inaccessible, not unknown_template", () => {
        expect(classify({ permanentPurgeRequestedAt: T, documentKind: null }).classification).toBe("inaccessible");
    });

    it("row 1b: purge tombstone (049 + kind NULL + payload NULL) is inaccessible/purged", () => {
        expect(classify({
            documentId: "D014", statusType: "049", documentKind: null, detailPayloadIsNull: true, fileTypesPresent: [],
        })).toEqual({ classification: "inaccessible", reasons: ["purged"], statusType: "049" });
    });

    it("row 1b needs all three conditions", () => {
        // 049 + kind NULL but payload present -> falls to row 2.
        expect(classify({ statusType: "049", documentKind: null, detailPayloadIsNull: false }).classification).toBe("unknown_template");
        // 049 + payload NULL but kind present -> falls to row 4 (rejected set).
        expect(classify({ statusType: "049", documentKind: "contract", detailPayloadIsNull: true }).classification).toBe("excluded_by_policy");
        // kind NULL + payload NULL but another status -> unknown_template.
        expect(classify({ statusType: "003", documentKind: null, detailPayloadIsNull: true }).classification).toBe("unknown_template");
    });

    it("row 1b tombstone detection normalizes the legacy name doc_delete", () => {
        expect(classify({ statusType: "doc_delete", documentKind: null, detailPayloadIsNull: true }).reasons).toEqual(["purged"]);
    });

    it("row 2: NULL kind is unknown_template/document-kind-unknown", () => {
        expect(classify({ documentKind: null })).toEqual({
            classification: "unknown_template", reasons: ["document-kind-unknown"], statusType: "003",
        });
    });

    it("row 2 outranks row 3: NULL kind with an unmapped status is unknown_template", () => {
        expect(classify({ documentKind: null, statusType: "999" }).classification).toBe("unknown_template");
    });

    it("row 3: status outside the KNOWN set is policy_pending/status-unclassified", () => {
        expect(classify({ statusType: "999" })).toEqual({
            classification: "policy_pending", reasons: ["status-unclassified"], statusType: "999",
        });
    });

    it("row 3: a long unmapped name stays policy_pending with the lowercased raw statusType preserved", () => {
        expect(classify({ statusType: "DOC_Request_Something" })).toEqual({
            classification: "policy_pending", reasons: ["status-unclassified"], statusType: "doc_request_something",
        });
    });

    it("row 3: null/empty status normalizes to 000 and is policy_pending", () => {
        expect(classify({ statusType: null })).toMatchObject({ classification: "policy_pending", statusType: "000" });
        expect(classify({ statusType: "" })).toMatchObject({ classification: "policy_pending", statusType: "000" });
    });

    it.each(["060", "049", "002", "061", "040", "045", "090", "099", "010", "071", "011", "080"])(
        "row 4: known incomplete code %s is excluded_by_policy/incomplete-no-file", (code) => {
            expect(classify({ statusType: code })).toEqual({
                classification: "excluded_by_policy", reasons: ["incomplete-no-file"], statusType: code,
            });
        });

    it.each(["003", "012", "022", "032", "050", "062", "072", "092"])(
        "row 5: completed code %s is included", (code) => {
            expect(classify({ statusType: code })).toEqual({
                classification: "included", reasons: [], statusType: code,
            });
        });

    it.each([["3", "003"], ["doc_complete", "003"], ["62", "062"], ["DOC_COMPLETE", "003"], ["doc_accept_participant", "062"]])(
        "legacy storage value %j normalizes to %s and is included", (stored, normalized) => {
            expect(classify({ statusType: stored })).toEqual({
                classification: "included", reasons: [], statusType: normalized,
            });
        });

    it("legacy 'doc_request_approval' normalizes to a known in-progress code -> excluded", () => {
        expect(classify({ statusType: "doc_request_approval" })).toMatchObject({
            classification: "excluded_by_policy", statusType: "010",
        });
    });

    it("identifier rule: a document id failing assertIdentifier is inaccessible/identifier-invalid", () => {
        expect(classify({ documentId: "bad id!" })).toEqual({
            classification: "inaccessible", reasons: ["identifier-invalid"], statusType: "003",
        });
        expect(classify({ documentId: "" }).reasons).toEqual(["identifier-invalid"]);
        expect(classify({ documentId: "." }).reasons).toEqual(["identifier-invalid"]);
        expect(classify({ documentId: "a".repeat(257) }).reasons).toEqual(["identifier-invalid"]);
        expect(classify({ documentId: "a".repeat(256) }).classification).toBe("included");
    });

    it("identifier rule is judged after rows 1/1b and before row 2", () => {
        // purge-pending wins over identifier-invalid
        expect(classify({ documentId: "bad id!", permanentPurgeRequestedAt: T }).reasons).toEqual(["purge-pending"]);
        // tombstone wins over identifier-invalid
        expect(classify({ documentId: "bad id!", statusType: "049", documentKind: null, detailPayloadIsNull: true }).reasons).toEqual(["purged"]);
        // identifier-invalid wins over unknown_template and policy_pending
        expect(classify({ documentId: "bad id!", documentKind: null }).reasons).toEqual(["identifier-invalid"]);
        expect(classify({ documentId: "bad id!", statusType: "999" }).reasons).toEqual(["identifier-invalid"]);
    });

    it("identifier-invalid carries no artifact-missing reason", () => {
        expect(classify({ documentId: "bad id!", fileTypesPresent: [] }).reasons).toEqual(["identifier-invalid"]);
    });

    it("extra reason: voided_at adds 'voided' without changing the classification", () => {
        expect(classify({ voidedAt: T })).toEqual({ classification: "included", reasons: ["voided"], statusType: "003" });
        expect(classify({ voidedAt: T, statusType: "060" })).toEqual({
            classification: "excluded_by_policy", reasons: ["incomplete-no-file", "voided"], statusType: "060",
        });
        expect(classify({ voidedAt: T, permanentPurgeRequestedAt: T }).reasons).toEqual(["purge-pending", "voided"]);
    });

    it("extra reason: included but a required file is absent adds artifact-missing-at-snapshot:<fileType>", () => {
        expect(classify({ fileTypesPresent: ["document"] }).reasons).toEqual(["artifact-missing-at-snapshot:audit_trail"]);
        expect(classify({ fileTypesPresent: ["audit_trail"] }).reasons).toEqual(["artifact-missing-at-snapshot:document"]);
        expect(classify({ fileTypesPresent: [] }).reasons).toEqual([
            "artifact-missing-at-snapshot:document", "artifact-missing-at-snapshot:audit_trail",
        ]);
        expect(classify({ fileTypesPresent: ["document"], voidedAt: T }).reasons).toEqual([
            "voided", "artifact-missing-at-snapshot:audit_trail",
        ]);
    });

    it("missing files do not matter for non-included documents", () => {
        expect(classify({ statusType: "060", fileTypesPresent: [] }).reasons).toEqual(["incomplete-no-file"]);
    });
});

describe("V06b fixture set (contract 6.1, literal expected counts)", () => {
    const fixtures = [
        // D001-D004 included, D004 missing audit_trail
        classify({ documentId: "D001" }),
        classify({ documentId: "D002", statusType: "doc_complete" }),
        classify({ documentId: "D003", documentKind: "service_record_snapshot" }),
        classify({ documentId: "D004", fileTypesPresent: ["document"] }),
        classify({ documentId: "D005", documentKind: null }),
        classify({ documentId: "D006", statusType: "060" }),
        classify({ documentId: "D007", permanentPurgeRequestedAt: T }),
        classify({ documentId: "D008", statusType: "061" }),
        classify({ documentId: "D017", statusType: "002", fileTypesPresent: [] }),
    ];

    it("classifies each fixture as declared", () => {
        expect(fixtures.map(f => f.classification)).toEqual([
            "included", "included", "included", "included",
            "unknown_template", "excluded_by_policy", "inaccessible", "excluded_by_policy", "excluded_by_policy",
        ]);
        expect(fixtures[3]!.reasons).toEqual(["artifact-missing-at-snapshot:audit_trail"]);
        expect(fixtures[7]!.reasons).toEqual(["incomplete-no-file"]);
    });

    it("counts N=9 included=4 unknownTemplate=1 inaccessible=1 excludedByPolicy=3 policyPending=0", () => {
        const counts = countExportClassifications(fixtures.map(f => f.classification));
        expect(counts).toEqual({
            total: 9, inaccessible: 1, unknownTemplate: 1, policyPending: 0, excludedByPolicy: 3, included: 4,
        });
        expect(() => assertExclusiveCounts(counts)).not.toThrow();
    });
});

describe("countExportClassifications / assertExclusiveCounts", () => {
    it("counts each classification once and total equals the sum", () => {
        const counts = countExportClassifications([
            "included", "policy_pending", "policy_pending", "inaccessible", "unknown_template", "excluded_by_policy",
        ]);
        expect(counts).toEqual({
            total: 6, inaccessible: 1, unknownTemplate: 1, policyPending: 2, excludedByPolicy: 1, included: 1,
        });
    });

    it("an empty inventory is all zero and valid", () => {
        const counts = countExportClassifications([]);
        expect(counts).toEqual({ total: 0, inaccessible: 0, unknownTemplate: 0, policyPending: 0, excludedByPolicy: 0, included: 0 });
        expect(() => assertExclusiveCounts(counts)).not.toThrow();
    });

    it("throws when total differs from the sum of the five", () => {
        const base = { total: 9, inaccessible: 1, unknownTemplate: 1, policyPending: 0, excludedByPolicy: 3, included: 4 };
        expect(() => assertExclusiveCounts(base)).not.toThrow();
        expect(() => assertExclusiveCounts({ ...base, total: 10 })).toThrow();
        expect(() => assertExclusiveCounts({ ...base, total: 8 })).toThrow();
        expect(() => assertExclusiveCounts({ ...base, included: 5 })).toThrow();
    });

    it("rejects an unknown classification value", () => {
        expect(() => countExportClassifications(["bogus" as never])).toThrow();
    });
});
