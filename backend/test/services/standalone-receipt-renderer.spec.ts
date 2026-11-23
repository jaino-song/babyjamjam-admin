import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createCanvas, loadImage, type SKRSContext2D } from "@napi-rs/canvas";

import { FileStorageObjectNotFoundError } from "../../domain/ports/file-storage.port";
import {
    StandaloneReceiptRenderer,
    type StandaloneReceiptSnapshot,
} from "../../infrastructure/pdf/standalone-receipt-renderer";
import {
    StandaloneReceiptTemplateLoader,
    StandaloneReceiptTemplateUnavailableError,
} from "../../infrastructure/pdf/standalone-receipt-template.loader";

const WIDTH = 2481;
const HEIGHT = 3508;
const SYNTHETIC = readFileSync(join(__dirname, "../fixtures/standalone-receipt-synthetic.png"));
const SYNTHETIC_PNG_SHA256 = "761b53f9458def3fa7bb8e2d848c9065fa0973406a7e1671c1c84df25d35d630";
const SYNTHETIC_OUTSIDE_BOXES_SHA256 = "796d0d84ce529a68e07b4389f6ea79695656c33caf30c261b56037540c9e684f";
const SNAPSHOT = Object.freeze({
    customerName: "가나다라마바사아자차",
    serviceStartDate: "2000-02-29",
    endDate: "2026-11-23",
    receivedDate: "2026-11-08",
    issueDate: "2099-12-31",
    fullPrice: 99_999_999,
    grant: 12_345,
    actualPrice: 67_890,
}) satisfies StandaloneReceiptSnapshot;

type Box = readonly [left: number, top: number, right: number, bottom: number];

const TOP_BOXES: readonly Box[] = [
    [540, 666, 1170, 736], [575, 745, 1188, 816], [540, 824, 995, 894],
    [460, 998, 635, 1060], [711, 998, 886, 1060], [961, 998, 1136, 1060],
    [715, 1274, 982, 1340],
    [401, 1357, 456, 1420], [516, 1357, 584, 1420], [641, 1357, 744, 1420],
    [572, 1435, 619, 1496], [684, 1435, 780, 1496], [844, 1435, 938, 1496],
];
const BOTTOM_BOXES: readonly Box[] = [
    [540, 2055, 1170, 2125], [575, 2133, 1188, 2204], [540, 2213, 995, 2283],
    [460, 2388, 635, 2448], [711, 2388, 886, 2448], [961, 2388, 1136, 2448],
    [703, 2663, 994, 2729],
    [390, 2743, 467, 2806], [527, 2743, 595, 2806], [652, 2743, 755, 2806],
    [561, 2821, 630, 2886], [695, 2821, 790, 2886], [854, 2821, 949, 2886],
];

async function readPixels(png: Buffer): Promise<Buffer> {
    const image = await loadImage(png);
    const canvas = createCanvas(image.width, image.height);
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    return Buffer.from(context.getImageData(0, 0, image.width, image.height).data.buffer);
}

const pixelOffset = (x: number, y: number): number => 4 * (y * WIDTH + x);

function hashOutsideBoxes(pixels: Buffer): string {
    const hash = createHash("sha256");
    const boxes = [...TOP_BOXES, ...BOTTOM_BOXES];
    for (let y = 0; y < HEIGHT; y++) {
        let x = 0;
        for (const [left, top, right, bottom] of boxes) {
            if (top <= y && y < bottom) {
                hash.update(pixels.subarray(pixelOffset(x, y), pixelOffset(left, y)));
                x = right;
            }
        }
        hash.update(pixels.subarray(pixelOffset(x, y), pixelOffset(WIDTH, y)));
    }
    return hash.digest("hex");
}

function inkBounds(before: Buffer, after: Buffer, [left, top, right, bottom]: Box): Box | undefined {
    let minX = right;
    let minY = bottom;
    let maxX = left - 1;
    let maxY = top - 1;
    for (let y = top; y < bottom; y++) {
        for (let x = left; x < right; x++) {
            const index = pixelOffset(x, y);
            if (before.readUInt32BE(index) !== after.readUInt32BE(index)) {
                minX = Math.min(minX, x);
                minY = Math.min(minY, y);
                maxX = Math.max(maxX, x);
                maxY = Math.max(maxY, y);
            }
        }
    }
    return maxX >= minX ? [minX, minY, maxX + 1, maxY + 1] : undefined;
}

