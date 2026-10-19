import type { FileHandle } from "node:fs/promises";

import { PDF_TAIL_WINDOW, WorkerError, checkPdfShape, type PdfShapeResult } from "domain/eformsign-backup/worker";

const HEAD_BYTES = 5;

async function readAt(file: FileHandle, position: number, length: number): Promise<Buffer> {
    const buffer = Buffer.alloc(length);
    let filled = 0;
    while (filled < length) {
        const { bytesRead } = await file.read(buffer, filled, length - filled, position + filled);
        if (bytesRead === 0) break;
        filled += bytesRead;
    }
    return buffer.subarray(0, filled);
}

/** Contract W5 on an open file: its first 5 bytes, its last 1024 bytes and its size go to the domain shape check. */
export async function checkPdfFile(file: FileHandle): Promise<PdfShapeResult> {
    const { size } = await file.stat();
    const head = await readAt(file, 0, Math.min(size, HEAD_BYTES));
    const tailLength = Math.min(size, PDF_TAIL_WINDOW);
    const tail = await readAt(file, size - tailLength, tailLength);
    return checkPdfShape(head, tail, size);
}

export async function assertPdfFile(file: FileHandle): Promise<void> {
    if (!(await checkPdfFile(file)).ok) throw new WorkerError("pdf-shape");
}
