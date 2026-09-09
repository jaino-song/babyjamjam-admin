import type { EformsignApiDocumentResponse } from "domain/repositories/eformsign.client.interface";
import {
    EFORMSIGN_SDK_CAPABILITY_DOCUMENT_ID,
    EFORMSIGN_SDK_CAPABILITY_PDF_SHA256,
    EFORMSIGN_SDK_CAPABILITY_RECIPIENT_ID,
    EFORMSIGN_SDK_CAPABILITY_RECIPIENT_TYPE,
    EFORMSIGN_SDK_CAPABILITY_TEMPLATE_ID,
    assertEformsignSdkDocumentIdentity,
    assertPdfDownload,
    hashPdfBody,
    readEformsignSdkDocumentSnapshot,
    type EformsignSdkDocumentSnapshot,
} from "./eformsign-sdk-capability.live.helper";

export const EFORMSIGN_WORKFLOW_UPDATE_DOCUMENT_ID = EFORMSIGN_SDK_CAPABILITY_DOCUMENT_ID;
export const EFORMSIGN_WORKFLOW_UPDATE_TEMPLATE_ID = EFORMSIGN_SDK_CAPABILITY_TEMPLATE_ID;
export const EFORMSIGN_WORKFLOW_UPDATE_PDF_SHA256 = EFORMSIGN_SDK_CAPABILITY_PDF_SHA256;
export const EFORMSIGN_WORKFLOW_UPDATE_RECIPIENT_ID = EFORMSIGN_SDK_CAPABILITY_RECIPIENT_ID;
export const EFORMSIGN_WORKFLOW_UPDATE_COMMENT = "제공기관 날짜 자동 수정 검증";
export const EFORMSIGN_WORKFLOW_UPDATE_AFTER_STATUS_TYPE = "071";
export const EFORMSIGN_WORKFLOW_UPDATE_AFTER_STEP_TYPE = "05";
export const EFORMSIGN_WORKFLOW_UPDATE_AFTER_STEP_INDEX = "3";
const TEMPLATE_CONFIG_TIMEOUT_MS = 15_000;
const DECLINE_TIMEOUT_MS = 30_000;

export interface WorkflowUpdateConfigReader {
    get(propertyPath: string): unknown;
}

export interface WorkflowUpdateTemplateStepSummary {
    sequence: number;
    type: string;
    stepGroup: number;
    recipientCount: number;
    reviewerPreviousSequence: number | null;
    useRecipientSpecified: boolean;
    rejectRestricted: boolean | null;
}

export interface WorkflowUpdateTemplateTopology {
    stepCount: number;
    sequential: boolean;
    parallel: boolean;
    rejectRestrictionsFalse: boolean;
    reviewerPreviousSequence: number;
    participantSequence: number;
    userParticipantUnselected: boolean;
    steps: WorkflowUpdateTemplateStepSummary[];
}

export interface WorkflowUpdateDeclineHttpEvidence {
    attempted: boolean;
    responseReceived: boolean;
    status: number | null;
    httpSuccess: boolean;
    responseBodyJson: boolean;
    responseIdPresent: boolean;
    responseIdMatches: boolean | null;
    transportError: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === "object" && value !== null && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null;
}

function requiredRecord(value: unknown, message: string): Record<string, unknown> {
    const record = asRecord(value);
    if (!record) throw new Error(message);
    return record;
}

function requiredString(value: unknown, message: string): string {
    if (typeof value === "string" && value.trim()) return value.trim();
    throw new Error(message);
}

function requiredNumber(value: unknown, message: string): number {
    const number = typeof value === "number"
        ? value
        : typeof value === "string" && /^-?\d+$/.test(value.trim())
            ? Number(value)
            : Number.NaN;
    if (Number.isSafeInteger(number)) return number;
    throw new Error(message);
}

function requiredBoolean(value: unknown, message: string): boolean {
    if (typeof value === "boolean") return value;
    throw new Error(message);
}

