import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";

import type { EformsignApiDocumentResponse } from "domain/repositories/eformsign.client.interface";
import { EFORMSIGN_COMPLETED_STATUS_CODES } from "domain/constants/eformsign-doc-status.constants";
import { EFORMSIGN_END_DATE_FIELD_IDS } from "application/usecases/eformsign-doc/eformsign-end-date-field-ids";

export const CONTRACT_DATE_UPDATE_DOCUMENT_ID = "d54eae92480941b4b656dfda2ffb93b7";
export const CONTRACT_DATE_UPDATE_DOCUMENT_TITLE = "인천아이미래로_남동구 계약서_송진호(확인단계테스트)";
export const CONTRACT_DATE_UPDATE_TEMPLATE_ID = "7a632a0c98a04bf38e678affcb73f815";
export const CONTRACT_DATE_UPDATE_BASELINE_END_DATE = "2027-01-04";
export const CONTRACT_DATE_UPDATE_BASELINE_RECEIPT_PERIOD = "20260709~20270104";
export const CONTRACT_DATE_UPDATE_OLD_END_DATE = "2026-12-31";
export const CONTRACT_DATE_UPDATE_OLD_RECEIPT_PERIOD = "20260709~20261231";
export const CONTRACT_DATE_UPDATE_PAYMENT_DATE = "2026-07-09";
export const CONTRACT_DATE_UPDATE_BASELINE_MONEY = {
    "서비스 비용": "1464000",
    "정부지원금": "1002000",
    "본인부담금": "462000",
} as const;

const PDF_DOCUMENT_FILE_TYPE = "document" as const;
const PDF_TEXT_EXTRACTOR_PATH = path.join(__dirname, "contract-date-update.pdf-text.mjs");

const FIELD_IDENTIFIER_KEYS = [
    "id",
    "component_id",
    "componentId",
    "field_id",
    "fieldId",
    "name",
    "component_name",
    "componentName",
    "field_name",
    "fieldName",
    "key",
    "label",
    "title",
] as const;
const FIELD_VALUE_KEYS = [
    "value",
    "component_value",
    "componentValue",
    "field_value",
    "fieldValue",
    "input_value",
    "display_value",
    "content",
    "text",
] as const;
const FIELD_TYPE_KEYS = ["type", "field_type", "data_type"] as const;
const PAYMENT_FIELD_ALIASES = {
    year: ["본인부담금 수령 년도", "본인부담금수령년도", "결제 년도", "결제년도", "paymentYear"],
    month: ["본인부담금 수령 월", "본인부담금수령월", "결제 월", "결제월", "paymentMonth"],
    day: ["본인부담금 수령 일", "본인부담금수령일", "결제 일", "결제일", "paymentDay"],
    full: ["본인부담금 수령일", "본인부담금수령일", "결제일", "paymentDate"],
} as const;
const MONEY_FIELD_ALIASES = ["서비스 비용", "정부지원금", "본인부담금"] as const;

interface FieldRecord {
    id: string;
    value: string;
    type: string;
}

export interface EformsignAccess {
    accessToken: string;
}

export interface PdfEvidence {
    sha256: string;
    byteLength: number;
    pageCount: number;
    hasEndDate: boolean;
    hasReceiptPeriod: boolean;
    receiptPeriodOccurrences: number;
    hasOldEndDate: boolean;
    hasOldReceiptPeriod: boolean;
    oldReceiptPeriodOccurrences: number;
    exportedPdfStale: boolean;
}

export interface ContractDateEvidence {
    id: string;
    title: string;
    templateId: string;
    statusType: string;
    stepType: string;
    stepName: string;
    endDate: string | null;
    receiptPeriods: string[];
    paymentDate: string | null;
    moneyFields: Record<string, string[]>;
    signatureHashes: string[];
    componentNames: string[];
    signatureComponentNames: string[];
    signatureComponentResults: DocumentComponentEvidence[];
    pdf: PdfEvidence;
}

export type VerificationResult<T> =
    | { status: "pass"; value: T }
    | { status: "not_verified"; reason: string };

