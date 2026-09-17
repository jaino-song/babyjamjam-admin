import type { EformsignTemplateStepOption } from "domain/repositories/eformsign.client.interface";

export const EFORMSIGN_TEMPLATE_WORKFLOW_FAILURE_REASONS = {
    INVALID: "template_workflow_config_invalid",
    UNSUPPORTED: "template_workflow_unsupported",
    UNAVAILABLE: "template_workflow_config_unavailable",
} as const;

export type EformsignTemplateWorkflowFailureReason =
    (typeof EFORMSIGN_TEMPLATE_WORKFLOW_FAILURE_REASONS)[keyof typeof EFORMSIGN_TEMPLATE_WORKFLOW_FAILURE_REASONS];

export type EformsignTemplateWorkflowStepType = "write" | "participant" | "reviewer" | "complete";
export type EformsignTemplateWorkflowRecipientType = "participant" | "reviewer";
export type EformsignTemplateWorkflowRecipientIdentity = "customer" | "institution";

export interface EformsignTemplateWorkflowStep {
    seq: string;
    type: EformsignTemplateWorkflowStepType;
    stepGroup: number;
}

export interface EformsignTemplateWorkflowRecipient {
    seq: string;
    type: EformsignTemplateWorkflowRecipientType;
    identity: EformsignTemplateWorkflowRecipientIdentity;
}

export interface EformsignTemplateWorkflow {
    templateId: string;
    steps: EformsignTemplateWorkflowStep[];
    recipients: EformsignTemplateWorkflowRecipient[];
}

export class EformsignTemplateWorkflowError extends Error {
    constructor(
        public readonly reason: Exclude<EformsignTemplateWorkflowFailureReason, "template_workflow_config_unavailable">,
    ) {
        super(reason);
        this.name = "EformsignTemplateWorkflowError";
    }
}

export class EformsignTemplateWorkflowUnavailableError extends Error {
    readonly reason = EFORMSIGN_TEMPLATE_WORKFLOW_FAILURE_REASONS.UNAVAILABLE;

    constructor() {
        super(EFORMSIGN_TEMPLATE_WORKFLOW_FAILURE_REASONS.UNAVAILABLE);
        this.name = "EformsignTemplateWorkflowUnavailableError";
    }
}

type ParsedStep = EformsignTemplateWorkflowStep & {
    option: EformsignTemplateStepOption;
};

function invalid(): never {
    throw new EformsignTemplateWorkflowError(EFORMSIGN_TEMPLATE_WORKFLOW_FAILURE_REASONS.INVALID);
}

function unsupported(): never {
    throw new EformsignTemplateWorkflowError(EFORMSIGN_TEMPLATE_WORKFLOW_FAILURE_REASONS.UNSUPPORTED);
}

function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
}

function parseSequence(value: unknown): { numeric: number; text: string } | null {
    if (typeof value === "number") {
        if (!Number.isSafeInteger(value) || value <= 0) return null;
        return { numeric: value, text: String(value) };
    }
    if (typeof value !== "string") return null;
    const text = value.trim();
    if (!/^\d+$/.test(text)) return null;
    const numeric = Number(text);
    if (!Number.isSafeInteger(numeric) || numeric <= 0) return null;
    return { numeric, text: String(numeric) };
}

function parseStepGroup(value: unknown): number | null {
    if (typeof value === "number") {
        return Number.isSafeInteger(value) && value >= 0 ? value : null;
    }
    if (typeof value !== "string" || !/^\d+$/.test(value.trim())) return null;
    const group = Number(value.trim());
    return Number.isSafeInteger(group) && group >= 0 ? group : null;
}

