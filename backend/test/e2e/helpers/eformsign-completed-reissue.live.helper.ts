import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, open, readdir, readFile, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { spawn } from "node:child_process";

import type {
    CreateDocumentPayload,
    CreateDocumentResponse,
    EformsignApiDocumentResponse,
} from "domain/repositories/eformsign.client.interface";
import { EformsignApiError } from "infrastructure/api/eformsign-api.error";

export const EFORMSIGN_COMPLETED_REISSUE_SOURCE_ID = "4f58a134b5864ecf9af283607cebba9d";
export const EFORMSIGN_COMPLETED_REISSUE_TEMPLATE_ID = "27f092d3bdba4777835187facd7468a6";
export const EFORMSIGN_COMPLETED_REISSUE_SOURCE_STATUS_TYPE = "003";
export const EFORMSIGN_COMPLETED_REISSUE_SOURCE_END_DATE = "2027-01-04";
export const EFORMSIGN_COMPLETED_REISSUE_SOURCE_PERIOD = "20260709~20270104";
export const EFORMSIGN_COMPLETED_REISSUE_SOURCE_START_DATE = "2026-07-09";
export const EFORMSIGN_COMPLETED_REISSUE_SOURCE_PAYMENT_DATE = "2026-07-09";
export const EFORMSIGN_COMPLETED_REISSUE_SOURCE_PDF_BYTES = 752385;
export const EFORMSIGN_COMPLETED_REISSUE_SOURCE_PDF_SHA256 =
    "40c118c2309a9979e33fbfe9ee922eef4c803c2ca9b2ceb3843761694fef1027";
export const EFORMSIGN_COMPLETED_REISSUE_TARGET_END_DATE = "2027-01-07";
export const EFORMSIGN_COMPLETED_REISSUE_TARGET_PERIOD = "20260709~20270107";
export const EFORMSIGN_COMPLETED_REISSUE_TARGET_PERIOD_DISPLAY = "20260709 ~ 20270107";
export const EFORMSIGN_COMPLETED_REISSUE_INTERNAL_RECIPIENT_ID =
    "142f6049d9af43e19b32ddf4c5139120";
export const EFORMSIGN_COMPLETED_REISSUE_EXPECTED_IDENTITY_FINGERPRINT =
    "45700d0327a1fd9f8aae02fada5c9dc405fbb0bc3f0c967517c57c5d9b55b37c";
export const EFORMSIGN_COMPLETED_REISSUE_NEW_USER_STATUS_TYPE = "060";
export const EFORMSIGN_COMPLETED_REISSUE_NEW_USER_STEP_TYPE = "05";
export const EFORMSIGN_COMPLETED_REISSUE_NEW_USER_STEP_INDEX = "2";
export const EFORMSIGN_COMPLETED_REISSUE_NEW_USER_STEP_GROUP = 3;
// The signed user advances the fresh contract to the internal provider participant
// while the workflow remains in the nonterminal participant status family.
export const EFORMSIGN_COMPLETED_REISSUE_PROVIDER_STATUS_TYPE = "060";
export const EFORMSIGN_COMPLETED_REISSUE_PROVIDER_STEP_TYPE = "05";
export const EFORMSIGN_COMPLETED_REISSUE_PROVIDER_STEP_INDEX = "3";
export const EFORMSIGN_COMPLETED_REISSUE_PROVIDER_STEP_GROUP = 4;
export const EFORMSIGN_COMPLETED_REISSUE_LEDGER_DIRECTORY =
    "/Users/jaino/.local/state/babyjamjam/phase0-completed-reissue";

export const EFORMSIGN_COMPLETED_REISSUE_SUITE_NAME = "Phase 0 completed contract reissue";
export const EFORMSIGN_COMPLETED_REISSUE_CREATE_TEST_NAME =
    "creates one fresh user-signature request from the immutable completed source with target dates";
export const EFORMSIGN_COMPLETED_REISSUE_FOLLOWUP_TEST_NAME =
    "reads the durable new document after user signature without mutating the vendor document";
export const EFORMSIGN_COMPLETED_REISSUE_CREATE_FULL_TEST_NAME =
    `${EFORMSIGN_COMPLETED_REISSUE_SUITE_NAME} ${EFORMSIGN_COMPLETED_REISSUE_CREATE_TEST_NAME}`;
export const EFORMSIGN_COMPLETED_REISSUE_FOLLOWUP_FULL_TEST_NAME =
    `${EFORMSIGN_COMPLETED_REISSUE_SUITE_NAME} ${EFORMSIGN_COMPLETED_REISSUE_FOLLOWUP_TEST_NAME}`;

export const EFORMSIGN_COMPLETED_REISSUE_ALLOWLIST_FIELD_IDS = [
    "이용자 성명",
    "이용자 생년월일",
    "이용자 주소",
    "이용자 연락처",
    "계약 시작 년도",
    "계약 시작 월",
    "계약 시작 일",
    "계약 종료 년도",
    "계약 종료 월",
    "계약 종료 일",
    "서비스 비용",
    "정부지원금",
    "본인부담금",
    "서비스 가격",
    "본인부담금 수령 년도",
    "본인부담금 수령 월",
    "본인부담금 수령 일",
    "서비스 기간",
] as const;

const PROTECTED_DOCUMENT_IDS = new Set([
    EFORMSIGN_COMPLETED_REISSUE_SOURCE_ID,
    "d5adcc5ecd99431f841151a0c7540759",
    "27e3c3287859433dbd8a680525c5338d",
]);
const SOURCE_DATE_FIELD_IDS = ["계약 시작 년도", "계약 시작 월", "계약 시작 일"] as const;
const SOURCE_END_DATE_FIELD_IDS = ["계약 종료 년도", "계약 종료 월", "계약 종료 일"] as const;
const PAYMENT_DATE_FIELD_IDS = [
    "본인부담금 수령 년도",
    "본인부담금 수령 월",
    "본인부담금 수령 일",
] as const;
const MONEY_FIELD_IDS = ["서비스 비용", "정부지원금", "본인부담금"] as const;
const FORBIDDEN_FIELD_PATTERN = /(서명|signature|stamp|도장|동의|consent|제공인력|provider|staff)/i;
const SECURE_DIRECTORY_MODE = 0o700;
const SECURE_FILE_MODE = 0o600;
const PDF_TEXT_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const PDF_POLL_DELAYS_MS = [0, 250, 500] as const;
const PDF_RETRYABLE_STATUSES = new Set([200, 202, 404, 409, 425, 429, 500, 502, 503, 504]);
const MIN_EXPECTED_PERIOD_OCCURRENCES = 2;
const PDF_DOCUMENT_FILE_TYPE = "document" as const;
const TEMPLATE_CONFIG_TIMEOUT_MS = 15_000;
const PDF_TEXT_EXTRACTOR_PATH = join(__dirname, "contract-date-update.pdf-text.mjs");

export interface CompletedReissueDownload {
    status: number;
    contentType: string;
    contentDisposition: string | null;
    body: Buffer;
}

export interface CompletedReissueFileReader {
    downloadDocumentFile(
        accessToken: string,
        documentId: string,
        fileType?: "document" | "audit_trail",
    ): Promise<CompletedReissueDownload>;
}

export interface CompletedReissueApiBoundary {
    getDocument(accessToken: string, documentId: string): Promise<EformsignApiDocumentResponse>;
    createDocument(accessToken: string, payload: CreateDocumentPayload): Promise<CreateDocumentResponse>;
}

export interface CompletedReissueTemplateReader {
    getTemplateConfig(accessToken: string, templateId: string): Promise<unknown>;
}

export interface CompletedReissueConfigReader {
    get(propertyPath: string): unknown;
}

export interface CompletedReissuePdfExpectation {
    endDate: string;
    period: string;
    forbiddenEndDate?: string;
    forbiddenPeriod?: string;
}

export interface CompletedReissuePdfEvidence {
    sha256: string;
    byteLength: number;
    pageCount: number;
    hasExpectedEndDate: boolean;
    hasExpectedPeriod: boolean;
    expectedPeriodOccurrences: number;
    hasForbiddenEndDate: boolean;
    hasForbiddenPeriod: boolean;
    forbiddenPeriodOccurrences: number;
}

export interface CompletedReissuePdfRead {
    body: Buffer;
    evidence: CompletedReissuePdfEvidence;
    attempts: number;
    statuses: number[];
}

export interface CompletedReissueTemplateStep {
    sequence: number;
    type: string;
    stepGroup: number;
    recipientCount: number;
    recipientId: string | null;
    recipientType: string | null;
    specifiedRecipientType: string | null;
    specifiedRecipientSequence: number | null;
    useRecipientSpecified: boolean;
    rejectRestricted: boolean | null;
}

export interface CompletedReissueTemplateTopology {
    templateId: string;
    version: string;
    enabled: true;
    released: true;
    steps: CompletedReissueTemplateStep[];
}

export interface CompletedReissueIdentity {
    name: string;
    phone: string;
    fingerprint: string;
}

export interface CompletedReissueDocumentSnapshot {
    documentId: string;
    templateId: string;
    statusType: string;
    stepType: string;
    stepIndex: string;
    stepGroup: number;
    fieldCount: number;
    fieldVectorHash: string;
    stageHash: string;
    historyHash: string;
    previousStatusHash: string;
    nextStatusHash: string;
    recipientsHash: string;
    documentNameHash: string;
}

export interface CompletedReissuePreflight {
    sourceId: string;
    sourceTemplateId: string;
    sourceStatusType: string;
    sourceIdentity: CompletedReissueIdentity;
    sourceFieldValues: Readonly<Record<string, string>>;
    sourceSnapshot: CompletedReissueDocumentSnapshot;
    sourcePdf: CompletedReissuePdfEvidence;
    template: CompletedReissueTemplateTopology;
    targetEndDate: string;
    targetPeriod: string;
    canonicalPayloadHash: string;
    operationKey: string;
    payload: CreateDocumentPayload;
}

export type CompletedReissueLedgerStatus = "created" | "prework_rejected" | "ambiguous";

export interface CompletedReissueLedgerResult {
    schemaVersion: 1;
    status: CompletedReissueLedgerStatus;
    operationKey: string;
    sourceId: string;
    templateId: string;
    templateVersion: string;
    targetEndDate: string;
    targetPeriod: string;
    recipientFingerprint: string;
    canonicalPayloadHash: string;
    documentId: string | null;
    artifactDirectory: string;
    createdAt: string;
}

export interface CompletedReissueLedgerReservation {
    markerPath: string;
    resultPath: string;
    acceptancePath: string;
    artifactDirectory: string;
    createdAt: string;
}

export interface CompletedReissueSafeSummary {
    status: string;
    operationKey: string;
    sourceId: string;
    templateId: string;
    templateVersion: string;
    targetEndDate: string;
    targetPeriod: string;
    recipientFingerprint: string;
    canonicalPayloadHash: string;
    documentId: string | null;
    artifactDirectory: string;
    visualInspection: "pending";
}

export interface CompletedReissueProbeResult extends CompletedReissueSafeSummary {
    sourcePdfSha256: string;
    sourcePdfBytes: number;
    newPdfSha256: string;
    newPdfBytes: number;
    newPdfAttempts: number;
}