export interface ReadonlyEformsignClient {
    getAccessToken(executionTime: number): Promise<{
        oauth_token?: { access_token?: string; refresh_token?: string };
    }>;
    getDocument(accessToken: string, documentId: string): Promise<EformsignApiDocumentResponse>;
}

export interface ReadonlyEformsignFileReader {
    downloadDocumentFile(
        accessToken: string,
        documentId: string,
        fileType?: "document" | "audit_trail",
    ): Promise<{
        status: number;
        contentType: string;
        contentDisposition: string | null;
        body: Buffer;
    }>;
}

export interface DocumentComponentEvidence {
    name: string;
    valueHash: string | null;
    valueLength: number;
}

export interface ReadonlyEformsignComponentReader {
    getDocumentComponents(
        accessToken: string,
        documentId: string,
        componentNames: readonly string[],
    ): Promise<DocumentComponentEvidence[]>;
}

export interface ReadonlyConfigReader {
    get<T = unknown>(propertyPath: string): T | undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function stringValue(value: unknown): string | null {
    if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed || null;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
        return String(value);
    }
    return null;
}

function firstRecordValue(record: Record<string, unknown>, keys: readonly string[]): string | null {
    for (const key of keys) {
        const value = stringValue(record[key]);
        if (value) return value;
    }
    return null;
}

function collectFieldRecords(value: unknown, output: FieldRecord[] = [], depth = 0): FieldRecord[] {
    if (depth > 10 || value === null || value === undefined) return output;
    if (Array.isArray(value)) {
        for (const item of value) collectFieldRecords(item, output, depth + 1);
        return output;
    }

    const record = asRecord(value);
    if (!record) return output;

    const id = firstRecordValue(record, FIELD_IDENTIFIER_KEYS);
    const fieldValue = firstRecordValue(record, FIELD_VALUE_KEYS);
    const type = firstRecordValue(record, FIELD_TYPE_KEYS) ?? "";
    if (id && fieldValue) {
        const duplicate = output.some((field) => (
            field.id === id && field.value === fieldValue && field.type === type
        ));
        if (!duplicate) output.push({ id, value: fieldValue, type });
    }

    for (const child of Object.values(record)) {
        if (child && typeof child === "object") {
            collectFieldRecords(child, output, depth + 1);
        }
    }
    return output;
}

function collectFieldIdentifiers(value: unknown, output: string[] = [], depth = 0): string[] {
    if (depth > 10 || value === null || value === undefined) return output;
    if (Array.isArray(value)) {
        for (const item of value) collectFieldIdentifiers(item, output, depth + 1);
        return output;
    }

    const record = asRecord(value);
    if (!record) return output;
    for (const key of FIELD_IDENTIFIER_KEYS) {
        const id = stringValue(record[key]);
        if (id && !output.includes(id)) output.push(id);
    }
    for (const child of Object.values(record)) {
        if (child && typeof child === "object") {
            collectFieldIdentifiers(child, output, depth + 1);
        }
    }
    return output;
}

function getFieldRecords(document: EformsignApiDocumentResponse): FieldRecord[] {
    return collectFieldRecords(document.fields).concat(
        collectFieldRecords(document.detail_template_info),
    );
}

function getFieldIdentifiers(document: EformsignApiDocumentResponse): string[] {
    return collectFieldIdentifiers(document.fields).concat(
        collectFieldIdentifiers(document.detail_template_info),
    );
}

function normalizeIdentifier(value: string): string {
    return value.toLowerCase().replace(/[\s_\-:/]/g, "");
}

function fieldValues(document: EformsignApiDocumentResponse, aliases: readonly string[]): string[] {
    const wanted = new Set(aliases.map(normalizeIdentifier));
    const values = getFieldRecords(document)
        .filter((field) => wanted.has(normalizeIdentifier(field.id)))
        .map((field) => field.value.trim())
        .filter(Boolean);
    return [...new Set(values)];
}

