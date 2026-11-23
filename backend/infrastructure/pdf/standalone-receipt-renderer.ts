import { accessSync, constants } from "node:fs";
import { join } from "node:path";
import { createCanvas, GlobalFonts, loadImage, type SKRSContext2D } from "@napi-rs/canvas";

import {
    encodeReceiptRgbPng,
    isReceiptPng,
    RECEIPT_DPI,
    RECEIPT_HEIGHT,
    RECEIPT_WIDTH,
} from "./standalone-receipt-png";

export interface StandaloneReceiptSnapshot {
    readonly customerName: string;
    readonly serviceStartDate: string;
    readonly endDate: string;
    readonly receivedDate: string;
    readonly issueDate: string;
    readonly fullPrice: number;
    readonly grant: number;
    readonly actualPrice: number;
}

type Box = readonly [left: number, top: number, right: number, bottom: number];

interface ReceiptCopy {
    readonly name: Box;
    readonly period: Box;
    readonly fullPrice: Box;
    readonly totals: readonly [Box, Box, Box];
    readonly acknowledgement: Box;
    readonly receivedDate: readonly [Box, Box, Box];
    readonly issueDate: readonly [Box, Box, Box];
}

// Bounds are measured against each copy's printed labels and rules at 300 DPI.
const COPIES: readonly ReceiptCopy[] = [
    {
        name: [540, 666, 1170, 736],
        period: [575, 745, 1188, 816],
        fullPrice: [540, 824, 995, 894],
        totals: [[460, 998, 635, 1060], [711, 998, 886, 1060], [961, 998, 1136, 1060]],
        acknowledgement: [715, 1274, 982, 1340],
        receivedDate: [[401, 1357, 456, 1420], [516, 1357, 584, 1420], [641, 1357, 744, 1420]],
        issueDate: [[572, 1435, 619, 1496], [684, 1435, 780, 1496], [844, 1435, 938, 1496]],
    },
    {
        name: [540, 2055, 1170, 2125],
        period: [575, 2133, 1188, 2204],
        fullPrice: [540, 2213, 995, 2283],
        totals: [[460, 2388, 635, 2448], [711, 2388, 886, 2448], [961, 2388, 1136, 2448]],
        acknowledgement: [703, 2663, 994, 2729],
        receivedDate: [[390, 2743, 467, 2806], [527, 2743, 595, 2806], [652, 2743, 755, 2806]],
        issueDate: [[561, 2821, 630, 2886], [695, 2821, 790, 2886], [854, 2821, 949, 2886]],
    },
];

const FONT_FAMILY = "StandaloneReceiptNanumMyeongjo";
const FONT_PATH = join(__dirname, "fonts", "NanumMyeongjo.ttf");
const POINTS_PER_INCH = 72;
const MAX_FONT_POINTS = 10;
const MIN_FONT_POINTS = 6;
const FONT_STEP_POINTS = 0.5;
const INK_PADDING = 2;
const MAX_NAME_LENGTH = 999;
const MAX_KRW = 999_999_999;

function validateDate(date: string, field: string): void {
    if (typeof date === "string" && date.length === 10 && /^20\d{2}-\d{2}-\d{2}$/.test(date)) {
        const parsed = new Date(`${date}T00:00:00Z`);
        if (!Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === date) {
            return;
        }
    }
    throw new RangeError(`Invalid standalone receipt ${field}`);
}

function formatAmount(amount: number, field: string): string {
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > MAX_KRW) {
        throw new RangeError(`Invalid standalone receipt ${field}`);
    }
    return amount.toLocaleString("en-US");
}

function dateDigits(date: string): readonly [string, string, string] {
    return [date.slice(2, 4), date.slice(5, 7), date.slice(8, 10)];
}

function prepareFields(snapshot: StandaloneReceiptSnapshot) {
    const { customerName, serviceStartDate, endDate, receivedDate, issueDate } = snapshot;
    if (typeof customerName !== "string" || customerName.length === 0 || customerName.length > MAX_NAME_LENGTH
        || customerName.trim() !== customerName || customerName.normalize("NFC") !== customerName
        || /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(customerName)) {
        throw new RangeError("Invalid standalone receipt customerName");
    }
    validateDate(serviceStartDate, "serviceStartDate");
    validateDate(endDate, "endDate");
    validateDate(receivedDate, "receivedDate");
    validateDate(issueDate, "issueDate");
    if (serviceStartDate > endDate) {
        throw new RangeError("Invalid standalone receipt service period");
    }

    return {
        customerName,
        period: `${serviceStartDate.replaceAll("-", ".")} ~ ${endDate.replaceAll("-", ".")}`,
        fullPrice: formatAmount(snapshot.fullPrice, "fullPrice"),
        grant: formatAmount(snapshot.grant, "grant"),
        actualPrice: formatAmount(snapshot.actualPrice, "actualPrice"),
        receivedDate: dateDigits(receivedDate),
        issueDate: dateDigits(issueDate),
    };
}

