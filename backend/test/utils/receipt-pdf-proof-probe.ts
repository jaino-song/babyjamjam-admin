import { readFileSync } from "node:fs";
import {
    PdfJsReceiptPdfTextExtractor,
    ReceiptPdfVerifierService,
    type ReceiptPdfVerificationInput,
} from "../../infrastructure/pdf/receipt-pdf-verifier.service";

/** Test-only native Node boundary for the installed ESM PDF parser. No app/DB bootstrap. */
async function main(): Promise<void> {
    const input = JSON.parse(readFileSync(0, "utf8")) as {
        pdf: string;
        scope: ReceiptPdfVerificationInput["scope"];
        expected: ReceiptPdfVerificationInput["expected"];
    };
    const pdf = Buffer.from(input.pdf, "base64");
    const extractor = new PdfJsReceiptPdfTextExtractor();
    // Surface parser errors directly instead of reducing them to an unverified result.
    await extractor.extract(pdf);
    const service = new ReceiptPdfVerifierService(extractor);
    const result = await service.verify({ ...input, pdf });
    process.stdout.write(`${JSON.stringify(result)}\n`);
}

void main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : "PDF probe failed"}\n`);
    process.exitCode = 1;
});
