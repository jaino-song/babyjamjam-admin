import { chmod, mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FrameLocator } from "playwright-core";

import { EFORMSIGN_END_DATE_FIELD_IDS } from "application/usecases/eformsign-doc/eformsign-end-date-field-ids";
import type { EformsignApiDocumentResponse } from "domain/repositories/eformsign.client.interface";
import {
    assertEformsignSdkDocumentIdentity,
    getAdvertisedOperationalActions,
    hashPdfBody,
    readEformsignSdkDocumentSnapshot,
    sanitizeActionCallback,
    type EformsignSdkDocumentSnapshot,
    type SanitizedEformsignAction,
    type SanitizedEformsignActionCallback,
} from "./eformsign-sdk-capability.live.helper";

export const EFORMSIGN_SEOGU_REVISION_DOCUMENT_ID = "d5adcc5ecd99431f841151a0c7540759";
export const EFORMSIGN_SEOGU_REVISION_TEMPLATE_ID = "1159de2d31fa444d92db3bd25afadd92";
export const EFORMSIGN_SEOGU_REVISION_TEMPLATE_VERSION = "12";
export const EFORMSIGN_SEOGU_REVISION_USER_EMAIL = "forchildrenbysongs@gmail.com";
export const EFORMSIGN_SEOGU_REVISION_RECIPIENT_ID = "142f6049d9af43e19b32ddf4c5139120";
/** The detail API calls the internal member recipient `insider`. */
export const EFORMSIGN_SEOGU_REVISION_RECIPIENT_TYPE = "insider";

export const EFORMSIGN_SEOGU_REVISION_REVIEW_STATUS_TYPE = "070";
export const EFORMSIGN_SEOGU_REVISION_REVIEW_STEP_TYPE = "06";
export const EFORMSIGN_SEOGU_REVISION_REVIEW_STEP_INDEX = "4";
export const EFORMSIGN_SEOGU_REVISION_REVIEW_STEP_GROUP = 5;
export const EFORMSIGN_SEOGU_REVISION_PARTICIPANT_STATUS_TYPE = "071";
export const EFORMSIGN_SEOGU_REVISION_PARTICIPANT_STEP_TYPE = "05";
export const EFORMSIGN_SEOGU_REVISION_PARTICIPANT_STEP_INDEX = "3";
export const EFORMSIGN_SEOGU_REVISION_PARTICIPANT_STEP_GROUP = 4;

export const EFORMSIGN_SEOGU_REVISION_BASELINE_END_DATE = "2027-01-05";
export const EFORMSIGN_SEOGU_REVISION_TARGET_END_DATE = "2027-01-06";
export const EFORMSIGN_SEOGU_REVISION_BASELINE_PERIOD = "20260709~20270105";
export const EFORMSIGN_SEOGU_REVISION_TARGET_PERIOD = "20260709~20270106";
export const EFORMSIGN_SEOGU_REVISION_START_DATE = "2026-07-09";
export const EFORMSIGN_SEOGU_REVISION_PAYMENT_DATE = "2026-07-09";
export const EFORMSIGN_SEOGU_REVISION_MONEY = {
    "서비스 비용": "1464000",
    "정부지원금": "1002000",
    "본인부담금": "462000",
} as const;

export const EFORMSIGN_SEOGU_REVISION_BASELINE_PDF_SHA256 =
    "1fe24f2392e4975d8dad34a81634daf5e08ea8f6d32841a73489c2423d7027e0";
export const EFORMSIGN_SEOGU_REVISION_INITIAL_SIGNED_PDF_SHA256 =
    "da6e21d42271ba3cdd43f95924b68104e57b9a1e81cffc7a87c03102cd8b64ca";

export const EFORMSIGN_SEOGU_REVISION_IFRAME_ID = "eformsign_sdk_seogu_revision_iframe";
export const EFORMSIGN_SEOGU_REVISION_DISPATCH_BRIDGE =
    "__eformsignSdkSeoguRevisionDispatchCurrentParticipantSend";
export const EFORMSIGN_SEOGU_REVISION_SEND_ACTION = { type: "01", code: "22" } as const;
export const EFORMSIGN_SEOGU_REVISION_DECLINE_COMMENT = "제공기관 날짜 자동 수정 검증";

const TEMPLATE_CONFIG_TIMEOUT_MS = 15_000;
const DECLINE_TIMEOUT_MS = 30_000;
const SECURE_DIRECTORY_MODE = 0o700;
const SECURE_FILE_MODE = 0o600;
const MAX_ACTION_LABEL_LENGTH = 160;
const MAX_ACTION_CODE_LENGTH = 64;
const MAX_ACTIONS_PER_CALLBACK = 20;
const PDF_READ_RETRY_DELAYS_MS = [0, 250, 500] as const;
const PDF_NOT_READY_STATUSES = new Set([202, 404, 409, 425, 429, 500, 502, 503, 504]);
const DATE_FIELD_IDS = [
    EFORMSIGN_END_DATE_FIELD_IDS.year,
    EFORMSIGN_END_DATE_FIELD_IDS.month,
    EFORMSIGN_END_DATE_FIELD_IDS.day,
    "서비스 기간",
] as const;
const START_FIELD_IDS = ["계약 시작 년도", "계약 시작 월", "계약 시작 일"] as const;
const PAYMENT_FIELD_IDS = ["본인부담금 수령 년도", "본인부담금 수령 월", "본인부담금 수령 일"] as const;

export const EFORMSIGN_SEOGU_REVISION_PREFILL_FIELDS = [
    { id: EFORMSIGN_END_DATE_FIELD_IDS.year, value: "27", enabled: true, required: false },
    { id: EFORMSIGN_END_DATE_FIELD_IDS.month, value: "01", enabled: true, required: false },
    { id: EFORMSIGN_END_DATE_FIELD_IDS.day, value: "06", enabled: true, required: false },
    { id: "서비스 기간", value: "20260709 ~ 20270106", enabled: true, required: false },
] as const;

export interface SeoguRevisionConfigReader {
    get(propertyPath: string): unknown;
}

export interface SeoguRevisionTemplateStepSummary {
    sequence: number;
    type: string;
    stepGroup: number;
    recipientCount: number;
    reviewerPreviousSequence: number | null;
    useRecipientSpecified: boolean;
    rejectRestricted: boolean | null;
}

export interface SeoguRevisionTemplateTopology {
    templateId: string;
    version: string;
    stepCount: number;
    sequential: boolean;
    parallel: boolean;
    rejectRestrictionsFalse: boolean;
    reviewerPreviousSequence: number;
    participantSequence: number;
    userParticipantUnselected: boolean;
    steps: SeoguRevisionTemplateStepSummary[];
}