function parseDateParts(yearValue: string | null, monthValue: string | null, dayValue: string | null): string | null {
    if (!yearValue || !monthValue || !dayValue) return null;
    const yearDigits = yearValue.replace(/\D/g, "");
    const monthDigits = monthValue.replace(/\D/g, "");
    const dayDigits = dayValue.replace(/\D/g, "");
    if ((yearDigits.length !== 2 && yearDigits.length !== 4) || monthDigits.length < 1 || dayDigits.length < 1) {
        return null;
    }
    const year = yearDigits.length === 2 ? `20${yearDigits}` : yearDigits.slice(0, 4);
    const month = monthDigits.padStart(2, "0").slice(-2);
    const day = dayDigits.padStart(2, "0").slice(-2);
    if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > 31) return null;
    return `${year}-${month}-${day}`;
}

function parseFullDate(value: string): string | null {
    const digits = value.replace(/\D/g, "");
    if (digits.length === 8) {
        return parseDateParts(digits.slice(0, 4), digits.slice(4, 6), digits.slice(6, 8));
    }
    if (digits.length === 6) {
        return parseDateParts(digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 6));
    }
    const match = value.match(/(\d{2,4})\D+(\d{1,2})\D+(\d{1,2})/);
    return match ? parseDateParts(match[1]!, match[2]!, match[3]!) : null;
}

function extractDate(document: EformsignApiDocumentResponse, aliases: typeof PAYMENT_FIELD_ALIASES | {
    year: readonly string[];
    month: readonly string[];
    day: readonly string[];
    full?: readonly string[];
}): string | null {
    const split = parseDateParts(
        fieldValues(document, aliases.year)[0] ?? null,
        fieldValues(document, aliases.month)[0] ?? null,
        fieldValues(document, aliases.day)[0] ?? null,
    );
    if (split) return split;
    for (const value of fieldValues(document, aliases.full ?? [])) {
        const parsed = parseFullDate(value);
        if (parsed) return parsed;
    }
    return null;
}

function normalizeRange(value: string): string | null {
    const parts = value.split(/\s*~\s*/);
    if (parts.length !== 2) return null;
    const start = parseFullDate(parts[0]!);
    const end = parseFullDate(parts[1]!);
    return start && end ? `${start.replace(/-/g, "")}~${end.replace(/-/g, "")}` : null;
}

function extractReceiptPeriods(document: EformsignApiDocumentResponse): string[] {
    return [...new Set(
        fieldValues(document, ["서비스 기간"])
            .map(normalizeRange)
            .filter((value): value is string => value !== null),
    )];
}

function extractMoneyFields(document: EformsignApiDocumentResponse): Record<string, string[]> {
    const result: Record<string, string[]> = {};
    for (const alias of MONEY_FIELD_ALIASES) {
        result[alias] = fieldValues(document, [alias])
            .map((value) => value.replace(/[^\d]/g, ""))
            .filter(Boolean);
    }
    return result;
}

function extractSignatureHashes(document: EformsignApiDocumentResponse): string[] {
    const records = getFieldRecords(document);
    const candidates = records.filter((field) => {
        const identifier = field.id;
        const isSignature = /(서명|signature)/i.test(identifier) || /(서명|signature|sign)/i.test(field.type);
        const isProviderValue = /(제공기관|제공업체|직원|provider|staff|company|도장|stamp)/i.test(identifier);
        const hasImageShape = /^data:image\//i.test(field.value) || /(image|signature|sign|서명)/i.test(field.type);
        return isSignature && !isProviderValue && hasImageShape;
    });
    return [...new Set(
        candidates
            .map((field) => createHash("sha256").update(field.value, "utf8").digest("hex"))
            .sort(),
    )];
}

export function getSignatureComponentNames(document: EformsignApiDocumentResponse): string[] {
    return getFieldIdentifiers(document)
        .filter((identifier) => {
        const isSignature = /(서명|signature)/i.test(identifier);
            const isProviderValue = /(제공기관|제공업체|직원|provider|staff|company|도장|stamp)/i.test(identifier);
            return isSignature && !isProviderValue;
        })
        .slice(0, 20);
}

