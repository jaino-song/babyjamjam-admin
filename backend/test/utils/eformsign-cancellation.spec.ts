import { EformsignApiError } from "infrastructure/api/eformsign-api.error";
import {
    classifyEformsignCancellationError,
    classifyEformsignCancellationResult,
    sanitizeEformsignCancellationReceipt,
} from "application/utils/eformsign-cancellation";

describe("eformsign cancellation classification", () => {
    it("classifies per-document success and authoritative refusal without retaining raw fields", () => {
        const outcomes = classifyEformsignCancellationResult({
            result: {
                success_result: ["doc-1"],
                fail_result: [
                    { document_id: "doc-2", code: "4000164", customer_phone: "01099998888" },
                    { document_id: "doc-3", code: "4000031", reason: "ambiguous" },
                ],
                token: "must-not-be-retained",
            },
        }, ["doc-1", "doc-2", "doc-3", "doc-4"]);

        expect(outcomes).toEqual([
            { documentId: "doc-1", decision: "accepted", reason: "provider_cancel_accepted" },
            {
                documentId: "doc-2",
                decision: "authoritative_refusal",
                reason: "provider_cancel_authoritative_refusal:4000164",
                vendorCode: "4000164",
            },
            {
                documentId: "doc-3",
                decision: "uncertain",
                reason: "provider_cancel_uncertain:4000031",
                vendorCode: "4000031",
            },
            {
                documentId: "doc-4",
                decision: "uncertain",
                reason: "provider_cancel_result_missing_document",
            },
        ]);
        expect(JSON.stringify(outcomes)).not.toContain("01099998888");
        expect(JSON.stringify(outcomes)).not.toContain("must-not-be-retained");
    });

    it("keeps absence, ambiguity, throttling and server errors uncertain", () => {
        for (const error of [
            new EformsignApiError("absent", 404, "4000004"),
            new EformsignApiError("ambiguous", 400, "4000031"),
            new EformsignApiError("throttled", 429),
            new EformsignApiError("server", 500),
        ]) {
            expect(classifyEformsignCancellationError(error).decision).toBe("uncertain");
        }
    });

    it("classifies a non-ambiguous provider 4xx as an authoritative refusal", () => {
        const result = classifyEformsignCancellationError(
            new EformsignApiError("forbidden", 403, "4000999"),
        );
        expect(result).toMatchObject({
            decision: "authoritative_refusal",
            vendorCode: "4000999",
        });
    });

    it("emits only a compact receipt", () => {
        expect(sanitizeEformsignCancellationReceipt({
            decision: "accepted",
            documentId: "doc-1",
            vendorCode: "4000164",
            source: "provider-response",
        })).toEqual({
            source: "provider-response",
            documentId: "doc-1",
            decision: "accepted",
            vendorCode: "4000164",
        });
    });
});