function parseStep(value: unknown): ParsedStep {
    const record = asRecord(value);
    if (!record) return invalid();

    const sequence = parseSequence(record["seq"]);
    const typeValue = record["type"];
    const stepGroup = parseStepGroup(record["step_group"]);
    if (!sequence || typeof typeValue !== "string" || !typeValue.trim() || stepGroup === null) {
        return invalid();
    }

    const normalizedType = typeValue.trim().toLowerCase();
    if (!["write", "participant", "reviewer", "complete"].includes(normalizedType)) {
        return unsupported();
    }

    const optionValue = record["option"];
    const option = optionValue === undefined ? {} : asRecord(optionValue);
    if (!option) return invalid();
    // eformsign has emitted these selector fields on either the step itself or
    // inside option across template revisions. Keep both forms typed while
    // giving the nested option the same precedence as the provider payload.
    const selectorOption = {
        use_receipient_specified: record["use_receipient_specified"],
        specified_recipient_type: record["specified_recipient_type"],
        specified_recipient_seq: record["specified_recipient_seq"],
        ...option,
    } as EformsignTemplateStepOption;

    return {
        seq: sequence.text,
        type: normalizedType as EformsignTemplateWorkflowStepType,
        stepGroup,
        option: selectorOption,
    };
}

function hasValidReviewerInheritance(
    reviewer: ParsedStep,
    institutionParticipant: ParsedStep,
): boolean {
    const option = reviewer.option;
    return option.use_receipient_specified === true
        && typeof option.specified_recipient_type === "string"
        && option.specified_recipient_type.trim().toLowerCase() === "beforewriter"
        && parseSequence(option.specified_recipient_seq)?.numeric
            === parseSequence(institutionParticipant.seq)?.numeric;
}

function isAllowedTopology(types: EformsignTemplateWorkflowStepType[]): boolean {
    return [
        ["write", "participant", "participant", "complete"],
        ["write", "participant", "reviewer", "complete"],
        ["write", "participant", "participant", "reviewer", "complete"],
    ].some((allowed) => allowed.length === types.length && allowed.every((type, index) => type === types[index]));
}

/**
 * Validates the provider template workflow and returns only the recipient metadata
 * needed by the contract renderer. Fixed groups and provider recipient records are
 * deliberately excluded from the returned plan.
 */
export function parseEformsignTemplateWorkflow(
    value: unknown,
    templateId: string,
): EformsignTemplateWorkflow {
    const normalizedTemplateId = templateId.trim();
    if (!normalizedTemplateId) return invalid();

    const root = asRecord(value);
    const formId = root?.["form_id"];
    if (!root || typeof formId !== "string" || formId.trim() !== normalizedTemplateId) {
        return invalid();
    }
    const config = asRecord(root["config"]);
    const rawSteps = config?.["step_settings"];
    if (!Array.isArray(rawSteps) || rawSteps.length === 0) return invalid();

    const parsedSteps = rawSteps.map(parseStep);
    const sequenceSet = new Set<string>();
    const groupSet = new Set<number>();
    for (const step of parsedSteps) {
        if (sequenceSet.has(step.seq)) return invalid();
        sequenceSet.add(step.seq);
        if (groupSet.has(step.stepGroup)) return invalid();
        groupSet.add(step.stepGroup);
    }

    parsedSteps.sort((left, right) => Number(left.seq) - Number(right.seq));
    const types = parsedSteps.map((step) => step.type);
    if (parsedSteps[0]?.type !== "write" || parsedSteps.at(-1)?.type !== "complete") {
        return invalid();
    }
    if (!isAllowedTopology(types)) return unsupported();

    const firstParticipant = parsedSteps[1];
    if (!firstParticipant || firstParticipant.type !== "participant") return invalid();

    const recipients: EformsignTemplateWorkflowRecipient[] = [
        { seq: firstParticipant.seq, type: "participant", identity: "customer" },
    ];

    const institutionParticipant = parsedSteps[2];
    if (!institutionParticipant) return invalid();
    if (institutionParticipant.type === "participant") {
        recipients.push({ seq: institutionParticipant.seq, type: "participant", identity: "institution" });
        const finalReviewer = parsedSteps[3];
        if (finalReviewer?.type === "reviewer") {
            if (!hasValidReviewerInheritance(finalReviewer, institutionParticipant)) return invalid();
            recipients.push({ seq: finalReviewer.seq, type: "reviewer", identity: "institution" });
        }
    } else if (institutionParticipant.type === "reviewer") {
        recipients.push({ seq: institutionParticipant.seq, type: "reviewer", identity: "institution" });
    } else {
        return invalid();
    }

    return {
        templateId: normalizedTemplateId,
        steps: parsedSteps.map(({ seq, type, stepGroup }) => ({ seq, type, stepGroup })),
        recipients,
    };
}