export interface SeoguRevisionHttpEvidence {
    attempted: boolean;
    responseReceived: boolean;
    status: number | null;
    httpSuccess: boolean;
    responseBodyJson: boolean;
    responseIdPresent: boolean;
    responseIdMatches: boolean | null;
    transportError: boolean;
}

export interface SeoguRevisionSdkProbeState {
    documentConfigured: boolean;
    openInvoked: boolean;
    opened: boolean;
    bootError: boolean;
    errorCallbackSeen: boolean;
    actionCallbacks: SanitizedEformsignActionCallback[];
    successCodes: string[];
    sendActionAttempted: boolean | null;
    sendActionCount: number | null;
    sendActionType: string | null;
    sendActionCode: string | null;
    sendActionErrorCode: string | null;
}

export interface SeoguRevisionStageExpectation {
    statusType: string;
    stepType: string;
    stepIndex: string;
    stepGroup: number;
}

export interface SeoguRevisionPdfArtifact {
    path: string;
    sha256: string;
    byteLength: number;
}

export interface SeoguRevisionPdfReader {
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

export interface SeoguRevisionPdfReadResult {
    body: Buffer;
    attempts: number;
    statuses: number[];
}

export type SeoguRevisionModalSelector = "input-comment-popup" | "request-send-popup" | "unknown";
export type SeoguRevisionModalTarget = "not-observed" | "uncertain";
export type SeoguRevisionControl = "send" | "cancel" | "confirm" | "back" | "unknown";

export interface SeoguRevisionModalInventory {
    visible: boolean;
    selector: SeoguRevisionModalSelector;
    target: SeoguRevisionModalTarget;
    visibleDialogCount: number;
    controls: SeoguRevisionControl[];
    inspectionError: boolean;
}

export class SeoguRevisionNotVerifiedError extends Error {
    constructor(reason: string) {
        super(reason);
        this.name = "SeoguRevisionNotVerifiedError";
    }
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function requiredRecord(value: unknown, message: string): Record<string, unknown> {
    const record = asRecord(value);
    if (!record) throw new SeoguRevisionNotVerifiedError(message);
    return record;
}

function requiredString(value: unknown, message: string): string {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
    throw new SeoguRevisionNotVerifiedError(message);
}

function requiredNumber(value: unknown, message: string): number {
    const number = typeof value === "number"
        ? value
        : typeof value === "string" && /^-?\d+$/.test(value.trim())
            ? Number(value)
            : Number.NaN;
    if (Number.isSafeInteger(number)) return number;
    throw new SeoguRevisionNotVerifiedError(message);
}

function requiredBoolean(value: unknown, message: string): boolean {
    if (typeof value === "boolean") return value;
    throw new SeoguRevisionNotVerifiedError(message);
}

function requiredArray(record: Record<string, unknown>, key: string): unknown[] {
    if (Array.isArray(record[key])) return record[key];
    throw new SeoguRevisionNotVerifiedError(`Seogu template ${key} metadata missing`);
}

function firstDefined(record: Record<string, unknown>, keys: readonly string[]): unknown {
    for (const key of keys) {
        if (record[key] !== undefined && record[key] !== null) return record[key];
    }
    return undefined;
}

function readOptionValue(
    step: Record<string, unknown>,
    option: Record<string, unknown>,
    keys: readonly string[],
): unknown {
    return firstDefined(option, keys) ?? firstDefined(step, keys);
}

function readRecipientId(value: unknown): string {
    const recipient = requiredRecord(value, "Seogu template recipient metadata missing");
    const group = asRecord(recipient["group"]);
    const member = asRecord(recipient["member"]);
    return requiredString(
        firstDefined(group ?? {}, ["id"])
        ?? firstDefined(member ?? {}, ["id"])
        ?? recipient["id"],
        "Seogu template recipient id metadata missing",
    );
}

function readRecipientType(value: unknown): string {
    const recipient = requiredRecord(value, "Seogu template recipient metadata missing");
    return requiredString(
        firstDefined(recipient, ["receipient_type", "recipient_type", "type"]),
        "Seogu template recipient type metadata missing",
    ).toLowerCase();
}

function parseStep(stepValue: unknown): SeoguRevisionTemplateStepSummary & {
    raw: Record<string, unknown>;
    option: Record<string, unknown>;
    recipients: unknown[];
} {
    const raw = requiredRecord(stepValue, "Seogu template step metadata missing");
    const option = asRecord(raw["option"]) ?? {};
    const sequence = requiredNumber(
        firstDefined(raw, ["seq", "step_seq", "step_index"]),
        "Seogu template step sequence metadata missing",
    );
    const recipients = [2, 3, 4].includes(sequence)
        ? requiredArray(option, "receipients")
        : Array.isArray(option["receipients"]) ? option["receipients"] : [];
    const type = requiredString(raw["type"], "Seogu template step type metadata missing").toLowerCase();
    const stepGroup = requiredNumber(raw["step_group"], "Seogu template step group metadata missing");
    const rejectRestricted = [2, 3, 4].includes(sequence)
        ? requiredBoolean(option["use_reject_restrict"], "Seogu template reject metadata missing")
        : null;
    if (rejectRestricted === true) throw new SeoguRevisionNotVerifiedError("Seogu template has a reject restriction");

    const specifiedType = readOptionValue(raw, option, ["specified_recipient_type"]);
    const specifiedSequenceValue = readOptionValue(raw, option, ["specified_recipient_seq"]);
    const useSpecifiedValue = readOptionValue(raw, option, ["use_receipient_specified"]);
    const reviewerPreviousSequence = specifiedSequenceValue === undefined
        ? null
        : requiredNumber(specifiedSequenceValue, "Seogu template recipient sequence metadata invalid");
    const useRecipientSpecified = useSpecifiedValue === undefined
        ? false
        : requiredBoolean(useSpecifiedValue, "Seogu template recipient selection metadata invalid");

    if (sequence === 3) {
        if (type !== "participant" || recipients.length !== 1) {
            throw new SeoguRevisionNotVerifiedError("Seogu template participant recipient topology is invalid");
        }
        if (
            readRecipientType(recipients[0]) !== "internal"
            || readRecipientId(recipients[0]) !== EFORMSIGN_SEOGU_REVISION_RECIPIENT_ID
        ) {
            throw new SeoguRevisionNotVerifiedError("Seogu template internal participant is outside the exact allowlist");
        }
        if (specifiedType !== "groupormember" || !useRecipientSpecified) {
            throw new SeoguRevisionNotVerifiedError("Seogu template participant selection is not explicit");
        }
    }

    if (sequence === 4) {
        if (type !== "reviewer" || recipients.length !== 0) {
            throw new SeoguRevisionNotVerifiedError("Seogu template reviewer recipient topology is invalid");
        }
        if (specifiedType !== "beforewriter" || reviewerPreviousSequence !== 3 || !useRecipientSpecified) {
            throw new SeoguRevisionNotVerifiedError("Seogu template reviewer does not inherit participant step 3");
        }
    }

    return {
        raw,
        option,
        recipients,
        sequence,
        type,
        stepGroup,
        recipientCount: recipients.length,
        reviewerPreviousSequence: sequence === 4 ? reviewerPreviousSequence : null,
        useRecipientSpecified,
        rejectRestricted,
    };
}

export function assertSeoguRevisionTemplateTopology(value: unknown): SeoguRevisionTemplateTopology {
    const root = requiredRecord(value, "Seogu template response metadata missing");
    if (requiredString(root["form_id"], "Seogu template form id metadata missing") !== EFORMSIGN_SEOGU_REVISION_TEMPLATE_ID) {
        throw new SeoguRevisionNotVerifiedError("Seogu template form id is outside the exact allowlist");
    }
    const version = requiredString(root["version"], "Seogu template version metadata missing");
    if (version !== EFORMSIGN_SEOGU_REVISION_TEMPLATE_VERSION) {
        throw new SeoguRevisionNotVerifiedError("Seogu template version is outside the exact v12 allowlist");
    }
    const config = requiredRecord(root["config"], "Seogu template config metadata missing");
    const settings = requiredArray(config, "step_settings");
    const steps = settings.map(parseStep).sort((left, right) => left.sequence - right.sequence);
    const expectedTypes = ["write", "participant", "participant", "reviewer", "complete"];
    if (
        steps.length !== expectedTypes.length
        || steps.some((step, index) => step.sequence !== index + 1 || step.type !== expectedTypes[index])
    ) {
        throw new SeoguRevisionNotVerifiedError("Seogu template step sequence is outside the v12 workflow");
    }
    const groups = steps.map((step) => step.stepGroup);
    if (new Set(groups).size !== groups.length) {
        throw new SeoguRevisionNotVerifiedError("Seogu template has parallel step groups");
    }
    const userStep = steps[1];
    const participantStep = steps[2];
    const reviewerStep = steps[3];
    if (!userStep || !participantStep || !reviewerStep) {
        throw new SeoguRevisionNotVerifiedError("Seogu template participant steps are missing");
    }
    const userUnselected = userStep.recipientCount === 0;
    if (!userUnselected) throw new SeoguRevisionNotVerifiedError("Seogu template user participant is selected");
    if (participantStep.stepGroup !== EFORMSIGN_SEOGU_REVISION_PARTICIPANT_STEP_GROUP) {
        throw new SeoguRevisionNotVerifiedError("Seogu template participant step group is outside the exact v12 topology");
    }
    if (reviewerStep.stepGroup !== EFORMSIGN_SEOGU_REVISION_REVIEW_STEP_GROUP) {
        throw new SeoguRevisionNotVerifiedError("Seogu template reviewer step group is outside the exact v12 topology");
    }
    if (reviewerStep.reviewerPreviousSequence !== 3) {
        throw new SeoguRevisionNotVerifiedError("Seogu template reviewer predecessor is not participant step 3");
    }
    return {
        templateId: EFORMSIGN_SEOGU_REVISION_TEMPLATE_ID,
        version,
        stepCount: steps.length,
        sequential: true,
        parallel: false,
        rejectRestrictionsFalse: steps.every((step) => step.rejectRestricted !== true),
        reviewerPreviousSequence: reviewerStep.reviewerPreviousSequence,
        participantSequence: participantStep.sequence,
        userParticipantUnselected: userUnselected,
        steps: steps.map((step) => ({
            sequence: step.sequence,
            type: step.type,
            stepGroup: step.stepGroup,
            recipientCount: step.recipientCount,
            reviewerPreviousSequence: step.reviewerPreviousSequence,
            useRecipientSpecified: step.useRecipientSpecified,
            rejectRestricted: step.rejectRestricted,
        })),
    };
}

export async function fetchSeoguRevisionTemplateConfig(
    configService: SeoguRevisionConfigReader,
    accessToken: string,
    templateId = EFORMSIGN_SEOGU_REVISION_TEMPLATE_ID,
): Promise<unknown> {
    if (templateId !== EFORMSIGN_SEOGU_REVISION_TEMPLATE_ID) {
        throw new SeoguRevisionNotVerifiedError("Seogu template request id is outside the exact allowlist");
    }
    const configuredBase = configService.get("EFORMSIGN_DOC_API_URL");
    const baseUrl = typeof configuredBase === "string" ? configuredBase.trim().replace(/\/+$/, "") : "";
    if (!baseUrl) throw new SeoguRevisionNotVerifiedError("Seogu template API base is missing");
    const response = await fetch(
        `${baseUrl}/v2.0/api/forms/${encodeURIComponent(templateId)}?is_include_config=true`,
        {
            method: "GET",
            headers: { Authorization: `Bearer ${accessToken}` },
            redirect: "error",
            signal: AbortSignal.timeout(TEMPLATE_CONFIG_TIMEOUT_MS),
        },
    );
    if (!response.ok) throw new SeoguRevisionNotVerifiedError(`Seogu template request returned ${response.status}`);
    return response.json();
}

function readDocumentId(value: unknown): string | null {
    const record = asRecord(value);
    if (!record) return null;
    const direct = firstDefined(record, ["document_id", "documentId"]);
    if (typeof direct === "string" && direct.trim()) return direct.trim();
    const document = asRecord(record["document"]);
    const nested = firstDefined(document ?? {}, ["id", "document_id", "documentId"]);
    return typeof nested === "string" && nested.trim() ? nested.trim() : null;
}

export async function postSingleSeoguRevisionDecline(
    configService: SeoguRevisionConfigReader,
    accessToken: string,
    documentId = EFORMSIGN_SEOGU_REVISION_DOCUMENT_ID,
): Promise<SeoguRevisionHttpEvidence> {
    if (documentId !== EFORMSIGN_SEOGU_REVISION_DOCUMENT_ID) {
        throw new SeoguRevisionNotVerifiedError("Seogu decline document id is outside the exact allowlist");
    }
    const configuredBase = configService.get("EFORMSIGN_DOC_API_URL");
    const baseUrl = typeof configuredBase === "string" ? configuredBase.trim().replace(/\/+$/, "") : "";
    if (!baseUrl) throw new SeoguRevisionNotVerifiedError("Seogu decline API base is missing");
    let response: Response;
    try {
        response = await fetch(
            `${baseUrl}/v2.0/api/documents/${encodeURIComponent(documentId)}/decline`,
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ comment: EFORMSIGN_SEOGU_REVISION_DECLINE_COMMENT }),
                redirect: "error",
                signal: AbortSignal.timeout(DECLINE_TIMEOUT_MS),
            },
        );
    } catch {
        return {
            attempted: true,
            responseReceived: false,
            status: null,
            httpSuccess: false,
            responseBodyJson: false,
            responseIdPresent: false,
            responseIdMatches: null,
            transportError: true,
        };
    }

    let bodyText = "";
    try {
        bodyText = await response.text();
    } catch {
        return {
            attempted: true,
            responseReceived: true,
            status: response.status,
            httpSuccess: response.ok,
            responseBodyJson: false,
            responseIdPresent: false,
            responseIdMatches: null,
            transportError: true,
        };
    }

    let payload: unknown;
    let responseBodyJson = false;
    if (bodyText.trim()) {
        try {
            payload = JSON.parse(bodyText) as unknown;
            responseBodyJson = true;
        } catch {
            payload = undefined;
        }
    }
    const responseId = readDocumentId(payload);
    return {
        attempted: true,
        responseReceived: true,
        status: response.status,
        httpSuccess: response.ok,
        responseBodyJson,
        responseIdPresent: responseId !== null,
        responseIdMatches: responseId === null ? null : responseId === documentId,
        transportError: false,
    };
}

