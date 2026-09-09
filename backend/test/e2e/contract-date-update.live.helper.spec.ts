import {
    CONTRACT_DATE_UPDATE_BASELINE_END_DATE,
    CONTRACT_DATE_UPDATE_BASELINE_MONEY,
    CONTRACT_DATE_UPDATE_BASELINE_RECEIPT_PERIOD,
    CONTRACT_DATE_UPDATE_DOCUMENT_ID,
    CONTRACT_DATE_UPDATE_DOCUMENT_TITLE,
    CONTRACT_DATE_UPDATE_PAYMENT_DATE,
    CONTRACT_DATE_UPDATE_TEMPLATE_ID,
    downloadContractDatePdf,
    immutableEvidenceEqual,
    readContractDateEvidence,
    type ContractDateEvidence,
    verifyBaselineEvidence,
} from "./helpers/contract-date-update.live.helper";

function reviewedEvidence(): ContractDateEvidence {
    return {
        id: CONTRACT_DATE_UPDATE_DOCUMENT_ID,
        title: CONTRACT_DATE_UPDATE_DOCUMENT_TITLE,
        templateId: CONTRACT_DATE_UPDATE_TEMPLATE_ID,
        statusType: "001",
        stepType: "05",
        stepName: "제공기관 확인",
        endDate: CONTRACT_DATE_UPDATE_BASELINE_END_DATE,
        receiptPeriods: [CONTRACT_DATE_UPDATE_BASELINE_RECEIPT_PERIOD],
        paymentDate: CONTRACT_DATE_UPDATE_PAYMENT_DATE,
        moneyFields: {
            "서비스 비용": [CONTRACT_DATE_UPDATE_BASELINE_MONEY["서비스 비용"]],
            "정부지원금": [CONTRACT_DATE_UPDATE_BASELINE_MONEY["정부지원금"]],
            "본인부담금": [CONTRACT_DATE_UPDATE_BASELINE_MONEY["본인부담금"]],
        },
        signatureHashes: ["a".repeat(64)],
        componentNames: ["이용자 서명"],
        signatureComponentNames: ["이용자 서명"],
        signatureComponentResults: [{ name: "이용자 서명", valueHash: "a".repeat(64), valueLength: 128 }],
        pdf: {
            sha256: "b".repeat(64),
            byteLength: 123,
            pageCount: 9,
            hasEndDate: true,
            hasReceiptPeriod: true,
            receiptPeriodOccurrences: 2,
            hasOldEndDate: false,
            hasOldReceiptPeriod: false,
            oldReceiptPeriodOccurrences: 0,
            exportedPdfStale: false,
        },
    };
}

describe("contract date update live helper guards", () => {
    it("accepts only the exact reviewed baseline evidence", () => {
        expect(verifyBaselineEvidence(reviewedEvidence())).toEqual({
            status: "pass",
            value: reviewedEvidence(),
        });
    });

    it("classifies an old exported PDF as stale instead of pass", () => {
        const evidence = reviewedEvidence();
        evidence.pdf = {
            ...evidence.pdf,
            hasEndDate: false,
            hasReceiptPeriod: false,
            hasOldEndDate: true,
            hasOldReceiptPeriod: true,
            oldReceiptPeriodOccurrences: 3,
            exportedPdfStale: true,
        };
        expect(verifyBaselineEvidence(evidence)).toEqual({
            status: "not_verified",
            reason: expect.stringContaining("exported_pdf_stale"),
        });
    });

    it("refuses a baseline with no hashed user signature", () => {
        const evidence = reviewedEvidence();
        evidence.signatureHashes = [];
        expect(verifyBaselineEvidence(evidence)).toEqual({
            status: "not_verified",
            reason: expect.stringContaining("signature"),
        });
    });

    it("rejects contradictory receipt periods instead of trusting the expected value", () => {
        const evidence = reviewedEvidence();
        evidence.receiptPeriods = [CONTRACT_DATE_UPDATE_BASELINE_RECEIPT_PERIOD, "20260709~20270105"];
        expect(verifyBaselineEvidence(evidence)).toEqual({
            status: "not_verified",
            reason: expect.stringContaining("contradictory"),
        });
    });

    it("rejects contradictory money values instead of trusting the first value", () => {
        const evidence = reviewedEvidence();
        evidence.moneyFields["서비스 비용"] = [CONTRACT_DATE_UPDATE_BASELINE_MONEY["서비스 비용"], "999999"];
        expect(verifyBaselineEvidence(evidence)).toEqual({
            status: "not_verified",
            reason: expect.stringContaining("money fields"),
        });
    });

    it("rejects a PDF containing both old and new date markers", () => {
        const evidence = reviewedEvidence();
        evidence.pdf = {
            ...evidence.pdf,
            hasOldEndDate: true,
        };
        expect(verifyBaselineEvidence(evidence)).toEqual({
            status: "not_verified",
            reason: expect.stringContaining("contradictory"),
        });
    });

    it("keeps immutable evidence mismatches red after a hypothetical save", () => {
        const before = reviewedEvidence();
        const after = reviewedEvidence();
        after.paymentDate = "2026-07-10";
        expect(immutableEvidenceEqual(before, after)).toBe(false);
    });

    it("rejects any document id outside the allowlist before network reads", async () => {
        const client = {
            getAccessToken: jest.fn(),
            getDocument: jest.fn(),
        };
        const reader = { downloadDocumentFile: jest.fn() };
        await expect(readContractDateEvidence(
            client,
            reader,
            "access-token",
            "unreviewed-document",
        )).rejects.toMatchObject({ name: "NotVerifiedError" });
        expect(client.getDocument).not.toHaveBeenCalled();
        expect(reader.downloadDocumentFile).not.toHaveBeenCalled();
    });

    it("rejects an unreviewed document id before a direct PDF read", async () => {
        const reader = { downloadDocumentFile: jest.fn() };
        await expect(downloadContractDatePdf(
            reader,
            "access-token",
            "unreviewed-document",
        )).rejects.toMatchObject({ name: "NotVerifiedError" });
        expect(reader.downloadDocumentFile).not.toHaveBeenCalled();
    });
});
