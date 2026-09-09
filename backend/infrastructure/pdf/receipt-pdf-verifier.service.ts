import { Inject, Injectable, Optional } from "@nestjs/common";
import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type * as PdfJs from "pdfjs-dist";

/**
 * The verifier deliberately has a small, injectable extraction boundary.  A
 * PDF hash or raster is useful for integrity and presentation, but neither is
 * evidence that the receipt fields in the official output are current.
 */
export const RECEIPT_PDF_TEXT_EXTRACTOR = Symbol("ReceiptPdfTextExtractor");

export interface ReceiptPdfExtractedPage {
    text: string;
    /** Form widget values when the template exposes them as annotations. */
    fields: Array<{ name: string; value: string }>;
}

export interface ReceiptPdfTextExtraction {
    pageCount: number;
    pages: ReceiptPdfExtractedPage[];
}

export interface ReceiptPdfTextExtractor {
    extract(pdf: Buffer): Promise<ReceiptPdfTextExtraction>;
}

export interface ReceiptPdfExpectedFields {
    serviceStartDate: string;
    serviceEndDate: string;
    receivedDate: string;
    amount: string | number;
}

export interface ReceiptPdfVerificationScope {
    branchId: string;
    clientId: number;
    revisionId: string;
    documentId: string;
    generation: string;
    mirrorGeneration: string;
    templateId?: string;
    templateVersion?: string | number;
}

export interface ReceiptPdfVerificationInput {
    pdf: Buffer;
    expected: ReceiptPdfExpectedFields;
    scope: ReceiptPdfVerificationScope;
    verifiedAt?: Date;
}

export type ReceiptPdfVerificationReason =
    | "invalid_scope"
    | "invalid_expected_fields"
    | "invalid_pdf"
    | "extraction_unavailable"
    | "unsupported_template"
    | "missing_field"
    | "mismatched_field"
    | "ambiguous_field";

export interface ReceiptPdfVerificationProof {
    status: "verified";
    officialPdfSha256: string;
    verifiedAt: Date;
    pageCount: number;
    scope: ReceiptPdfVerificationScope;
    expected: ReceiptPdfExpectedFields;
}

export interface ReceiptPdfVerificationFailure {
    status: "capability_unverified";
    reason: ReceiptPdfVerificationReason;
}

export type ReceiptPdfVerificationResult =
    | ReceiptPdfVerificationProof
    | ReceiptPdfVerificationFailure;

type PdfJsModule = typeof PdfJs;

// pdfjs-dist 4.x is ESM-only while the backend compiles to CommonJS. Keep the
// specifier fixed; callers cannot select a module or execute arbitrary code.
const PDFJS_SPECIFIER = "pdfjs-dist/legacy/build/pdf.mjs";
const importEsm = new Function("specifier", "return import(specifier)") as (
    specifier: string,
) => Promise<unknown>;

/** Production extractor backed by the installed official pdfjs-dist package. */
@Injectable()
export class PdfJsReceiptPdfTextExtractor implements ReceiptPdfTextExtractor {
    private pdfjsPromise: Promise<PdfJsModule> | null = null;

    private loadPdfJs(): Promise<PdfJsModule> {
        if (!this.pdfjsPromise) {
            this.pdfjsPromise = (importEsm(PDFJS_SPECIFIER) as Promise<PdfJsModule>).catch(
                (error: unknown) => {
                    this.pdfjsPromise = null;
                    throw error;
                },
            );
        }
        return this.pdfjsPromise;
    }

    async extract(pdf: Buffer): Promise<ReceiptPdfTextExtraction> {
        if (!Buffer.isBuffer(pdf) || pdf.length < 5 || pdf.subarray(0, 5).toString("ascii") !== "%PDF-") {
            throw new Error("receipt PDF is not a PDF buffer");
        }

        const pdfjs = await this.loadPdfJs();
        const pdfjsRoot = path.dirname(require.resolve("pdfjs-dist/package.json"));
        const document = await pdfjs.getDocument({
            data: Uint8Array.from(pdf),
            disableWorker: true,
            disableFontFace: true,
            useSystemFonts: false,
            cMapUrl: pathToFileURL(path.join(pdfjsRoot, "cmaps") + path.sep).href,
            cMapPacked: true,
            standardFontDataUrl: pathToFileURL(path.join(pdfjsRoot, "standard_fonts") + path.sep).href,
        } as unknown as Parameters<PdfJsModule["getDocument"]>[0]).promise;

        try {
            const pages: ReceiptPdfExtractedPage[] = [];
            for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
                const page = await document.getPage(pageNumber);
                const textContent = await page.getTextContent();
                const text = textContent.items
                    .map((item) => {
                        const candidate = item as unknown as { str?: unknown };
                        return typeof candidate.str === "string" ? candidate.str : "";
                    })
                    .join(" ");

                let fields: Array<{ name: string; value: string }> = [];
                if (typeof page.getAnnotations === "function") {
                    const annotations = await page.getAnnotations();
                    fields = annotations
                        .map((annotation) => {
                            const candidate = annotation as unknown as {
                                fieldName?: unknown;
                                fieldValue?: unknown;
                                alternativeText?: unknown;
                            };
                            const name = typeof candidate.fieldName === "string"
                                ? candidate.fieldName
                                : typeof candidate.alternativeText === "string"
                                    ? candidate.alternativeText
                                    : "";
                            const value = typeof candidate.fieldValue === "string"
                                ? candidate.fieldValue
                                : "";
                            return { name, value };
                        })
                        .filter((field) => field.name.length > 0 || field.value.length > 0);
                }
                pages.push({ text, fields });
            }
            return { pageCount: document.numPages, pages };
        } finally {
            await document.destroy();
        }
    }
}

