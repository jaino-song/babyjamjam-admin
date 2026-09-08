import { createHash } from "node:crypto";

import {
    PdfJsReceiptPdfTextExtractor,
    ReceiptPdfVerifierService,
    ReceiptPdfTextExtractor,
    ReceiptPdfTextExtraction,
} from "infrastructure/pdf/receipt-pdf-verifier.service";

const PDF = Buffer.from("%PDF-1.7\nreceipt-proof-fixture\n%%EOF");
const SCOPE = {
    branchId: "11111111-1111-1111-1111-111111111111",
    clientId: 7,
    revisionId: "revision-1",
    documentId: "document-1",
    generation: "generation-1",
    mirrorGeneration: "mirror-1",
    templateId: "template-1",
    templateVersion: 3,
};
const EXPECTED = {
    serviceStartDate: "2026-08-01",
    serviceEndDate: "2026-08-14",
    receivedDate: "2026-08-02",
    amount: 123000,
};

class FakeReceiptPdfTextExtractor implements ReceiptPdfTextExtractor {
    constructor(private readonly extraction: ReceiptPdfTextExtraction) {}

    async extract(pdf: Buffer): Promise<ReceiptPdfTextExtraction> {
        void pdf;
        return this.extraction;
    }
}

function extraction(text: string): ReceiptPdfTextExtraction {
    return { pageCount: 1, pages: [{ text, fields: [] }] };
}

function createService(text: string): ReceiptPdfVerifierService {
    return new ReceiptPdfVerifierService(new FakeReceiptPdfTextExtractor(extraction(text)));
}

function utf16Hex(value: string): string {
    return `<FEFF${Array.from(value).map((character) => (
        (character.codePointAt(0) ?? 0).toString(16).padStart(4, "0").toUpperCase()
    )).join("")}>`;
}

/** A local AcroForm fixture keeps one test on the installed pdfjs extraction path. */
function localReceiptPdf(): Buffer {
    const objects: string[] = [];
    objects[1] = "<< /Type /Catalog /Pages 2 0 R /AcroForm 6 0 R >>";
    objects[2] = "<< /Type /Pages /Kids [3 0 R] /Count 1 >>";
    objects[3] = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Annots [7 0 R 8 0 R 9 0 R] >>";
    objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
    objects[5] = "<< /Length 0 >>\nstream\n\nendstream";
    objects[6] = "<< /Fields [7 0 R 8 0 R 9 0 R] >>";
    objects[7] = `<< /FT /Tx /T ${utf16Hex("서비스 기간")} /V ${utf16Hex("2026-08-01~2026-08-14")} /Type /Annot /Subtype /Widget /Rect [0 0 1 1] /P 3 0 R >>`;
    objects[8] = `<< /FT /Tx /T ${utf16Hex("본인부담금 수령일")} /V ${utf16Hex("2026-08-02")} /Type /Annot /Subtype /Widget /Rect [0 0 1 1] /P 3 0 R >>`;
    objects[9] = `<< /FT /Tx /T ${utf16Hex("본인부담금")} /V ${utf16Hex("123000")} /Type /Annot /Subtype /Widget /Rect [0 0 1 1] /P 3 0 R >>`;

    let pdf = "%PDF-1.7\n";
    const offsets: number[] = [0];
    for (let index = 1; index < objects.length; index += 1) {
        offsets[index] = Buffer.byteLength(pdf);
        pdf += `${index} 0 obj\n${objects[index]}\nendobj\n`;
    }
    const xrefOffset = Buffer.byteLength(pdf);
    pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
    for (let index = 1; index < objects.length; index += 1) {
        pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
    }
    pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    return Buffer.from(pdf, "binary");
}

function input(overrides: Partial<Parameters<ReceiptPdfVerifierService["verify"]>[0]> = {}) {
    return {
        pdf: PDF,
        scope: SCOPE,
        expected: EXPECTED,
        verifiedAt: new Date("2026-09-08T03:00:00.000Z"),
        ...overrides,
    };
}

