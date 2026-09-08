import {
    EFORMSIGN_COMPLETED_STATUS_CODES,
    TERMINAL_STATUS_CODES,
} from "domain/constants/eformsign-doc-status.constants";
import {
    normalizeEformsignStatusCode,
    normalizeEformsignStepType,
    isProviderReviewWorkflowStep,
} from "domain/utils/eformsign-status-code";
import type {
    ServiceRecordRevisionContractLockedFacts,
} from "application/services/service-record-revision-document-coordinator.service";
import type {
    ServiceRecordContractRevisionWorkflowScope,
    ServiceRecordContractRevisionWorkflowStage,
} from "application/services/service-record-contract-revision.service";

/**
 * A branch-owned projection of the eformsign document row.  Values which are
 * not columns on the legacy row (for example templateVersion) may only be
 * supplied when a caller has observed them from an authoritative source.  The
 * mapper never creates those values from a timestamp, hash, or provider name.
 */
export interface ServiceRecordRevisionFactsDocument {
    documentId: string | null;
    branchId?: string | null;
    clientId?: number | null;
    documentVersion?: number | null;
    templateId?: string | null;
    templateVersion?: string | null;
    mirrorGeneration?: string | null;
    startDate?: string | null;
    endDate?: string | null;
    receivedDate?: string | null;
    receivedAmount?: string | number | null;
    statusType?: string | number | null;
    stepType?: string | number | null;
    stepIndex?: string | number | null;
    stepName?: string | null;
    stepRecipientType?: string | number | null;
    stepRecipientName?: string | null;
    stepRecipientSms?: string | null;
    detailPayload: unknown | null;
    /** Explicit server-owned values may be passed when already parsed by the adapter. */
    stage?: ServiceRecordContractRevisionWorkflowStage | null;
    workflowScope?: ServiceRecordContractRevisionWorkflowScope | null;
    participant?: {
        id?: string | null;
        name?: string | null;
        phone?: string | null;
    } | null;
    allowedFieldIds?: readonly string[] | null;
    /** May be the row's JSON field map or the provider's field array. */
    fields?: unknown;
}

export interface ServiceRecordRevisionFactsReceiptToken {
    id: string;
    eformsignDocId: number;
    branchId: string | null;
    clientId: number | null;
    active: boolean;
    revokedAt: Date | string | null;
}

export interface ServiceRecordRevisionFactsInput {
    document: ServiceRecordRevisionFactsDocument | null;
    /** Undefined means no token observation was supplied; [] is an observed empty set. */
    receiptTokens?: readonly ServiceRecordRevisionFactsReceiptToken[];
    targetPeriod: ServiceRecordRevisionContractLockedFacts["targetPeriod"];
}

export interface ServiceRecordRevisionReceiptInput {
    expected: {
        serviceStartDate: string;
        serviceEndDate: string;
        receivedDate: string;
        amount: string;
    };
    tokens: {
        eformsignDocId: number;
        tokenIds: string[];
    };
    source: {
        documentId: string;
        documentVersion: number | null;
        templateId: string;
        templateVersion: string;
        mirrorGeneration: string;
    };
}

export interface ServiceRecordRevisionFactsResult {
    facts: ServiceRecordRevisionContractLockedFacts | null;
    receiptInput: ServiceRecordRevisionReceiptInput | null;
    /** Stable, non-sensitive names of facts which were absent, malformed, or contradictory. */
    missingFacts: string[];
}

type JsonRecord = Record<string, unknown>;
type Candidate = { value: unknown; source: string };