function assertSeoguRevisionStage(
    document: EformsignApiDocumentResponse,
    expectation: SeoguRevisionStageExpectation,
): EformsignSdkDocumentSnapshot {
    const snapshot = assertEformsignSdkDocumentIdentity(document, {
        documentId: EFORMSIGN_SEOGU_REVISION_DOCUMENT_ID,
        templateId: EFORMSIGN_SEOGU_REVISION_TEMPLATE_ID,
        statusType: expectation.statusType,
        stepType: expectation.stepType,
        stepIndex: expectation.stepIndex,
        recipientId: EFORMSIGN_SEOGU_REVISION_RECIPIENT_ID,
        recipientType: EFORMSIGN_SEOGU_REVISION_RECIPIENT_TYPE,
        expiredDate: 0,
        expired: false,
    });
    if (document.current_status.step_group !== expectation.stepGroup) {
        throw new SeoguRevisionNotVerifiedError("Seogu document step group is outside the exact allowlist");
    }
    return snapshot;
}

export function assertSeoguRevisionReviewerDocument(document: EformsignApiDocumentResponse): EformsignSdkDocumentSnapshot {
    return assertSeoguRevisionStage(document, {
        statusType: EFORMSIGN_SEOGU_REVISION_REVIEW_STATUS_TYPE,
        stepType: EFORMSIGN_SEOGU_REVISION_REVIEW_STEP_TYPE,
        stepIndex: EFORMSIGN_SEOGU_REVISION_REVIEW_STEP_INDEX,
        stepGroup: EFORMSIGN_SEOGU_REVISION_REVIEW_STEP_GROUP,
    });
}