function requiredArray(record: Record<string, unknown>, key: string): unknown[] {
    if (Array.isArray(record[key])) return record[key];
    throw new Error(`workflow update template ${key} metadata missing`);
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

function readStepSequence(step: Record<string, unknown>): number {
    return requiredNumber(
        firstDefined(step, ["seq", "step_seq", "step_index"]),
        "workflow update template step sequence metadata missing",
    );
}

function readRecipientId(value: unknown): string {
    const recipient = requiredRecord(value, "workflow update template recipient metadata missing");
    const group = asRecord(recipient["group"]);
    const member = asRecord(recipient["member"]);
    return requiredString(
        firstDefined(group ?? {}, ["id"]) ?? firstDefined(member ?? {}, ["id"]) ?? recipient["id"],
        "workflow update template recipient id metadata missing",
    );
}

function readRecipientType(value: unknown): string {
    const recipient = requiredRecord(value, "workflow update template recipient metadata missing");
    return requiredString(
        firstDefined(recipient, ["receipient_type", "recipient_type", "type"]),
        "workflow update template recipient type metadata missing",
    ).toLowerCase();
}

function parseStep(stepValue: unknown): WorkflowUpdateTemplateStepSummary & {
    raw: Record<string, unknown>;
    option: Record<string, unknown>;
    recipients: unknown[];
} {
    const raw = requiredRecord(stepValue, "workflow update template step metadata missing");
    const option = asRecord(raw["option"]) ?? {};
    const sequence = readStepSequence(raw);
    const recipients = [2, 3, 4].includes(sequence)
        ? requiredArray(option, "receipients")
        : Array.isArray(option["receipients"]) ? option["receipients"] : [];
    const type = requiredString(raw["type"], "workflow update template step type metadata missing").toLowerCase();
    const stepGroup = requiredNumber(raw["step_group"], "workflow update template step group metadata missing");

    const rejectRestricted = [2, 3, 4].includes(sequence)
        ? requiredBoolean(option["use_reject_restrict"], "workflow update template reject metadata missing")
        : null;
    if (rejectRestricted === true) throw new Error("workflow update template has a reject restriction");

    const specifiedType = readOptionValue(raw, option, ["specified_recipient_type"]);
    const specifiedSequenceValue = readOptionValue(raw, option, ["specified_recipient_seq"]);
    const useSpecifiedValue = readOptionValue(raw, option, ["use_receipient_specified"]);
    const reviewerPreviousSequence = specifiedSequenceValue === undefined
        ? null
        : requiredNumber(specifiedSequenceValue, "workflow update template recipient sequence metadata invalid");
    const useRecipientSpecified = useSpecifiedValue === undefined
        ? false
        : requiredBoolean(useSpecifiedValue, "workflow update template recipient selection metadata invalid");

    if (sequence === 3) {
        if (type !== "participant" || recipients.length !== 1) {
            throw new Error("workflow update template participant recipient topology is invalid");
        }
        if (readRecipientType(recipients[0]) !== "internal" || readRecipientId(recipients[0]) !== EFORMSIGN_WORKFLOW_UPDATE_RECIPIENT_ID) {
            throw new Error("workflow update template internal participant is outside the exact allowlist");
        }
        if (specifiedType !== "groupormember" || !useRecipientSpecified) {
            throw new Error("workflow update template participant selection is not explicit");
        }
    }

    if (sequence === 4) {
        if (type !== "reviewer" || recipients.length !== 0) {
            throw new Error("workflow update template reviewer recipient topology is invalid");
        }
        if (specifiedType !== "beforewriter" || reviewerPreviousSequence !== 3 || !useRecipientSpecified) {
            throw new Error("workflow update template reviewer does not explicitly inherit participant step 3");
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

export function assertWorkflowUpdateTemplateTopology(
    value: unknown,
): WorkflowUpdateTemplateTopology {
    const root = requiredRecord(value, "workflow update template response metadata missing");
    if (requiredString(root["form_id"], "workflow update template form id metadata missing") !== EFORMSIGN_WORKFLOW_UPDATE_TEMPLATE_ID) {
        throw new Error("workflow update template form id is outside the exact allowlist");
    }
    const config = requiredRecord(root["config"], "workflow update template config metadata missing");
    const settings = requiredArray(config, "step_settings");
    const steps = settings.map(parseStep).sort((left, right) => left.sequence - right.sequence);
    const expectedTypes = ["write", "participant", "participant", "reviewer", "complete"];
    if (steps.length !== expectedTypes.length || steps.some((step, index) => step.sequence !== index + 1 || step.type !== expectedTypes[index])) {
        throw new Error("workflow update template step sequence is outside the expected workflow");
    }
    const groups = steps.map((step) => step.stepGroup);
    if (new Set(groups).size !== groups.length) {
        throw new Error("workflow update template has parallel step groups");
    }

    const userStep = steps[1];
    const participantStep = steps[2];
    const reviewerStep = steps[3];
    if (!userStep || !participantStep || !reviewerStep) {
        throw new Error("workflow update template participant steps are missing");
    }
    const userUnselected = userStep.recipientCount === 0;
    if (!userUnselected) throw new Error("workflow update template user participant is selected");
    if (reviewerStep.reviewerPreviousSequence !== 3) {
        throw new Error("workflow update template reviewer predecessor is not participant step 3");
    }

    return {
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

export async function fetchWorkflowUpdateTemplateConfig(
    configService: WorkflowUpdateConfigReader,
    accessToken: string,
    templateId = EFORMSIGN_WORKFLOW_UPDATE_TEMPLATE_ID,
): Promise<unknown> {
    const configuredBase = configService.get("EFORMSIGN_DOC_API_URL");
    const baseUrl = typeof configuredBase === "string" ? configuredBase.trim().replace(/\/+$/, "") : "";
    if (!baseUrl) throw new Error("workflow update template API base is missing");
    const response = await fetch(
        `${baseUrl}/v2.0/api/forms/${encodeURIComponent(templateId)}?is_include_config=true`,
        {
            method: "GET",
            headers: { Authorization: `Bearer ${accessToken}` },
            signal: AbortSignal.timeout(TEMPLATE_CONFIG_TIMEOUT_MS),
        },
    );
    if (!response.ok) throw new Error(`workflow update template request returned ${response.status}`);
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

export async function postSingleWorkflowUpdateDecline(
    configService: WorkflowUpdateConfigReader,
    accessToken: string,
    documentId = EFORMSIGN_WORKFLOW_UPDATE_DOCUMENT_ID,
): Promise<WorkflowUpdateDeclineHttpEvidence> {
    if (documentId !== EFORMSIGN_WORKFLOW_UPDATE_DOCUMENT_ID) {
        throw new Error("workflow update decline document id is outside the exact allowlist");
    }
    const configuredBase = configService.get("EFORMSIGN_DOC_API_URL");
    const baseUrl = typeof configuredBase === "string" ? configuredBase.trim().replace(/\/+$/, "") : "";
    if (!baseUrl) throw new Error("workflow update decline API base is missing");
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
                body: JSON.stringify({ comment: EFORMSIGN_WORKFLOW_UPDATE_COMMENT }),
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

export function assertWorkflowUpdateDeclinedDocument(
    document: EformsignApiDocumentResponse,
): EformsignSdkDocumentSnapshot {
    if (
        document.id !== EFORMSIGN_WORKFLOW_UPDATE_DOCUMENT_ID
        || document.template?.id !== EFORMSIGN_WORKFLOW_UPDATE_TEMPLATE_ID
    ) {
        throw new Error("workflow update postflight document identity changed");
    }
    const status = document.current_status;
    if (
        status.status_type !== EFORMSIGN_WORKFLOW_UPDATE_AFTER_STATUS_TYPE
        || status.step_type !== EFORMSIGN_WORKFLOW_UPDATE_AFTER_STEP_TYPE
        || status.step_index !== EFORMSIGN_WORKFLOW_UPDATE_AFTER_STEP_INDEX
        || status.expired_date !== 0
        || status._expired !== false
    ) {
        throw new Error("workflow update postflight did not return the previous participant stage");
    }
    const recipients = status.step_recipients ?? [];
    if (
        recipients.length !== 1
        || recipients[0]?.id !== EFORMSIGN_WORKFLOW_UPDATE_RECIPIENT_ID
        || recipients[0]?.recipient_type !== EFORMSIGN_SDK_CAPABILITY_RECIPIENT_TYPE
    ) {
        throw new Error("workflow update postflight recipient changed");
    }
    return readEformsignSdkDocumentSnapshot(document);
}

export function assertWorkflowUpdateFieldsUnchanged(
    before: EformsignSdkDocumentSnapshot,
    after: EformsignSdkDocumentSnapshot,
): void {
    if (before.fieldHash !== after.fieldHash || before.fieldCount !== after.fieldCount) {
        throw new Error("workflow update decline changed document fields");
    }
}

export { assertEformsignSdkDocumentIdentity, assertPdfDownload, hashPdfBody };