const PERIOD_LABELS = [
    "서비스 기간",
    "서비스기간",
    "서비스 제공 기간",
    "서비스 제공기간",
    "제공 기간",
    "제공기간",
] as const;

const RECEIVED_DATE_LABELS = [
    "본인부담금 수령",
    "본인부담금수령",
    "영수증 수령",
    "영수증수령",
    "수령일자",
    "수령 일자",
    "수령일",
    "수령 일",
] as const;

const AMOUNT_LABELS = [
    "본인부담금",
    "본인 부담금",
    "실제 부담금",
    "실제부담금",
    "납부 금액",
    "납부금액",
    "결제 금액",
    "결제금액",
] as const;

const FIELD_WINDOW_RADIUS = 140;

function compact(value: string): string {
    return value.replace(/\s+/g, "").replace(/[：:]/g, ":");
}

function normalizeDate(value: string): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    const match = trimmed.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/)
        ?? trimmed.match(/^(\d{4})(\d{2})(\d{2})$/)
        ?? trimmed.match(/^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일?$/);
    if (!match) return null;
    const [, year, month, day] = match;
    if (!year || !month || !day) return null;
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
    if (
        !Number.isInteger(date.getTime())
        || date.getUTCFullYear() !== Number(year)
        || date.getUTCMonth() !== Number(month) - 1
        || date.getUTCDate() !== Number(day)
    ) {
        return null;
    }
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function dateAliases(value: string): string[] {
    const normalized = normalizeDate(value);
    if (!normalized) return [];
    const [year, month, day] = normalized.split("-");
    if (!year || !month || !day) return [];
    const shortYear = year.slice(2);
    return [
        normalized,
        `${year}${month}${day}`,
        `${year}.${month}.${day}`,
        `${year}/${month}/${day}`,
        `${year}년${month}월${day}일`,
        `${shortYear}.${month}.${day}`,
        `${shortYear}/${month}/${day}`,
        `${shortYear}년${month}월${day}일`,
        `${shortYear}${month}${day}`,
    ];
}

function amountDigits(value: string | number): string | null {
    if (typeof value === "number" && (!Number.isFinite(value) || value < 0)) return null;
    if (typeof value !== "number" && typeof value !== "string") return null;
    const raw = typeof value === "number" ? String(value) : value.trim();
    if (!raw) return null;
    const digits = raw.replace(/[^0-9]/g, "");
    return digits.length > 0 && Number.isSafeInteger(Number(digits)) ? digits : null;
}

function amountAliases(value: string | number): string[] {
    const digits = amountDigits(value);
    if (!digits) return [];
    const grouped = Number(digits).toLocaleString("en-US");
    return [digits, grouped, `${grouped}원`, `${digits}원`];
}

function normalizeSearchText(value: string): string {
    return value.normalize("NFKC").replace(/[\u00a0\t\r\n]+/g, " ");
}

