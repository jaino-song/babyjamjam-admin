import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, open, readdir, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

import type { EformsignApiDocumentResponse } from "domain/repositories/eformsign.client.interface";
import { extractEformsignVendorCode } from "infrastructure/api/eformsign-api.error";
import {
    EFORMSIGN_COMPLETED_REISSUE_EXPECTED_IDENTITY_FINGERPRINT,
    EFORMSIGN_COMPLETED_REISSUE_SOURCE_END_DATE,
    EFORMSIGN_COMPLETED_REISSUE_SOURCE_ID,
    EFORMSIGN_COMPLETED_REISSUE_SOURCE_PAYMENT_DATE,
    EFORMSIGN_COMPLETED_REISSUE_SOURCE_START_DATE,
    EFORMSIGN_COMPLETED_REISSUE_SOURCE_STATUS_TYPE,
    EFORMSIGN_COMPLETED_REISSUE_TARGET_END_DATE,
    EFORMSIGN_COMPLETED_REISSUE_TARGET_PERIOD,
    EFORMSIGN_COMPLETED_REISSUE_TEMPLATE_ID,
    completedReissueIdentityFingerprint,
    canonicalJson,
    protectedCompletedReissueDocumentIds,
    snapshotCompletedReissueDocument,
} from "./eformsign-completed-reissue.live.helper";

export const EFORMSIGN_DRAFT_DIAGNOSTIC_SYNTHETIC_NAME = "송진호 API 진단";
export const EFORMSIGN_DRAFT_DIAGNOSTIC_LEDGER_DIRECTORY =
    "/Users/jaino/.local/state/babyjamjam/phase0-draft-diagnostic";
export const EFORMSIGN_DRAFT_DIAGNOSTIC_SUITE_NAME = "Phase 0 draft diagnostic";
export const EFORMSIGN_DRAFT_DIAGNOSTIC_CREATE_TEST_NAME =
    "creates one synthetic no-notification draft with reduced fields";
export const EFORMSIGN_DRAFT_DIAGNOSTIC_CREATE_FULL_TEST_NAME =
    `${EFORMSIGN_DRAFT_DIAGNOSTIC_SUITE_NAME} ${EFORMSIGN_DRAFT_DIAGNOSTIC_CREATE_TEST_NAME}`;
export const EFORMSIGN_DRAFT_DIAGNOSTIC_TOKEN_API_ORIGIN = "https://api.eformsign.com";
export const EFORMSIGN_DRAFT_DIAGNOSTIC_DOC_API_ORIGIN = "https://kr-api.eformsign.com";