export function assertSeoguRevisionParticipantDocument(document: EformsignApiDocumentResponse): EformsignSdkDocumentSnapshot {
    return assertSeoguRevisionStage(document, {
        statusType: EFORMSIGN_SEOGU_REVISION_PARTICIPANT_STATUS_TYPE,
        stepType: EFORMSIGN_SEOGU_REVISION_PARTICIPANT_STEP_TYPE,
        stepIndex: EFORMSIGN_SEOGU_REVISION_PARTICIPANT_STEP_INDEX,
        stepGroup: EFORMSIGN_SEOGU_REVISION_PARTICIPANT_STEP_GROUP,
    });
}

/** Check only immutable document/template identity before retaining postflight evidence. */
export function assertSeoguRevisionDocumentIdentity(document: EformsignApiDocumentResponse): void {
    if (document.id !== EFORMSIGN_SEOGU_REVISION_DOCUMENT_ID) {
        throw new SeoguRevisionNotVerifiedError("Seogu document id is outside the exact allowlist");
    }
    if (document.template?.id !== EFORMSIGN_SEOGU_REVISION_TEMPLATE_ID) {
        throw new SeoguRevisionNotVerifiedError("Seogu document template id is outside the exact allowlist");
    }
}

function fieldsForId(document: EformsignApiDocumentResponse, id: string): Array<{ value: string; type: string }> {
    return (document.fields ?? [])
        .filter((field) => field.id === id)
        .map((field) => ({ value: String(field.value ?? ""), type: String(field.type ?? "") }));
}

function oneFieldValue(document: EformsignApiDocumentResponse, id: string): string {
    const fields = fieldsForId(document, id);
    if (fields.length !== 1) {
        throw new SeoguRevisionNotVerifiedError(`Seogu field ${id} did not have exactly one API value`);
    }
    const field = fields[0];
    if (!field) throw new SeoguRevisionNotVerifiedError(`Seogu field ${id} was missing`);
    return field.value.trim();
}

function normalizePeriod(value: string): string {
    return value.replace(/[\s-]/g, "");
}

function normalizeMoney(value: string): string {
    return value.replace(/[\s,₩원]/g, "");
}

function normalizeYear(value: string): string {
    const digits = value.replace(/\s/g, "");
    return digits.length === 4 ? digits.slice(-2) : digits;
}

function stableJson(value: unknown): string {
    return JSON.stringify(value) ?? "";
}

function rawFieldFingerprint(document: EformsignApiDocumentResponse, excludedIds: ReadonlySet<string>): string {
    return stableJson((document.fields ?? [])
        .filter((field) => !excludedIds.has(field.id))
        .map((field) => ({
            id: String(field.id ?? ""),
            value: String(field.value ?? ""),
            type: String(field.type ?? ""),
        }))
        .sort((left, right) => stableJson(left).localeCompare(stableJson(right))));
}