function fieldWindows(
    text: string,
    labels: readonly string[],
    accept: (compactText: string, index: number, label: string) => boolean = () => true,
): string[] {
    const normalized = normalizeSearchText(text);
    const compactText = compact(normalized);
    const matches: Array<{ index: number; end: number; label: string }> = [];
    const seenNeedles = new Set<string>();
    for (const label of labels) {
        const needle = compact(label);
        if (seenNeedles.has(needle)) continue;
        seenNeedles.add(needle);
        let from = 0;
        while (from <= compactText.length) {
            const index = compactText.indexOf(needle, from);
            if (index < 0) break;
            if (accept(compactText, index, label)) {
                matches.push({ index, end: index + needle.length, label });
            }
            from = index + Math.max(needle.length, 1);
        }
    }
    // Labels can be nested in the same rendered field (e.g. `수령일` inside
    // `본인부담금 수령일`). Keep the longest match for one occurrence so a
    // template's legitimate label aliases do not manufacture ambiguity.
    const selected: Array<{ index: number; end: number; label: string }> = [];
    for (const match of matches.sort((left, right) => (
        left.index - right.index
        || (right.end - right.index) - (left.end - left.index)
    ))) {
        const overlap = selected.find((candidate) => (
            match.index < candidate.end && candidate.index < match.end
        ));
        if (!overlap) {
            selected.push(match);
        } else if (match.end - match.index > overlap.end - overlap.index) {
            selected[selected.indexOf(overlap)] = match;
        }
    }
    return selected
        .sort((left, right) => left.index - right.index)
        .map((match) => compactText.slice(Math.max(0, match.index - FIELD_WINDOW_RADIUS), match.end + FIELD_WINDOW_RADIUS));
}

function hasAlias(value: string, aliases: readonly string[]): boolean {
    const normalized = compact(value).normalize("NFKC");
    return aliases.some((alias) => normalized.includes(compact(alias).normalize("NFKC")));
}

function countAliasMatches(value: string, aliases: readonly string[]): number {
    const normalized = compact(value).normalize("NFKC");
    const intervals: Array<{ start: number; end: number }> = [];
    aliases.forEach((alias) => {
        const needle = compact(alias).normalize("NFKC");
        if (!needle) return;
        let from = 0;
        while (from <= normalized.length) {
            const index = normalized.indexOf(needle, from);
            if (index < 0) break;
            // Different display aliases can overlap one rendered value (for
            // example `26년08월02일` is contained in
            // `2026년08월02일`). Merge overlapping intervals below instead
            // of treating aliases as separate field occurrences.
            intervals.push({ start: index, end: index + needle.length });
            from = index + needle.length;
        }
    });
    intervals.sort((left, right) => left.start - right.start || right.end - left.end);
    let count = 0;
    let coveredEnd = -1;
    for (const interval of intervals) {
        if (interval.start >= coveredEnd) {
            count += 1;
            coveredEnd = interval.end;
        } else if (interval.end > coveredEnd) {
            coveredEnd = interval.end;
        }
    }
    return count;
}

function validateScope(scope: ReceiptPdfVerificationScope): boolean {
    return Boolean(
        scope
        && typeof scope.branchId === "string" && scope.branchId.trim()
        && Number.isSafeInteger(scope.clientId) && scope.clientId > 0
        && typeof scope.revisionId === "string" && scope.revisionId.trim()
        && typeof scope.documentId === "string" && scope.documentId.trim()
        && typeof scope.generation === "string" && scope.generation.trim()
        && typeof scope.mirrorGeneration === "string" && scope.mirrorGeneration.trim()
        && (scope.templateId === undefined || (typeof scope.templateId === "string" && scope.templateId.trim()))
        && (scope.templateVersion === undefined
            || (typeof scope.templateVersion === "string" && scope.templateVersion.trim().length > 0)
            || (typeof scope.templateVersion === "number"
                && Number.isSafeInteger(scope.templateVersion)
                && scope.templateVersion > 0)),
    );
}

function validateExpected(expected: ReceiptPdfExpectedFields): boolean {
    if (!expected || typeof expected !== "object") return false;
    const start = normalizeDate(expected.serviceStartDate);
    const end = normalizeDate(expected.serviceEndDate);
    return Boolean(
        start
        && end
        && start <= end
        && normalizeDate(expected.receivedDate)
        && amountDigits(expected.amount),
    );
}

/**
 * Verifies template-scoped receipt fields from a fresh PDF.  The verifier is
 * intentionally conservative: one missing, conflicting, or repeated match
 * leaves the operation capability-unverified so callers can preserve the old
 * image and retry/reconcile later.
 */
@Injectable()
export class ReceiptPdfVerifierService {
    private readonly extractor: ReceiptPdfTextExtractor;

    constructor(
        @Optional()
        @Inject(RECEIPT_PDF_TEXT_EXTRACTOR)
        extractor?: ReceiptPdfTextExtractor,
    ) {
        this.extractor = extractor ?? new PdfJsReceiptPdfTextExtractor();
    }

