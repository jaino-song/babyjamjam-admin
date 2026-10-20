import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { checkPdfShape } from "domain/eformsign-backup/worker";

import { pdfjsPageCount } from "./helpers/pdfjs-open";
import { buildMinimalPdf } from "./helpers/pdf-fixture-minimal";

describe("pdf fixtures", () => {
    let root: string;
    beforeAll(async () => { root = await fs.mkdtemp(path.join(homedir(), "bjj455-pdf-fixture-")); });
    afterAll(async () => { await fs.rm(root, { recursive: true, force: true }); });

    it.each(["a", "b", "synthetic"])("should build a PDF that passes the worker check and opens in pdfjs (%s)", async seed => {
        const pdf = buildMinimalPdf(seed);
        expect(checkPdfShape(pdf.subarray(0, 5), pdf.subarray(Math.max(0, pdf.length - 1024)), pdf.length)).toEqual({ ok: true });
        const file = path.join(root, `${seed}.pdf`);
        await fs.writeFile(file, pdf, { mode: 0o600 });
        // pdfjs runs in its own process; importing it inside the Jest VM breaks when workers are shared.
        expect(await pdfjsPageCount(file)).toBeGreaterThanOrEqual(1);
    }, 60_000);
    it("should make different seeds produce different bytes", () => {
        expect(buildMinimalPdf("a").equals(buildMinimalPdf("b"))).toBe(false);
    });
});