function historyMultiset(histories: readonly unknown[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const history of histories) {
        const key = stableJson(history);
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
}

/** Preserve prior history entries; a successful mutation may append one new event. */
export function assertSeoguRevisionHistoryPreserved(
    before: EformsignApiDocumentResponse,
    after: EformsignApiDocumentResponse,
): void {
    if (!Array.isArray(before.histories) || !Array.isArray(after.histories)) {
        throw new SeoguRevisionNotVerifiedError("Seogu API history was not returned for preservation proof");
    }
    const afterCounts = historyMultiset(after.histories);
    for (const [key, count] of historyMultiset(before.histories).entries()) {
        if ((afterCounts.get(key) ?? 0) < count) {
            throw new SeoguRevisionNotVerifiedError("Seogu API history entry was removed or changed");
        }
    }
}

export function assertSeoguRevisionBaselineFields(document: EformsignApiDocumentResponse): void {
    if (document.id !== EFORMSIGN_SEOGU_REVISION_DOCUMENT_ID) {
        throw new SeoguRevisionNotVerifiedError("Seogu baseline document id changed");
    }
    const startValues = [
        normalizeYear(oneFieldValue(document, START_FIELD_IDS[0])),
        oneFieldValue(document, START_FIELD_IDS[1]),
        oneFieldValue(document, START_FIELD_IDS[2]),
    ];
    if (stableJson(startValues) !== stableJson(["26", "07", "09"])) {
        throw new SeoguRevisionNotVerifiedError("Seogu baseline start date was not 2026-07-09");
    }
    const endValues = [
        normalizeYear(oneFieldValue(document, EFORMSIGN_END_DATE_FIELD_IDS.year)),
        oneFieldValue(document, EFORMSIGN_END_DATE_FIELD_IDS.month),
        oneFieldValue(document, EFORMSIGN_END_DATE_FIELD_IDS.day),
    ];
    if (stableJson(endValues) !== stableJson(["27", "01", "05"])) {
        throw new SeoguRevisionNotVerifiedError("Seogu baseline end date was not 2027-01-05");
    }
    if (normalizePeriod(oneFieldValue(document, "서비스 기간")) !== EFORMSIGN_SEOGU_REVISION_BASELINE_PERIOD) {
        throw new SeoguRevisionNotVerifiedError("Seogu baseline service period was not Jan05");
    }
    const paymentValues = PAYMENT_FIELD_IDS.map((id) => oneFieldValue(document, id));
    if (stableJson(paymentValues) !== stableJson(["26", "07", "09"])) {
        throw new SeoguRevisionNotVerifiedError("Seogu payment date was not 2026-07-09");
    }
    for (const [id, expected] of Object.entries(EFORMSIGN_SEOGU_REVISION_MONEY)) {
        if (normalizeMoney(oneFieldValue(document, id)) !== expected) {
            throw new SeoguRevisionNotVerifiedError(`Seogu baseline money field ${id} changed`);
        }
    }
}

export function assertSeoguRevisionTargetFields(document: EformsignApiDocumentResponse): void {
    if (
        normalizeYear(oneFieldValue(document, EFORMSIGN_END_DATE_FIELD_IDS.year)) !== "27"
        || oneFieldValue(document, EFORMSIGN_END_DATE_FIELD_IDS.month) !== "01"
        || oneFieldValue(document, EFORMSIGN_END_DATE_FIELD_IDS.day) !== "06"
        || normalizePeriod(oneFieldValue(document, "서비스 기간")) !== EFORMSIGN_SEOGU_REVISION_TARGET_PERIOD
    ) {
        throw new SeoguRevisionNotVerifiedError("Seogu target fields were not at Jan06");
    }
}

/** Only the four reviewed date fields may differ after the SDK participant send. */
export function assertSeoguRevisionOnlyAllowedFieldChanges(
    before: EformsignApiDocumentResponse,
    after: EformsignApiDocumentResponse,
): void {
    if (before.id !== EFORMSIGN_SEOGU_REVISION_DOCUMENT_ID || after.id !== EFORMSIGN_SEOGU_REVISION_DOCUMENT_ID) {
        throw new SeoguRevisionNotVerifiedError("Seogu field comparison document id changed");
    }
    if (before.template?.id !== EFORMSIGN_SEOGU_REVISION_TEMPLATE_ID || after.template?.id !== EFORMSIGN_SEOGU_REVISION_TEMPLATE_ID) {
        throw new SeoguRevisionNotVerifiedError("Seogu field comparison template id changed");
    }
    const allowed = new Set<string>(DATE_FIELD_IDS);
    if (rawFieldFingerprint(before, allowed) !== rawFieldFingerprint(after, allowed)) {
        throw new SeoguRevisionNotVerifiedError("Seogu API changed a field outside the four-field allowlist");
    }
    assertSeoguRevisionBaselineFields(before);
    assertSeoguRevisionTargetFields(after);
    const immutableStart = START_FIELD_IDS.map((id) => oneFieldValue(before, id));
    const afterStart = START_FIELD_IDS.map((id) => oneFieldValue(after, id));
    if (stableJson(immutableStart) !== stableJson(afterStart)) {
        throw new SeoguRevisionNotVerifiedError("Seogu start date fields changed");
    }
    const beforePayment = PAYMENT_FIELD_IDS.map((id) => oneFieldValue(before, id));
    const afterPayment = PAYMENT_FIELD_IDS.map((id) => oneFieldValue(after, id));
    if (stableJson(beforePayment) !== stableJson(afterPayment)) {
        throw new SeoguRevisionNotVerifiedError("Seogu payment date fields changed");
    }
    for (const id of Object.keys(EFORMSIGN_SEOGU_REVISION_MONEY)) {
        if (normalizeMoney(oneFieldValue(before, id)) !== normalizeMoney(oneFieldValue(after, id))) {
            throw new SeoguRevisionNotVerifiedError(`Seogu money field ${id} changed`);
        }
    }
}

export function assertSeoguRevisionPdfDownload(download: {
    status: number;
    contentType: string;
    body: Buffer;
}): void {
    if (
        download.status !== 200
        || !download.contentType.toLowerCase().includes("application/pdf")
        || !Buffer.isBuffer(download.body)
        || download.body.length < 5
        || download.body.subarray(0, 5).toString("ascii") !== "%PDF-"
    ) {
        throw new SeoguRevisionNotVerifiedError("Seogu PDF response was not a successful PDF");
    }
}

function pdfOutputReady(download: {
    status: number;
    contentType: string;
    body: Buffer;
}): boolean {
    try {
        assertSeoguRevisionPdfDownload(download);
        return true;
    } catch {
        return false;
    }
}

function pdfReadMayBeNotReady(download: {
    status: number;
    contentType: string;
    body: Buffer;
}): boolean {
    if (pdfOutputReady(download)) return false;
    return PDF_NOT_READY_STATUSES.has(download.status) || download.status === 200;
}

function waitForRetry(delayMs: number): Promise<void> {
    if (delayMs <= 0) return Promise.resolve();
    return new Promise((resolve) => setTimeout(resolve, delayMs));
}

/** Retries only GET PDF reads when the generated output is not ready. */
export async function downloadSeoguRevisionPdfWithReadonlyRetry(
    reader: SeoguRevisionPdfReader,
    accessToken: string,
    documentId = EFORMSIGN_SEOGU_REVISION_DOCUMENT_ID,
): Promise<SeoguRevisionPdfReadResult> {
    if (documentId !== EFORMSIGN_SEOGU_REVISION_DOCUMENT_ID) {
        throw new SeoguRevisionNotVerifiedError("Seogu PDF document id is outside the exact allowlist");
    }
    const statuses: number[] = [];
    let lastDownload: Awaited<ReturnType<SeoguRevisionPdfReader["downloadDocumentFile"]>> | undefined;
    for (let index = 0; index < PDF_READ_RETRY_DELAYS_MS.length; index += 1) {
        const delayMs = PDF_READ_RETRY_DELAYS_MS[index] ?? 0;
        await waitForRetry(delayMs);
        lastDownload = await reader.downloadDocumentFile(accessToken, documentId, "document");
        statuses.push(lastDownload.status);
        if (pdfOutputReady(lastDownload)) {
            return { body: lastDownload.body, attempts: index + 1, statuses };
        }
        if (!pdfReadMayBeNotReady(lastDownload)) break;
    }
    if (!lastDownload) throw new SeoguRevisionNotVerifiedError("Seogu PDF read did not start");
    assertSeoguRevisionPdfDownload(lastDownload);
    return { body: lastDownload.body, attempts: statuses.length, statuses };
}

export async function createSecureSeoguRevisionArtifactDirectory(): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), "eformsign-seogu-revision-"));
    await chmod(directory, SECURE_DIRECTORY_MODE);
    if (((await stat(directory)).mode & 0o777) !== SECURE_DIRECTORY_MODE) {
        throw new SeoguRevisionNotVerifiedError("Seogu artifact directory was not secured");
    }
    return directory;
}