export const EFORMSIGN_DRAFT_DIAGNOSTIC_ALLOWLIST_FIELD_IDS = [
    "이용자 성명",
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

const SOURCE_PERIOD = "20260709~20270104";
const TARGET_PERIOD_DISPLAY = "20260709 ~ 20270107";
const EXPECTED_MONEY: Readonly<Record<string, string>> = {
    "서비스 비용": "1464000",
    정부지원금: "1002000",
    본인부담금: "462000",
    "서비스 가격": "1464000",
};
const PROTECTED_DOCUMENT_IDS = new Set(protectedCompletedReissueDocumentIds());
const FORBIDDEN_FIELD_PATTERN = /(연락처|전화|phone|이메일|email|생년월일|주소|서명|signature|stamp|도장|동의|consent|제공인력|provider|staff)/i;
const SECURE_DIRECTORY_MODE = 0o700;
const SECURE_FILE_MODE = 0o600;
const DRAFT_POST_TIMEOUT_MS = 60_000;

export type DraftDiagnosticTemplate = {
    templateId: string;
    version: string;
    enabled: true;
    released: true;
    steps: Array<{
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
    }>;
};

export interface DraftDiagnosticField {
    id: string;
    value: string;
}

export interface DraftDiagnosticCreateBody {
    template_id: string;
    document: {
        fields: DraftDiagnosticField[];
        recipients: [];
    };
}

export interface DraftDiagnosticApi {
    getDocument(accessToken: string, documentId: string): Promise<EformsignApiDocumentResponse>;
}

export interface DraftDiagnosticConfigReader {
    get(propertyPath: string): unknown;
}

export function assertDraftDiagnosticOfficialLiveOrigins(config: DraftDiagnosticConfigReader): void {
    if (
        config.get("EFORMSIGN_API_URL") !== EFORMSIGN_DRAFT_DIAGNOSTIC_TOKEN_API_ORIGIN
        || config.get("EFORMSIGN_DOC_API_URL") !== EFORMSIGN_DRAFT_DIAGNOSTIC_DOC_API_ORIGIN
    ) throw fail("config");
}

export type DraftDiagnosticFailureCategory =
    | "config"
    | "ledger"
    | "vendor_http"
    | "response_body"
    | "response_shape"
    | "timeout"
    | "transport"
    | "postcondition";

export interface DraftDiagnosticFailureMetadata {
    category: DraftDiagnosticFailureCategory;
    httpStatus: number | null;
    vendorCode: string | null;
}

export interface DraftDiagnosticSafeSummary {
    status: "created";
    operationKey: string;
    sourceId: string;
    templateId: string;
    documentId: string;
    artifactDirectory: string;
    fieldCount: number;
}

export interface DraftDiagnosticOptions {
    accessToken: string;
    api: DraftDiagnosticApi;
    config: DraftDiagnosticConfigReader;
    template: DraftDiagnosticTemplate;
    ledgerDirectory?: string;
    fetchImpl?: typeof fetch;
    now?: () => Date;
    expectedIdentityFingerprint?: string;
    logger?: (event: Record<string, string | number | null>) => void;
}

export class DraftDiagnosticFailure extends Error {
    constructor(public readonly metadata: DraftDiagnosticFailureMetadata) {
        super("draft diagnostic failed");
        this.name = "DraftDiagnosticFailure";
    }
}

export class DraftDiagnosticAlreadyAttemptedError extends Error {
    constructor() {
        super("draft diagnostic operation already attempted");
        this.name = "DraftDiagnosticAlreadyAttemptedError";
    }
}

function fail(category: DraftDiagnosticFailureCategory, httpStatus: number | null = null, vendorCode: string | null = null): DraftDiagnosticFailure {
    return new DraftDiagnosticFailure({ category, httpStatus, vendorCode });
}

function normalizedFieldId(value: string): string {
    return value.normalize("NFKC").toLowerCase().replace(/[\s_\-:/]/g, "");
}

function fieldValue(document: EformsignApiDocumentResponse, fieldId: string): string {
    const fields = document.fields;
    if (!Array.isArray(fields)) throw fail("postcondition");
    const matches = fields.filter((field) => normalizedFieldId(field.id) === normalizedFieldId(fieldId));
    if (matches.length !== 1 || !matches[0]?.value.trim()) throw fail("postcondition");
    return matches[0].value.trim();
}

function dateFromParts(yearValue: string, monthValue: string, dayValue: string): string {
    const yearDigits = yearValue.replace(/\D/g, "");
    const monthDigits = monthValue.replace(/\D/g, "");
    const dayDigits = dayValue.replace(/\D/g, "");
    if (![2, 4].includes(yearDigits.length) || !monthDigits || !dayDigits) throw fail("postcondition");
    const year = yearDigits.length === 2 ? `20${yearDigits}` : yearDigits.slice(0, 4);
    const month = monthDigits.padStart(2, "0").slice(-2);
    const day = dayDigits.padStart(2, "0").slice(-2);
    if (Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > 31) throw fail("postcondition");
    return `${year}-${month}-${day}`;
}

function dateText(value: string): string {
    const digits = value.replace(/\D/g, "");
    if (digits.length === 8) return dateFromParts(digits.slice(0, 4), digits.slice(4, 6), digits.slice(6, 8));
    if (digits.length === 6) return dateFromParts(digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 6));
    throw fail("postcondition");
}

function normalizedPeriod(value: string): string {
    const parts = value.split(/\s*~\s*/);
    if (parts.length !== 2 || !parts[0] || !parts[1]) throw fail("postcondition");
    return `${dateText(parts[0]).replace(/-/g, "")}~${dateText(parts[1]).replace(/-/g, "")}`;
}

