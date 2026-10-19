import { checkPdfShape } from "domain/eformsign-backup/worker";

import { buildMinimalPdf } from "./helpers/pdf-fixture-minimal";

const importEsm = new Function("specifier", "return import(specifier)") as (specifier: string) => Promise<unknown>;

describe("pdf fixtures", () => {
    it.each(["a", "b", "synthetic"])("should build a PDF that passes the worker check and opens in pdfjs (%s)", async seed => {
        const pdf = buildMinimalPdf(seed);
        expect(checkPdfShape(pdf.subarray(0, 5), pdf.subarray(Math.max(0, pdf.length - 1024)), pdf.length)).toEqual({ ok: true });
        const pdfjs = await importEsm("pdfjs-dist/legacy/build/pdf.mjs") as {
            getDocument: (options: object) => { promise: Promise<{ numPages: number; destroy: () => Promise<void> }> };
        };
        const document = await pdfjs.getDocument({ data: new Uint8Array(pdf), useSystemFonts: false, isEvalSupported: false }).promise;
        try { expect(document.numPages).toBeGreaterThanOrEqual(1); } finally { await document.destroy(); }
    });
    it("should make different seeds produce different bytes", () => {
        expect(buildMinimalPdf("a").equals(buildMinimalPdf("b"))).toBe(false);
    });
});