export async function writeSecureSeoguRevisionPdfArtifact(
    directory: string,
    label: "before" | "after",
    body: Buffer,
): Promise<SeoguRevisionPdfArtifact> {
    assertSeoguRevisionPdfDownload({ status: 200, contentType: "application/pdf", body });
    const artifactPath = join(directory, `${label}.pdf`);
    await writeFile(artifactPath, body, { mode: SECURE_FILE_MODE, flag: "wx" });
    await chmod(artifactPath, SECURE_FILE_MODE);
    if (((await stat(artifactPath)).mode & 0o777) !== SECURE_FILE_MODE) {
        throw new SeoguRevisionNotVerifiedError("Seogu PDF artifact was not secured");
    }
    return { path: artifactPath, sha256: hashPdfBody(body), byteLength: body.length };
}

export interface SeoguRevisionApiArtifact {
    documentId: string;
    templateId: string;
    statusType: string;
    stepType: string;
    stepIndex: string;
    stepGroup: number;
    expiredDate: number | null;
    expired: boolean | null;
    fieldHash: string;
    fieldCount: number;
    historyCount: number;
}

export async function writeSecureSeoguRevisionApiArtifact(
    directory: string,
    label: "before" | "after",
    document: EformsignApiDocumentResponse,
): Promise<SeoguRevisionApiArtifact> {
    const snapshot = readEformsignSdkDocumentSnapshot(document);
    const artifact: SeoguRevisionApiArtifact = {
        documentId: document.id,
        templateId: document.template?.id ?? "",
        statusType: document.current_status.status_type,
        stepType: document.current_status.step_type,
        stepIndex: document.current_status.step_index,
        stepGroup: document.current_status.step_group,
        expiredDate: document.current_status.expired_date ?? null,
        expired: document.current_status._expired ?? null,
        fieldHash: snapshot.fieldHash,
        fieldCount: snapshot.fieldCount,
        historyCount: Array.isArray(document.histories) ? document.histories.length : 0,
    };
    const artifactPath = join(directory, `${label}.api.json`);
    await writeFile(artifactPath, `${JSON.stringify(artifact)}\n`, { mode: SECURE_FILE_MODE, flag: "wx" });
    await chmod(artifactPath, SECURE_FILE_MODE);
    if (((await stat(artifactPath)).mode & 0o777) !== SECURE_FILE_MODE) {
        throw new SeoguRevisionNotVerifiedError("Seogu API artifact was not secured");
    }
    return artifact;
}

function boundedString(value: unknown, maxLength: number): string {
    if (typeof value === "string") return value.trim().slice(0, maxLength);
    if (typeof value === "number" && Number.isFinite(value)) return String(value).slice(0, maxLength);
    return "";
}

export function normalizeSeoguRevisionSdkProbeState(value: unknown): SeoguRevisionSdkProbeState {
    const state = asRecord(value) ?? {};
    const actionCallbacks = Array.isArray(state["actionCallbacks"])
        ? state["actionCallbacks"].flatMap((item): SanitizedEformsignActionCallback[] => {
            const sanitized = sanitizeActionCallback(item);
            return sanitized ? [sanitized] : [];
        })
        : [];
    const successCodes = Array.isArray(state["successCodes"])
        ? state["successCodes"].map((code) => boundedString(code, 32)).filter(Boolean).slice(0, MAX_ACTIONS_PER_CALLBACK)
        : [];
    const sendActionCount = typeof state["sendActionCount"] === "number"
        && Number.isInteger(state["sendActionCount"])
        && state["sendActionCount"] >= 0
        ? state["sendActionCount"]
        : null;
    return {
        documentConfigured: state["documentConfigured"] === true,
        openInvoked: state["openInvoked"] === true,
        opened: state["opened"] === true,
        bootError: state["bootError"] === true,
        errorCallbackSeen: state["errorCallbackSeen"] === true,
        actionCallbacks,
        successCodes,
        sendActionAttempted: typeof state["sendActionAttempted"] === "boolean" ? state["sendActionAttempted"] : null,
        sendActionCount,
        sendActionType: boundedString(state["sendActionType"], 16) || null,
        sendActionCode: boundedString(state["sendActionCode"], MAX_ACTION_CODE_LENGTH) || null,
        sendActionErrorCode: boundedString(state["sendActionErrorCode"], 64) || null,
    };
}

export function getAdvertisedSeoguRevisionSendActions(
    callbacks: readonly SanitizedEformsignActionCallback[],
): SanitizedEformsignAction[] {
    return getAdvertisedOperationalActions(callbacks)
        .filter((action) => action.code === EFORMSIGN_SEOGU_REVISION_SEND_ACTION.code);
}

export function assertSeoguRevisionSendAdvertised(
    callbacks: readonly SanitizedEformsignActionCallback[],
): SanitizedEformsignAction[] {
    const actions = getAdvertisedSeoguRevisionSendActions(callbacks);
    if (actions.length === 0) {
        throw new SeoguRevisionNotVerifiedError("fresh Seogu SDK actionCallback did not advertise participant send code 22");
    }
    return actions;
}

function serializeOption(value: Record<string, unknown>): string {
    return JSON.stringify(value)
        .replace(/</g, "\\u003c")
        .replace(/\u2028/g, "\\u2028")
        .replace(/\u2029/g, "\\u2029");
}