function normalizedMoney(value: string): string {
    const digits = value.replace(/[^\d]/g, "");
    if (!digits) throw fail("postcondition");
    return digits;
}

function bodyFieldMap(body: DraftDiagnosticCreateBody): Map<string, DraftDiagnosticField> {
    return new Map(body.document.fields.map((field) => [normalizedFieldId(field.id), field]));
}

export function buildDraftDiagnosticCreateBody(): DraftDiagnosticCreateBody {
    return {
        template_id: EFORMSIGN_COMPLETED_REISSUE_TEMPLATE_ID,
        document: {
            fields: [
                { id: "이용자 성명", value: EFORMSIGN_DRAFT_DIAGNOSTIC_SYNTHETIC_NAME },
                { id: "계약 시작 년도", value: "26" },
                { id: "계약 시작 월", value: "07" },
                { id: "계약 시작 일", value: "09" },
                { id: "계약 종료 년도", value: "27" },
                { id: "계약 종료 월", value: "01" },
                { id: "계약 종료 일", value: "07" },
                { id: "서비스 비용", value: "1,464,000" },
                { id: "정부지원금", value: "1,002,000" },
                { id: "본인부담금", value: "462,000" },
                { id: "서비스 가격", value: "1,464,000" },
                { id: "본인부담금 수령 년도", value: "26" },
                { id: "본인부담금 수령 월", value: "07" },
                { id: "본인부담금 수령 일", value: "09" },
                { id: "서비스 기간", value: TARGET_PERIOD_DISPLAY },
            ],
            recipients: [],
        },
    };
}

export function assertDraftDiagnosticCreateBody(body: DraftDiagnosticCreateBody): void {
    if (body.template_id !== EFORMSIGN_COMPLETED_REISSUE_TEMPLATE_ID) throw fail("postcondition");
    if (Object.keys(body.document).sort().join(",") !== "fields,recipients") throw fail("postcondition");
    if (body.document.recipients.length !== 0 || body.document.fields.length !== EFORMSIGN_DRAFT_DIAGNOSTIC_ALLOWLIST_FIELD_IDS.length) {
        throw fail("postcondition");
    }
    const ids = body.document.fields.map((field) => field.id);
    if (new Set(ids.map(normalizedFieldId)).size !== ids.length || ids.some((id, index) => id !== EFORMSIGN_DRAFT_DIAGNOSTIC_ALLOWLIST_FIELD_IDS[index])) {
        throw fail("postcondition");
    }
    if (body.document.fields.some((field) => FORBIDDEN_FIELD_PATTERN.test(field.id))) throw fail("postcondition");
    const fields = bodyFieldMap(body);
    const expected: Readonly<Record<string, string>> = {
        "이용자 성명": EFORMSIGN_DRAFT_DIAGNOSTIC_SYNTHETIC_NAME,
        "계약 시작 년도": "26",
        "계약 시작 월": "07",
        "계약 시작 일": "09",
        "계약 종료 년도": "27",
        "계약 종료 월": "01",
        "계약 종료 일": "07",
        "서비스 비용": "1,464,000",
        정부지원금: "1,002,000",
        본인부담금: "462,000",
        "서비스 가격": "1,464,000",
        "본인부담금 수령 년도": "26",
        "본인부담금 수령 월": "07",
        "본인부담금 수령 일": "09",
        "서비스 기간": TARGET_PERIOD_DISPLAY,
    };
    for (const [id, value] of Object.entries(expected)) {
        const field = fields.get(normalizedFieldId(id));
        if (!field || field.value !== value) throw fail("postcondition");
    }
}