export function getDocumentComponentNames(document: EformsignApiDocumentResponse): string[] {
    const signatureNameSet = new Set(getSignatureComponentNames(document));
    return getFieldIdentifiers(document)
        .filter((identifier) => {
            const normalized = normalizeIdentifier(identifier);
            return signatureNameSet.has(identifier)
                || normalized.includes(normalizeIdentifier("서비스 기간"))
                || normalized.includes(normalizeIdentifier("계약 종료"))
                || normalized.includes(normalizeIdentifier("본인부담금 수령"));
        })
        .slice(0, 20);
}

export async function readDocumentComponents(
    config: ReadonlyConfigReader,
    accessToken: string,
    documentId: string,
    componentNames: readonly string[],
): Promise<DocumentComponentEvidence[]> {
    if (documentId !== CONTRACT_DATE_UPDATE_DOCUMENT_ID) {
        throw new NotVerifiedError("document id is outside the exact allowlist");
    }
    const apiBase = config.get<string>("EFORMSIGN_DOC_API_URL")?.trim();
    const names = [...new Set(componentNames.map((name) => name.trim()).filter(Boolean))].slice(0, 20);
    if (!apiBase || names.length === 0) {
        throw new NotVerifiedError("no allowlisted signature component names were available");
    }
    const endpoint = `${apiBase.replace(/\/+$/, "")}/v2.0/api/documents/${documentId}/document_component`;
    const request = async (body: Record<string, unknown>): Promise<DocumentComponentEvidence[]> => {
        const response = await fetch(endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${accessToken}`,
            },
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            throw new NotVerifiedError(`document component read returned vendor status ${response.status}`);
        }
        const payload = asRecord(await response.json());
        const listValue = payload?.["documentComponentList"] ?? payload?.["document_component_list"];
        const list = Array.isArray(listValue) ? listValue : [];
        return list.flatMap((item): DocumentComponentEvidence[] => {
            const record = asRecord(item);
            const name = stringValue(record?.["name"]);
            const value = stringValue(record?.["value"]);
            if (!name) return [];
            return [{
                name,
                valueHash: value ? createHash("sha256").update(value, "utf8").digest("hex") : null,
                valueLength: value?.length ?? 0,
            }];
        });
    };
    const listed = await request({
        documentComponentBodyList: names.map((name) => ({ name })),
    });
    return listed;
}

function compactPdfText(value: string): string {
    return value.normalize("NFKC").replace(/\s+/g, "");
}

function datePdfVariants(isoDate: string): string[] {
    const [year, month, day] = isoDate.split("-");
    if (!year || !month || !day) return [];
    return [
        `${year}${month}${day}`,
        `${year}-${month}-${day}`,
        `${year}.${month}.${day}`,
        `${year}년${month}월${day}일`,
    ];
}

function receiptPdfVariants(): string[] {
    return [
        "20260709~20270104",
        "2026-07-09~2027-01-04",
        "2026.07.09~2027.01.04",
        "2026년07월09일~2027년01월04일",
    ];
}

function oldReceiptPdfVariants(): string[] {
    return [
        "20260709~20261231",
        "2026-07-09~2026-12-31",
        "2026.07.09~2026.12.31",
        "2026년07월09일~2026년12월31일",
    ];
}

function countOccurrences(value: string, needle: string): number {
    if (!needle) return 0;
    let count = 0;
    let cursor = 0;
    while (true) {
        const index = value.indexOf(needle, cursor);
        if (index < 0) return count;
        count += 1;
        cursor = index + needle.length;
    }
}

async function extractPdfText(pdf: Buffer): Promise<{ pageCount: number; text: string }> {
    // The backend compiles to CommonJS while pdfjs-dist 4.x is ESM-only. Run
    // the fixed, dependency-local extraction module as a child ESM process so
    // this test does not use dynamic code evaluation or alter the production loader.
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [PDF_TEXT_EXTRACTOR_PATH], {
            stdio: ["pipe", "pipe", "ignore"],
        });
        const chunks: Buffer[] = [];
        let outputLength = 0;
        let settled = false;
        const fail = (error: Error) => {
            if (settled) return;
            settled = true;
            child.kill();
            reject(error);
        };
        child.stdout.on("data", (chunk: Buffer) => {
            outputLength += chunk.length;
            if (outputLength > 8 * 1024 * 1024) {
                fail(new NotVerifiedError("document PDF text output exceeded the local safety limit"));
                return;
            }
            chunks.push(chunk);
        });
        child.on("error", () => fail(new NotVerifiedError("document PDF text extractor could not start")));
        child.on("close", (code) => {
            if (settled) return;
            if (code !== 0) {
                fail(new NotVerifiedError("document PDF text extractor returned a non-zero status"));
                return;
            }
            try {
                const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
                    pageCount?: unknown;
                    text?: unknown;
                };
                if (
                    !Number.isInteger(parsed.pageCount)
                    || (parsed.pageCount as number) < 1
                    || typeof parsed.text !== "string"
                ) {
                    fail(new NotVerifiedError("document PDF text extractor returned an invalid result"));
                    return;
                }
                settled = true;
                resolve({ pageCount: parsed.pageCount as number, text: parsed.text });
            } catch {
                fail(new NotVerifiedError("document PDF text extractor returned unreadable output"));
            }
        });
        child.stdin.on("error", () => fail(new NotVerifiedError("document PDF could not be sent to the text extractor")));
        child.stdin.end(pdf);
    });
}

export async function downloadContractDatePdf(
    reader: ReadonlyEformsignFileReader,
    accessToken: string,
    documentId: string,
): Promise<Buffer> {
    if (documentId !== CONTRACT_DATE_UPDATE_DOCUMENT_ID) {
        throw new NotVerifiedError("document id is outside the exact allowlist");
    }
    const download = await reader.downloadDocumentFile(accessToken, documentId, PDF_DOCUMENT_FILE_TYPE);
    if (!download || typeof download.contentType !== "string" || !Buffer.isBuffer(download.body)) {
        throw new NotVerifiedError("document PDF response shape was unavailable");
    }
    const contentType = download.contentType.toLowerCase();
    if (download.status !== 200 || !contentType.includes("application/pdf")) {
        throw new NotVerifiedError("document PDF response was not a successful PDF");
    }
    if (download.body.length < 5 || download.body.subarray(0, 5).toString("ascii") !== "%PDF-") {
        throw new NotVerifiedError("document PDF did not contain a PDF signature");
    }
    return download.body;
}

async function readPdfEvidence(
    reader: ReadonlyEformsignFileReader,
    accessToken: string,
    documentId: string,
): Promise<PdfEvidence> {
    const body = await downloadContractDatePdf(reader, accessToken, documentId);
    let extracted: { pageCount: number; text: string };
    try {
        extracted = await extractPdfText(body);
    } catch (error) {
        const errorRecord = asRecord(error);
        const errorName = error instanceof Error
            ? error.name
            : typeof errorRecord?.["name"] === "string"
                ? errorRecord["name"]
                : typeof error;
        throw new NotVerifiedError(`document PDF text extraction was unavailable (${errorName})`);
    }
    if (extracted.pageCount < 1) {
        throw new NotVerifiedError("document PDF had no pages");
    }
    const compact = compactPdfText(extracted.text);
    const receiptPeriodOccurrences = receiptPdfVariants()
        .map((variant) => countOccurrences(compact, variant))
        .reduce((max, count) => Math.max(max, count), 0);
    const oldReceiptPeriodOccurrences = oldReceiptPdfVariants()
        .map((variant) => countOccurrences(compact, variant))
        .reduce((max, count) => Math.max(max, count), 0);
    const hasEndDate = datePdfVariants(CONTRACT_DATE_UPDATE_BASELINE_END_DATE)
        .some((variant) => compact.includes(variant));
    const hasOldEndDate = datePdfVariants(CONTRACT_DATE_UPDATE_OLD_END_DATE)
        .some((variant) => compact.includes(variant));
    const hasReceiptPeriod = receiptPeriodOccurrences > 0;
    const hasOldReceiptPeriod = oldReceiptPeriodOccurrences > 0;
    return {
        sha256: createHash("sha256").update(body).digest("hex"),
        byteLength: body.length,
        pageCount: extracted.pageCount,
        hasEndDate,
        hasReceiptPeriod,
        receiptPeriodOccurrences,
        hasOldEndDate,
        hasOldReceiptPeriod,
        oldReceiptPeriodOccurrences,
        exportedPdfStale: !hasEndDate && hasOldEndDate && hasOldReceiptPeriod,
    };
}

export class NotVerifiedError extends Error {
    constructor(reason: string) {
        super(reason);
        this.name = "NotVerifiedError";
    }
}

export function safeErrorReason(error: unknown, operation: string): string {
    if (error instanceof NotVerifiedError) return error.message;
    const candidate = asRecord(error);
    const status = candidate?.["status"];
    const vendorCode = candidate?.["vendorCode"];
    if (typeof status === "number" && Number.isFinite(status)) {
        return `${operation} returned vendor status ${status}${typeof vendorCode === "string" ? ` (${vendorCode})` : ""}`;
    }
    if (error instanceof Error) return `${operation} failed (${error.name})`;
    const errorName = typeof candidate?.["name"] === "string" ? candidate["name"] : typeof error;
    return `${operation} failed (${errorName})`;
}

export async function acquireEformsignAccess(client: ReadonlyEformsignClient): Promise<EformsignAccess> {
    const token = await client.getAccessToken(Date.now());
    const accessToken = token.oauth_token?.access_token?.trim();
    if (!accessToken) {
        throw new NotVerifiedError("eformsign access-token response was incomplete");
    }
    return { accessToken };
}

export async function readContractDateEvidence(
    client: ReadonlyEformsignClient,
    reader: ReadonlyEformsignFileReader,
    accessToken: string,
    documentId = CONTRACT_DATE_UPDATE_DOCUMENT_ID,
    componentReader?: ReadonlyEformsignComponentReader,
): Promise<ContractDateEvidence> {
    if (documentId !== CONTRACT_DATE_UPDATE_DOCUMENT_ID) {
        throw new NotVerifiedError("document id is outside the exact allowlist");
    }
    let phase = "document detail";
    try {
        const document = await client.getDocument(accessToken, documentId);
        phase = "document PDF";
        const pdf = await readPdfEvidence(reader, accessToken, documentId);
        phase = "document fields";
        let signatureHashes = extractSignatureHashes(document);
        const signatureComponentNames = getSignatureComponentNames(document);
        const componentNames = getDocumentComponentNames(document);
        let signatureComponentResults: DocumentComponentEvidence[] = [];
        if (componentReader) {
            phase = "document components";
            signatureComponentResults = await componentReader.getDocumentComponents(
                accessToken,
                documentId,
                componentNames,
            );
            const signatureNameSet = new Set(signatureComponentNames);
            signatureHashes = [...new Set([
                ...signatureHashes,
                ...signatureComponentResults
                    .filter((component) => signatureNameSet.has(component.name))
                    .map((component) => component.valueHash)
                    .filter((hash): hash is string => hash !== null),
            ])].sort();
        }
        const moneyFields = extractMoneyFields(document);
        return {
            id: document.id,
            title: document.document_name,
            templateId: document.template.id,
            statusType: document.current_status.status_type,
            stepType: document.current_status.step_type,
            stepName: document.current_status.step_name,
            endDate: extractDate(document, {
                year: [EFORMSIGN_END_DATE_FIELD_IDS.year],
                month: [EFORMSIGN_END_DATE_FIELD_IDS.month],
                day: [EFORMSIGN_END_DATE_FIELD_IDS.day],
            }),
            receiptPeriods: extractReceiptPeriods(document),
            paymentDate: extractDate(document, PAYMENT_FIELD_ALIASES),
            moneyFields,
            signatureHashes,
            componentNames,
            signatureComponentNames,
            signatureComponentResults,
            pdf,
        };
    } catch (error) {
        if (error instanceof NotVerifiedError) throw error;
        const errorRecord = asRecord(error);
        const errorName = error instanceof Error
            ? error.name
            : typeof errorRecord?.["name"] === "string"
                ? errorRecord["name"]
                : typeof error;
        throw new NotVerifiedError(`${phase} could not be read (${errorName})`);
    }
}

export function verifyBaselineEvidence(
    evidence: ContractDateEvidence,
): VerificationResult<ContractDateEvidence> {
    if (evidence.id !== CONTRACT_DATE_UPDATE_DOCUMENT_ID) {
        return { status: "not_verified", reason: "vendor returned a different document id" };
    }
    if (evidence.title !== CONTRACT_DATE_UPDATE_DOCUMENT_TITLE) {
        return { status: "not_verified", reason: "vendor document title did not match the allowlist" };
    }
    if (evidence.templateId !== CONTRACT_DATE_UPDATE_TEMPLATE_ID) {
        return { status: "not_verified", reason: "vendor template id did not match the allowlist" };
    }
    if (EFORMSIGN_COMPLETED_STATUS_CODES.has(evidence.statusType)) {
        return { status: "not_verified", reason: "document was already in a completed status" };
    }
    // The reviewed document is an eformsign temporary-save representation. Its
    // API status remains 001/05 while the participant label is "제공기관 확인";
    // do not generalize this exception to other documents or workflow stages.
    if (evidence.statusType !== "001" || evidence.stepType !== "05" || evidence.stepName !== "제공기관 확인") {
        return { status: "not_verified", reason: "document was not at the provider confirmation step" };
    }
    if (evidence.endDate !== CONTRACT_DATE_UPDATE_BASELINE_END_DATE) {
        return { status: "not_verified", reason: "saved contract end date was not 2027-01-04" };
    }
    if (!evidence.receiptPeriods.includes(CONTRACT_DATE_UPDATE_BASELINE_RECEIPT_PERIOD)) {
        return { status: "not_verified", reason: "saved receipt period was not 20260709~20270104" };
    }
    if (evidence.paymentDate !== CONTRACT_DATE_UPDATE_PAYMENT_DATE) {
        return { status: "not_verified", reason: "payment date was missing or differed from 2026-07-09" };
    }
    if (
        evidence.receiptPeriods.some((period) => period !== CONTRACT_DATE_UPDATE_BASELINE_RECEIPT_PERIOD)
        || evidence.pdf.hasEndDate && evidence.pdf.hasOldEndDate
        || evidence.pdf.hasReceiptPeriod && evidence.pdf.hasOldReceiptPeriod
    ) {
        return { status: "not_verified", reason: "downloaded PDF or detail fields contained contradictory date markers" };
    }
    if (MONEY_FIELD_ALIASES.some((alias) => {
        const values = evidence.moneyFields[alias] ?? [];
        return values.length !== 1 || values[0] !== CONTRACT_DATE_UPDATE_BASELINE_MONEY[alias];
    })) {
        return { status: "not_verified", reason: "one or more immutable money fields contained contradictory values" };
    }
    if (
        evidence.pdf.exportedPdfStale
    ) {
        return { status: "not_verified", reason: "exported_pdf_stale: downloaded PDF still contains the pre-save dates" };
    }
    if (evidence.signatureHashes.length === 0) {
        return { status: "not_verified", reason: "original user signature value was unavailable for hashing" };
    }
    if (!evidence.pdf.hasEndDate || !evidence.pdf.hasReceiptPeriod || evidence.pdf.receiptPeriodOccurrences < 2) {
        return { status: "not_verified", reason: "downloaded PDF did not expose both saved date markers and both receipt occurrences" };
    }
    return { status: "pass", value: evidence };
}

export function immutableEvidenceEqual(
    before: ContractDateEvidence,
    after: ContractDateEvidence,
): boolean {
    return before.id === after.id
        && before.title === after.title
        && before.templateId === after.templateId
        && before.statusType === after.statusType
        && before.stepType === after.stepType
        && before.stepName === after.stepName
        && before.paymentDate === after.paymentDate
        && JSON.stringify(before.moneyFields) === JSON.stringify(after.moneyFields)
        && JSON.stringify(before.signatureComponentNames) === JSON.stringify(after.signatureComponentNames)
        && JSON.stringify(before.signatureHashes) === JSON.stringify(after.signatureHashes);
}