const SOURCE_START_ALIASES = [
    "계약 시작일",
    "계약시작일",
    "서비스 시작일",
    "서비스시작일",
    "startDate",
    "contractStartDate",
] as const;
const SOURCE_END_ALIASES = [
    "계약 종료일",
    "계약종료일",
    "서비스 종료일",
    "서비스종료일",
    "endDate",
    "contractEndDate",
] as const;
const PERIOD_ALIASES = [
    "계약 기간",
    "계약기간",
    "서비스 기간",
    "서비스기간",
    "서비스 제공 기간",
    "서비스 제공기간",
    "servicePeriod",
    "contractPeriod",
] as const;
const RECEIVED_DATE_ALIASES = [
    "본인부담금 수령일",
    "본인부담금수령일",
    "영수증 수령일",
    "영수증수령일",
    "수령일자",
    "수령 일자",
    "수령일",
    "수령 일",
    "receivedDate",
    "received_date",
] as const;
const RECEIVED_DATE_PART_ALIASES = {
    year: [
        "본인부담금 수령 년도",
        "본인부담금수령년도",
        "영수증 수령 년도",
        "영수증수령년도",
        "수령 년도",
        "수령년도",
        "receivedYear",
    ],
    month: [
        "본인부담금 수령 월",
        "본인부담금수령월",
        "영수증 수령 월",
        "영수증수령월",
        "수령 월",
        "수령월",
        "receivedMonth",
    ],
    day: [
        "본인부담금 수령 일",
        "본인부담금수령일",
        "영수증 수령 일",
        "영수증수령일",
        "수령 일",
        "수령일",
        "receivedDay",
    ],
} as const;
const AMOUNT_ALIASES = [
    "본인부담금",
    "본인 부담금",
    "실제 부담금",
    "실제부담금",
    "납부 금액",
    "납부금액",
    "결제 금액",
    "결제금액",
    "actualPrice",
    "receivedAmount",
    "received_amount",
] as const;
const CUSTOMER_NAME_ALIASES = [
    "이용자 성명",
    "이용자성명",
    "고객 성명",
    "고객성명",
    "고객명",
    "산모 성명",
    "산모성명",
    "산모명",
    "customerName",
    "clientName",
    "userName",
] as const;
const FIELD_ID_KEYS = [
    "id",
    "field_id",
    "fieldId",
    "name",
    "label",
    "field_name",
    "fieldName",
    "display_name",
    "displayName",
    "input_id",
    "inputId",
] as const;
const FIELD_VALUE_KEYS = [
    "value",
    "field_value",
    "fieldValue",
    "input_value",
    "inputValue",
    "data",
    "text",
] as const;
const RECIPIENT_NAME_KEYS = ["name", "recipient_name", "recipientName"] as const;
const RECIPIENT_ID_KEYS = ["id", "recipient_id", "recipientId", "email"] as const;
const RECIPIENT_TYPE_KEYS = [
    "recipient_type",
    "recipientType",
    "step_type",
    "stepType",
] as const;
const RECIPIENT_PHONE_KEYS = [
    "sms",
    "phone",
    "phone_number",
    "phoneNumber",
    "mobile",
    "mobile_number",
    "mobileNumber",
] as const;

function isRecord(value: unknown): value is JsonRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
}