/** Builds a test-only official SDK page. It never enters the writer route or clicks a modal. */
export function buildSeoguRevisionSdkHtml(
    documentOption: Record<string, unknown>,
    options: { iframeId?: string } = {},
): string {
    const iframeId = options.iframeId ?? EFORMSIGN_SEOGU_REVISION_IFRAME_ID;
    const optionJson = serializeOption(documentOption);
    const iframeIdJson = JSON.stringify(iframeId);
    const bridgeNameJson = JSON.stringify(EFORMSIGN_SEOGU_REVISION_DISPATCH_BRIDGE);
    return `<!doctype html>
<html><head><meta charset="utf-8"><title>eformsign Seogu revision test</title></head>
<body style="margin:0">
<iframe id=${iframeIdJson} style="width:100vw;height:100vh;border:0"></iframe>
<script>
(function () {
    var option = ${optionJson};
    var iframeId = ${iframeIdJson};
    var bridgeName = ${bridgeNameJson};
    var sdk = null;
    window.__eformsignSdkSeoguRevisionProbe = {
        documentConfigured: false,
        openInvoked: false,
        opened: false,
        bootError: false,
        errorCallbackSeen: false,
        actionCallbacks: [],
        successCodes: [],
        sendActionAttempted: false,
        sendActionCount: 0,
        sendActionType: null,
        sendActionCode: null,
        sendActionErrorCode: null
    };
    function boundedString(value, maxLength) {
        if (typeof value === "string") return value.trim().slice(0, maxLength);
        if (typeof value === "number" && isFinite(value)) return String(value).slice(0, maxLength);
        return "";
    }
    function sanitizeActionCallback(response) {
        if (!response || typeof response !== "object" || response.fn !== "actionCallback") return null;
        var data = Array.isArray(response.data) ? response.data : [];
        var actions = [];
        for (var i = 0; i < data.length && actions.length < ${MAX_ACTIONS_PER_CALLBACK}; i += 1) {
            var item = data[i];
            if (!item || typeof item !== "object") continue;
            var name = boundedString(item.name, ${MAX_ACTION_LABEL_LENGTH});
            var code = boundedString(item.code, ${MAX_ACTION_CODE_LENGTH});
            if (!name && !code) continue;
            actions.push({ name: name, code: code });
        }
        return { type: boundedString(response.type, 32), fn: "actionCallback", data: actions };
    }
    function setBootError(code) {
        window.__eformsignSdkSeoguRevisionProbe.bootError = true;
        window.__eformsignSdkSeoguRevisionProbe.sendActionErrorCode = boundedString(code, 64) || null;
    }
    function loadScript(src, done, errorCode) {
        var script = document.createElement("script");
        script.src = src;
        script.async = false;
        script.onload = done;
        script.onerror = function () { setBootError(errorCode); };
        document.head.appendChild(script);
    }
    function successCallback(response) {
        var code = boundedString(response && response.code, 32);
        if (code && window.__eformsignSdkSeoguRevisionProbe.successCodes.length < ${MAX_ACTIONS_PER_CALLBACK}) {
            window.__eformsignSdkSeoguRevisionProbe.successCodes.push(code);
        }
    }
    function errorCallback(response) {
        window.__eformsignSdkSeoguRevisionProbe.errorCallbackSeen = true;
        window.__eformsignSdkSeoguRevisionProbe.sendActionErrorCode =
            boundedString(response && response.code, 64) || "sdk-error";
    }
    function actionCallback(response) {
        var sanitized = sanitizeActionCallback(response);
        if (sanitized) window.__eformsignSdkSeoguRevisionProbe.actionCallbacks.push(sanitized);
    }
    window[bridgeName] = function () {
        var probe = window.__eformsignSdkSeoguRevisionProbe;
        if (probe.sendActionAttempted) return false;
        var advertised = probe.actionCallbacks.some(function (callback) {
            return callback.data.some(function (action) { return action.code === "22"; });
        });
        if (!advertised) {
            probe.sendActionErrorCode = "action-code-22-not-observed";
            return false;
        }
        probe.sendActionAttempted = true;
        probe.sendActionCount += 1;
        probe.sendActionType = "01";
        probe.sendActionCode = "22";
        if (!sdk || typeof sdk.sendAction !== "function") {
            probe.sendActionErrorCode = "send-action-unsupported";
            return false;
        }
        try {
            sdk.sendAction({ type: "01", code: "22" });
            return true;
        } catch (error) {
            probe.sendActionErrorCode = "send-action-threw";
            return false;
        }
    };
    function open() {
        if (typeof window.EformSignDocument !== "function") return setBootError("sdk-not-initialized");
        try {
            sdk = new window.EformSignDocument();
            sdk.document(option, iframeId, successCallback, errorCallback, actionCallback);
            window.__eformsignSdkSeoguRevisionProbe.documentConfigured = true;
            window.__eformsignSdkSeoguRevisionProbe.openInvoked = true;
            sdk.open();
            window.__eformsignSdkSeoguRevisionProbe.opened = true;
        } catch (error) {
            setBootError("sdk-document-or-open-threw");
        }
    }
    loadScript("https://www.eformsign.com/plugins/jquery/jquery.min.js", function () {
        loadScript("https://www.eformsign.com/lib/js/efs_embedded_v2.js", open, "sdk-script-load");
    }, "jquery-script-load");
})();
</script></body></html>`;
}

