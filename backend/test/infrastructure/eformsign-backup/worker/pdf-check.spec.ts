import { promises as fs } from "node:fs";
import path from "node:path";

import { assertPdfFile, checkPdfFile } from "infrastructure/eformsign-backup/worker/pdf-check";

import { makeTestBase } from "./helpers/destination-support";
import { buildMinimalPdf } from "./helpers/pdf-fixture-minimal";

describe("pdf-check", () => {
    let base: string;
    beforeAll(async () => { base = await makeTestBase(); });
    afterAll(async () => { await fs.rm(base, { recursive: true, force: true }); });

    async function check(bytes: Uint8Array) {
        const file = await fs.open(path.join(base, `f-${Math.random().toString(16).slice(2)}`), "w+");
        try {
            await file.write(bytes);
            return { result: await checkPdfFile(file), assertion: await assertPdfFile(file).then(() => "ok", (e: { reasonCode: string }) => e.reasonCode) };
        } finally { await file.close(); }
    }

    it("should accept a minimal valid PDF", async () => {
        expect(await check(buildMinimalPdf())).toEqual({ result: { ok: true }, assertion: "ok" });
    });
    it("should accept a large PDF whose trailer is inside the tail window", async () => {
        const pdf = buildMinimalPdf("big");
        const prefixPadded = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(5000, 0x25), pdf.subarray(9)]);
        expect((await check(prefixPadded)).result).toEqual({ ok: true });
    });
    it("should reject a PDF whose startxref is pushed out of the last 1024 bytes", async () => {
        const padded = Buffer.concat([buildMinimalPdf("big"), Buffer.alloc(5000, 0x20)]);
        expect((await check(padded)).result).toMatchObject({ ok: false });
    });
    it.each([
        ["non-PDF bytes", Buffer.alloc(200, 0x41), "bad-header"],
        ["too short", Buffer.from("%PDF-1.4\nstartxref\n%%EOF\n"), "too-short"],
        ["no startxref", Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(100, 0x20), Buffer.from("%%EOF\n")]), "missing-startxref"],
        ["no EOF", Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(100, 0x20), Buffer.from("startxref\n12\n")]), "missing-eof"],
        ["empty", Buffer.alloc(0), "too-short"],
    ])("should reject %s", async (_name, bytes, reason) => {
        const { result, assertion } = await check(bytes);
        expect(result).toEqual({ ok: false, reason });
        expect(assertion).toBe("pdf-shape");
    });
});