describe("ReceiptPdfVerifierService", () => {
    it("requires one scoped match for the service period, received date, and unchanged amount", async () => {
        const service = createService(
            "서비스 기간 2026-08-01~2026-08-14 본인부담금 수령일 2026년 08월 02일 본인부담금 123,000원",
        );

        await expect(service.verify(input())).resolves.toEqual({
            status: "verified",
            officialPdfSha256: createHash("sha256").update(PDF).digest("hex"),
            verifiedAt: new Date("2026-09-08T03:00:00.000Z"),
            pageCount: 1,
            scope: SCOPE,
            expected: EXPECTED,
        });
    });

    it("uses installed pdfjs to extract local receipt fields before accepting proof", async () => {
        const service = new ReceiptPdfVerifierService(new PdfJsReceiptPdfTextExtractor());
        const pdf = localReceiptPdf();

        const result = await service.verify(input({ pdf }));
        expect(result).toMatchObject({
            status: "verified",
            officialPdfSha256: createHash("sha256").update(pdf).digest("hex"),
            pageCount: 1,
        });
    });

    it("stays capability_unverified when a scoped field label is missing", async () => {
        await expect(createService("서비스 기간 2026-08-01~2026-08-14 본인부담금 수령일 2026-08-02").verify(input())).resolves.toEqual({
            status: "capability_unverified",
            reason: "missing_field",
        });
    });

    it.each([
        ["wrong period", "서비스 기간 2026-08-02~2026-08-14 본인부담금 수령일 2026-08-02 본인부담금 123,000원"],
        ["wrong received date", "서비스 기간 2026-08-01~2026-08-14 본인부담금 수령일 2026-08-03 본인부담금 123,000원"],
        ["wrong amount", "서비스 기간 2026-08-01~2026-08-14 본인부담금 수령일 2026-08-02 본인부담금 124,000원"],
    ] as const)("stays capability_unverified for %s", async (_label, text) => {
        await expect(createService(text).verify(input())).resolves.toEqual({
            status: "capability_unverified",
            reason: "mismatched_field",
        });
    });

    it("fails closed when a matching field is repeated or appears in two template sections", async () => {
        const service = createService(
            "서비스 기간 2026-08-01~2026-08-14 본인부담금 수령일 2026-08-02 본인부담금 123,000원 "
            + "서비스 기간 2026-08-01~2026-08-14 본인부담금 수령일 2026-08-02 본인부담금 123,000원",
        );

        await expect(service.verify(input())).resolves.toEqual({
            status: "capability_unverified",
            reason: "ambiguous_field",
        });
    });

    it.each([
        ["extractor error", new Error("provider bytes unavailable"), "extraction_unavailable"],
        ["empty output", null, "unsupported_template"],
    ] as const)("does not label %s as proof", async (_label, errorOrNull, reason) => {
        const extractor: ReceiptPdfTextExtractor = {
            extract: errorOrNull
                ? jest.fn().mockRejectedValue(errorOrNull)
                : jest.fn().mockResolvedValue(extraction("")),
        };
        const service = new ReceiptPdfVerifierService(extractor);

        await expect(service.verify(input())).resolves.toEqual({
            status: "capability_unverified",
            reason,
        });
    });

    it("fails closed when an extractor returns malformed page metadata", async () => {
        const extractor: ReceiptPdfTextExtractor = {
            extract: jest.fn().mockResolvedValue({ pageCount: 1, pages: [{ text: "ok", fields: [{ name: "period", value: 7 }] }] }),
        };

        await expect(new ReceiptPdfVerifierService(extractor).verify(input())).resolves.toEqual({
            status: "capability_unverified",
            reason: "invalid_pdf",
        });
    });

    it("rejects malformed scope, expected fields, and PDF input before extraction", async () => {
        const extractor = { extract: jest.fn().mockResolvedValue(extraction("unused")) };
        const service = new ReceiptPdfVerifierService(extractor);

        await expect(service.verify(input({ pdf: Buffer.from("not-pdf") }))).resolves.toEqual({
            status: "capability_unverified",
            reason: "invalid_pdf",
        });
        await expect(service.verify(input({ scope: { ...SCOPE, generation: "" } }))).resolves.toEqual({
            status: "capability_unverified",
            reason: "invalid_scope",
        });
        await expect(service.verify(input({ expected: { ...EXPECTED, amount: "not-an-amount" } }))).resolves.toEqual({
            status: "capability_unverified",
            reason: "invalid_expected_fields",
        });
        await expect(service.verify(input({ expected: { ...EXPECTED, serviceStartDate: EXPECTED.serviceEndDate, serviceEndDate: EXPECTED.serviceStartDate } }))).resolves.toEqual({
            status: "capability_unverified",
            reason: "invalid_expected_fields",
        });
        expect(extractor.extract).not.toHaveBeenCalled();
    });

    it("accepts annotation field values only when they remain inside the same scoped extraction", async () => {
        const extractor: ReceiptPdfTextExtractor = {
            extract: jest.fn().mockResolvedValue({
                pageCount: 1,
                pages: [{
                    text: "서비스 기간 본인부담금 수령일 본인부담금",
                    fields: [
                        { name: "서비스 기간", value: "2026-08-01~2026-08-14" },
                        { name: "본인부담금 수령일", value: "2026-08-02" },
                        { name: "본인부담금", value: "123000" },
                    ],
                }],
            }),
        };
        const service = new ReceiptPdfVerifierService(extractor);

        await expect(service.verify(input())).resolves.toMatchObject({ status: "verified" });
    });
});
