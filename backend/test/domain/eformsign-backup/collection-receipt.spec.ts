import { CollectionReceipt, evaluateCollectionReceipt, documentIdSetDigest } from "domain/eformsign-backup/collection-receipt";

const digest = "a".repeat(64);
function receipt(): CollectionReceipt {
    return {
        companyId: "company-1", visibility: "unknown", outcome: "succeeded", startAck: "acknowledged", finalAck: "acknowledged",
        scans: (["01", "03", "04"] as const).flatMap(documentType => ([1, 2] as const).map(pass => ({
            documentType, pass, distinctIdCount: 2, documentIdSetSha256: digest,
            pages: [0, 1].map(ordinal => ({ ordinal, startOffset: ordinal, requestedLimit: 1, returnedCount: 1, totalCount: 2, terminal: ordinal === 1, outcome: "succeeded" as const, persistenceAck: "acknowledged" as const })),
        }))),
    };
}
const evaluate = (input: unknown) => evaluateCollectionReceipt(input);

describe("collection receipt v1", () => {
    it("freezes a domain-separated sorted distinct-ID set digest", () => {
        expect(documentIdSetDigest(["doc-2", "doc-1", "doc-1"])).toBe("ebd5670792e43ed1739374172298df8d8b814290b141a557d96f46986f1be853");
        expect(documentIdSetDigest(["doc-1", "doc-2"])).toBe(documentIdSetDigest(["doc-2", "doc-1"]));
    });
    it("observes six healthy scans but always leaves company coverage unverified", () => {
        expect(evaluate(receipt())).toMatchObject({ observedScan: "complete", companyCoverage: "unverified", reasons: ["company-visibility-unknown", "provider-consistency-unverified"] });
        const known = receipt(); known.visibility = "declared-company-wide";
        expect(evaluate(known)).toMatchObject({ observedScan: "complete", companyCoverage: "unverified", reasons: ["provider-consistency-unverified"] });
    });
    it("reports page2 failure using fixed flags, never raw errors or identifiers", () => {
        const input = receipt(); input.scans[0]!.pages[1]!.outcome = "failed";
        const result = evaluate({ ...input, rawError: "private-provider-error", documentIds: ["private-doc"] });
        expect(result.observedScan).toBe("incomplete");
        expect(result.reasons).toContain("page-failed");
        expect(JSON.stringify(result)).not.toMatch(/private|company-1/);
    });
    it("rejects matching counts with different repeated-pass digests", () => {
        const input = receipt(); input.scans[1]!.documentIdSetSha256 = "b".repeat(64);
        expect(evaluate(input).reasons).toContain("repeat-set-mismatch");
    });
    it.each(["failed", "pending"] as const)("does not complete interrupted persistence %s", ack => {
        for (const stage of ["start", "page", "final"]) {
            const input = receipt();
            if (stage === "start") input.startAck = ack;
            if (stage === "final") input.finalAck = ack;
            if (stage === "page") input.scans[0]!.pages[0]!.persistenceAck = ack;
            expect(evaluate(input).observedScan).toBe("incomplete");
        }
    });
    it("requires every type and both passes without duplicate scans", () => {
        const missing = receipt(); missing.scans.pop();
        expect(evaluate(missing).reasons).toContain("scan-set-incomplete");
        const duplicate = receipt(); duplicate.scans.push(duplicate.scans[0]!);
        expect(evaluate(duplicate).reasons).toContain("scan-set-incomplete");
    });
    it.each(["ordinal", "startOffset", "returnedCount", "totalCount", "requestedLimit"] as const)("rejects malformed page count/position %s", field => {
        const input = receipt(); input.scans[0]!.pages[1]![field] = -1;
        expect(evaluate(input).observedScan).toBe("incomplete");
    });
    it("requires contiguous actual starts and ordinals, terminal evidence and distinct counts", () => {
        for (const mutate of [
            (r: CollectionReceipt) => { r.scans[0]!.pages[1]!.startOffset = 2; },
            (r: CollectionReceipt) => { r.scans[0]!.pages[1]!.ordinal = 2; },
            (r: CollectionReceipt) => { r.scans[0]!.pages[1]!.terminal = false; },
            (r: CollectionReceipt) => { r.scans[0]!.distinctIdCount = 1; },
            (r: CollectionReceipt) => { r.scans[0]!.pages[0]!.terminal = true; },
        ]) {
            const input = receipt(); mutate(input);
            expect(evaluate(input).observedScan).toBe("incomplete");
        }
    });
    it("keeps changing totals incomplete even with a supplied explanation", () => {
        const input = receipt(); input.scans[0]!.pages[0]!.totalCount = 3;
        expect(evaluate(input).observedScan).toBe("incomplete");
        input.scans[0]!.pages[1]!.totalChangeReason = "provider-total-changed";
        expect(evaluate(input).observedScan).toBe("incomplete");
    });
    it("accepts an explicitly observed empty terminal page", () => {
        const input = receipt();
        for (const scan of input.scans) {
            scan.distinctIdCount = 0; scan.documentIdSetSha256 = documentIdSetDigest([]);
            scan.pages = [{ ordinal: 0, startOffset: 0, requestedLimit: 100, returnedCount: 0, totalCount: 0, terminal: true, outcome: "succeeded", persistenceAck: "acknowledged" }];
        }
        expect(evaluate(input).observedScan).toBe("complete");
    });
    it.each([null, {}, { scans: [] }, { companyId: "../unsafe" }, { x: undefined }, { scans: new Date() }])("fails closed for malformed receipts %#", input => {
        expect(evaluate(input)).toMatchObject({ observedScan: "incomplete", companyCoverage: "unverified" });
    });
    it("rejects receipt accessors without executing them", () => {
        const get = jest.fn(() => "private-provider-error");
        expect(evaluate(Object.defineProperty(receipt(), "companyId", { get, enumerable: true })).observedScan).toBe("incomplete");
        const ids = Object.defineProperty(["doc-1"], "0", { get, enumerable: true });
        expect(() => documentIdSetDigest(ids)).toThrow("Invalid evidence");
        expect(get).not.toHaveBeenCalled();
    });
    it("preserves run outcome flags for interrupted finalization", () => {
        const input = receipt(); input.outcome = "interrupted";
        expect(evaluate(input).reasons).toContain("run-interrupted");
    });
});