describe("StandaloneReceiptRenderer", () => {
    const renderer = new StandaloneReceiptRenderer();
    let before: Buffer;

    beforeAll(async () => {
        expect(createHash("sha256").update(SYNTHETIC).digest("hex")).toBe(SYNTHETIC_PNG_SHA256);
        before = await readPixels(SYNTHETIC);
        expect(hashOutsideBoxes(before)).toBe(SYNTHETIC_OUTSIDE_BOXES_SHA256);
    });

    it.each([
        { amounts: [0, 0, 0], formatted: ["0", "0", "0"] },
        { amounts: [99_999_999, 12_345, 67_890], formatted: ["99,999,999", "12,345", "67,890"] },
        { amounts: [999_999_999, 999_999_999, 999_999_999], formatted: ["999,999,999", "999,999,999", "999,999,999"] },
    ] as const)("renders $formatted in both copies and preserves all pixels outside the slots", async ({
        amounts: [fullPrice, grant, actualPrice], formatted: [full, subsidy, actual],
    }) => {
        const context: SKRSContext2D = createCanvas(1, 1).getContext("2d");
        const fillText = jest.spyOn(Object.getPrototypeOf(context) as SKRSContext2D, "fillText");
        let output: Buffer;
        try {
            output = await renderer.render(SYNTHETIC, Object.freeze({ ...SNAPSHOT, fullPrice, grant, actualPrice }));
            const expectedCopy = [
                SNAPSHOT.customerName, "2000.02.29 ~ 2026.11.23", full, full, subsidy, actual, actual,
                "26", "11", "08", "99", "12", "31",
            ];
            expect(fillText.mock.calls.map(([text]) => text)).toEqual([...expectedCopy, ...expectedCopy]);
        } finally {
            fillText.mockRestore();
        }

        expect(output.readUInt32BE(16)).toBe(WIDTH);
        expect(output.readUInt32BE(20)).toBe(HEIGHT);
        expect(output.subarray(24, 26)).toEqual(Buffer.from([8, 2])); // 8-bit RGB
        expect(output.toString("ascii", 37, 41)).toBe("pHYs");
        expect(output.readUInt32BE(41)).toBe(11811); // 300 DPI in pixels per meter
        const after = await readPixels(output);
        expect(hashOutsideBoxes(after)).toBe(SYNTHETIC_OUTSIDE_BOXES_SHA256);
        for (const box of [...TOP_BOXES, ...BOTTOM_BOXES]) {
            const bounds = inkBounds(before, after, box);
            if (!bounds) {
                throw new Error(`No ink drawn within ${box.join(", ")}`);
            }
            const [left, top, right, bottom] = bounds;
            expect(left).toBeGreaterThan(box[0]);
            expect(top).toBeGreaterThan(box[1]);
            expect(right).toBeLessThan(box[2]);
            expect(bottom).toBeLessThan(box[3]);
        }
    });

    it.each([
        { customerName: "" },
        { customerName: "가 " },
        { customerName: "\u1100\u1161" },
        { customerName: "가\n나" },
        { customerName: "가\u202e나" },
        { customerName: "가".repeat(1000) },
        { serviceStartDate: "2026-2-09" },
        { serviceStartDate: "2026-02-29" },
        { serviceStartDate: "2026-11-24" },
        { endDate: "2026-04-31" },
        { receivedDate: "1999-12-31" },
        { receivedDate: "2026-00-08" },
        { issueDate: "2100-01-01" },
        { issueDate: "2026-11-23T00:00:00Z" },
        { fullPrice: -1 },
        { fullPrice: 1_000_000_000 },
        { grant: Number.MAX_SAFE_INTEGER + 1 },
        { grant: 0.5 },
        { actualPrice: Number.NaN },
    ])("rejects invalid snapshot %#", async (invalid) => {
        await expect(renderer.render(SYNTHETIC, { ...SNAPSHOT, ...invalid })).rejects.toThrow(RangeError);
    });

    it("refuses text that still exceeds the measured box at 6 points", async () => {
        await expect(renderer.render(SYNTHETIC, { ...SNAPSHOT, customerName: "가".repeat(50) }))
            .rejects.toThrow("customerName does not fit");
    });

    it("refuses missing or unreadable PNG input and unexpected dimensions", async () => {
        const wrongDimensions = createCanvas(1, 1).toBuffer("image/png");
        await expect(renderer.render(Buffer.alloc(0), SNAPSHOT)).rejects.toThrow("PNG or dimensions");
        await expect(renderer.render(wrongDimensions, SNAPSHOT)).rejects.toThrow("PNG or dimensions");
        await expect(renderer.render(SYNTHETIC.subarray(0, 33), SNAPSHOT)).rejects.toThrow("PNG or dimensions");
    });

    it("refuses a broken font path and an existing file that cannot register as a font", async () => {
        const missingFont = new StandaloneReceiptRenderer(join(__dirname, "not-a-font.ttf"));
        const invalidFont = new StandaloneReceiptRenderer(join(__dirname, "../fixtures/standalone-receipt-synthetic.png"));
        await expect(missingFont.render(SYNTHETIC, SNAPSHOT)).rejects.toThrow("NanumMyeongjo font is unavailable");
        await expect(invalidFont.render(SYNTHETIC, SNAPSHOT)).rejects.toThrow("NanumMyeongjo font is unavailable");
    });
});

describe("StandaloneReceiptTemplateLoader", () => {
    const APPROVED_FILENAME = "ab20ef494186f1bc3d480dcb96facc67c753de72d6d03dc3a7b7fc85f639548f.png";
    const BRANCH_A = "a1a11111-1111-4111-8111-111111111111";
    const BRANCH_B = "b2b22222-2222-4222-8222-222222222222";
    const PATH_A = `standalone-receipt-templates/${BRANCH_A}/${APPROVED_FILENAME}`;
    const PATH_B = `standalone-receipt-templates/${BRANCH_B}/${APPROVED_FILENAME}`;

    it("downloads only the selected branch path and refuses an unprovisioned branch or a digest mismatch", async () => {
        const download = jest.fn(async (path: string) => {
            if (path === PATH_A) {
                return SYNTHETIC;
            }
            throw new FileStorageObjectNotFoundError(path, "download");
        });
        const loader = new StandaloneReceiptTemplateLoader({ download });
        await expect(loader.load(BRANCH_B)).rejects.toThrow(StandaloneReceiptTemplateUnavailableError);
        await expect(loader.load(BRANCH_A.toUpperCase())).rejects.toThrow(StandaloneReceiptTemplateUnavailableError);
        expect(download.mock.calls).toEqual([[PATH_B], [PATH_A]]);
    });

    it("rejects a non-UUID storage path before downloading", async () => {
        const download = jest.fn();
        const loader = new StandaloneReceiptTemplateLoader({ download });
        await expect(loader.load(`../${BRANCH_A}`)).rejects.toThrow(StandaloneReceiptTemplateUnavailableError);
        expect(download).not.toHaveBeenCalled();
    });
});
