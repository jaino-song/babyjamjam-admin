import { WorkerError } from "./worker-error";

/** Contract W5: "PDF shape" only. Content equality is proven by sha256, never by this check. */
export const PDF_MIN_LENGTH = 64;
export const PDF_TAIL_WINDOW = 1024;
const HEADER = "%PDF-";

export type PdfShapeResult =
    | { ok: true }
    | { ok: false; reason: "too-short" | "bad-header" | "tail-incomplete" | "missing-startxref" | "missing-eof" | "eof-before-startxref" };

function latin1(bytes: Uint8Array): string {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("latin1");
}

/**
 * `head` holds the first bytes of the file (at least 5), `tail` its last bytes (up to 1024 are used) and `length`
 * its full size. The file must start with `%PDF-`, be at least 64 bytes, and carry `startxref` followed by `%%EOF`
 * inside its last 1024 bytes.
 */
export function checkPdfShape(head: Uint8Array, tail: Uint8Array, length: number): PdfShapeResult {
    if (!Number.isSafeInteger(length) || length < PDF_MIN_LENGTH) return { ok: false, reason: "too-short" };
    if (head.byteLength < HEADER.length || latin1(head.subarray(0, HEADER.length)) !== HEADER) {
        return { ok: false, reason: "bad-header" };
    }
    if (tail.byteLength < Math.min(length, PDF_TAIL_WINDOW)) return { ok: false, reason: "tail-incomplete" };
    const window = latin1(tail.subarray(Math.max(0, tail.byteLength - PDF_TAIL_WINDOW)));
    const startxref = window.lastIndexOf("startxref");
    if (startxref < 0) return { ok: false, reason: "missing-startxref" };
    if (window.indexOf("%%EOF", startxref) < 0) {
        return { ok: false, reason: window.includes("%%EOF") ? "eof-before-startxref" : "missing-eof" };
    }
    return { ok: true };
}

export function assertPdfShape(head: Uint8Array, tail: Uint8Array, length: number): void {
    if (!checkPdfShape(head, tail, length).ok) throw new WorkerError("pdf-shape");
}
