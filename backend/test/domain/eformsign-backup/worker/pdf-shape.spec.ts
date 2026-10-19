import { PDF_TAIL_WINDOW, assertPdfShape, checkPdfShape } from "domain/eformsign-backup/worker";

const enc = (text: string) => Uint8Array.from(Buffer.from(text, "latin1"));

/** A synthetic PDF-shaped buffer: header, filler, then the given trailer. */
function pdf(trailer: string, filler = 200): Uint8Array {
    return enc(`%PDF-1.7\n${"x".repeat(filler)}\n${trailer}`);
}
function check(bytes: Uint8Array) {
    return checkPdfShape(bytes.subarray(0, 1024), bytes.subarray(Math.max(0, bytes.byteLength - PDF_TAIL_WINDOW)), bytes.byteLength);
}

describe("checkPdfShape (contract W5)", () => {
    it("accepts a header with startxref followed by %%EOF in the last 1024 bytes", () => {
        expect(check(pdf("startxref\n123\n%%EOF\n"))).toEqual({ ok: true });
        expect(check(pdf("startxref\n123\n%%EOF"))).toEqual({ ok: true });
    });

    it("accepts when startxref sits exactly inside the tail window of a large file", () => {
        const big = pdf("startxref\n9\n%%EOF\n", 50_000);
        expect(check(big)).toEqual({ ok: true });
    });

    it("rejects a file shorter than 64 bytes", () => {
        expect(check(enc("%PDF-1.7\nstartxref\n1\n%%EOF\n"))).toEqual({ ok: false, reason: "too-short" });
        expect(checkPdfShape(new Uint8Array(0), new Uint8Array(0), 0)).toEqual({ ok: false, reason: "too-short" });
    });

    it("rejects a wrong or missing header", () => {
        const body = `${"x".repeat(200)}\nstartxref\n1\n%%EOF\n`;
        expect(check(enc(`%PDX-1.7\n${body}`))).toEqual({ ok: false, reason: "bad-header" });
        expect(check(enc(`  %PDF-1.7\n${body}`))).toEqual({ ok: false, reason: "bad-header" });
        expect(check(enc(`%pdf-1.7\n${body}`))).toEqual({ ok: false, reason: "bad-header" });
        expect(checkPdfShape(enc("%PDF"), enc("startxref %%EOF".padStart(1024, " ")), 4096)).toEqual({ ok: false, reason: "bad-header" });
    });

    it("rejects a missing startxref or %%EOF", () => {
        expect(check(pdf("%%EOF\n"))).toEqual({ ok: false, reason: "missing-startxref" });
        expect(check(pdf("startxref\n123\n"))).toEqual({ ok: false, reason: "missing-eof" });
    });

    it("rejects %%EOF that comes before startxref", () => {
        expect(check(pdf("%%EOF\nstartxref\n123\n"))).toEqual({ ok: false, reason: "eof-before-startxref" });
    });

    it("rejects startxref that is further than 1024 bytes from the end", () => {
        const bytes = pdf(`startxref\n1\n%%EOF\n${"y".repeat(1100)}`);
        expect(check(bytes)).toEqual({ ok: false, reason: "missing-startxref" });
    });

    it("rejects a tail shorter than the window the file requires", () => {
        const bytes = pdf("startxref\n123\n%%EOF\n", 5000);
        expect(checkPdfShape(bytes.subarray(0, 8), bytes.subarray(bytes.byteLength - 10), bytes.byteLength))
            .toEqual({ ok: false, reason: "tail-incomplete" });
    });

    it("uses only the last 1024 bytes of an oversized tail argument", () => {
        const bytes = pdf(`startxref\n1\n%%EOF\n${"y".repeat(1100)}`);
        expect(checkPdfShape(bytes, bytes, bytes.byteLength)).toEqual({ ok: false, reason: "missing-startxref" });
    });

    it("assertPdfShape throws pdf-shape", () => {
        expect(() => assertPdfShape(enc("nope"), enc("nope"), 4)).toThrow(expect.objectContaining({ reasonCode: "pdf-shape" }));
        const ok = pdf("startxref\n1\n%%EOF\n");
        expect(() => assertPdfShape(ok, ok, ok.byteLength)).not.toThrow();
    });
});