export function assertDraftDiagnosticSourceBaseline(
    source: EformsignApiDocumentResponse,
    expectedIdentityFingerprint = EFORMSIGN_COMPLETED_REISSUE_EXPECTED_IDENTITY_FINGERPRINT,
): string {
    if (
        source.id !== EFORMSIGN_COMPLETED_REISSUE_SOURCE_ID
        || source.template?.id !== EFORMSIGN_COMPLETED_REISSUE_TEMPLATE_ID
        || source.current_status?.status_type !== EFORMSIGN_COMPLETED_REISSUE_SOURCE_STATUS_TYPE
    ) throw fail("postcondition");
    const name = fieldValue(source, "이용자 성명");
    const phone = fieldValue(source, "이용자 연락처");
    const fingerprint = completedReissueIdentityFingerprint(source.id, name, phone);
    if (fingerprint !== expectedIdentityFingerprint) throw fail("postcondition");
    if (dateFromParts(fieldValue(source, "계약 시작 년도"), fieldValue(source, "계약 시작 월"), fieldValue(source, "계약 시작 일")) !== EFORMSIGN_COMPLETED_REISSUE_SOURCE_START_DATE) throw fail("postcondition");
    if (dateFromParts(fieldValue(source, "계약 종료 년도"), fieldValue(source, "계약 종료 월"), fieldValue(source, "계약 종료 일")) !== EFORMSIGN_COMPLETED_REISSUE_SOURCE_END_DATE) throw fail("postcondition");
    if (normalizedPeriod(fieldValue(source, "서비스 기간")) !== SOURCE_PERIOD) throw fail("postcondition");
    if (dateFromParts(fieldValue(source, "본인부담금 수령 년도"), fieldValue(source, "본인부담금 수령 월"), fieldValue(source, "본인부담금 수령 일")) !== EFORMSIGN_COMPLETED_REISSUE_SOURCE_PAYMENT_DATE) throw fail("postcondition");
    for (const [id, expected] of Object.entries(EXPECTED_MONEY)) {
        if (normalizedMoney(fieldValue(source, id)) !== expected) throw fail("postcondition");
    }
    return fingerprint;
}

export function assertDraftDiagnosticSourceUnchanged(
    before: EformsignApiDocumentResponse,
    after: EformsignApiDocumentResponse,
): void {
    if (canonicalJson(snapshotCompletedReissueDocument(before)) !== canonicalJson(snapshotCompletedReissueDocument(after))) {
        throw fail("postcondition");
    }
}

function assertDraftTemplate(template: DraftDiagnosticTemplate): void {
    const expectedTypes = ["write", "participant", "participant", "reviewer", "complete"];
    const expectedGroups = [1, 3, 4, 5, 2];
    if (
        template.templateId !== EFORMSIGN_COMPLETED_REISSUE_TEMPLATE_ID
        || template.enabled !== true
        || template.released !== true
        || template.steps.length !== expectedTypes.length
        || template.steps.some((step, index) => step.sequence !== index + 1 || step.type !== expectedTypes[index] || step.stepGroup !== expectedGroups[index])
    ) throw fail("postcondition");
}

export function assertDraftDiagnosticNewDocument(
    document: EformsignApiDocumentResponse,
    expectedDocumentId: string,
): void {
    if (
        !/^[a-f0-9]{32}$/i.test(expectedDocumentId)
        || document.id !== expectedDocumentId
        || PROTECTED_DOCUMENT_IDS.has(document.id)
        || document.template?.id !== EFORMSIGN_COMPLETED_REISSUE_TEMPLATE_ID
        || document.current_status?.status_type !== "001"
    ) throw fail("postcondition");
    if (fieldValue(document, "이용자 성명") !== EFORMSIGN_DRAFT_DIAGNOSTIC_SYNTHETIC_NAME) throw fail("postcondition");
    if (dateFromParts(fieldValue(document, "계약 시작 년도"), fieldValue(document, "계약 시작 월"), fieldValue(document, "계약 시작 일")) !== EFORMSIGN_COMPLETED_REISSUE_SOURCE_START_DATE) throw fail("postcondition");
    if (dateFromParts(fieldValue(document, "계약 종료 년도"), fieldValue(document, "계약 종료 월"), fieldValue(document, "계약 종료 일")) !== EFORMSIGN_COMPLETED_REISSUE_TARGET_END_DATE) throw fail("postcondition");
    if (normalizedPeriod(fieldValue(document, "서비스 기간")) !== EFORMSIGN_COMPLETED_REISSUE_TARGET_PERIOD) throw fail("postcondition");
    if (dateFromParts(fieldValue(document, "본인부담금 수령 년도"), fieldValue(document, "본인부담금 수령 월"), fieldValue(document, "본인부담금 수령 일")) !== EFORMSIGN_COMPLETED_REISSUE_SOURCE_PAYMENT_DATE) throw fail("postcondition");
    for (const [id, expected] of Object.entries(EXPECTED_MONEY)) {
        if (normalizedMoney(fieldValue(document, id)) !== expected) throw fail("postcondition");
    }
    if ((document.fields ?? []).some((field) => FORBIDDEN_FIELD_PATTERN.test(field.id) && field.value.trim())) throw fail("postcondition");
}