interface Overlay {
    readonly box: Box;
    readonly text: string;
    readonly leftAligned?: boolean;
}

function drawOverlays(context: SKRSContext2D, overlays: readonly Overlay[], field: string): void {
    for (let points = MAX_FONT_POINTS; points >= MIN_FONT_POINTS; points -= FONT_STEP_POINTS) {
        context.font = `${points * RECEIPT_DPI / POINTS_PER_INCH}px ${FONT_FAMILY}`;
        const measured = overlays.map((overlay) => ({ ...overlay, metrics: context.measureText(overlay.text) }));
        const fits = measured.every(({ box: [left, top, right, bottom], metrics }) => {
            const inkWidth = metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight;
            const inkHeight = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
            return inkWidth > 0 && inkHeight > 0
                && Math.max(metrics.width, inkWidth) <= right - left - 2 * INK_PADDING
                && inkHeight <= bottom - top - 2 * INK_PADDING;
        });
        if (fits) {
            for (const { box: [left, top, right, bottom], text, leftAligned, metrics } of measured) {
                const inkCenter = (metrics.actualBoundingBoxRight - metrics.actualBoundingBoxLeft) / 2;
                const x = leftAligned
                    ? left + INK_PADDING + metrics.actualBoundingBoxLeft
                    : (left + right) / 2 - inkCenter;
                const y = (top + bottom + metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2;
                context.fillText(text, x, y);
            }
            return;
        }
    }
    throw new RangeError(`Standalone receipt ${field} does not fit`);
}

function drawDate(
    context: SKRSContext2D,
    slots: readonly [Box, Box, Box],
    digits: readonly [string, string, string],
    field: string,
): void {
    drawOverlays(context, [
        { box: slots[0], text: digits[0], leftAligned: true },
        { box: slots[1], text: digits[1] },
        { box: slots[2], text: digits[2] },
    ], field);
}

export class StandaloneReceiptRenderer {
    private fontRegistered = false;

    constructor(private readonly fontPath = FONT_PATH) {}

    private ensureFont(): void {
        try {
            accessSync(this.fontPath, constants.R_OK);
            if (!this.fontRegistered) {
                this.fontRegistered = Boolean(GlobalFonts.registerFromPath(this.fontPath, FONT_FAMILY));
            }
            if (this.fontRegistered && GlobalFonts.has(FONT_FAMILY)) {
                return;
            }
        } catch {
            // An unavailable font file and absent registration both prevent rendering.
        }
        throw new Error("Standalone receipt NanumMyeongjo font is unavailable");
    }

    /** Render both copies of a complete receipt using a template verified by the private loader. */
    async render(templatePng: Buffer, snapshot: StandaloneReceiptSnapshot): Promise<Buffer> {
        const fields = prepareFields(snapshot);
        if (!isReceiptPng(templatePng)) {
            throw new Error("Invalid standalone receipt template PNG or dimensions");
        }
        const template = await loadImage(templatePng);
        if (template.width !== RECEIPT_WIDTH || template.height !== RECEIPT_HEIGHT) {
            throw new Error("Invalid standalone receipt template PNG dimensions");
        }
        this.ensureFont();
        const canvas = createCanvas(RECEIPT_WIDTH, RECEIPT_HEIGHT);
        const context = canvas.getContext("2d", { alpha: false });
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, RECEIPT_WIDTH, RECEIPT_HEIGHT);
        context.drawImage(template, 0, 0);
        context.fillStyle = "#000000";
        context.textAlign = "left";
        context.textBaseline = "alphabetic";

        for (const copy of COPIES) {
            drawOverlays(context, [{ box: copy.name, text: fields.customerName, leftAligned: true }], "customerName");
            drawOverlays(context, [{ box: copy.period, text: fields.period, leftAligned: true }], "service period");
            drawOverlays(context, [{ box: copy.fullPrice, text: fields.fullPrice, leftAligned: true }], "fullPrice");
            drawOverlays(context, [{ box: copy.totals[0], text: fields.fullPrice }], "fullPrice total");
            drawOverlays(context, [{ box: copy.totals[1], text: fields.grant }], "grant total");
            drawOverlays(context, [{ box: copy.totals[2], text: fields.actualPrice }], "actualPrice total");
            drawOverlays(context, [{ box: copy.acknowledgement, text: fields.actualPrice }], "acknowledgement amount");
            drawDate(context, copy.receivedDate, fields.receivedDate, "receivedDate");
            drawDate(context, copy.issueDate, fields.issueDate, "issueDate");
        }

        return encodeReceiptRgbPng(context.getImageData(0, 0, RECEIPT_WIDTH, RECEIPT_HEIGHT).data);
    }
}