export function assertSeoguRevisionSdkHtml(
    html: string,
    iframeId = EFORMSIGN_SEOGU_REVISION_IFRAME_ID,
): void {
    const documentCalls = html.match(/sdk\.document\s*\(/g) ?? [];
    const openCalls = html.match(/sdk\.open\s*\(/g) ?? [];
    const sendCalls = html.match(/sdk\.sendAction\s*\(/g) ?? [];
    if (documentCalls.length !== 1 || openCalls.length !== 1 || sendCalls.length !== 1) {
        throw new SeoguRevisionNotVerifiedError("Seogu SDK page must register one document, one open, one sendAction");
    }
    if (!html.includes(`id=${JSON.stringify(iframeId)}`)) {
        throw new SeoguRevisionNotVerifiedError("Seogu SDK iframe id is not stable");
    }
    if (!html.includes("sdk.document(option, iframeId, successCallback, errorCallback, actionCallback)")) {
        throw new SeoguRevisionNotVerifiedError("Seogu SDK page must use the official callback order");
    }
    if (!html.includes("window[bridgeName]") || !html.includes(JSON.stringify(EFORMSIGN_SEOGU_REVISION_DISPATCH_BRIDGE))) {
        throw new SeoguRevisionNotVerifiedError("Seogu SDK page is missing the explicit dispatch bridge");
    }
    if (!html.includes('sdk.sendAction({ type: "01", code: "22" })')) {
        throw new SeoguRevisionNotVerifiedError("Seogu SDK page must send only participant action code 22");
    }
    for (const forbidden of [
        "runEformsignCreationGates",
        "runEformsignFinalizeGates",
        ".click(",
        "execAction(",
        "sdk.save(",
        "sdk.finalize(",
        "sdk.approve(",
        "sdk.decline(",
        "doc_update",
        "request_type",
        'code: "20"',
        'code: "05"',
    ]) {
        if (html.includes(forbidden)) throw new SeoguRevisionNotVerifiedError(`Seogu SDK page contains forbidden action: ${forbidden}`);
    }
    const actionCallbackStart = html.indexOf("function actionCallback");
    const bridgeStart = html.indexOf("window[bridgeName]");
    if (actionCallbackStart < 0 || bridgeStart < 0 || html.slice(actionCallbackStart, bridgeStart).includes("sendAction")) {
        throw new SeoguRevisionNotVerifiedError("Seogu SDK actionCallback must remain observation-only");
    }
    if (!html.includes('action.code === "22"') || !html.includes("probe.sendActionAttempted")) {
        throw new SeoguRevisionNotVerifiedError("Seogu SDK bridge is not gated on fresh code 22 and once-only state");
    }
}

export function assertSeoguRevisionMode02Option(
    value: unknown,
    documentId = EFORMSIGN_SEOGU_REVISION_DOCUMENT_ID,
    templateId = EFORMSIGN_SEOGU_REVISION_TEMPLATE_ID,
    userEmail = EFORMSIGN_SEOGU_REVISION_USER_EMAIL,
): void {
    const option = asRecord(value);
    const mode = asRecord(option?.["mode"]);
    const user = asRecord(option?.["user"]);
    if (
        mode?.["type"] !== "02"
        || mode["document_id"] !== documentId
        || mode["template_id"] !== templateId
    ) {
        throw new SeoguRevisionNotVerifiedError("Seogu SDK mode02 option does not match the exact document");
    }
    if (user?.["type"] !== "01" || user["id"] !== userEmail) {
        throw new SeoguRevisionNotVerifiedError("Seogu SDK user identity does not match the exact allowlist");
    }
    if (Object.prototype.hasOwnProperty.call(option, "prefill")) {
        throw new SeoguRevisionNotVerifiedError("Seogu SDK base mode02 option must not already contain prefill");
    }
    if (Object.prototype.hasOwnProperty.call(mode, "request_type")) {
        throw new SeoguRevisionNotVerifiedError("Seogu SDK mode02 option must not enter a writer update route");
    }
}

export function buildSeoguRevisionPrefillOption(
    baseOption: Record<string, unknown>,
): Record<string, unknown> {
    assertSeoguRevisionMode02Option(baseOption);
    return {
        ...baseOption,
        prefill: {
            fields: EFORMSIGN_SEOGU_REVISION_PREFILL_FIELDS.map((field) => ({ ...field })),
        },
    };
}

export function assertSeoguRevisionPrefillOption(value: unknown): void {
    const option = asRecord(value);
    const prefill = asRecord(option?.["prefill"]);
    const fields = prefill?.["fields"];
    if (!Array.isArray(fields) || fields.length !== EFORMSIGN_SEOGU_REVISION_PREFILL_FIELDS.length) {
        throw new SeoguRevisionNotVerifiedError("Seogu SDK option must contain exactly four prefill fields");
    }
    fields.forEach((field, index) => {
        const record = asRecord(field);
        const expected = EFORMSIGN_SEOGU_REVISION_PREFILL_FIELDS[index];
        if (
            !record
            || !expected
            || record["id"] !== expected.id
            || record["value"] !== expected.value
            || record["enabled"] !== true
            || record["required"] !== false
            || Object.keys(record).some((key) => !["id", "value", "enabled", "required"].includes(key))
        ) {
            throw new SeoguRevisionNotVerifiedError("Seogu SDK prefill fields are outside the exact four-field allowlist");
        }
    });
}

/** A visible SDK modal is uncertain and is returned for inspection only. */
export async function readSeoguRevisionModalInventory(
    eformsignFrame: FrameLocator,
): Promise<SeoguRevisionModalInventory> {
    return eformsignFrame.locator("body").evaluate((body): SeoguRevisionModalInventory => {
        const isVisible = (element: Element | null): element is HTMLElement => {
            if (!(element instanceof HTMLElement)) return false;
            const style = window.getComputedStyle(element);
            if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
            const rect = element.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        };
        const selectorFor = (element: Element): SeoguRevisionModalSelector => {
            if (element.id === "inputCommentPopup") return "input-comment-popup";
            if (element.id === "requestWithInputCommentPopup") return "request-send-popup";
            return "unknown";
        };
        const candidates = Array.from(body.querySelectorAll<HTMLElement>(
            "#inputCommentPopup, #requestWithInputCommentPopup, [role=dialog]",
        )).filter((element) => isVisible(element));
        const dialog = candidates[0] ?? null;
        if (!dialog) {
            return {
                visible: false,
                selector: "unknown",
                target: "not-observed",
                visibleDialogCount: 0,
                controls: [],
                inspectionError: false,
            };
        }
        const controlForLabel = (value: string): SeoguRevisionControl => {
            const label = value.replace(/\s+/g, "").trim();
            if (label === "전송" || label === "보내기" || label.toLowerCase() === "send") return "send";
            if (label === "취소" || label.toLowerCase() === "cancel") return "cancel";
            if (label === "확인" || label.toLowerCase() === "confirm") return "confirm";
            if (label === "뒤로" || label.toLowerCase() === "back") return "back";
            return "unknown";
        };
        const controls = Array.from(dialog.querySelectorAll<HTMLButtonElement>("button"))
            .filter((button) => isVisible(button))
            .map((button) => controlForLabel(button.innerText ?? ""));
        return {
            visible: true,
            selector: selectorFor(dialog),
            target: "uncertain",
            visibleDialogCount: candidates.length,
            controls: Array.from(new Set(controls)),
            inspectionError: false,
        };
    }, { timeout: 3_000 });
}

export function safeSeoguRevisionErrorReason(error: unknown, operation: string): string {
    if (error instanceof SeoguRevisionNotVerifiedError) return error.message;
    const record = asRecord(error);
    const status = record?.["status"];
    const vendorCode = record?.["vendorCode"];
    if (typeof status === "number" && Number.isFinite(status)) {
        return `${operation} returned vendor status ${status}${typeof vendorCode === "string" ? ` (${vendorCode.slice(0, 64)})` : ""}`;
    }
    if (error instanceof Error) return `${operation} failed (${error.name})`;
    return `${operation} failed (${typeof record?.["name"] === "string" ? record["name"] : typeof error})`;
}

export { hashPdfBody, readEformsignSdkDocumentSnapshot };