function operationKey(): string {
    return createHash("sha256").update(canonicalJson({
        sourceId: EFORMSIGN_COMPLETED_REISSUE_SOURCE_ID,
        templateId: EFORMSIGN_COMPLETED_REISSUE_TEMPLATE_ID,
        body: buildDraftDiagnosticCreateBody(),
    })).digest("hex");
}

async function assertNoSymlinkAncestors(path: string): Promise<void> {
    const absolute = resolve(path);
    const components = absolute.split(sep).filter(Boolean);
    let cursor = absolute.startsWith(sep) ? sep : "";
    for (const component of components) {
        cursor = join(cursor, component);
        try {
            if ((await lstat(cursor)).isSymbolicLink()) throw fail("ledger");
        } catch (error) {
            if (error instanceof DraftDiagnosticFailure) throw error;
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            break;
        }
    }
}

async function secureDirectory(directory: string): Promise<void> {
    await assertNoSymlinkAncestors(directory);
    try {
        const current = await lstat(directory);
        if (!current.isDirectory() || current.isSymbolicLink()) throw fail("ledger");
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        await mkdir(directory, { recursive: true, mode: SECURE_DIRECTORY_MODE });
    }
    await chmod(directory, SECURE_DIRECTORY_MODE);
    if (((await stat(directory)).mode & 0o777) !== SECURE_DIRECTORY_MODE) throw fail("ledger");
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
        const result = await handle.write(data, offset, data.length - offset, offset);
        if (result.bytesWritten < 1) throw fail("ledger");
        offset += result.bytesWritten;
    }
}

async function writeSecureJson(path: string, value: unknown): Promise<void> {
    await assertNoSymlinkAncestors(path);
    const handle = await open(path, "wx", SECURE_FILE_MODE);
    const data = Buffer.from(`${canonicalJson(value)}\n`, "utf8");
    try {
        await writeAll(handle, data);
        await handle.sync();
    } finally {
        await handle.close();
    }
    await chmod(path, SECURE_FILE_MODE);
    const file = await lstat(path);
    if (!file.isFile() || file.isSymbolicLink() || (file.mode & 0o777) !== SECURE_FILE_MODE) throw fail("ledger");
    await syncDirectory(resolve(path, ".."));
}

async function updateSecureJson(path: string, value: unknown): Promise<void> {
    await assertNoSymlinkAncestors(path);
    const file = await lstat(path);
    if (!file.isFile() || file.isSymbolicLink() || (file.mode & 0o777) !== SECURE_FILE_MODE) throw fail("ledger");
    const handle = await open(path, "r+");
    const data = Buffer.from(`${canonicalJson(value)}\n`, "utf8");
    try {
        await handle.truncate(0);
        await writeAll(handle, data);
        await handle.sync();
    } finally {
        await handle.close();
    }
    await chmod(path, SECURE_FILE_MODE);
    await syncDirectory(resolve(path, ".."));
}

interface Reservation {
    markerPath: string;
    resultPath: string;
    artifactDirectory: string;
    operationKey: string;
    createdAt: string;
}