export interface CompletedReissueProbeOptions {
    accessToken: string;
    api: CompletedReissueApiBoundary;
    fileReader: CompletedReissueFileReader;
    templateReader: CompletedReissueTemplateReader;
    ledgerDirectory?: string;
    now?: () => Date;
    logger?: (event: Record<string, string | number | null>) => void;
    /** Offline fixture seam; live execution keeps the reviewed source fingerprint default. */
    expectedIdentityFingerprint?: string;
    readPdf?: (
        reader: CompletedReissueFileReader,
        accessToken: string,
        documentId: string,
        expectation: CompletedReissuePdfExpectation,
    ) => Promise<CompletedReissuePdfRead>;
}

export interface CompletedReissueFollowupOptions {
    accessToken: string;
    api: Pick<CompletedReissueApiBoundary, "getDocument">;
    fileReader: CompletedReissueFileReader;
    ledgerDirectory?: string;
    readPdf?: (
        reader: CompletedReissueFileReader,
        accessToken: string,
        documentId: string,
        expectation: CompletedReissuePdfExpectation,
    ) => Promise<CompletedReissuePdfRead>;
}

export async function fetchCompletedReissueTemplateConfig(
    configReader: CompletedReissueConfigReader,
    accessToken: string,
    templateId = EFORMSIGN_COMPLETED_REISSUE_TEMPLATE_ID,
): Promise<unknown> {
    if (templateId !== EFORMSIGN_COMPLETED_REISSUE_TEMPLATE_ID) {
        throw new CompletedReissueNotVerifiedError("template request id is outside the exact allowlist");
    }
    const configuredBase = configReader.get("EFORMSIGN_DOC_API_URL");
    const baseUrl = typeof configuredBase === "string" ? configuredBase.trim().replace(/\/+$/, "") : "";
    if (!baseUrl) throw new CompletedReissueNotVerifiedError("template API base is missing");
    if (!accessToken.trim()) throw new CompletedReissueNotVerifiedError("template API access token is empty");
    const response = await fetch(
        `${baseUrl}/v2.0/api/forms/${encodeURIComponent(templateId)}?is_include_config=true`,
        {
            method: "GET",
            headers: { Authorization: `Bearer ${accessToken}` },
            redirect: "error",
            signal: AbortSignal.timeout(TEMPLATE_CONFIG_TIMEOUT_MS),
        },
    );
    if (!response.ok) throw new CompletedReissueNotVerifiedError(`template request returned ${response.status}`);
    return response.json();
}

export class CompletedReissueNotVerifiedError extends Error {
    constructor(reason: string) {
        super(reason);
        this.name = "CompletedReissueNotVerifiedError";
    }
}

export class CompletedReissueAlreadyAttemptedError extends CompletedReissueNotVerifiedError {
    constructor() {
        super("completed reissue ledger marker already exists");
        this.name = "CompletedReissueAlreadyAttemptedError";
    }
}

export class CompletedReissuePreworkRejectedError extends CompletedReissueNotVerifiedError {
    constructor() {
        super("completed reissue create was rejected before provider work");
        this.name = "CompletedReissuePreworkRejectedError";
    }
}

export class CompletedReissueAmbiguousError extends CompletedReissueNotVerifiedError {
    constructor() {
        super("completed reissue create outcome is ambiguous; do not retry");
        this.name = "CompletedReissueAmbiguousError";
    }
}