function isPositiveInteger(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isDateOnly(value: unknown): value is string {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split("-").map(Number);
    const instant = new Date(Date.UTC(year ?? Number.NaN, (month ?? Number.NaN) - 1, day ?? Number.NaN));
    return Number.isFinite(instant.getTime())
        && instant.getUTCFullYear() === year
        && instant.getUTCMonth() === (month ?? Number.NaN) - 1
        && instant.getUTCDate() === day;
}

function isWorkflowScope(value: unknown): value is ServiceRecordContractRevisionWorkflowScope {
    return isRecord(value)
        && Object.keys(value).length > 0
        && Object.keys(value).every((key) => key.trim().length > 0)
        && Object.values(value).every((entry) => (
            entry === null
            || typeof entry === "string"
            || typeof entry === "number"
            || typeof entry === "boolean"
        ));
}

function isStage(value: unknown): value is ServiceRecordContractRevisionWorkflowStage {
    return value === "provider_review"
        || value === "provider_participant"
        || value === "signature_pending"
        || value === "completed"
        || value === "unsupported";
}

function own<T extends object>(object: T, key: PropertyKey): boolean {
    return Object.prototype.hasOwnProperty.call(object, key);
}

function stringValue(value: unknown): string | null {
    if (typeof value === "string") return value.trim() || null;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    return null;
}

function normalizeIdentifier(value: string): string {
    return value.replace(/[\s_\-:/.()[\]{}]+/g, "").toLowerCase();
}

function sameValue(first: unknown, second: unknown): boolean {
    if (typeof first === "string" && typeof second === "string") {
        return first.trim() === second.trim();
    }
    return Object.is(first, second);
}

function addMissing(missing: string[], ...names: string[]): void {
    for (const name of names) {
        if (!missing.includes(name)) missing.push(name);
    }
}

function collectRecords(value: unknown, depth = 0): JsonRecord[] {
    if (depth > 8 || value === null || value === undefined) return [];
    if (Array.isArray(value)) return value.flatMap((item) => collectRecords(item, depth + 1));
    if (!isRecord(value)) return [];
    return [value, ...Object.values(value).flatMap((item) => collectRecords(item, depth + 1))];
}

function firstKnownValue(record: JsonRecord, keys: readonly string[]): unknown {
    for (const key of keys) {
        if (own(record, key)) return record[key];
    }
    return undefined;
}

interface FieldCollection {
    values: Record<string, string>;
    normalized: Map<string, { id: string; value: string }>;
    conflicts: Set<string>;
    malformed: boolean;
}

function emptyFieldCollection(): FieldCollection {
    return {
        values: {},
        normalized: new Map(),
        conflicts: new Set(),
        malformed: false,
    };
}

function addField(collection: FieldCollection, rawId: unknown, rawValue: unknown): void {
    const fieldId = stringValue(rawId);
    if (!fieldId) {
        collection.malformed = true;
        return;
    }
    const fieldValue = stringValue(rawValue);
    if (fieldValue === null) {
        collection.malformed = true;
        return;
    }
    const key = normalizeIdentifier(fieldId);
    const existing = collection.normalized.get(key);
    if (existing && existing.value !== fieldValue) {
        collection.conflicts.add(fieldId);
        return;
    }
    if (!existing) collection.normalized.set(key, { id: fieldId, value: fieldValue });
    if (!own(collection.values, fieldId)) collection.values[fieldId] = fieldValue;
}

/**
 * Read only the provider's field-record shapes. The scalar-map branch is
 * entered solely below known `fields`/`field_values` containers; arbitrary
 * metadata objects are never projected as editable fields.
 */
function collectFieldValues(
    value: unknown,
    collection: FieldCollection,
    depth = 0,
    scalarMap = false,
): void {
    if (depth > 8 || value === null || value === undefined) return;
    if (Array.isArray(value)) {
        for (const item of value) collectFieldValues(item, collection, depth + 1, scalarMap);
        return;
    }
    if (!isRecord(value)) {
        if (scalarMap) collection.malformed = true;
        return;
    }

    const rawId = firstKnownValue(value, FIELD_ID_KEYS);
    const rawFieldValue = firstKnownValue(value, FIELD_VALUE_KEYS);
    if (rawId !== undefined || rawFieldValue !== undefined) {
        if (rawId !== undefined && rawFieldValue !== undefined) {
            addField(collection, rawId, rawFieldValue);
            return;
        }
        // `detail_template_info` itself has an `id`/`name` pair but is not a
        // field record. Treat only objects that also look like a field (or
        // carry a value without an id) as malformed evidence.
        if (rawFieldValue !== undefined
            || (rawId !== undefined
                && ["type", "field_id", "fieldId", "label", "field_name", "fieldName"].some((key) => own(value, key)))) {
            collection.malformed = true;
            return;
        }
    }

    for (const [key, nested] of Object.entries(value)) {
        const fieldContainer = [
            "fields",
            "field_values",
            "fieldValues",
            "field_values_list",
            "template_fields",
            "templateFields",
        ].includes(key);
        if (fieldContainer) {
            collectFieldValues(nested, collection, depth + 1, true);
        } else if (scalarMap) {
            if (typeof nested === "string" || typeof nested === "number" || typeof nested === "boolean") {
                addField(collection, key, nested);
            } else {
                collectFieldValues(nested, collection, depth + 1, false);
            }
        } else {
            collectFieldValues(nested, collection, depth + 1, false);
        }
    }
}

function fieldCandidates(
    collection: FieldCollection,
    aliases: readonly string[],
    exactOnly = false,
): Candidate[] {
    const aliasKeys = aliases.map(normalizeIdentifier);
    return [...collection.normalized.values()]
        .filter(({ id }) => {
            const idKey = normalizeIdentifier(id);
            return aliasKeys.some((alias) => idKey === alias || (!exactOnly && alias.length >= 5 && idKey.includes(alias)));
        })
        .map(({ value, id }) => ({ value, source: id }));
}

function readField(
    collection: FieldCollection,
    aliases: readonly string[],
    exactOnly = false,
): { value: string | null; ambiguous: boolean } {
    const candidates = fieldCandidates(collection, aliases, exactOnly);
    const values = [...new Set(candidates.map(({ value }) => typeof value === "string" ? value.trim() : String(value)))];
    return {
        value: values.length === 1 ? values[0]! : null,
        ambiguous: values.length > 1,
    };
}

function explicitPathCandidates(root: unknown, paths: readonly (readonly string[])[]): Candidate[] {
    if (!isRecord(root)) return [];
    const candidates: Candidate[] = [];
    for (const path of paths) {
        let current: unknown = root;
        for (const key of path) {
            if (!isRecord(current) || !own(current, key)) {
                current = undefined;
                break;
            }
            current = current[key];
        }
        if (current !== undefined) candidates.push({ value: current, source: path.join(".") });
    }
    return candidates;
}

function resolveCandidates(
    candidates: readonly Candidate[],
): { present: boolean; value: unknown; ambiguous: boolean } {
    if (candidates.length === 0) return { present: false, value: undefined, ambiguous: false };
    const first = candidates[0]!.value;
    return {
        present: true,
        value: first,
        ambiguous: candidates.slice(1).some(({ value }) => !sameValue(first, value)),
    };
}

function parseStrictDate(raw: unknown): string | null {
    const value = stringValue(raw);
    if (!value) return null;
    if (isDateOnly(value)) return value;
    const digits = String(value).replace(/\D/g, "");
    if (digits.length === 8) {
        const canonical = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
        return isDateOnly(canonical) ? canonical : null;
    }
    const separated = String(value).match(/^(\d{4})\D+(\d{1,2})\D+(\d{1,2})$/);
    if (separated) {
        const canonical = `${separated[1]}-${separated[2]!.padStart(2, "0")}-${separated[3]!.padStart(2, "0")}`;
        return isDateOnly(canonical) ? canonical : null;
    }
    return null;
}

function parseDateParts(collection: FieldCollection, aliases: {
    year: readonly string[];
    month: readonly string[];
    day: readonly string[];
}): { value: string | null; ambiguous: boolean } {
    const year = readField(collection, aliases.year);
    const month = readField(collection, aliases.month);
    const day = readField(collection, aliases.day);
    if (year.ambiguous || month.ambiguous || day.ambiguous) {
        return { value: null, ambiguous: true };
    }
    const yearDigits = year.value?.replace(/\D/g, "") ?? "";
    const monthDigits = month.value?.replace(/\D/g, "") ?? "";
    const dayDigits = day.value?.replace(/\D/g, "") ?? "";
    if (!yearDigits || !monthDigits || !dayDigits) return { value: null, ambiguous: false };
    const fullYear = yearDigits.length === 2
        ? `20${yearDigits}`
        : yearDigits.length === 4 ? yearDigits : "";
    if (!fullYear || !/^\d{1,2}$/.test(monthDigits) || !/^\d{1,2}$/.test(dayDigits)) {
        return { value: null, ambiguous: false };
    }
    const canonical = `${fullYear}-${monthDigits.padStart(2, "0")}-${dayDigits.padStart(2, "0")}`;
    return { value: isDateOnly(canonical) ? canonical : null, ambiguous: false };
}

function parsePeriod(raw: unknown): { start: string | null; end: string | null } {
    const value = stringValue(raw);
    if (!value) return { start: null, end: null };
    const matches = value.match(/\d{2,4}\D*\d{1,2}\D*\d{1,2}/g) ?? [];
    if (matches.length !== 2) return { start: null, end: null };
    return {
        start: parseStrictDate(matches[0]),
        end: parseStrictDate(matches[1]),
    };
}

function normalizeAmount(raw: unknown): string | null {
    if (typeof raw === "number") {
        return Number.isSafeInteger(raw) && raw >= 0 ? String(raw) : null;
    }
    const value = stringValue(raw);
    if (!value) return null;
    const stripped = value.replace(/[\s,._₩원]/g, "");
    return /^\d+$/.test(stripped) ? stripped : null;
}

function readDateFact(
    document: ServiceRecordRevisionFactsDocument,
    collection: FieldCollection,
    property: "startDate" | "endDate" | "receivedDate",
    aliases: readonly string[],
    parts: { year: readonly string[]; month: readonly string[]; day: readonly string[] } | null,
    missing: string[],
): string | null {
    if (own(document, property)) {
        const value = parseStrictDate(document[property]);
        if (!value) addMissing(missing, `sourceDocument.${property}`);
        return value;
    }

    const directCandidates = fieldCandidates(collection, aliases);
    const parsedDirectValues = [...new Set(
        directCandidates
            .map(({ value }) => parseStrictDate(value))
            .filter((value): value is string => value !== null),
    )];
    const directRawValues = directCandidates
        .map(({ value }) => typeof value === "string" ? value.trim() : String(value));
    // Date-part fields share a compact identifier with some full-date aliases
    // (for example `본인부담금 수령 일`). A short all-digit value is therefore
    // left for the explicit year/month/day parser below; any other unparseable
    // direct value is a malformed full-date fact.
    const onlyShortDateParts = directRawValues.length > 0
        && directRawValues.every((value) => /^\d{1,2}$/.test(value));
    if (parsedDirectValues.length > 1) {
        addMissing(missing, `sourceDocument.${property}.ambiguous`);
        return null;
    }
    if (directRawValues.length > 0 && parsedDirectValues.length === 0 && !onlyShortDateParts) {
        addMissing(missing, `sourceDocument.${property}`);
        return null;
    }
    const directValue = parsedDirectValues[0] ?? null;
    const partValue = parts ? parseDateParts(collection, parts) : { value: null, ambiguous: false };
    if (partValue.ambiguous) {
        addMissing(missing, `sourceDocument.${property}.ambiguous`);
        return null;
    }
    if (directValue && partValue.value && directValue !== partValue.value) {
        addMissing(missing, `sourceDocument.${property}.mismatch`);
        return null;
    }
    if (directValue || partValue.value) return directValue ?? partValue.value;
    addMissing(missing, `sourceDocument.${property}`);
    return null;
}

function recipientCandidates(detail: JsonRecord): Array<{ id: string; name: string; phone: string | null }> {
    const candidates = new Map<string, { id: string; name: string; phone: string | null }>();
    const sources = [
        detail["recipients"],
        detail["current_status"],
        detail["currentStatus"],
        detail["previous_status"],
        detail["previousStatus"],
        detail["histories"],
        detail["next_status"],
        detail["nextStatus"],
    ];
    for (const record of sources.flatMap((source) => collectRecords(source))) {
        const type = stringValue(firstKnownValue(record, RECIPIENT_TYPE_KEYS));
        if (type !== "02" && type !== "05") continue;
        const id = stringValue(firstKnownValue(record, RECIPIENT_ID_KEYS));
        const name = stringValue(firstKnownValue(record, RECIPIENT_NAME_KEYS));
        if (!id || !name) continue;
        const phone = stringValue(firstKnownValue(record, RECIPIENT_PHONE_KEYS));
        const key = `${id}\u0000${name}`;
        const previous = candidates.get(key);
        if (previous && previous.phone !== phone && previous.phone !== null && phone !== null) {
            // Keep both values visible to the caller by using a sentinel that will
            // be rejected as ambiguous below; no phone value is selected silently.
            candidates.set(key, { ...previous, phone: "__ambiguous__" });
        } else {
            candidates.set(key, previous ?? { id, name, phone });
        }
    }
    return [...candidates.values()];
}

function deriveParticipant(
    document: ServiceRecordRevisionFactsDocument,
    detail: JsonRecord,
    collection: FieldCollection,
    missing: string[],
): { id: string; name: string; phone: string | null } | null {
    if (own(document, "participant")) {
        const participant = document.participant;
        if (!participant || !isNonEmptyString(participant.id) || !isNonEmptyString(participant.name)) {
            addMissing(missing, "sourceDocument.participant");
            return null;
        }
        if (participant.phone !== null && participant.phone !== undefined && !isNonEmptyString(participant.phone)) {
            addMissing(missing, "sourceDocument.participant.phone");
            return null;
        }
        return {
            id: participant.id.trim(),
            name: participant.name.trim(),
            phone: participant.phone?.trim() || null,
        };
    }

    const candidates = recipientCandidates(detail);
    if (candidates.length !== 1 || candidates[0]!.phone === "__ambiguous__") {
        addMissing(missing, "sourceDocument.participant");
        return null;
    }
    const candidate = candidates[0]!;
    const customerName = readField(collection, CUSTOMER_NAME_ALIASES);
    if (customerName.ambiguous) {
        addMissing(missing, "sourceDocument.participant.name.ambiguous");
        return null;
    }
    if (customerName.value && customerName.value.trim() !== candidate.name.trim()) {
        addMissing(missing, "sourceDocument.participant.name.mismatch");
        return null;
    }
    return {
        id: candidate.id,
        name: candidate.name,
        phone: candidate.phone,
    };
}

function explicitStringFact(
    document: ServiceRecordRevisionFactsDocument,
    key: "templateId" | "templateVersion" | "mirrorGeneration",
    detail: JsonRecord,
    paths: readonly (readonly string[])[],
    missing: string[],
): string | null {
    const documentPresent = own(document, key);
    const documentCandidates = documentPresent ? [{ value: document[key], source: `document.${key}` }] : [];
    const detailCandidates = explicitPathCandidates(detail, paths);
    const resolved = resolveCandidates([...documentCandidates, ...detailCandidates]);
    if (!resolved.present || resolved.ambiguous || !isNonEmptyString(resolved.value)) {
        addMissing(missing, `sourceDocument.${key}`);
        return null;
    }
    return resolved.value.trim();
}

function resolveDocumentVersion(
    document: ServiceRecordRevisionFactsDocument,
    detail: JsonRecord,
    missing: string[],
): number | null {
    const documentPresent = own(document, "documentVersion");
    const candidates = documentPresent
        ? [{ value: document.documentVersion, source: "document.documentVersion" }]
        : explicitPathCandidates(detail, [
            ["documentVersion"],
            ["document_version"],
            ["metadata", "documentVersion"],
            ["metadata", "document_version"],
        ]);
    const resolved = resolveCandidates(candidates);
    if (!resolved.present || resolved.ambiguous) {
        addMissing(missing, "sourceDocument.documentVersion");
        return null;
    }
    if (resolved.value === null) return null;
    if (!isPositiveInteger(resolved.value)) {
        addMissing(missing, "sourceDocument.documentVersion");
        return null;
    }
    return resolved.value;
}

function observedStatusValue(
    document: ServiceRecordRevisionFactsDocument,
    detail: JsonRecord,
    key: "statusType" | "stepType" | "stepIndex" | "stepName",
    detailKeys: readonly string[],
    missing: string[],
): string | null {
    const currentStatus = isRecord(detail["current_status"])
        ? detail["current_status"]
        : isRecord(detail["currentStatus"]) ? detail["currentStatus"] : null;
    const documentPresent = own(document, key);
    const documentValue = documentPresent ? document[key] : undefined;
    const detailValue = currentStatus ? firstKnownValue(currentStatus, detailKeys) : undefined;
    const candidates = [
        ...(documentPresent ? [{ value: documentValue, source: `document.${key}` }] : []),
        ...(detailValue !== undefined ? [{ value: detailValue, source: `detail.current_status.${key}` }] : []),
    ];
    const resolved = resolveCandidates(candidates);
    if (!resolved.present) {
        addMissing(missing, `sourceDocument.${key}`);
        return null;
    }
    const value = stringValue(resolved.value);
    if (!value || resolved.ambiguous) {
        addMissing(missing, resolved.ambiguous ? `sourceDocument.${key}.mismatch` : `sourceDocument.${key}`);
        return null;
    }
    if (key === "statusType") return normalizeEformsignStatusCode(value);
    if (key === "stepType") return normalizeEformsignStepType(value);
    return value;
}

function deriveStage(
    document: ServiceRecordRevisionFactsDocument,
    detail: JsonRecord,
    statusType: string | null,
    stepType: string | null,
    stepName: string | null,
    missing: string[],
): ServiceRecordContractRevisionWorkflowStage | null {
    if (own(document, "stage")) {
        if (!isStage(document.stage)) addMissing(missing, "sourceDocument.stage");
        else return document.stage;
    }
    const detailStage = resolveCandidates(explicitPathCandidates(detail, [
        ["stage"],
        ["workflowStage"],
        ["workflow_stage"],
        ["metadata", "stage"],
    ]));
    if (detailStage.present) {
        if (!isStage(detailStage.value) || detailStage.ambiguous) {
            addMissing(missing, "sourceDocument.stage");
        } else {
            return detailStage.value;
        }
    }
    if (!statusType || !stepType || !stepName) {
        addMissing(missing, "sourceDocument.stage");
        return null;
    }
    if (EFORMSIGN_COMPLETED_STATUS_CODES.has(statusType)) return "completed";
    if (statusType === "070" && isProviderReviewWorkflowStep({ stepType, stepName })) {
        return "provider_review";
    }
    const providerStep = /(제공기관|관리자|담당자|provider|manager|staff)/i.test(stepName);
    const customerStep = /(이용자|고객|산모|participant|customer)/i.test(stepName);
    if (stepType === "05" && providerStep) return "provider_participant";
    if (stepType === "05" && customerStep && ["001", "002", "010", "020", "030", "043", "060", "063", "064"].includes(statusType)) {
        return "signature_pending";
    }
    if (TERMINAL_STATUS_CODES.has(statusType)) return "unsupported";
    addMissing(missing, "sourceDocument.stage");
    return null;
}

function resolveAllowedFieldIds(
    document: ServiceRecordRevisionFactsDocument,
    detail: JsonRecord,
    missing: string[],
): string[] | null {
    const candidates = own(document, "allowedFieldIds")
        ? [{ value: document.allowedFieldIds, source: "document.allowedFieldIds" }]
        : explicitPathCandidates(detail, [
            ["allowedFieldIds"],
            ["allowed_field_ids"],
            ["metadata", "allowedFieldIds"],
            ["metadata", "allowed_field_ids"],
        ]);
    const resolved = resolveCandidates(candidates);
    if (!resolved.present || resolved.ambiguous || !Array.isArray(resolved.value)) {
        addMissing(missing, "sourceDocument.allowedFieldIds");
        return null;
    }
    const values = resolved.value.map(stringValue);
    if (!values.every((value): value is string => Boolean(value))) {
        addMissing(missing, "sourceDocument.allowedFieldIds");
        return null;
    }
    const normalized = values.map(normalizeIdentifier);
    if (values.length === 0 || new Set(normalized).size !== values.length) {
        addMissing(missing, "sourceDocument.allowedFieldIds");
        return null;
    }
    return values.map((value) => value.trim());
}

function resolveWorkflowScope(
    document: ServiceRecordRevisionFactsDocument,
    observed: { statusType: string | null; stepType: string | null; stepIndex: string | null; stepName: string | null },
    missing: string[],
): ServiceRecordContractRevisionWorkflowScope | null {
    if (own(document, "workflowScope")) {
        if (!isWorkflowScope(document.workflowScope)) {
            addMissing(missing, "sourceDocument.workflowScope");
            return null;
        }
        return { ...document.workflowScope };
    }
    if (!observed.statusType || !observed.stepType || !observed.stepIndex || !observed.stepName) {
        addMissing(missing, "sourceDocument.workflowScope");
        return null;
    }
    return {
        statusType: observed.statusType,
        stepType: observed.stepType,
        stepIndex: observed.stepIndex,
        stepName: observed.stepName,
    };
}

function resolveSourceFields(
    document: ServiceRecordRevisionFactsDocument,
    detail: JsonRecord,
    missing: string[],
): FieldCollection {
    const collection = emptyFieldCollection();
    if (own(document, "fields")) {
        collectFieldValues(document.fields, collection, 0, true);
    } else {
        collectFieldValues(detail["fields"], collection, 0, true);
        collectFieldValues(detail["detail_template_info"], collection);
    }
    if (collection.malformed) addMissing(missing, "sourceDocument.fields");
    if (collection.conflicts.size > 0) addMissing(missing, "sourceDocument.fields.ambiguous");
    if (Object.keys(collection.values).length === 0) addMissing(missing, "sourceDocument.fields");
    return collection;
}

function validTargetPeriod(
    target: ServiceRecordRevisionContractLockedFacts["targetPeriod"],
    missing: string[],
): target is ServiceRecordRevisionContractLockedFacts["targetPeriod"] & {
    startDate: string;
    endDate: string;
    receiptPeriod: string;
    fields: Readonly<Record<string, string>>;
} {
    if (!target || !isDateOnly(target.startDate)) addMissing(missing, "targetPeriod.startDate");
    if (!target || !isDateOnly(target.endDate)) addMissing(missing, "targetPeriod.endDate");
    if (target && isDateOnly(target.startDate) && isDateOnly(target.endDate) && target.startDate > target.endDate) {
        addMissing(missing, "targetPeriod.period");
    }
    if (!target || !isNonEmptyString(target.receiptPeriod)
        || !isDateOnly(target.startDate)
        || !isDateOnly(target.endDate)
        || target.receiptPeriod !== `${target.startDate}~${target.endDate}`) {
        addMissing(missing, "targetPeriod.receiptPeriod");
    }
    if (!target || !isRecord(target.fields)
        || Object.values(target.fields).some((value) => typeof value !== "string")) {
        addMissing(missing, "targetPeriod.fields");
    }
    return Boolean(
        target
        && isDateOnly(target.startDate)
        && isDateOnly(target.endDate)
        && target.startDate <= target.endDate
        && isNonEmptyString(target.receiptPeriod)
        && target.receiptPeriod === `${target.startDate}~${target.endDate}`
        && isRecord(target.fields)
        && Object.values(target.fields).every((value) => typeof value === "string"),
    );
}

function validateReceiptTokens(
    document: ServiceRecordRevisionFactsDocument,
    receiptTokens: readonly ServiceRecordRevisionFactsReceiptToken[] | undefined,
    missing: string[],
): { eformsignDocId: number; tokenIds: string[] } | null {
    if (receiptTokens === undefined) {
        addMissing(missing, "receipt.tokens");
        return null;
    }
    if (receiptTokens.length === 0) return null;
    if (!isNonEmptyString(document.branchId) || !isPositiveInteger(document.clientId)) {
        addMissing(missing, "sourceDocument.scope");
        return null;
    }
    const tokenIds: string[] = [];
    let eformsignDocId: number | null = null;
    for (const token of receiptTokens) {
        if (!isNonEmptyString(token.id)
            || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(token.id)
            || !isPositiveInteger(token.eformsignDocId)
            || token.branchId !== document.branchId
            || token.clientId !== document.clientId
            || token.active !== true
            || token.revokedAt !== null) {
            addMissing(missing, "receipt.tokens.scope");
            continue;
        }
        if (eformsignDocId === null) eformsignDocId = token.eformsignDocId;
        if (eformsignDocId !== token.eformsignDocId) addMissing(missing, "receipt.tokens.document");
        tokenIds.push(token.id);
    }
    if (tokenIds.length !== receiptTokens.length || new Set(tokenIds).size !== tokenIds.length) {
        addMissing(missing, "receipt.tokens");
        return null;
    }
    if (eformsignDocId === null) {
        addMissing(missing, "receipt.tokens.document");
        return null;
    }
    return { eformsignDocId, tokenIds };
}

/**
 * Capture immutable contract and receipt facts from a scoped document detail.
 * The function is intentionally pure: callers must read the document/token
 * rows under their owning transaction and pass those observations here.
 */
export function captureServiceRecordRevisionFacts(
    input: ServiceRecordRevisionFactsInput,
): ServiceRecordRevisionFactsResult {
    const missing: string[] = [];
    const receiptMissing: string[] = [];
    const document = input?.document ?? null;
    const target = input?.targetPeriod;
    const targetValid = validTargetPeriod(target, missing);

    if (!document || !isNonEmptyString(document.documentId)) {
        addMissing(missing, "sourceDocument");
        return { facts: null, receiptInput: null, missingFacts: [...new Set(missing)] };
    }
    if (!isNonEmptyString(document.branchId) || !isPositiveInteger(document.clientId)) {
        addMissing(missing, "sourceDocument.scope");
    }
    const detail = isRecord(document.detailPayload) ? document.detailPayload : null;
    if (!detail) {
        addMissing(missing, "sourceDocument.detailPayload");
        return { facts: null, receiptInput: null, missingFacts: [...new Set(missing)] };
    }
    const detailId = stringValue(detail["id"]);
    if (!detailId || detailId !== document.documentId) {
        addMissing(missing, "sourceDocument.documentId.mismatch");
    }

    const sourceFields = resolveSourceFields(document, detail, missing);
    const statusType = observedStatusValue(document, detail, "statusType", ["status_type", "statusType"], missing);
    const stepType = observedStatusValue(document, detail, "stepType", ["step_type", "stepType"], missing);
    const stepIndex = observedStatusValue(document, detail, "stepIndex", ["step_index", "stepIndex"], missing);
    const stepName = observedStatusValue(document, detail, "stepName", ["step_name", "stepName"], missing);
    const observed = { statusType, stepType, stepIndex, stepName };

    const documentVersion = resolveDocumentVersion(document, detail, missing);
    const templateId = explicitStringFact(
        document,
        "templateId",
        detail,
        [["template", "id"], ["detail_template_info", "id"], ["template_id"], ["templateId"]],
        missing,
    );
    const templateVersion = explicitStringFact(
        document,
        "templateVersion",
        detail,
        [["templateVersion"], ["template_version"], ["template", "version"], ["template", "templateVersion"], ["detail_template_info", "version"]],
        missing,
    );
    const mirrorGeneration = explicitStringFact(
        document,
        "mirrorGeneration",
        detail,
        [["mirrorGeneration"], ["mirror_generation"], ["mirror", "generation"], ["metadata", "mirrorGeneration"], ["metadata", "mirror_generation"]],
        missing,
    );
    const workflowScope = resolveWorkflowScope(document, observed, missing);
    const stage = deriveStage(document, detail, statusType, stepType, stepName, missing);
    const participant = deriveParticipant(document, detail, sourceFields, missing);
    const allowedFieldIds = resolveAllowedFieldIds(document, detail, missing);

    const sourceStartDate = readDateFact(
        document,
        sourceFields,
        "startDate",
        SOURCE_START_ALIASES,
        { year: ["계약 시작 년도", "계약시작년도", "서비스 시작 년도", "서비스시작년도", "startYear"], month: ["계약 시작 월", "계약시작월", "서비스 시작 월", "서비스시작월", "startMonth"], day: ["계약 시작 일", "계약시작일", "서비스 시작 일", "서비스시작일", "startDay"] },
        missing,
    );
    const sourceEndDate = readDateFact(
        document,
        sourceFields,
        "endDate",
        SOURCE_END_ALIASES,
        { year: ["계약 종료 년도", "계약종료년도", "서비스 종료 년도", "서비스종료년도", "endYear"], month: ["계약 종료 월", "계약종료월", "서비스 종료 월", "서비스종료월", "endMonth"], day: ["계약 종료 일", "계약종료일", "서비스 종료 일", "서비스종료일", "endDay"] },
        missing,
    );
    const periodField = readField(sourceFields, PERIOD_ALIASES);
    const period = periodField.value ? parsePeriod(periodField.value) : { start: null, end: null };
    if (periodField.ambiguous) addMissing(missing, "sourceDocument.period.ambiguous");
    if (periodField.value && (!period.start || !period.end)) addMissing(missing, "sourceDocument.period");
    if (sourceStartDate && period.start && sourceStartDate !== period.start) addMissing(missing, "sourceDocument.startDate.mismatch");
    if (sourceEndDate && period.end && sourceEndDate !== period.end) addMissing(missing, "sourceDocument.endDate.mismatch");
    const finalStartDate = sourceStartDate ?? period.start;
    const finalEndDate = sourceEndDate ?? period.end;
    if (!finalStartDate) addMissing(missing, "sourceDocument.startDate");
    if (!finalEndDate) addMissing(missing, "sourceDocument.endDate");
    if (finalStartDate && finalEndDate && finalStartDate > finalEndDate) addMissing(missing, "sourceDocument.period");

    const receivedDate = readDateFact(
        document,
        sourceFields,
        "receivedDate",
        RECEIVED_DATE_ALIASES,
        RECEIVED_DATE_PART_ALIASES,
        missing,
    );
    let receivedAmount: string | null = null;
    if (own(document, "receivedAmount" as keyof ServiceRecordRevisionFactsDocument)) {
        // This field is intentionally read only when a server adapter supplied
        // it explicitly; no amount is derived from client pricing or duration.
        const raw = (document as ServiceRecordRevisionFactsDocument & { receivedAmount?: unknown }).receivedAmount;
        receivedAmount = normalizeAmount(raw);
        if (receivedAmount === null) addMissing(missing, "sourceDocument.receivedAmount");
    } else {
        const amountField = readField(sourceFields, AMOUNT_ALIASES, true);
        if (amountField.ambiguous) addMissing(missing, "sourceDocument.receivedAmount.ambiguous");
        receivedAmount = normalizeAmount(amountField.value);
        if (amountField.value !== null && receivedAmount === null) addMissing(missing, "sourceDocument.receivedAmount");
        if (amountField.value === null) addMissing(missing, "sourceDocument.receivedAmount");
    }

    const factsMissing = missing.length > 0;
    const facts = !factsMissing && targetValid && templateId && templateVersion && mirrorGeneration
        && workflowScope && stage && participant && allowedFieldIds && finalStartDate && finalEndDate && receivedDate && receivedAmount
        ? {
            sourceDocument: {
                documentId: document.documentId.trim(),
                documentVersion,
                templateId,
                templateVersion,
                workflowScope,
                mirrorGeneration,
                stage,
                participant,
                receivedDate,
                receivedAmount,
                startDate: finalStartDate,
                endDate: finalEndDate,
                allowedFieldIds,
                fields: { ...sourceFields.values },
            },
            targetPeriod: {
                startDate: target.startDate,
                endDate: target.endDate,
                receiptPeriod: target.receiptPeriod,
                fields: { ...target.fields },
            },
        } satisfies ServiceRecordRevisionContractLockedFacts
        : null;

    const tokens = validateReceiptTokens(document, input.receiptTokens, receiptMissing);
    const receiptInput = !facts
        || !targetValid
        || !templateId
        || !templateVersion
        || !mirrorGeneration
        || !finalStartDate
        || !finalEndDate
        || !receivedDate
        || !receivedAmount
        || !tokens
        ? null
        : {
            expected: {
                serviceStartDate: target.startDate,
                serviceEndDate: target.endDate,
                receivedDate,
                amount: receivedAmount,
            },
            tokens,
            source: {
                documentId: document.documentId.trim(),
                documentVersion,
                templateId,
                templateVersion,
                mirrorGeneration,
            },
        } satisfies ServiceRecordRevisionReceiptInput;

    return {
        facts,
        receiptInput,
        missingFacts: [...new Set([...missing, ...receiptMissing])],
    };
}