async function reserve(
    directory: string,
    key: string,
    now: () => Date,
): Promise<Reservation> {
    await secureDirectory(directory);
    const entries = await readdir(directory, { withFileTypes: true });
    if (entries.length > 0) throw new DraftDiagnosticAlreadyAttemptedError();
    const reservation: Reservation = {
        markerPath: join(directory, "attempt.json"),
        resultPath: join(directory, "result.json"),
        artifactDirectory: directory,
        operationKey: key,
        createdAt: now().toISOString(),
    };
    const shared = {
        schemaVersion: 1,
        operationKey: key,
        sourceId: EFORMSIGN_COMPLETED_REISSUE_SOURCE_ID,
        templateId: EFORMSIGN_COMPLETED_REISSUE_TEMPLATE_ID,
        fieldCount: EFORMSIGN_DRAFT_DIAGNOSTIC_ALLOWLIST_FIELD_IDS.length,
        artifactDirectory: directory,
        createdAt: reservation.createdAt,
    };
    await writeSecureJson(reservation.markerPath, { ...shared, status: "reserved" });
    await writeSecureJson(reservation.resultPath, {
        ...shared,
        status: "reserved",
        documentId: null,
        failureCategory: null,
        httpStatus: null,
        vendorCode: null,
    });
    return reservation;
}

function safeStatus(status: number): number | null {
    return Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
}

function safeVendorCode(body: string): string | null {
    const code = extractEformsignVendorCode(body)?.trim() ?? "";
    return /^\d{1,16}$/.test(code) ? code : null;
}

function transportFailure(error: unknown): DraftDiagnosticFailure {
    const name = error instanceof Error ? error.name : "";
    const isDomTimeout = typeof DOMException !== "undefined" && error instanceof DOMException;
    return fail(
        name === "TimeoutError"
        || name === "AbortError"
        || isDomTimeout
            ? "timeout"
            : "transport",
    );
}

function documentIdFromResponse(value: unknown): string | null {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const root = value as Record<string, unknown>;
    const documentValue = root["document"];
    const document = typeof documentValue === "object" && documentValue !== null && !Array.isArray(documentValue)
        ? documentValue as Record<string, unknown>
        : null;
    const candidate = document?.["id"] ?? root["document_id"] ?? root["docid"] ?? root["id"];
    return typeof candidate === "string" && /^[a-f0-9]{32}$/i.test(candidate.trim()) ? candidate.trim() : null;
}

