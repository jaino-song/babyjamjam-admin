import { deflateSync } from "node:zlib";

export const RECEIPT_WIDTH = 2481;
export const RECEIPT_HEIGHT = 3508;
export const RECEIPT_DPI = 300;

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
    let crc = index;
    for (let bit = 0; bit < 8; bit++) {
        crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    return crc;
});

function pngCrc(bytes: Buffer): number {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff]!;
    }
    return (crc ^ 0xffffffff) >>> 0;
}

export function isReceiptPng(bytes: Buffer): boolean {
    if (bytes.length < 33 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)
        || bytes.readUInt32BE(8) !== 13 || bytes.toString("ascii", 12, 16) !== "IHDR"
        || bytes.readUInt32BE(16) !== RECEIPT_WIDTH || bytes.readUInt32BE(20) !== RECEIPT_HEIGHT) {
        return false;
    }

    // Reject truncated or damaged chunks before passing the buffer to the native decoder.
    let hasImageData = false;
    for (let start = PNG_SIGNATURE.length; start + 12 <= bytes.length;) {
        const length = bytes.readUInt32BE(start);
        const dataEnd = start + 8 + length;
        const end = dataEnd + 4;
        if (end > bytes.length || pngCrc(bytes.subarray(start + 4, dataEnd)) !== bytes.readUInt32BE(dataEnd)) {
            return false;
        }
        const type = bytes.toString("ascii", start + 4, start + 8);
        if (type === "IEND") {
            return hasImageData && length === 0 && end === bytes.length;
        }
        hasImageData ||= type === "IDAT" && length > 0;
        start = end;
    }
    return false;
}

function pngChunk(type: string, data: Buffer): Buffer {
    const chunk = Buffer.allocUnsafe(data.length + 12);
    chunk.writeUInt32BE(data.length, 0);
    chunk.write(type, 4, "ascii");
    data.copy(chunk, 8);
    chunk.writeUInt32BE(pngCrc(chunk.subarray(4, -4)), chunk.length - 4);
    return chunk;
}

/** Canvas encodes PNG as RGBA even for an opaque surface. Write RGB scanlines from its opaque pixels. */
export function encodeReceiptRgbPng(rgba: Uint8ClampedArray): Buffer {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(RECEIPT_WIDTH, 0);
    header.writeUInt32BE(RECEIPT_HEIGHT, 4);
    header[8] = 8;
    header[9] = 2; // PNG truecolor (RGB).

    const density = Buffer.alloc(9);
    const pixelsPerMeter = Math.round(RECEIPT_DPI / 0.0254);
    density.writeUInt32BE(pixelsPerMeter, 0);
    density.writeUInt32BE(pixelsPerMeter, 4);
    density[8] = 1; // Pixels per meter.

    const scanlines = Buffer.allocUnsafe((1 + 3 * RECEIPT_WIDTH) * RECEIPT_HEIGHT);
    let source = 0;
    let target = 0;
    for (let row = 0; row < RECEIPT_HEIGHT; row++) {
        scanlines[target++] = 1; // PNG Sub filter: difference from the left pixel.
        let red = 0;
        let green = 0;
        let blue = 0;
        for (let column = 0; column < RECEIPT_WIDTH; column++) {
            // The caller supplies a full receipt-sized canvas, with four bytes per pixel.
            const nextRed = rgba[source]!;
            const nextGreen = rgba[source + 1]!;
            const nextBlue = rgba[source + 2]!;
            scanlines[target++] = nextRed - red;
            scanlines[target++] = nextGreen - green;
            scanlines[target++] = nextBlue - blue;
            red = nextRed;
            green = nextGreen;
            blue = nextBlue;
            source += 4;
        }
    }

    return Buffer.concat([
        PNG_SIGNATURE,
        pngChunk("IHDR", header),
        pngChunk("pHYs", density),
        pngChunk("IDAT", deflateSync(scanlines)),
        pngChunk("IEND", Buffer.alloc(0)),
    ]);
}