    async verify(input: ReceiptPdfVerificationInput): Promise<ReceiptPdfVerificationResult> {
        if (!validateScope(input.scope)) return { status: "capability_unverified", reason: "invalid_scope" };
        if (!validateExpected(input.expected)) return { status: "capability_unverified", reason: "invalid_expected_fields" };
        if (
            !Buffer.isBuffer(input.pdf)
            || input.pdf.length < 5
            || input.pdf.subarray(0, 5).toString("ascii") !== "%PDF-"
        ) {
            return { status: "capability_unverified", reason: "invalid_pdf" };
        }

        let extraction: ReceiptPdfTextExtraction;
        try {
            extraction = await this.extractor.extract(input.pdf);
        } catch {
            return { status: "capability_unverified", reason: "extraction_unavailable" };
        }
        if (
            !extraction
            || typeof extraction !== "object"
            || !Number.isSafeInteger(extraction.pageCount)
            || extraction.pageCount < 1
            || !Array.isArray(extraction.pages)
            || extraction.pages.length !== extraction.pageCount
            || !extraction.pages.every((page) => (
                page
                && typeof page.text === "string"
                && Array.isArray(page.fields)
                && page.fields.every((field) => (
                    field
                    && typeof field.name === "string"
                    && typeof field.value === "string"
                ))
            ))
        ) {
            return { status: "capability_unverified", reason: "invalid_pdf" };
        }

        const pages = extraction.pages.map((page) => {
            let text = normalizeSearchText(page.text);
            const compactText = compact(text);
            for (const field of page.fields) {
                // A widget name is often already painted into the page text.
                // Append its value without duplicating that label; otherwise
                // append the complete annotation pair for templates whose
                // labels exist only in form metadata.
                const name = normalizeSearchText(field.name);
                text += compactText.includes(compact(name))
                    ? ` ${field.value}`
                    : ` ${name} ${field.value}`;
            }
            return { text: normalizeSearchText(text) };
        });
        const combinedText = pages.map((page) => page.text).join(" ");
        if (!combinedText.trim()) return { status: "capability_unverified", reason: "unsupported_template" };

        const expectedStart = dateAliases(input.expected.serviceStartDate);
        const expectedEnd = dateAliases(input.expected.serviceEndDate);
        const expectedReceived = dateAliases(input.expected.receivedDate);
        const expectedAmount = amountAliases(input.expected.amount);

        const periodWindows = fieldWindows(combinedText, PERIOD_LABELS);
        const receivedWindows = fieldWindows(combinedText, RECEIVED_DATE_LABELS);
        const amountWindows = fieldWindows(
            combinedText,
            AMOUNT_LABELS,
            (compactText, index, label) => label !== "본인부담금"
                || !compactText.slice(index + compact(label).length, index + compact(label).length + 8).startsWith("수령"),
        );
        if (periodWindows.length === 0 || receivedWindows.length === 0 || amountWindows.length === 0) {
            return { status: "capability_unverified", reason: "missing_field" };
        }

        const matchingPeriods = periodWindows.filter((window) => hasAlias(window, expectedStart) && hasAlias(window, expectedEnd));
        if (matchingPeriods.length === 0) return { status: "capability_unverified", reason: "mismatched_field" };
        if (matchingPeriods.length !== 1 || countAliasMatches(matchingPeriods[0]!, expectedStart) !== 1 || countAliasMatches(matchingPeriods[0]!, expectedEnd) !== 1) {
            return { status: "capability_unverified", reason: "ambiguous_field" };
        }

        const matchingReceived = receivedWindows.filter((window) => hasAlias(window, expectedReceived));
        if (matchingReceived.length === 0) return { status: "capability_unverified", reason: "mismatched_field" };
        if (matchingReceived.length !== 1 || countAliasMatches(matchingReceived[0]!, expectedReceived) !== 1) {
            return { status: "capability_unverified", reason: "ambiguous_field" };
        }

        const matchingAmounts = amountWindows.filter((window) => hasAlias(window, expectedAmount));
        if (matchingAmounts.length === 0) return { status: "capability_unverified", reason: "mismatched_field" };
        if (matchingAmounts.length !== 1 || countAliasMatches(matchingAmounts[0]!, expectedAmount) !== 1) {
            return { status: "capability_unverified", reason: "ambiguous_field" };
        }

        const verifiedAt = input.verifiedAt ?? new Date();
        if (!Number.isFinite(verifiedAt.getTime())) return { status: "capability_unverified", reason: "invalid_scope" };
        return {
            status: "verified",
            officialPdfSha256: createHash("sha256").update(input.pdf).digest("hex"),
            verifiedAt: new Date(verifiedAt.getTime()),
            pageCount: extraction.pageCount,
            scope: { ...input.scope },
            expected: { ...input.expected },
        };
    }
}