export class CompletedReissuePostconditionError extends CompletedReissueNotVerifiedError {
    constructor(reason = "completed reissue postcondition failed") {
        super(reason);
        this.name = "CompletedReissuePostconditionError";
    }
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function stringValue(value: unknown, allowEmpty = false): string | null {
    if (typeof value === "string") {
        const result = value.trim();
        return result || (allowEmpty ? "" : null);
    }
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    return null;
}

function requiredString(value: unknown, reason: string): string {
    const result = stringValue(value);
    if (!result) throw new CompletedReissueNotVerifiedError(reason);
    return result;
}

function requiredNumber(value: unknown, reason: string): number {
    const number = typeof value === "number"
        ? value
        : typeof value === "string" && /^-?\d+$/.test(value.trim())
            ? Number(value)
            : Number.NaN;
    if (!Number.isSafeInteger(number)) throw new CompletedReissueNotVerifiedError(reason);
    return number;
}

function requiredBoolean(value: unknown, reason: string): boolean {
    if (typeof value !== "boolean") throw new CompletedReissueNotVerifiedError(reason);
    return value;
}

function requiredArray(record: Record<string, unknown>, key: string): unknown[] {
    if (!Array.isArray(record[key])) {
        throw new CompletedReissueNotVerifiedError(`template ${key} metadata missing`);
    }
    return record[key] as unknown[];
}

function firstDefined(record: Record<string, unknown>, keys: readonly string[]): unknown {
    for (const key of keys) {
        if (record[key] !== undefined && record[key] !== null) return record[key];
    }
    return undefined;
}

function sha256Hex(value: string | Buffer): string {
    return createHash("sha256").update(value).digest("hex");
}

export function canonicalJson(value: unknown): string {
    if (value === null || typeof value !== "object") {
        const primitive = JSON.stringify(value);
        return primitive === undefined ? "null" : primitive;
    }
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => (
        `${JSON.stringify(key)}:${canonicalJson(record[key])}`
    )).join(",")}}`;
}

export function normalizeDigits(value: string): string {
    return value.normalize("NFKC").replace(/\D/g, "");
}

export function completedReissueIdentityFingerprint(
    sourceId: string,
    sourceName: string,
    sourcePhone: string,
): string {
    return sha256Hex(JSON.stringify([
        sourceId,
        sourceName.trim(),
        normalizeDigits(sourcePhone),
    ]));
}

export function exactJestTestNamePattern(fullTestName: string): string {
    return `^${fullTestName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`;
}

export function hasExactJestTestNameSelector(
    fullTestName: string,
    argv = process.argv,
): boolean {
    const expected = exactJestTestNamePattern(fullTestName);
    const selectors: string[] = [];
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (!argument) continue;
        if (
            argument === "--watch"
            || argument.startsWith("--watch=")
            || argument === "--watchAll"
            || argument.startsWith("--watchAll=")
            || argument === "--watch-all"
            || argument.startsWith("--watch-all=")
            || argument === "-w"
            || argument.startsWith("-w=")
        ) {
            return false;
        }
        if (argument.startsWith("--testNamePattern=")) {
            selectors.push(argument.slice("--testNamePattern=".length));
            continue;
        }
        if (argument.startsWith("--test-name-pattern=")) {
            selectors.push(argument.slice("--test-name-pattern=".length));
            continue;
        }
        if (argument.startsWith("-t=")) {
            selectors.push(argument.slice("-t=".length));
            continue;
        }
        if (argument === "--testNamePattern" || argument === "--test-name-pattern" || argument === "-t") {
            const value = argv[index + 1];
            if (!value) return false;
            selectors.push(value);
            index += 1;
        }
    }
    return selectors.length === 1 && selectors[0] === expected;
}

export function isCompletedReissueLiveGate(
    fullTestName: string,
    env = process.env,
    argv = process.argv,
): boolean {
    return env["LIVE_E2E"] === "1" && hasExactJestTestNameSelector(fullTestName, argv);
}

interface SourceFieldEntry {
    id: string;
    value: string;
    type: string;
}

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

function primitiveValue(value: unknown): string | null {
    if (typeof value === "string") return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    return null;
}

function collectFieldEntries(value: unknown, output: SourceFieldEntry[] = [], depth = 0): SourceFieldEntry[] {
    if (depth > 12 || value === null || value === undefined) return output;
    if (Array.isArray(value)) {
        value.forEach((item) => collectFieldEntries(item, output, depth + 1));
        return output;
    }
    const record = asRecord(value);
    if (!record) return output;
    const id: string | null = FIELD_IDENTIFIER_KEYS
        .map((key) => stringValue(record[key]))
        .find((candidate): candidate is string => Boolean(candidate)) ?? null;
    const fieldValue: string | null = FIELD_VALUE_KEYS
        .map((key) => primitiveValue(record[key]))
        .find((item): item is string => item !== null && item !== undefined) ?? null;
    const type = FIELD_TYPE_KEYS.map((key) => stringValue(record[key], true)).find((item) => item !== null) ?? "";
    if (id && fieldValue !== null) {
        if (!output.some((entry) => entry.id === id && entry.value === fieldValue && entry.type === type)) {
            output.push({ id, value: fieldValue, type });
        }
    }
    Object.values(record).forEach((child) => {
        if (child && typeof child === "object") collectFieldEntries(child, output, depth + 1);
    });
    return output;
}

function getFieldEntries(document: EformsignApiDocumentResponse): SourceFieldEntry[] {
    return collectFieldEntries(document.fields).concat(collectFieldEntries(document.detail_template_info));
}

function normalizeFieldId(value: string): string {
    return value.normalize("NFKC").toLowerCase().replace(/[\s_\-:/]/g, "");
}

function buildFieldIndex(document: EformsignApiDocumentResponse): Map<string, SourceFieldEntry[]> {
    const index = new Map<string, SourceFieldEntry[]>();
    for (const entry of getFieldEntries(document)) {
        const key = normalizeFieldId(entry.id);
        const existing = index.get(key) ?? [];
        if (!existing.some((candidate) => candidate.value === entry.value && candidate.type === entry.type)) {
            existing.push(entry);
        }
        index.set(key, existing);
    }
    return index;
}

function readUniqueField(index: Map<string, SourceFieldEntry[]>, fieldId: string): string {
    const candidates = index.get(normalizeFieldId(fieldId));
    if (!candidates || candidates.length !== 1 || !candidates[0]) {
        throw new CompletedReissueNotVerifiedError(`source field ${fieldId} is missing or contradictory`);
    }
    if (!candidates[0].value.trim()) {
        throw new CompletedReissueNotVerifiedError(`source field ${fieldId} is empty`);
    }
    return candidates[0].value;
}

function readSourceFieldValues(document: EformsignApiDocumentResponse): Record<string, string> {
    const index = buildFieldIndex(document);
    const result: Record<string, string> = {};
    for (const fieldId of EFORMSIGN_COMPLETED_REISSUE_ALLOWLIST_FIELD_IDS) {
        result[fieldId] = readUniqueField(index, fieldId);
    }
    return result;
}

function parseDateParts(yearValue: string, monthValue: string, dayValue: string): string {
    const yearDigits = yearValue.replace(/\D/g, "");
    const monthDigits = monthValue.replace(/\D/g, "");
    const dayDigits = dayValue.replace(/\D/g, "");
    if ((yearDigits.length !== 2 && yearDigits.length !== 4) || monthDigits.length < 1 || dayDigits.length < 1) {
        throw new CompletedReissueNotVerifiedError("date field shape is unknown");
    }
    const year = yearDigits.length === 2 ? `20${yearDigits}` : yearDigits.slice(0, 4);
    const month = monthDigits.padStart(2, "0").slice(-2);
    const day = dayDigits.padStart(2, "0").slice(-2);
    if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > 31) {
        throw new CompletedReissueNotVerifiedError("date field value is invalid");
    }
    return `${year}-${month}-${day}`;
}

function dateFromFields(values: Readonly<Record<string, string>>, ids: readonly [string, string, string]): string {
    const year = values[ids[0]];
    const month = values[ids[1]];
    const day = values[ids[2]];
    if (year === undefined || month === undefined || day === undefined) {
        throw new CompletedReissueNotVerifiedError("date field vector is incomplete");
    }
    return parseDateParts(year, month, day);
}

function parseDateText(value: string): string {
    const digits = value.replace(/\D/g, "");
    if (digits.length === 8) return parseDateParts(digits.slice(0, 4), digits.slice(4, 6), digits.slice(6, 8));
    if (digits.length === 6) return parseDateParts(digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 6));
    const match = value.match(/(\d{2,4})\D+(\d{1,2})\D+(\d{1,2})/);
    if (!match?.[1] || !match[2] || !match[3]) throw new CompletedReissueNotVerifiedError("period date shape is unknown");
    return parseDateParts(match[1], match[2], match[3]);
}

function normalizePeriod(value: string): string {
    const parts = value.split(/\s*~\s*/);
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
        throw new CompletedReissueNotVerifiedError("service period shape is unknown");
    }
    return `${parseDateText(parts[0]).replace(/-/g, "")}~${parseDateText(parts[1]).replace(/-/g, "")}`;
}

function normalizeMoney(value: string): string {
    const digits = value.replace(/[^\d]/g, "");
    if (!digits) throw new CompletedReissueNotVerifiedError("money field is empty");
    return digits;
}

function sourceIdentity(
    values: Readonly<Record<string, string>>,
    expectedFingerprint = EFORMSIGN_COMPLETED_REISSUE_EXPECTED_IDENTITY_FINGERPRINT,
): CompletedReissueIdentity {
    const name = values["이용자 성명"];
    const phone = values["이용자 연락처"];
    if (!name || !phone || normalizeDigits(phone).length < 9) {
        throw new CompletedReissueNotVerifiedError("source user identity fields are incomplete");
    }
    const fingerprint = completedReissueIdentityFingerprint(
        EFORMSIGN_COMPLETED_REISSUE_SOURCE_ID,
        name,
        phone,
    );
    if (fingerprint !== expectedFingerprint) {
        throw new CompletedReissueNotVerifiedError("source user identity is outside the exact allowlist");
    }
    return { name, phone, fingerprint };
}

export function completedReissueOperationKey(
    sourceId: string,
    templateId: string,
    targetEndDate: string,
    recipient: { name: string; sms: string },
): string {
    return completedReissueOperationKeyFromFingerprint(
        sourceId,
        templateId,
        targetEndDate,
        completedReissueIdentityFingerprint(sourceId, recipient.name, recipient.sms),
    );
}

export function completedReissueOperationKeyFromFingerprint(
    sourceId: string,
    templateId: string,
    targetEndDate: string,
    recipientFingerprint: string,
): string {
    return sha256Hex(canonicalJson([
        sourceId,
        templateId,
        targetEndDate,
        { recipientFingerprint },
    ]));
}

function safeHashUnknown(value: unknown): string {
    return sha256Hex(canonicalJson(value));
}

function safeRecipientProjection(value: unknown): unknown {
    const record = asRecord(value);
    if (!record) return null;
    return {
        recipientType: stringValue(record["recipient_type"]),
        idHash: stringValue(record["id"]) ? sha256Hex(stringValue(record["id"]) as string) : null,
        nameHash: stringValue(record["name"]) ? sha256Hex(stringValue(record["name"]) as string) : null,
        smsHash: stringValue(record["sms"]) ? sha256Hex(stringValue(record["sms"]) as string) : null,
    };
}

export function snapshotCompletedReissueDocument(
    document: EformsignApiDocumentResponse,
): CompletedReissueDocumentSnapshot {
    const fields = getFieldEntries(document)
        .map((field) => ({ id: field.id, type: field.type, valueHash: sha256Hex(field.value) }))
        .sort((left, right) => canonicalJson(left).localeCompare(canonicalJson(right)));
    const currentStatus = document.current_status;
    return {
        documentId: document.id,
        templateId: document.template?.id ?? "",
        statusType: currentStatus?.status_type ?? "",
        stepType: currentStatus?.step_type ?? "",
        stepIndex: currentStatus?.step_index ?? "",
        stepGroup: currentStatus?.step_group ?? -1,
        fieldCount: fields.length,
        fieldVectorHash: sha256Hex(canonicalJson(fields)),
        stageHash: safeHashUnknown({
            statusType: currentStatus?.status_type,
            stepType: currentStatus?.step_type,
            stepIndex: currentStatus?.step_index,
            stepGroup: currentStatus?.step_group,
            expiredDate: currentStatus?.expired_date,
            expired: currentStatus?._expired,
            stepRecipients: currentStatus?.step_recipients?.map(safeRecipientProjection),
        }),
        historyHash: safeHashUnknown(document.histories ?? null),
        previousStatusHash: safeHashUnknown(document.previous_status ?? null),
        nextStatusHash: safeHashUnknown(document.next_status ?? null),
        recipientsHash: safeHashUnknown(document.recipients ?? null),
        documentNameHash: safeHashUnknown(document.document_name ?? null),
    };
}

function readRecipientId(value: unknown): string {
    const record = asRecord(value);
    if (!record) throw new CompletedReissueNotVerifiedError("template recipient metadata missing");
    const group = asRecord(record["group"]);
    const member = asRecord(record["member"]);
    return requiredString(
        firstDefined(group ?? {}, ["id"]) ?? firstDefined(member ?? {}, ["id"]) ?? record["id"],
        "template recipient identity metadata missing",
    );
}

function readRecipientType(value: unknown): string {
    const record = asRecord(value);
    if (!record) throw new CompletedReissueNotVerifiedError("template recipient metadata missing");
    return requiredString(
        firstDefined(record, ["receipient_type", "recipient_type", "type"]),
        "template recipient type metadata missing",
    ).toLowerCase();
}

function parseTemplateStep(value: unknown): CompletedReissueTemplateStep {
    const step = asRecord(value);
    if (!step) throw new CompletedReissueNotVerifiedError("template step metadata missing");
    const option = asRecord(step["option"]) ?? {};
    const sequence = requiredNumber(
        firstDefined(step, ["seq", "step_seq", "step_index"]),
        "template step sequence metadata missing",
    );
    const type = requiredString(step["type"], "template step type metadata missing").toLowerCase();
    const stepGroup = requiredNumber(step["step_group"], "template step group metadata missing");
    const recipients = [2, 3, 4].includes(sequence)
        ? requiredArray(option, "receipients")
        : Array.isArray(option["receipients"]) ? option["receipients"] as unknown[] : [];
    const specifiedRecipientType = stringValue(firstDefined(option, ["specified_recipient_type"])
        ?? firstDefined(step, ["specified_recipient_type"]));
    const specifiedSequenceValue = firstDefined(option, ["specified_recipient_seq"])
        ?? firstDefined(step, ["specified_recipient_seq"]);
    const specifiedRecipientSequence = specifiedSequenceValue === undefined
        ? null
        : requiredNumber(specifiedSequenceValue, "template recipient sequence metadata invalid");
    const useRecipientSpecifiedValue = firstDefined(option, ["use_receipient_specified"])
        ?? firstDefined(step, ["use_receipient_specified"]);
    const useRecipientSpecified = useRecipientSpecifiedValue === undefined
        ? false
        : requiredBoolean(useRecipientSpecifiedValue, "template recipient selection metadata invalid");
    const rejectRestricted = [2, 3, 4].includes(sequence)
        ? requiredBoolean(option["use_reject_restrict"], "template reject metadata missing")
        : null;
    if (rejectRestricted === true) throw new CompletedReissueNotVerifiedError("template reject restriction is enabled");

    if (sequence === 2) {
        if (type !== "participant" || recipients.length !== 0) {
            throw new CompletedReissueNotVerifiedError("template user participant topology is invalid");
        }
        const autoInfo = asRecord(option["outsider_auto_infos"]);
        if (
            stringValue(autoInfo?.["name"]) !== "이용자 성명"
            || stringValue(autoInfo?.["sms_number"]) !== "이용자 연락처"
        ) {
            throw new CompletedReissueNotVerifiedError("template user recipient field mapping is unknown");
        }
    }
    if (sequence === 3) {
        if (
            type !== "participant"
            || recipients.length !== 1
            || readRecipientType(recipients[0]) !== "internal"
            || readRecipientId(recipients[0]) !== EFORMSIGN_COMPLETED_REISSUE_INTERNAL_RECIPIENT_ID
            || specifiedRecipientType !== "groupormember"
            || !useRecipientSpecified
        ) {
            throw new CompletedReissueNotVerifiedError("template internal participant topology is invalid");
        }
    }
    if (sequence === 4) {
        if (
            type !== "reviewer"
            || recipients.length !== 0
            || specifiedRecipientType !== "beforewriter"
            || specifiedRecipientSequence !== 3
            || !useRecipientSpecified
        ) {
            throw new CompletedReissueNotVerifiedError("template reviewer inheritance topology is invalid");
        }
    }

    const recipient = recipients[0];
    return {
        sequence,
        type,
        stepGroup,
        recipientCount: recipients.length,
        recipientId: recipient === undefined ? null : readRecipientId(recipient),
        recipientType: recipient === undefined ? null : readRecipientType(recipient),
        specifiedRecipientType,
        specifiedRecipientSequence,
        useRecipientSpecified,
        rejectRestricted,
    };
}

export function assertCompletedReissueTemplateTopology(value: unknown): CompletedReissueTemplateTopology {
    const root = asRecord(value);
    if (!root) throw new CompletedReissueNotVerifiedError("template response metadata missing");
    const formId = requiredString(
        firstDefined(root, ["form_id", "formId"]),
        "template form id metadata missing",
    );
    if (formId !== EFORMSIGN_COMPLETED_REISSUE_TEMPLATE_ID) {
        throw new CompletedReissueNotVerifiedError("template form id is outside the exact allowlist");
    }
    if (root["enabled"] !== true || root["is_release"] !== true) {
        throw new CompletedReissueNotVerifiedError("template is not enabled and released");
    }
    const version = requiredString(root["version"], "template version metadata missing");
    const config = asRecord(root["config"]);
    if (!config) throw new CompletedReissueNotVerifiedError("template config metadata missing");
    const steps = requiredArray(config, "step_settings")
        .map(parseTemplateStep)
        .sort((left, right) => left.sequence - right.sequence);
    const expectedTypes = ["write", "participant", "participant", "reviewer", "complete"];
    const expectedGroups = [1, 3, 4, 5, 2];
    if (
        steps.length !== expectedTypes.length
        || steps.some((step, index) => (
            step.sequence !== index + 1
            || step.type !== expectedTypes[index]
            || step.stepGroup !== expectedGroups[index]
        ))
        || new Set(steps.map((step) => step.stepGroup)).size !== steps.length
    ) {
        throw new CompletedReissueNotVerifiedError("template workflow topology is unknown");
    }
    return { templateId: formId, version, enabled: true, released: true, steps };
}

function dateVariants(isoDate: string): string[] {
    const [year, month, day] = isoDate.split("-");
    if (!year || !month || !day) return [];
    return [
        `${year}${month}${day}`,
        `${year}-${month}-${day}`,
        `${year}.${month}.${day}`,
        `${year}년${month}월${day}일`,
    ];
}

function periodVariants(period: string): string[] {
    const [start, end] = period.split("~");
    if (!start || !end || start.length !== 8 || end.length !== 8) return [];
    const startIso = `${start.slice(0, 4)}-${start.slice(4, 6)}-${start.slice(6, 8)}`;
    const endIso = `${end.slice(0, 4)}-${end.slice(4, 6)}-${end.slice(6, 8)}`;
    const korean = (iso: string): string => (
        `${iso.slice(0, 4)}년${iso.slice(5, 7)}월${iso.slice(8, 10)}일`
    );
    return [
        `${start}${"~"}${end}`,
        `${startIso}~${endIso}`,
        `${startIso.replace(/-/g, ".")}~${endIso.replace(/-/g, ".")}`,
        `${korean(startIso)}~${korean(endIso)}`,
    ];
}

function compactPdfText(value: string): string {
    return value.normalize("NFKC").replace(/\s+/g, "");
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

export function inspectCompletedReissuePdf(
    body: Buffer,
    pageCount: number,
    text: string,
    expectation: CompletedReissuePdfExpectation,
): CompletedReissuePdfEvidence {
    const compact = compactPdfText(text);
    const expectedPeriodOccurrences = periodVariants(expectation.period)
        .map((variant) => countOccurrences(compact, variant))
        .reduce((max, count) => Math.max(max, count), 0);
    const forbiddenPeriodOccurrences = expectation.forbiddenPeriod
        ? periodVariants(expectation.forbiddenPeriod)
            .map((variant) => countOccurrences(compact, variant))
            .reduce((max, count) => Math.max(max, count), 0)
        : 0;
    return {
        sha256: sha256Hex(body),
        byteLength: body.length,
        pageCount,
        hasExpectedEndDate: dateVariants(expectation.endDate).some((variant) => compact.includes(variant)),
        hasExpectedPeriod: expectedPeriodOccurrences > 0,
        expectedPeriodOccurrences,
        hasForbiddenEndDate: expectation.forbiddenEndDate
            ? dateVariants(expectation.forbiddenEndDate).some((variant) => compact.includes(variant))
            : false,
        hasForbiddenPeriod: forbiddenPeriodOccurrences > 0,
        forbiddenPeriodOccurrences,
    };
}

async function extractPdfText(body: Buffer): Promise<{ pageCount: number; text: string }> {
    return new Promise((resolveResult, reject) => {
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
            if (outputLength > PDF_TEXT_MAX_OUTPUT_BYTES) {
                fail(new CompletedReissueNotVerifiedError("PDF text output exceeded local safety limit"));
                return;
            }
            chunks.push(chunk);
        });
        child.on("error", () => fail(new CompletedReissueNotVerifiedError("PDF text extractor could not start")));
        child.on("close", (code) => {
            if (settled) return;
            if (code !== 0) {
                fail(new CompletedReissueNotVerifiedError("PDF text extractor returned a non-zero status"));
                return;
            }
            try {
                const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
                    pageCount?: unknown;
                    text?: unknown;
                };
                if (!Number.isInteger(parsed.pageCount) || (parsed.pageCount as number) < 1 || typeof parsed.text !== "string") {
                    fail(new CompletedReissueNotVerifiedError("PDF text extractor result shape is unknown"));
                    return;
                }
                settled = true;
                resolveResult({ pageCount: parsed.pageCount as number, text: parsed.text });
            } catch {
                fail(new CompletedReissueNotVerifiedError("PDF text extractor result was unreadable"));
            }
        });
        child.stdin.on("error", () => fail(new CompletedReissueNotVerifiedError("PDF body could not reach extractor")));
        child.stdin.end(body);
    });
}

function assertPdfDownload(download: CompletedReissueDownload): void {
    if (
        !download
        || download.status !== 200
        || !download.contentType.toLowerCase().includes("application/pdf")
        || download.body.length < 5
        || download.body.subarray(0, 5).toString("ascii") !== "%PDF-"
    ) {
        throw new CompletedReissueNotVerifiedError("document download was not a valid PDF");
    }
}

async function readPdfOnce(
    reader: CompletedReissueFileReader,
    accessToken: string,
    documentId: string,
    expectation: CompletedReissuePdfExpectation,
): Promise<CompletedReissuePdfRead> {
    const download = await reader.downloadDocumentFile(accessToken, documentId, PDF_DOCUMENT_FILE_TYPE);
    assertPdfDownload(download);
    const extracted = await extractPdfText(download.body);
    const evidence = inspectCompletedReissuePdf(download.body, extracted.pageCount, extracted.text, expectation);
    return { body: download.body, evidence, attempts: 1, statuses: [download.status] };
}

export async function readCompletedReissuePdf(
    reader: CompletedReissueFileReader,
    accessToken: string,
    documentId: string,
    expectation: CompletedReissuePdfExpectation,
): Promise<CompletedReissuePdfRead> {
    const result = await readPdfOnce(reader, accessToken, documentId, expectation);
    assertCompletedReissuePdfEvidence(result.evidence, expectation);
    return result;
}

export async function readCompletedReissuePdfWithReadonlyPoll(
    reader: CompletedReissueFileReader,
    accessToken: string,
    documentId: string,
    expectation: CompletedReissuePdfExpectation,
    delaysMs: readonly number[] = PDF_POLL_DELAYS_MS,
): Promise<CompletedReissuePdfRead> {
    if (delaysMs.length === 0) throw new CompletedReissueNotVerifiedError("PDF poll has no attempts");
    const statuses: number[] = [];
    let lastReason = "PDF output was not ready";
    for (let index = 0; index < delaysMs.length; index += 1) {
        const delayMs = delaysMs[index] ?? 0;
        if (delayMs > 0) await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, delayMs));
        let responseRecorded = false;
        try {
            const download = await reader.downloadDocumentFile(accessToken, documentId, PDF_DOCUMENT_FILE_TYPE);
            statuses.push(download.status);
            responseRecorded = true;
            if (!PDF_RETRYABLE_STATUSES.has(download.status)) {
                throw new CompletedReissueNotVerifiedError(`PDF read returned status ${download.status}`);
            }
            if (
                download.status !== 200
                || !download.contentType.toLowerCase().includes("application/pdf")
                || download.body.length < 5
                || download.body.subarray(0, 5).toString("ascii") !== "%PDF-"
            ) {
                lastReason = `PDF output status ${download.status} was not ready`;
                continue;
            }
            const extracted = await extractPdfText(download.body);
            const evidence = inspectCompletedReissuePdf(download.body, extracted.pageCount, extracted.text, expectation);
            if (
                evidence.hasExpectedEndDate
                && evidence.hasExpectedPeriod
                && evidence.expectedPeriodOccurrences >= MIN_EXPECTED_PERIOD_OCCURRENCES
                && !evidence.hasForbiddenEndDate
                && !evidence.hasForbiddenPeriod
            ) {
                return { body: download.body, evidence, attempts: index + 1, statuses };
            }
            lastReason = "PDF output did not contain the fresh target markers";
        } catch (error) {
            if (error instanceof CompletedReissueNotVerifiedError) lastReason = error.message;
            else lastReason = "PDF GET failed before a response";
            if (!responseRecorded) statuses.push(0);
        }
    }
    throw new CompletedReissueNotVerifiedError(`${lastReason}; attempts=${statuses.length}`);
}

export function assertCompletedReissuePdfEvidence(
    evidence: CompletedReissuePdfEvidence,
    expectation: CompletedReissuePdfExpectation,
): void {
    if (
        evidence.pageCount < 1
        || !evidence.hasExpectedEndDate
        || !evidence.hasExpectedPeriod
        || evidence.expectedPeriodOccurrences < MIN_EXPECTED_PERIOD_OCCURRENCES
        || evidence.hasForbiddenEndDate
        || evidence.hasForbiddenPeriod
    ) {
        throw new CompletedReissuePostconditionError(
            `PDF markers failed for ${expectation.endDate}/${expectation.period}`,
        );
    }
}

function sourcePdfExpectation(): CompletedReissuePdfExpectation {
    return {
        endDate: EFORMSIGN_COMPLETED_REISSUE_SOURCE_END_DATE,
        period: EFORMSIGN_COMPLETED_REISSUE_SOURCE_PERIOD,
        forbiddenEndDate: EFORMSIGN_COMPLETED_REISSUE_TARGET_END_DATE,
        forbiddenPeriod: EFORMSIGN_COMPLETED_REISSUE_TARGET_PERIOD,
    };
}

function targetPdfExpectation(): CompletedReissuePdfExpectation {
    return {
        endDate: EFORMSIGN_COMPLETED_REISSUE_TARGET_END_DATE,
        period: EFORMSIGN_COMPLETED_REISSUE_TARGET_PERIOD,
        forbiddenEndDate: EFORMSIGN_COMPLETED_REISSUE_SOURCE_END_DATE,
        forbiddenPeriod: EFORMSIGN_COMPLETED_REISSUE_SOURCE_PERIOD,
    };
}

function targetEndFieldValue(sourceValue: string, targetYear: string): string {
    return sourceValue.replace(/\d{2,4}/, (match) => match.length === 4 ? targetYear : targetYear.slice(2));
}

function buildPayload(
    sourceValues: Readonly<Record<string, string>>,
    identity: CompletedReissueIdentity,
    template: CompletedReissueTemplateTopology,
): { requestWithoutIdempotency: Omit<CreateDocumentPayload, "idempotencyKey">; fields: Array<{ id: string; value: string }> } {
    const fields = EFORMSIGN_COMPLETED_REISSUE_ALLOWLIST_FIELD_IDS.map((id) => {
        if (id === "계약 종료 년도") {
            return { id, value: targetEndFieldValue(sourceValues[id] ?? "", "2027") };
        }
        if (id === "계약 종료 월") return { id, value: "01" };
        if (id === "계약 종료 일") return { id, value: "07" };
        if (id === "서비스 기간") return { id, value: EFORMSIGN_COMPLETED_REISSUE_TARGET_PERIOD_DISPLAY };
        const value = sourceValues[id];
        if (value === undefined) throw new CompletedReissueNotVerifiedError(`source field ${id} is unavailable`);
        return { id, value };
    });
    const requestWithoutIdempotency: Omit<CreateDocumentPayload, "idempotencyKey"> = {
        templateId: template.templateId,
        prefillFields: fields,
        recipient: { name: identity.name, sms: identity.phone },
    };
    return { requestWithoutIdempotency, fields };
}

export function assertCompletedReissueCreatePayload(
    payload: CreateDocumentPayload,
    preflight: Pick<CompletedReissuePreflight, "sourceFieldValues" | "sourceIdentity" | "template" | "canonicalPayloadHash" | "operationKey">,
): void {
    if (payload.documentName !== undefined || payload.reviewer !== undefined) {
        throw new CompletedReissueNotVerifiedError("create payload must omit documentName and reviewer");
    }
    if (payload.templateId !== preflight.template.templateId || payload.idempotencyKey !== preflight.operationKey) {
        throw new CompletedReissueNotVerifiedError("create payload identity is not deterministic");
    }
    if (!payload.recipient || payload.recipient.name !== preflight.sourceIdentity.name || normalizeDigits(payload.recipient.sms) !== normalizeDigits(preflight.sourceIdentity.phone)) {
        throw new CompletedReissueNotVerifiedError("create payload recipient does not match the source identity");
    }
    if (
        payload.prefillFields.length !== EFORMSIGN_COMPLETED_REISSUE_ALLOWLIST_FIELD_IDS.length
        || new Set(payload.prefillFields.map((field) => normalizeFieldId(field.id))).size !== payload.prefillFields.length
    ) {
        throw new CompletedReissueNotVerifiedError("create payload field allowlist is not exact");
    }
    const fieldMap = new Map(payload.prefillFields.map((field) => [normalizeFieldId(field.id), field]));
    const allowlist = new Set(EFORMSIGN_COMPLETED_REISSUE_ALLOWLIST_FIELD_IDS.map(normalizeFieldId));
    if ([...fieldMap.keys()].some((id) => !allowlist.has(id))) {
        throw new CompletedReissueNotVerifiedError("create payload contains a non-allowlisted field");
    }
    for (const id of EFORMSIGN_COMPLETED_REISSUE_ALLOWLIST_FIELD_IDS) {
        if (FORBIDDEN_FIELD_PATTERN.test(id)) throw new CompletedReissueNotVerifiedError("forbidden field entered allowlist");
        if (!fieldMap.has(normalizeFieldId(id))) throw new CompletedReissueNotVerifiedError(`create payload omitted ${id}`);
    }
    const endDateFieldSet = new Set<string>(SOURCE_END_DATE_FIELD_IDS);
    for (const id of EFORMSIGN_COMPLETED_REISSUE_ALLOWLIST_FIELD_IDS) {
        if (endDateFieldSet.has(id) || id === "서비스 기간") continue;
        const sourceValue = preflight.sourceFieldValues[id];
        const payloadValue = fieldMap.get(normalizeFieldId(id))?.value;
        if (sourceValue === undefined || payloadValue !== sourceValue) {
            throw new CompletedReissueNotVerifiedError(`create payload changed source field ${id}`);
        }
    }
    const startDate = dateFromFields(preflight.sourceFieldValues, SOURCE_DATE_FIELD_IDS);
    if (startDate !== EFORMSIGN_COMPLETED_REISSUE_SOURCE_START_DATE) {
        throw new CompletedReissueNotVerifiedError("create payload changed source start date");
    }
    const paymentDate = dateFromFields(preflight.sourceFieldValues, PAYMENT_DATE_FIELD_IDS);
    if (paymentDate !== EFORMSIGN_COMPLETED_REISSUE_SOURCE_PAYMENT_DATE) {
        throw new CompletedReissueNotVerifiedError("create payload changed source payment date");
    }
    for (const id of MONEY_FIELD_IDS) {
        const sourceValue = preflight.sourceFieldValues[id];
        const payloadValue = fieldMap.get(normalizeFieldId(id))?.value;
        if (!sourceValue || payloadValue === undefined || normalizeMoney(payloadValue) !== normalizeMoney(sourceValue)) {
            throw new CompletedReissueNotVerifiedError(`create payload changed source money field ${id}`);
        }
    }
    const servicePrice = fieldMap.get(normalizeFieldId("서비스 가격"))?.value;
    if (!servicePrice || normalizeMoney(servicePrice) !== normalizeMoney(preflight.sourceFieldValues["서비스 가격"] ?? "")) {
        throw new CompletedReissueNotVerifiedError("create payload changed source service price");
    }
    if (normalizePeriod(fieldMap.get(normalizeFieldId("서비스 기간"))?.value ?? "") !== EFORMSIGN_COMPLETED_REISSUE_TARGET_PERIOD) {
        throw new CompletedReissueNotVerifiedError("create payload target period is incorrect");
    }
    if (dateFromFields(
        Object.fromEntries(SOURCE_END_DATE_FIELD_IDS.map((id) => [id, fieldMap.get(normalizeFieldId(id))?.value ?? ""])),
        SOURCE_END_DATE_FIELD_IDS,
    ) !== EFORMSIGN_COMPLETED_REISSUE_TARGET_END_DATE) {
        throw new CompletedReissueNotVerifiedError("create payload target end date is incorrect");
    }
    if (canonicalJson({
        templateId: payload.templateId,
        prefillFields: payload.prefillFields,
        recipient: payload.recipient,
    }) === "") {
        throw new CompletedReissueNotVerifiedError("canonical payload was unavailable");
    }
    if (preflight.canonicalPayloadHash.length !== 64) {
        throw new CompletedReissueNotVerifiedError("canonical payload hash was unavailable");
    }
    const canonicalPayloadHash = sha256Hex(canonicalJson({
        templateId: payload.templateId,
        prefillFields: payload.prefillFields,
        recipient: payload.recipient,
    }));
    if (canonicalPayloadHash !== preflight.canonicalPayloadHash) {
        throw new CompletedReissueNotVerifiedError("canonical payload hash does not match the request");
    }
}

export function buildCompletedReissuePreflight(
    source: EformsignApiDocumentResponse,
    template: CompletedReissueTemplateTopology,
    sourcePdf: CompletedReissuePdfEvidence,
    expectedIdentityFingerprint = EFORMSIGN_COMPLETED_REISSUE_EXPECTED_IDENTITY_FINGERPRINT,
): CompletedReissuePreflight {
    if (
        source.id !== EFORMSIGN_COMPLETED_REISSUE_SOURCE_ID
        || source.template?.id !== EFORMSIGN_COMPLETED_REISSUE_TEMPLATE_ID
        || source.current_status?.status_type !== EFORMSIGN_COMPLETED_REISSUE_SOURCE_STATUS_TYPE
    ) {
        throw new CompletedReissueNotVerifiedError("completed source identity or terminal status changed");
    }
    if (
        sourcePdf.sha256 !== EFORMSIGN_COMPLETED_REISSUE_SOURCE_PDF_SHA256
        || sourcePdf.byteLength !== EFORMSIGN_COMPLETED_REISSUE_SOURCE_PDF_BYTES
        || !sourcePdf.hasExpectedEndDate
        || !sourcePdf.hasExpectedPeriod
        || sourcePdf.expectedPeriodOccurrences < MIN_EXPECTED_PERIOD_OCCURRENCES
        || sourcePdf.hasForbiddenEndDate
        || sourcePdf.hasForbiddenPeriod
    ) {
        throw new CompletedReissueNotVerifiedError("completed source PDF is outside the exact baseline");
    }
    if (template.templateId !== EFORMSIGN_COMPLETED_REISSUE_TEMPLATE_ID) {
        throw new CompletedReissueNotVerifiedError("current template identity changed");
    }
    const sourceFieldValues = readSourceFieldValues(source);
    const identity = sourceIdentity(sourceFieldValues, expectedIdentityFingerprint);
    if (dateFromFields(sourceFieldValues, SOURCE_DATE_FIELD_IDS) !== EFORMSIGN_COMPLETED_REISSUE_SOURCE_START_DATE) {
        throw new CompletedReissueNotVerifiedError("source start date changed");
    }
    if (dateFromFields(sourceFieldValues, SOURCE_END_DATE_FIELD_IDS) !== EFORMSIGN_COMPLETED_REISSUE_SOURCE_END_DATE) {
        throw new CompletedReissueNotVerifiedError("source end date baseline changed");
    }
    if (normalizePeriod(sourceFieldValues["서비스 기간"] ?? "") !== EFORMSIGN_COMPLETED_REISSUE_SOURCE_PERIOD) {
        throw new CompletedReissueNotVerifiedError("source service period baseline changed");
    }
    if (dateFromFields(sourceFieldValues, PAYMENT_DATE_FIELD_IDS) !== EFORMSIGN_COMPLETED_REISSUE_SOURCE_PAYMENT_DATE) {
        throw new CompletedReissueNotVerifiedError("source payment date changed");
    }
    const expectedMoney = { "서비스 비용": "1464000", "정부지원금": "1002000", "본인부담금": "462000" };
    for (const id of MONEY_FIELD_IDS) {
        if (normalizeMoney(sourceFieldValues[id] ?? "") !== expectedMoney[id]) {
            throw new CompletedReissueNotVerifiedError(`source money field ${id} changed`);
        }
    }
    if (normalizeMoney(sourceFieldValues["서비스 가격"] ?? "") !== expectedMoney["서비스 비용"]) {
        throw new CompletedReissueNotVerifiedError("source service price changed");
    }
    const { requestWithoutIdempotency } = buildPayload(sourceFieldValues, identity, template);
    const canonicalPayloadHash = sha256Hex(canonicalJson(requestWithoutIdempotency));
    const operationKey = completedReissueOperationKey(
        source.id,
        template.templateId,
        EFORMSIGN_COMPLETED_REISSUE_TARGET_END_DATE,
        { name: identity.name, sms: identity.phone },
    );
    const payload: CreateDocumentPayload = { ...requestWithoutIdempotency, idempotencyKey: operationKey };
    const preflight: CompletedReissuePreflight = {
        sourceId: source.id,
        sourceTemplateId: source.template.id,
        sourceStatusType: source.current_status.status_type,
        sourceIdentity: identity,
        sourceFieldValues,
        sourceSnapshot: snapshotCompletedReissueDocument(source),
        sourcePdf,
        template,
        targetEndDate: EFORMSIGN_COMPLETED_REISSUE_TARGET_END_DATE,
        targetPeriod: EFORMSIGN_COMPLETED_REISSUE_TARGET_PERIOD,
        canonicalPayloadHash,
        operationKey,
        payload,
    };
    assertCompletedReissueCreatePayload(payload, preflight);
    return preflight;
}

export function assertCompletedReissueSourceUnchanged(
    before: CompletedReissuePreflight,
    after: EformsignApiDocumentResponse,
    afterPdf: CompletedReissuePdfEvidence,
): void {
    if (
        canonicalJson(before.sourceSnapshot) !== canonicalJson(snapshotCompletedReissueDocument(after))
        || afterPdf.sha256 !== before.sourcePdf.sha256
        || afterPdf.byteLength !== before.sourcePdf.byteLength
    ) {
        throw new CompletedReissuePostconditionError("immutable completed source changed after create");
    }
}

function readDocumentIdentityFields(document: EformsignApiDocumentResponse): {
    name: string;
    phone: string;
    values: Record<string, string>;
} {
    const values = readSourceFieldValues(document);
    const name = values["이용자 성명"];
    const phone = values["이용자 연락처"];
    if (!name || !phone) throw new CompletedReissuePostconditionError("new document identity fields are missing");
    return { name, phone, values };
}

function assertCurrentRecipientMatchesIdentity(
    document: EformsignApiDocumentResponse,
    identity: CompletedReissueIdentity,
): void {
    const recipients = document.current_status?.step_recipients ?? [];
    if (recipients.length !== 1 || !recipients[0]) {
        throw new CompletedReissuePostconditionError("new user signer recipient shape is unknown");
    }
    const recipient = recipients[0];
    const recipientPhone = normalizeDigits(recipient.sms ?? "");
    const recipientIdDigits = normalizeDigits(recipient.id ?? "");
    const phoneMatches = (recipientPhone && recipientPhone === normalizeDigits(identity.phone))
        || (recipientIdDigits && recipientIdDigits === normalizeDigits(identity.phone));
    const nameMatches = !recipient.name || recipient.name.trim() === identity.name.trim();
    if (!phoneMatches || !nameMatches) {
        throw new CompletedReissuePostconditionError("new user signer recipient does not match the source fingerprint");
    }
}

export function assertCompletedReissueNewUserDocument(
    document: EformsignApiDocumentResponse,
    preflight: CompletedReissuePreflight,
    expectedDocumentId: string,
): void {
    if (
        !document.id
        || !expectedDocumentId.trim()
        || document.id !== expectedDocumentId
        || PROTECTED_DOCUMENT_IDS.has(document.id)
        || document.id === preflight.sourceId
        || document.template?.id !== preflight.template.templateId
        || document.current_status?.status_type !== EFORMSIGN_COMPLETED_REISSUE_NEW_USER_STATUS_TYPE
        || document.current_status?.step_type !== EFORMSIGN_COMPLETED_REISSUE_NEW_USER_STEP_TYPE
        || document.current_status?.step_index !== EFORMSIGN_COMPLETED_REISSUE_NEW_USER_STEP_INDEX
        || document.current_status?.step_group !== EFORMSIGN_COMPLETED_REISSUE_NEW_USER_STEP_GROUP
    ) {
        throw new CompletedReissuePostconditionError("new document is not at the user signer stage");
    }
    const identityFields = readDocumentIdentityFields(document);
    if (
        completedReissueIdentityFingerprint(preflight.sourceId, identityFields.name, identityFields.phone)
            !== preflight.sourceIdentity.fingerprint
    ) {
        throw new CompletedReissuePostconditionError("new document identity fingerprint changed");
    }
    assertCurrentRecipientMatchesIdentity(document, preflight.sourceIdentity);
    if (dateFromFields(identityFields.values, SOURCE_DATE_FIELD_IDS) !== EFORMSIGN_COMPLETED_REISSUE_SOURCE_START_DATE) {
        throw new CompletedReissuePostconditionError("new document changed source start date");
    }
    if (dateFromFields(identityFields.values, SOURCE_END_DATE_FIELD_IDS) !== EFORMSIGN_COMPLETED_REISSUE_TARGET_END_DATE) {
        throw new CompletedReissuePostconditionError("new document target end date is missing");
    }
    if (normalizePeriod(identityFields.values["서비스 기간"] ?? "") !== EFORMSIGN_COMPLETED_REISSUE_TARGET_PERIOD) {
        throw new CompletedReissuePostconditionError("new document target period is missing");
    }
    if (dateFromFields(identityFields.values, PAYMENT_DATE_FIELD_IDS) !== EFORMSIGN_COMPLETED_REISSUE_SOURCE_PAYMENT_DATE) {
        throw new CompletedReissuePostconditionError("new document changed source payment date");
    }
    for (const id of MONEY_FIELD_IDS) {
        const expected = id === "서비스 비용" ? "1464000" : id === "정부지원금" ? "1002000" : "462000";
        if (normalizeMoney(identityFields.values[id] ?? "") !== expected) {
            throw new CompletedReissuePostconditionError(`new document changed source money field ${id}`);
        }
    }
    if (normalizeMoney(identityFields.values["서비스 가격"] ?? "") !== "1464000") {
        throw new CompletedReissuePostconditionError("new document changed source service price");
    }
}

export function assertCompletedReissueProviderFollowupDocument(
    document: EformsignApiDocumentResponse,
    expectedDocumentId: string,
): void {
    if (
        !document.id
        || document.id !== expectedDocumentId
        || PROTECTED_DOCUMENT_IDS.has(document.id)
        || document.template?.id !== EFORMSIGN_COMPLETED_REISSUE_TEMPLATE_ID
        || document.current_status?.status_type !== EFORMSIGN_COMPLETED_REISSUE_PROVIDER_STATUS_TYPE
        || document.current_status?.step_type !== EFORMSIGN_COMPLETED_REISSUE_PROVIDER_STEP_TYPE
        || document.current_status?.step_index !== EFORMSIGN_COMPLETED_REISSUE_PROVIDER_STEP_INDEX
        || document.current_status?.step_group !== EFORMSIGN_COMPLETED_REISSUE_PROVIDER_STEP_GROUP
    ) {
        throw new CompletedReissuePostconditionError("new document is not at the provider participant stage");
    }
    const recipient = document.current_status.step_recipients?.[0];
    if (
        document.current_status.step_recipients?.length !== 1
        || !recipient
        || recipient.id !== EFORMSIGN_COMPLETED_REISSUE_INTERNAL_RECIPIENT_ID
        || !["insider", "internal", "01"].includes(recipient.recipient_type.toLowerCase())
    ) {
        throw new CompletedReissuePostconditionError("provider participant identity is not inherited from the template");
    }
    const values = readSourceFieldValues(document);
    if (dateFromFields(values, SOURCE_DATE_FIELD_IDS) !== EFORMSIGN_COMPLETED_REISSUE_SOURCE_START_DATE) {
        throw new CompletedReissuePostconditionError("followup changed source start date");
    }
    if (dateFromFields(values, SOURCE_END_DATE_FIELD_IDS) !== EFORMSIGN_COMPLETED_REISSUE_TARGET_END_DATE) {
        throw new CompletedReissuePostconditionError("followup target end date is missing");
    }
    if (normalizePeriod(values["서비스 기간"] ?? "") !== EFORMSIGN_COMPLETED_REISSUE_TARGET_PERIOD) {
        throw new CompletedReissuePostconditionError("followup target period is missing");
    }
    if (dateFromFields(values, PAYMENT_DATE_FIELD_IDS) !== EFORMSIGN_COMPLETED_REISSUE_SOURCE_PAYMENT_DATE) {
        throw new CompletedReissuePostconditionError("followup changed payment date");
    }
    for (const id of MONEY_FIELD_IDS) {
        const expected = id === "서비스 비용" ? "1464000" : id === "정부지원금" ? "1002000" : "462000";
        if (normalizeMoney(values[id] ?? "") !== expected) {
            throw new CompletedReissuePostconditionError(`followup changed source money field ${id}`);
        }
    }
}

async function assertSecureDirectory(directory: string): Promise<void> {
    await assertNoSymlinkAncestors(directory);
    let directoryStat;
    try {
        directoryStat = await lstat(directory);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        await mkdir(directory, { recursive: true, mode: SECURE_DIRECTORY_MODE });
        directoryStat = await lstat(directory);
    }
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
        throw new CompletedReissueNotVerifiedError("ledger/artifact directory is not a real directory");
    }
    await chmod(directory, SECURE_DIRECTORY_MODE);
    const secured = await stat(directory);
    if ((secured.mode & 0o777) !== SECURE_DIRECTORY_MODE) {
        throw new CompletedReissueNotVerifiedError("ledger/artifact directory permissions are not 0700");
    }
}

async function assertExistingSecureDirectory(directory: string): Promise<void> {
    await assertNoSymlinkAncestors(directory);
    const directoryStat = await lstat(directory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
        throw new CompletedReissueNotVerifiedError("ledger/artifact directory is not a real directory");
    }
    if ((directoryStat.mode & 0o777) !== SECURE_DIRECTORY_MODE) {
        throw new CompletedReissueNotVerifiedError("ledger/artifact directory permissions are not 0700");
    }
}

async function assertSecureFile(path: string): Promise<void> {
    await assertNoSymlinkAncestors(path);
    const fileStat = await lstat(path);
    if (!fileStat.isFile() || fileStat.isSymbolicLink() || (fileStat.mode & 0o777) !== SECURE_FILE_MODE) {
        throw new CompletedReissueNotVerifiedError("ledger/artifact file is not a secure regular file");
    }
}

async function assertNoSymlinkAncestors(path: string): Promise<void> {
    const absolute = resolve(path);
    const components = absolute.split(sep).filter(Boolean);
    let cursor = absolute.startsWith(sep) ? sep : "";
    for (const component of components) {
        cursor = cursor === sep ? join(cursor, component) : join(cursor, component);
        let componentStat;
        try {
            componentStat = await lstat(cursor);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
            throw error;
        }
        if (componentStat.isSymbolicLink()) {
            throw new CompletedReissueNotVerifiedError("ledger/artifact path contains a symlink ancestor");
        }
    }
}

async function syncDirectory(directory: string): Promise<void> {
    const handle = await open(directory, "r");
    try {
        await handle.sync();
    } finally {
        await handle.close();
    }
}

async function writeAll(handle: Awaited<ReturnType<typeof open>>, data: Buffer): Promise<void> {
    let offset = 0;
    while (offset < data.length) {
        const result = await handle.write(data, offset, data.length - offset, null);
        if (result.bytesWritten < 1) throw new CompletedReissueNotVerifiedError("secure file write made no progress");
        offset += result.bytesWritten;
    }
}

async function writeSecureFile(path: string, data: Buffer | string): Promise<void> {
    await assertNoSymlinkAncestors(path);
    const handle = await open(path, "wx", SECURE_FILE_MODE);
    try {
        await writeAll(handle, typeof data === "string" ? Buffer.from(data, "utf8") : data);
        await handle.sync();
    } finally {
        await handle.close();
    }
    await chmod(path, SECURE_FILE_MODE);
    await assertSecureFile(path);
    await syncDirectory(resolve(path, ".."));
}

async function updateSecureJson(path: string, value: unknown): Promise<void> {
    await assertSecureFile(path);
    const handle = await open(path, "r+");
    try {
        const data = Buffer.from(`${canonicalJson(value)}\n`, "utf8");
        await handle.truncate(0);
        let offset = 0;
        while (offset < data.length) {
            const result = await handle.write(data, offset, data.length - offset, offset);
            if (result.bytesWritten < 1) throw new CompletedReissueNotVerifiedError("secure file update made no progress");
            offset += result.bytesWritten;
        }
        await handle.sync();
    } finally {
        await handle.close();
    }
    await chmod(path, SECURE_FILE_MODE);
    await assertSecureFile(path);
    await syncDirectory(resolve(path, ".."));
}

async function writeSecureJson(path: string, value: unknown): Promise<void> {
    await writeSecureFile(path, `${canonicalJson(value)}\n`);
}

export async function writeCompletedReissuePdfArtifact(
    directory: string,
    label: "source-before" | "source-after" | "new-user-stage",
    body: Buffer,
): Promise<{ path: string; sha256: string; byteLength: number }> {
    await assertSecureDirectory(directory);
    const path = join(directory, `${label}.pdf`);
    await writeSecureFile(path, body);
    return { path, sha256: sha256Hex(body), byteLength: body.length };
}

async function writeApiArtifact(
    directory: string,
    label: "source-before" | "source-after" | "new-user",
    document: EformsignApiDocumentResponse,
): Promise<void> {
    const snapshot = snapshotCompletedReissueDocument(document);
    await writeSecureJson(join(directory, `${label}.api.json`), snapshot);
}

export async function reserveCompletedReissueAttempt(
    preflight: CompletedReissuePreflight,
    ledgerDirectory = EFORMSIGN_COMPLETED_REISSUE_LEDGER_DIRECTORY,
    now = () => new Date(),
): Promise<CompletedReissueLedgerReservation> {
    await assertSecureDirectory(ledgerDirectory);
    const artifactRoot = join(ledgerDirectory, "artifacts");
    await assertSecureDirectory(artifactRoot);
    const markerPath = join(ledgerDirectory, `${preflight.operationKey}.attempt.json`);
    const resultPath = join(ledgerDirectory, `${preflight.operationKey}.result.json`);
    const failurePath = join(ledgerDirectory, `${preflight.operationKey}.failure.json`);
    const acceptancePath = join(ledgerDirectory, `${preflight.operationKey}.acceptance.json`);
    const artifactDirectory = join(ledgerDirectory, "artifacts", preflight.operationKey);
    for (const path of [markerPath, resultPath, acceptancePath, failurePath, artifactDirectory]) {
        try {
            const existing = await lstat(path);
            if (existing.isSymbolicLink()) {
                throw new CompletedReissueNotVerifiedError("ledger namespace symlink refused");
            }
            throw new CompletedReissueAlreadyAttemptedError();
        } catch (error) {
            if (error instanceof CompletedReissueNotVerifiedError) throw error;
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
    }
    const createdAt = now().toISOString();
    const sharedLedgerFields = {
        schemaVersion: 1 as const,
        operationKey: preflight.operationKey,
        sourceId: preflight.sourceId,
        templateId: preflight.template.templateId,
        templateVersion: preflight.template.version,
        targetEndDate: preflight.targetEndDate,
        targetPeriod: preflight.targetPeriod,
        recipientFingerprint: preflight.sourceIdentity.fingerprint,
        canonicalPayloadHash: preflight.canonicalPayloadHash,
        artifactDirectory,
        createdAt,
    };
    try {
        await writeSecureJson(markerPath, {
            ...sharedLedgerFields,
        });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new CompletedReissueAlreadyAttemptedError();
        throw error;
    }
    try {
        await writeSecureJson(resultPath, {
            ...sharedLedgerFields,
            status: "reserved",
            documentId: null,
        });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new CompletedReissueAlreadyAttemptedError();
        throw error;
    }
    try {
        await writeSecureJson(acceptancePath, {
            ...sharedLedgerFields,
            status: "reserved",
            documentId: null,
        });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new CompletedReissueAlreadyAttemptedError();
        throw error;
    }
    try {
        await mkdir(artifactDirectory, { mode: SECURE_DIRECTORY_MODE });
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new CompletedReissueAlreadyAttemptedError();
        throw error;
    }
    await assertSecureDirectory(artifactDirectory);
    return { markerPath, resultPath, acceptancePath, artifactDirectory, createdAt };
}

async function persistLedgerResult(
    reservation: CompletedReissueLedgerReservation,
    preflight: CompletedReissuePreflight,
    status: CompletedReissueLedgerStatus,
    documentId: string | null,
): Promise<void> {
    await updateSecureJson(reservation.resultPath, {
        schemaVersion: 1,
        status,
        operationKey: preflight.operationKey,
        sourceId: preflight.sourceId,
        templateId: preflight.template.templateId,
        templateVersion: preflight.template.version,
        targetEndDate: preflight.targetEndDate,
        targetPeriod: preflight.targetPeriod,
        recipientFingerprint: preflight.sourceIdentity.fingerprint,
        canonicalPayloadHash: preflight.canonicalPayloadHash,
        documentId,
        artifactDirectory: reservation.artifactDirectory,
        createdAt: reservation.createdAt,
    });
}

async function persistAcceptanceReceipt(
    reservation: CompletedReissueLedgerReservation,
    preflight: CompletedReissuePreflight,
    documentId: string,
    now: () => Date,
): Promise<void> {
    await updateSecureJson(reservation.acceptancePath, {
        schemaVersion: 1,
        status: "accepted",
        operationKey: preflight.operationKey,
        sourceId: preflight.sourceId,
        templateId: preflight.template.templateId,
        templateVersion: preflight.template.version,
        targetEndDate: preflight.targetEndDate,
        targetPeriod: preflight.targetPeriod,
        recipientFingerprint: preflight.sourceIdentity.fingerprint,
        canonicalPayloadHash: preflight.canonicalPayloadHash,
        documentId,
        artifactDirectory: reservation.artifactDirectory,
        createdAt: reservation.createdAt,
        acceptedAt: now().toISOString(),
    });
}

async function persistFailureOutcome(
    reservation: CompletedReissueLedgerReservation,
    preflight: CompletedReissuePreflight,
    documentId: string | null,
    reasonCode: string,
): Promise<void> {
    await writeSecureJson(reservation.resultPath.replace(/\.result\.json$/, ".failure.json"), {
        schemaVersion: 1,
        status: "postcondition_failed",
        operationKey: preflight.operationKey,
        sourceId: preflight.sourceId,
        templateId: preflight.template.templateId,
        documentId,
        reasonCode: reasonCode.slice(0, 80),
    });
}

function safeErrorCode(error: unknown): string {
    if (error instanceof EformsignApiError) return `vendor_status_${error.status}`;
    if (error instanceof CompletedReissueNotVerifiedError) return error.name;
    if (error instanceof Error) return error.name;
    return "unknown_error";
}

type CompletedReissueCreateErrorCategory = "vendor_http_error" | "runtime_error" | "unknown_error";

interface CompletedReissueCreateErrorMetadata {
    httpStatus: number | null;
    vendorCode: string | null;
    name: string;
    category: CompletedReissueCreateErrorCategory;
}

function safeErrorName(error: unknown): string {
    const name = error instanceof Error ? error.name : "UnknownError";
    return /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(name) ? name : "UnknownError";
}

function safeVendorCode(error: unknown): string | null {
    if (!(error instanceof EformsignApiError) || typeof error.vendorCode !== "string") return null;
    const vendorCode = error.vendorCode.trim();
    return /^\d{1,16}$/.test(vendorCode) ? vendorCode : null;
}

function completedReissueCreateErrorMetadata(error: unknown): CompletedReissueCreateErrorMetadata {
    const status = errorStatus(error);
    return {
        httpStatus: status !== null && Number.isInteger(status) && status >= 100 && status <= 599 ? status : null,
        vendorCode: safeVendorCode(error),
        name: safeErrorName(error),
        category: error instanceof EformsignApiError
            ? "vendor_http_error"
            : error instanceof Error
                ? "runtime_error"
                : "unknown_error",
    };
}

async function persistCreateErrorMetadata(
    reservation: CompletedReissueLedgerReservation,
    error: unknown,
): Promise<void> {
    await writeSecureJson(
        join(reservation.artifactDirectory, "create-error.json"),
        completedReissueCreateErrorMetadata(error),
    );
}

function errorStatus(error: unknown): number | null {
    if (error instanceof EformsignApiError) return error.status;
    const record = asRecord(error);
    return typeof record?.["status"] === "number" && Number.isFinite(record["status"])
        ? record["status"]
        : null;
}

export function classifyCompletedReissueCreateError(error: unknown): "prework_rejected" | "ambiguous" {
    const status = errorStatus(error);
    return status === 429 ? "prework_rejected" : "ambiguous";
}

function createResponseDocumentId(response: CreateDocumentResponse): string | null {
    const documentId = response.documentId.trim();
    return documentId || null;
}

function safeSummary(
    preflight: CompletedReissuePreflight,
    reservation: CompletedReissueLedgerReservation,
    status: string,
    documentId: string | null,
): CompletedReissueSafeSummary {
    return {
        status,
        operationKey: preflight.operationKey,
        sourceId: preflight.sourceId,
        templateId: preflight.template.templateId,
        templateVersion: preflight.template.version,
        targetEndDate: preflight.targetEndDate,
        targetPeriod: preflight.targetPeriod,
        recipientFingerprint: preflight.sourceIdentity.fingerprint,
        canonicalPayloadHash: preflight.canonicalPayloadHash,
        documentId,
        artifactDirectory: reservation.artifactDirectory,
        visualInspection: "pending",
    };
}

export function safeCompletedReissueSummary(
    preflight: CompletedReissuePreflight,
    reservation: CompletedReissueLedgerReservation,
    status: string,
    documentId: string | null,
): CompletedReissueSafeSummary {
    return safeSummary(preflight, reservation, status, documentId);
}

export async function runCompletedReissueProbe(
    options: CompletedReissueProbeOptions,
): Promise<CompletedReissueProbeResult> {
    const now = options.now ?? (() => new Date());
    const logger = options.logger ?? (() => undefined);
    const ledgerDirectory = options.ledgerDirectory ?? EFORMSIGN_COMPLETED_REISSUE_LEDGER_DIRECTORY;
    const readPdf = options.readPdf ?? readCompletedReissuePdfWithReadonlyPoll;
    if (!options.accessToken.trim()) throw new CompletedReissueNotVerifiedError("access token is empty");

    const sourceBefore = await options.api.getDocument(options.accessToken, EFORMSIGN_COMPLETED_REISSUE_SOURCE_ID);
    const sourcePdfBefore = await readPdf(
        options.fileReader,
        options.accessToken,
        EFORMSIGN_COMPLETED_REISSUE_SOURCE_ID,
        sourcePdfExpectation(),
    );
    const topology = assertCompletedReissueTemplateTopology(
        await options.templateReader.getTemplateConfig(options.accessToken, EFORMSIGN_COMPLETED_REISSUE_TEMPLATE_ID),
    );
    const preflight = buildCompletedReissuePreflight(
        sourceBefore,
        topology,
        sourcePdfBefore.evidence,
        options.expectedIdentityFingerprint,
    );
    const reservation = await reserveCompletedReissueAttempt(preflight, ledgerDirectory, now);
    await assertSecureDirectory(reservation.artifactDirectory);
    await writeApiArtifact(reservation.artifactDirectory, "source-before", sourceBefore);
    await writeCompletedReissuePdfArtifact(reservation.artifactDirectory, "source-before", sourcePdfBefore.body);
    await writeSecureJson(join(reservation.artifactDirectory, "canonical-request.json"), {
        templateId: preflight.template.templateId,
        templateVersion: preflight.template.version,
        fieldIds: preflight.payload.prefillFields.map((field) => field.id),
        fieldValueHashes: preflight.payload.prefillFields.map((field) => sha256Hex(field.value)),
        recipientFingerprint: preflight.sourceIdentity.fingerprint,
        canonicalPayloadHash: preflight.canonicalPayloadHash,
    });
    logger({
        event: "preflight_pass",
        sourceId: preflight.sourceId,
        templateId: preflight.template.templateId,
        templateVersion: preflight.template.version,
        operationKey: preflight.operationKey,
        sourcePdfSha256: preflight.sourcePdf.sha256,
    });

    let createResponse: CreateDocumentResponse;
    try {
        createResponse = await options.api.createDocument(options.accessToken, preflight.payload);
    } catch (error) {
        const status = classifyCompletedReissueCreateError(error);
        try {
            await persistCreateErrorMetadata(reservation, error);
        } catch {
            // Error metadata is diagnostic only; preserve the original create classification.
        }
        try {
            await persistLedgerResult(reservation, preflight, status, null);
        } catch {
            throw new CompletedReissueAmbiguousError();
        }
        logger({ event: status, operationKey: preflight.operationKey, sourceId: preflight.sourceId, documentId: null });
        if (status === "prework_rejected") throw new CompletedReissuePreworkRejectedError();
        throw new CompletedReissueAmbiguousError();
    }

    const newDocumentId = createResponseDocumentId(createResponse);
    if (!newDocumentId) {
        try {
            await persistCreateErrorMetadata(reservation, new Error("create response missing document id"));
        } catch {
            // Error metadata is diagnostic only; preserve the ambiguous outcome.
        }
        try {
            await persistLedgerResult(reservation, preflight, "ambiguous", null);
        } catch {
            // A missing id is already an ambiguous response; retain the marker and never retry.
        }
        throw new CompletedReissueAmbiguousError();
    }
    try {
        await persistLedgerResult(reservation, preflight, "created", newDocumentId);
        await persistAcceptanceReceipt(reservation, preflight, newDocumentId, now);
    } catch {
        throw new CompletedReissueAmbiguousError();
    }

    try {
        if (PROTECTED_DOCUMENT_IDS.has(newDocumentId)) {
            throw new CompletedReissuePostconditionError("provider returned a protected document id");
        }
        const sourceAfter = await options.api.getDocument(options.accessToken, EFORMSIGN_COMPLETED_REISSUE_SOURCE_ID);
        const sourcePdfAfter = await readPdf(
            options.fileReader,
            options.accessToken,
            EFORMSIGN_COMPLETED_REISSUE_SOURCE_ID,
            sourcePdfExpectation(),
        );
        assertCompletedReissueSourceUnchanged(preflight, sourceAfter, sourcePdfAfter.evidence);
        await writeApiArtifact(reservation.artifactDirectory, "source-after", sourceAfter);
        await writeCompletedReissuePdfArtifact(reservation.artifactDirectory, "source-after", sourcePdfAfter.body);

        const newDocument = await options.api.getDocument(options.accessToken, newDocumentId);
        assertCompletedReissueNewUserDocument(newDocument, preflight, newDocumentId);
        await writeApiArtifact(reservation.artifactDirectory, "new-user", newDocument);
        const newPdf = await readPdf(
            options.fileReader,
            options.accessToken,
            newDocumentId,
            targetPdfExpectation(),
        );
        assertCompletedReissuePdfEvidence(newPdf.evidence, targetPdfExpectation());
        await writeCompletedReissuePdfArtifact(reservation.artifactDirectory, "new-user-stage", newPdf.body);
        const summary = safeSummary(preflight, reservation, "created_visual_pending", newDocumentId);
        logger({ event: summary.status, operationKey: summary.operationKey, sourceId: summary.sourceId, documentId: summary.documentId });
        return {
            ...summary,
            sourcePdfSha256: sourcePdfAfter.evidence.sha256,
            sourcePdfBytes: sourcePdfAfter.evidence.byteLength,
            newPdfSha256: newPdf.evidence.sha256,
            newPdfBytes: newPdf.evidence.byteLength,
            newPdfAttempts: newPdf.attempts,
        };
    } catch (error) {
        try {
            await persistFailureOutcome(reservation, preflight, newDocumentId, safeErrorCode(error));
        } catch {
            throw new CompletedReissueAmbiguousError();
        }
        logger({ event: "postcondition_failed", operationKey: preflight.operationKey, sourceId: preflight.sourceId, documentId: newDocumentId });
        if (error instanceof CompletedReissuePostconditionError) throw error;
        throw new CompletedReissuePostconditionError();
    }
}

async function readSecureJson(path: string): Promise<Record<string, unknown>> {
    await assertSecureFile(path);
    const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
    const record = asRecord(parsed);
    if (!record) throw new CompletedReissueNotVerifiedError("ledger result shape is unknown");
    return record;
}

const LEDGER_SHARED_KEYS = [
    "schemaVersion",
    "operationKey",
    "sourceId",
    "templateId",
    "templateVersion",
    "targetEndDate",
    "targetPeriod",
    "recipientFingerprint",
    "canonicalPayloadHash",
    "artifactDirectory",
    "createdAt",
] as const;

function assertLedgerSharedFields(
    record: Record<string, unknown>,
    expectedOperationKey: string,
    expectedArtifactDirectory: string,
    label: string,
): void {
    if (
        record["schemaVersion"] !== 1
        || record["operationKey"] !== expectedOperationKey
        || record["sourceId"] !== EFORMSIGN_COMPLETED_REISSUE_SOURCE_ID
        || record["templateId"] !== EFORMSIGN_COMPLETED_REISSUE_TEMPLATE_ID
        || typeof record["templateVersion"] !== "string"
        || !record["templateVersion"].trim()
        || record["targetEndDate"] !== EFORMSIGN_COMPLETED_REISSUE_TARGET_END_DATE
        || record["targetPeriod"] !== EFORMSIGN_COMPLETED_REISSUE_TARGET_PERIOD
        || record["recipientFingerprint"] !== EFORMSIGN_COMPLETED_REISSUE_EXPECTED_IDENTITY_FINGERPRINT
        || typeof record["canonicalPayloadHash"] !== "string"
        || !/^[a-f0-9]{64}$/.test(record["canonicalPayloadHash"])
        || record["artifactDirectory"] !== expectedArtifactDirectory
        || typeof record["createdAt"] !== "string"
        || !record["createdAt"].trim()
    ) {
        throw new CompletedReissueNotVerifiedError(`${label} ledger relation is outside the reviewed operation`);
    }
}

function assertLedgerRelationsEqual(
    left: Record<string, unknown>,
    right: Record<string, unknown>,
    leftLabel: string,
    rightLabel: string,
): void {
    for (const key of LEDGER_SHARED_KEYS) {
        if (left[key] !== right[key]) {
            throw new CompletedReissueNotVerifiedError(
                `ledger ${leftLabel}/${rightLabel} ${key} relation mismatch`,
            );
        }
    }
}

function assertLedgerDocumentId(record: Record<string, unknown>, label: string): string {
    const documentId = stringValue(record["documentId"]);
    if (!documentId || PROTECTED_DOCUMENT_IDS.has(documentId)) {
        throw new CompletedReissueNotVerifiedError(`${label} ledger document id is invalid`);
    }
    return documentId;
}

export async function readCompletedReissueLedgerResult(
    ledgerDirectory = EFORMSIGN_COMPLETED_REISSUE_LEDGER_DIRECTORY,
): Promise<CompletedReissueLedgerResult> {
    await assertExistingSecureDirectory(ledgerDirectory);
    await assertExistingSecureDirectory(join(ledgerDirectory, "artifacts"));
    const entries = await readdir(ledgerDirectory, { withFileTypes: true });
    const expectedOperationKey = completedReissueOperationKeyFromFingerprint(
        EFORMSIGN_COMPLETED_REISSUE_SOURCE_ID,
        EFORMSIGN_COMPLETED_REISSUE_TEMPLATE_ID,
        EFORMSIGN_COMPLETED_REISSUE_TARGET_END_DATE,
        EFORMSIGN_COMPLETED_REISSUE_EXPECTED_IDENTITY_FINGERPRINT,
    );
    const expectedResultName = `${expectedOperationKey}.result.json`;
    const resultEntries = entries.filter((entry) => entry.name.endsWith(".result.json"));
    if (resultEntries.length !== 1 || resultEntries[0]?.name !== expectedResultName) {
        throw new CompletedReissueNotVerifiedError("ledger does not contain exactly one reviewed reissue result");
    }
    const artifactDirectory = join(ledgerDirectory, "artifacts", expectedOperationKey);
    await assertExistingSecureDirectory(artifactDirectory);

    const result = await readSecureJson(join(ledgerDirectory, expectedResultName));
    const marker = await readSecureJson(join(ledgerDirectory, `${expectedOperationKey}.attempt.json`));
    const acceptance = await readSecureJson(join(ledgerDirectory, `${expectedOperationKey}.acceptance.json`));
    assertLedgerSharedFields(result, expectedOperationKey, artifactDirectory, "result");
    assertLedgerSharedFields(marker, expectedOperationKey, artifactDirectory, "attempt marker");
    assertLedgerSharedFields(acceptance, expectedOperationKey, artifactDirectory, "acceptance");
    assertLedgerRelationsEqual(result, marker, "result", "attempt marker");
    assertLedgerRelationsEqual(result, acceptance, "result", "acceptance");
    if (result["status"] !== "created") {
        throw new CompletedReissueNotVerifiedError("ledger result is not a durable created outcome");
    }
    if (acceptance["status"] !== "accepted") {
        throw new CompletedReissueNotVerifiedError("ledger acceptance receipt is not immutable accepted evidence");
    }
    const documentId = assertLedgerDocumentId(result, "result");
    if (assertLedgerDocumentId(acceptance, "acceptance") !== documentId) {
        throw new CompletedReissueNotVerifiedError("ledger result and acceptance document ids differ");
    }
    if (typeof acceptance["acceptedAt"] !== "string" || !acceptance["acceptedAt"].trim()) {
        throw new CompletedReissueNotVerifiedError("ledger acceptance timestamp is missing");
    }
    const failurePath = join(ledgerDirectory, `${expectedOperationKey}.failure.json`);
    try {
        await assertSecureFile(failurePath);
        throw new CompletedReissuePostconditionError("ledger result has a failed postcondition outcome");
    } catch (error) {
        const code = asRecord(error)?.["code"];
        if (code !== "ENOENT") throw error;
    }
    return {
        schemaVersion: 1,
        status: "created",
        operationKey: expectedOperationKey,
        sourceId: EFORMSIGN_COMPLETED_REISSUE_SOURCE_ID,
        templateId: EFORMSIGN_COMPLETED_REISSUE_TEMPLATE_ID,
        templateVersion: result["templateVersion"] as string,
        targetEndDate: EFORMSIGN_COMPLETED_REISSUE_TARGET_END_DATE,
        targetPeriod: EFORMSIGN_COMPLETED_REISSUE_TARGET_PERIOD,
        recipientFingerprint: EFORMSIGN_COMPLETED_REISSUE_EXPECTED_IDENTITY_FINGERPRINT,
        canonicalPayloadHash: result["canonicalPayloadHash"] as string,
        documentId,
        artifactDirectory,
        createdAt: result["createdAt"] as string,
    };
}

export async function verifyCompletedReissueFollowup(
    options: CompletedReissueFollowupOptions,
): Promise<CompletedReissueSafeSummary & { pdfSha256: string; pdfBytes: number; pdfAttempts: number }> {
    const result = await readCompletedReissueLedgerResult(options.ledgerDirectory);
    const documentId = result.documentId;
    if (!documentId) throw new CompletedReissueNotVerifiedError("ledger result document id is missing");
    const readPdf = options.readPdf ?? readCompletedReissuePdfWithReadonlyPoll;
    const document = await options.api.getDocument(options.accessToken, documentId);
    assertCompletedReissueProviderFollowupDocument(document, documentId);
    const pdf = await readPdf(
        options.fileReader,
        options.accessToken,
        documentId,
        targetPdfExpectation(),
    );
    assertCompletedReissuePdfEvidence(pdf.evidence, targetPdfExpectation());
    return {
        status: "provider_stage_verified_visual_pending",
        operationKey: result.operationKey,
        sourceId: result.sourceId,
        templateId: result.templateId,
        templateVersion: result.templateVersion,
        targetEndDate: result.targetEndDate,
        targetPeriod: result.targetPeriod,
        recipientFingerprint: result.recipientFingerprint,
        canonicalPayloadHash: result.canonicalPayloadHash,
        documentId,
        artifactDirectory: result.artifactDirectory,
        visualInspection: "pending",
        pdfSha256: pdf.evidence.sha256,
        pdfBytes: pdf.evidence.byteLength,
        pdfAttempts: pdf.attempts,
    };
}

export function protectedCompletedReissueDocumentIds(): readonly string[] {
    return [...PROTECTED_DOCUMENT_IDS];
}