async function postDraft(
    options: DraftDiagnosticOptions,
    key: string,
): Promise<{ documentId: string; httpStatus: number }> {
    const configured = options.config.get("EFORMSIGN_DOC_API_URL");
    if (configured !== EFORMSIGN_DRAFT_DIAGNOSTIC_DOC_API_ORIGIN || !options.accessToken.trim()) throw fail("config");
    const url = `${EFORMSIGN_DRAFT_DIAGNOSTIC_DOC_API_ORIGIN}/v2.0/api/documents?template_id=${encodeURIComponent(EFORMSIGN_COMPLETED_REISSUE_TEMPLATE_ID)}`;
    const fetchImpl = options.fetchImpl ?? fetch;
    let response: Response;
    try {
        response = await fetchImpl(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${options.accessToken}`,
                "Idempotency-Key": key,
            },
            body: JSON.stringify(buildDraftDiagnosticCreateBody()),
            redirect: "error",
            signal: AbortSignal.timeout(DRAFT_POST_TIMEOUT_MS),
        });
    } catch (error) {
        throw transportFailure(error);
    }
    const httpStatus = safeStatus(response.status);
    if (!response.ok) {
        let body: string;
        try {
            body = await response.text();
        } catch {
            throw fail("response_body", httpStatus);
        }
        throw fail("vendor_http", httpStatus, safeVendorCode(body));
    }
    let parsed: unknown;
    try {
        parsed = await response.json();
    } catch {
        throw fail("response_body", httpStatus);
    }
    const documentId = documentIdFromResponse(parsed);
    if (!documentId || PROTECTED_DOCUMENT_IDS.has(documentId)) {
        let vendorCode: string | null = null;
        try {
            vendorCode = safeVendorCode(JSON.stringify(parsed));
        } catch {
            vendorCode = null;
        }
        throw fail("response_shape", httpStatus, vendorCode);
    }
    return { documentId, httpStatus: httpStatus ?? response.status };
}

async function persistResult(
    reservation: Reservation,
    status: "created" | "created_unverified" | "failed" | "ambiguous",
    documentId: string | null,
    metadata: DraftDiagnosticFailureMetadata | null,
): Promise<void> {
    await updateSecureJson(reservation.resultPath, {
        schemaVersion: 1,
        status,
        operationKey: reservation.operationKey,
        sourceId: EFORMSIGN_COMPLETED_REISSUE_SOURCE_ID,
        templateId: EFORMSIGN_COMPLETED_REISSUE_TEMPLATE_ID,
        fieldCount: EFORMSIGN_DRAFT_DIAGNOSTIC_ALLOWLIST_FIELD_IDS.length,
        documentId,
        artifactDirectory: reservation.artifactDirectory,
        createdAt: reservation.createdAt,
        failureCategory: metadata?.category ?? null,
        httpStatus: metadata?.httpStatus ?? null,
        vendorCode: metadata?.vendorCode ?? null,
    });
}

export async function runDraftDiagnostic(options: DraftDiagnosticOptions): Promise<DraftDiagnosticSafeSummary> {
    const now = options.now ?? (() => new Date());
    const logger = options.logger ?? (() => undefined);
    const directory = options.ledgerDirectory ?? EFORMSIGN_DRAFT_DIAGNOSTIC_LEDGER_DIRECTORY;
    const key = operationKey();
    assertDraftDiagnosticCreateBody(buildDraftDiagnosticCreateBody());
    assertDraftTemplate(options.template);
    if (!options.accessToken.trim()) throw fail("config");
    const reservation = await reserve(directory, key, now);
    let documentId: string | null = null;
    let postEntered = false;
    try {
        const sourceBefore = await options.api.getDocument(options.accessToken, EFORMSIGN_COMPLETED_REISSUE_SOURCE_ID);
        assertDraftDiagnosticSourceBaseline(sourceBefore, options.expectedIdentityFingerprint);
        postEntered = true;
        const created = await postDraft(options, key);
        documentId = created.documentId;
        await persistResult(reservation, "created_unverified", documentId, null);
        const sourceAfter = await options.api.getDocument(options.accessToken, EFORMSIGN_COMPLETED_REISSUE_SOURCE_ID);
        assertDraftDiagnosticSourceUnchanged(sourceBefore, sourceAfter);
        const draft = await options.api.getDocument(options.accessToken, documentId);
        assertDraftDiagnosticNewDocument(draft, documentId);
        await persistResult(reservation, "created", documentId, null);
        logger({ event: "draft_created", status: "created", sourceId: EFORMSIGN_COMPLETED_REISSUE_SOURCE_ID, templateId: EFORMSIGN_COMPLETED_REISSUE_TEMPLATE_ID, documentId, fieldCount: EFORMSIGN_DRAFT_DIAGNOSTIC_ALLOWLIST_FIELD_IDS.length });
        return {
            status: "created",
            operationKey: key,
            sourceId: EFORMSIGN_COMPLETED_REISSUE_SOURCE_ID,
            templateId: EFORMSIGN_COMPLETED_REISSUE_TEMPLATE_ID,
            documentId,
            artifactDirectory: directory,
            fieldCount: EFORMSIGN_DRAFT_DIAGNOSTIC_ALLOWLIST_FIELD_IDS.length,
        };
    } catch (error) {
        const metadata = error instanceof DraftDiagnosticFailure
            ? error.metadata
            : { category: "postcondition" as const, httpStatus: null, vendorCode: null };
        const resultStatus = !postEntered || metadata.category === "config"
            ? "failed"
            : documentId !== null
                ? "created_unverified"
                : "ambiguous";
        try {
            await persistResult(reservation, resultStatus, documentId, metadata);
        } catch {
            // The marker remains durable; never retry this operation after an artifact write failure.
        }
        logger({ event: "draft_failed", status: resultStatus, sourceId: EFORMSIGN_COMPLETED_REISSUE_SOURCE_ID, templateId: EFORMSIGN_COMPLETED_REISSUE_TEMPLATE_ID, documentId, fieldCount: EFORMSIGN_DRAFT_DIAGNOSTIC_ALLOWLIST_FIELD_IDS.length });
        if (error instanceof DraftDiagnosticFailure) throw error;
        throw fail(metadata.category, metadata.httpStatus, metadata.vendorCode);
    }
}
