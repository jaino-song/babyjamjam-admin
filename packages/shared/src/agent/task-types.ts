import { z } from "zod";

import {
    AutomationConsentChoiceSchema,
    ClientInputOperationsSchema,
    ClientClearedFieldsSchema,
    ClientTentativeValuesSchema,
    ClientWriteFieldsSchema,
    CLIENT_WRITE_FIELD_NAMES,
    type ClientWriteFields,
} from "./client-input-policy";

export const AGENT_TASK_SCHEMA_VERSION = 1 as const;
export const AgentTaskSchemaVersionSchema = z.literal(AGENT_TASK_SCHEMA_VERSION);

export const AgentTaskCapabilityIdSchema = z.enum(["clients.create", "clients.update"]);
export const AgentTaskKindSchema = AgentTaskCapabilityIdSchema;
export type AgentTaskCapabilityId = z.infer<typeof AgentTaskCapabilityIdSchema>;
export type AgentTaskKind = z.infer<typeof AgentTaskKindSchema>;

export const AgentTaskStateSchema = z.enum([
    "collecting",
    "confirming_target",
    "review_ready",
    "awaiting_approval",
    "paused",
    "executing",
    "reconciling",
    "completed",
    "failed",
    "cancelled",
]);
export type AgentTaskState = z.infer<typeof AgentTaskStateSchema>;

/**
 * Session restore classification is deliberately independent from recovery
 * task discovery.  A session may be available, archived, or expired while
 * still exposing separately scoped unresolved task evidence.
 */
export const AgentTaskRestoreStatusSchema = z.enum([
    "available",
    "session_archived",
    "session_expired",
]);
export type AgentTaskRestoreStatus = z.infer<typeof AgentTaskRestoreStatusSchema>;

/** Task revisions are persistence-safe ordered values, unlike action tokens. */
export const AgentTaskRevisionSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export type AgentTaskRevision = z.infer<typeof AgentTaskRevisionSchema>;
export const AgentActionRevisionTokenSchema = z.string().trim().min(1).max(200);

/** Server-issued/client-generated references are UUIDs, never display text. */
export const AgentTaskReferenceSchema = z.uuid();
export const AgentTaskIdSchema = AgentTaskReferenceSchema;
export const AgentTaskEventIdSchema = AgentTaskReferenceSchema;
export const AgentTaskSnapshotRefSchema = AgentTaskReferenceSchema;
export const AgentTaskEventHashSchema = z.string().regex(/^[a-f0-9]{64}$/i);
export const AgentTaskIsoDateTimeSchema = z.iso.datetime();

/**
 * A server-issued rendering hint used to interpret ordinal/choice replies.
 * The hint is advisory: ownership and freshness are rechecked against the
 * current task before a selection is accepted.
 */
export const AgentTaskDisplayedChoiceHintSchema = z.object({
    taskId: AgentTaskIdSchema,
    choiceSetRef: AgentTaskReferenceSchema,
    revision: AgentTaskRevisionSchema,
}).strict();
export type AgentTaskDisplayedChoiceHint = z.infer<typeof AgentTaskDisplayedChoiceHintSchema>;
/** Short alias retained for callers that name the rendered value directly. */
export const AgentDisplayedChoiceHintSchema = AgentTaskDisplayedChoiceHintSchema;
export type AgentDisplayedChoiceHint = AgentTaskDisplayedChoiceHint;

export const AgentTaskSourceSchema = z.enum(["user", "wizard", "server", "lookup", "model", "system"]);
export const AgentTaskFieldProvenanceSchema = z.object({
    source: AgentTaskSourceSchema,
    capturedAt: AgentTaskIsoDateTimeSchema.optional(),
    eventId: AgentTaskEventIdSchema.optional(),
    valueRef: AgentTaskReferenceSchema.optional(),
}).strict();
export const AgentTaskProvenanceSchema = z.object({
    confirmed: z.record(z.string(), AgentTaskFieldProvenanceSchema),
    tentative: z.record(z.string(), AgentTaskFieldProvenanceSchema),
}).strict();

/**
 * Issue codes are structural and intentionally finite. They are safe to copy
 * into model/chat projections because no user-provided value can become a
 * code accidentally (for example a phone number or birthday).
 */
export const AGENT_TASK_ISSUE_CODES = [
    "task.required",
    "task.invalid",
    "task.duplicate",
    "task.ambiguous",
    "task.stale",
    "task.consent_required",
] as const;
export const AgentTaskIssueCodeSchema = z.enum(AGENT_TASK_ISSUE_CODES);
export const AgentTaskIssueSeveritySchema = z.enum(["info", "warning", "error"]);
export const AgentTaskIssueSchema = z.object({
    code: AgentTaskIssueCodeSchema,
    field: z.enum(CLIENT_WRITE_FIELD_NAMES).optional(),
    severity: AgentTaskIssueSeveritySchema,
    message: z.string().trim().min(1).max(1000),
}).strict();

export const AgentTaskConstraintsSchema = z.object({ noSend: z.boolean() }).strict();

/** Provider target versions are SHA-256 snapshots, distinct from task revisions. */
export const AgentTaskTargetVersionSchema = z.string().regex(/^[a-f0-9]{64}$/i);
export type AgentTaskTargetVersion = z.infer<typeof AgentTaskTargetVersionSchema>;
export const AgentTaskTargetSchema = z.object({
    targetRef: AgentTaskReferenceSchema,
    version: AgentTaskTargetVersionSchema,
    choiceSetRef: AgentTaskReferenceSchema.optional(),
    optionId: AgentTaskReferenceSchema.optional(),
}).strict();
export type AgentTaskTarget = z.infer<typeof AgentTaskTargetSchema>;

/** Authorized REST snapshots may retain presentation labels. Safe parts use refs only. */
export const AgentTaskChoiceOptionSchema = z.object({
    optionId: AgentTaskReferenceSchema,
    label: z.string().trim().min(1).max(300),
    description: z.string().trim().max(1000).optional(),
}).strict();
export const AgentTaskChoiceSetSchema = z.object({
    choiceSetRef: AgentTaskReferenceSchema,
    options: z.array(AgentTaskChoiceOptionSchema).min(1).max(100),
    issuedAt: AgentTaskIsoDateTimeSchema.optional(),
    expiresAt: AgentTaskIsoDateTimeSchema.optional(),
}).strict();
export type AgentTaskChoiceSet = z.infer<typeof AgentTaskChoiceSetSchema>;

export const AgentTaskActionLinkSchema = z.object({
    actionId: AgentTaskReferenceSchema,
    expectedRevision: AgentActionRevisionTokenSchema,
    proposalRevision: AgentTaskRevisionSchema.optional(),
}).strict();
export const AgentTaskTimesSchema = z.object({
    createdAt: AgentTaskIsoDateTimeSchema,
    updatedAt: AgentTaskIsoDateTimeSchema,
    acceptedAt: AgentTaskIsoDateTimeSchema.optional(),
    pausedAt: AgentTaskIsoDateTimeSchema.optional(),
    terminatedAt: AgentTaskIsoDateTimeSchema.optional(),
    expiresAt: AgentTaskIsoDateTimeSchema.optional(),
}).strict();

export const AgentAutomationConsentBindingSchema = z.object({
    recipientRef: AgentTaskReferenceSchema,
    effectDigest: AgentTaskEventHashSchema,
    templateRef: AgentTaskReferenceSchema,
    policyDigest: AgentTaskEventHashSchema,
    consentEventId: AgentTaskEventIdSchema,
}).strict();
export type AgentAutomationConsentBinding = z.infer<typeof AgentAutomationConsentBindingSchema>;

export const AgentAutomationConsentSchema = z.object({
    choice: AutomationConsentChoiceSchema,
    binding: AgentAutomationConsentBindingSchema.nullable(),
}).strict().superRefine((value, context) => {
    if (value.choice === "yes" && value.binding === null) {
        context.addIssue({ code: "custom", path: ["binding"], message: "A yes consent requires a server-issued binding" });
    }
    if (value.choice !== "yes" && value.binding !== null) {
        context.addIssue({ code: "custom", path: ["binding"], message: "Only yes consent may carry a binding" });
    }
});
export const AgentAutomationConsentInputSchema = z.object({ choice: AutomationConsentChoiceSchema }).strict();
export type AgentAutomationConsent = z.infer<typeof AgentAutomationConsentSchema>;

/** Delivery descriptions contain references, never phone/name/body preimages. */
export const AgentAutomationEffectKindSchema = z.enum(["client-rule", "employee-assignment", "service-record-link"]);
export const AgentAutomationQuestionAvailabilitySchema = z.enum(["available", "none", "unavailable"]);
export const AgentAutomationUnavailableReasonSchema = z.enum([
    "missing-input", "missing-default-rules", "sender-unavailable", "unsupported-content", "source-unavailable",
]);
export const AgentAutomationEffectSummarySchema = z.object({
    effectRef: AgentTaskReferenceSchema,
    recipientRef: AgentTaskReferenceSchema,
    kind: AgentAutomationEffectKindSchema,
    recipientType: z.enum(["client", "primary-employee", "secondary-employee"]),
    change: z.enum(["create", "refresh", "cancel"]),
    templateKey: z.enum([
        "SERVICE_INFO", "CLIENT_GREETING", "PRICE_INFO", "REMINDER", "THANKS", "SURVEY", "INFO",
        "SERVICE_END_NOTICE", "EMPLOYEE_ASSIGNED", "SERVICE_RECORD_LINK",
    ]),
}).strict();
export const AgentAutomationQuestionSchema = z.object({
    questionRef: AgentTaskReferenceSchema,
    availability: AgentAutomationQuestionAvailabilitySchema,
    reason: AgentAutomationUnavailableReasonSchema.optional(),
    /** These refs designate the complete canonical sets, not representative members. */
    recipientSetRef: AgentTaskReferenceSchema,
    templateSetRef: AgentTaskReferenceSchema,
    effectDigest: AgentTaskEventHashSchema,
    policyDigest: AgentTaskEventHashSchema,
    effects: z.array(AgentAutomationEffectSummarySchema).max(500),
}).strict().superRefine((value, context) => {
    if ((value.availability === "none" && value.effects.length !== 0)
        || (value.availability === "available" && value.effects.length === 0)) {
        context.addIssue({ code: "custom", path: ["effects"], message: "Effect availability does not match the described effects" });
    }
    if ((value.availability === "unavailable") !== (value.reason !== undefined)) {
        context.addIssue({ code: "custom", path: ["reason"], message: "Only unavailable effects require a finite reason" });
    }
    if (new Set(value.effects.map(({ effectRef }) => effectRef)).size !== value.effects.length) {
        context.addIssue({ code: "custom", path: ["effects"], message: "Effect references must be unique" });
    }
});
export type AgentAutomationQuestion = z.infer<typeof AgentAutomationQuestionSchema>;
export type AgentAutomationEffectSummary = z.infer<typeof AgentAutomationEffectSummarySchema>;

export const AgentTaskSchema = z.object({
    schemaVersion: AgentTaskSchemaVersionSchema,
    taskId: AgentTaskIdSchema,
    sessionId: AgentTaskIdSchema,
    kind: AgentTaskKindSchema,
    capabilityId: AgentTaskCapabilityIdSchema,
    revision: AgentTaskRevisionSchema,
    state: AgentTaskStateSchema,
    confirmed: ClientWriteFieldsSchema,
    tentative: ClientTentativeValuesSchema,
    clearedFields: ClientClearedFieldsSchema.default([]),
    provenance: AgentTaskProvenanceSchema,
    issues: z.array(AgentTaskIssueSchema),
    constraints: AgentTaskConstraintsSchema,
    choiceSets: z.array(AgentTaskChoiceSetSchema),
    orderedChoiceRefs: z.array(AgentTaskReferenceSchema),
    target: AgentTaskTargetSchema.nullable(),
    consent: AgentAutomationConsentSchema,
    /** Absent on legacy tasks until the server has evaluated automation. */
    automation: AgentAutomationQuestionSchema.optional(),
    action: AgentTaskActionLinkSchema.nullable(),
    times: AgentTaskTimesSchema,
    currentSnapshotRef: AgentTaskSnapshotRefSchema,
}).strict().superRefine((value, context) => {
    if (value.kind !== value.capabilityId) {
        context.addIssue({ code: "custom", path: ["kind"], message: "Task kind must match capabilityId" });
    }
    for (const field of value.clearedFields) {
        if (Object.prototype.hasOwnProperty.call(value.confirmed, field)) {
            context.addIssue({
                code: "custom",
                path: ["clearedFields"],
                message: "A cleared field cannot also have a confirmed value",
            });
        }
    }
});
export type AgentTask = z.infer<typeof AgentTaskSchema>;

export const AgentTaskCreateRequestSchema = z.object({
    schemaVersion: AgentTaskSchemaVersionSchema.optional(),
    sessionId: AgentTaskIdSchema,
    capabilityId: AgentTaskCapabilityIdSchema,
    clientEventId: AgentTaskEventIdSchema,
    operations: ClientInputOperationsSchema.default([]),
}).strict();
export type AgentTaskCreateRequest = z.infer<typeof AgentTaskCreateRequestSchema>;

export const AgentTaskPatchRequestSchema = z.object({
    clientEventId: AgentTaskEventIdSchema,
    expectedRevision: AgentTaskRevisionSchema,
    operations: ClientInputOperationsSchema.min(1),
}).strict();
export type AgentTaskPatchRequest = z.infer<typeof AgentTaskPatchRequestSchema>;

const AgentTaskCommandBaseShape = {
    clientEventId: AgentTaskEventIdSchema,
    expectedRevision: AgentTaskRevisionSchema,
};
const SelectTargetByChoiceSetIdSchema = z.object({
    ...AgentTaskCommandBaseShape,
    command: z.literal("select-target"),
    choiceSetId: AgentTaskReferenceSchema,
    optionId: AgentTaskReferenceSchema,
}).strict();
const SelectTargetByChoiceSetRefSchema = z.object({
    ...AgentTaskCommandBaseShape,
    command: z.literal("select-target"),
    choiceSetRef: AgentTaskReferenceSchema,
    optionId: AgentTaskReferenceSchema,
}).strict();
export const AgentTaskSelectTargetCommandSchema = z.union([SelectTargetByChoiceSetIdSchema, SelectTargetByChoiceSetRefSchema]);
const StartUpdateCommandSchema = z.object({
    ...AgentTaskCommandBaseShape,
    command: z.literal("start-update"),
    /** Existing server-issued reference selected by the caller's UI. */
    targetRef: AgentTaskReferenceSchema,
    /** CAS version for the selected target, never an ownership assertion. */
    expectedTargetVersion: AgentTaskEventHashSchema,
}).strict();
export const AgentTaskStartUpdateCommandSchema = StartUpdateCommandSchema;
export const AgentTaskCommandRequestSchema = z.union([
    AgentTaskSelectTargetCommandSchema,
    AgentTaskStartUpdateCommandSchema,
    z.object({ ...AgentTaskCommandBaseShape, command: z.literal("pause") }).strict(),
    z.object({ ...AgentTaskCommandBaseShape, command: z.literal("resume") }).strict(),
    z.object({ ...AgentTaskCommandBaseShape, command: z.literal("prepare-review") }).strict(),
    z.object({ ...AgentTaskCommandBaseShape, command: z.literal("cancel") }).strict(),
]);
export type AgentTaskCommandRequest = z.infer<typeof AgentTaskCommandRequestSchema>;
export const AgentTaskCommandNameSchema = z.enum(["select-target", "start-update", "pause", "resume", "prepare-review", "cancel"]);
export type AgentTaskCommandName = z.infer<typeof AgentTaskCommandNameSchema>;

export const AgentTaskEventReceiptSchema = z.object({
    taskId: AgentTaskIdSchema,
    eventId: AgentTaskEventIdSchema,
    eventHash: AgentTaskEventHashSchema,
    acceptedRevision: AgentTaskRevisionSchema,
    currentSnapshotRef: AgentTaskSnapshotRefSchema,
}).strict();
export type AgentTaskEventReceipt = z.infer<typeof AgentTaskEventReceiptSchema>;
export const AgentTaskMutationResponseSchema = z.object({ receipt: AgentTaskEventReceiptSchema, snapshot: AgentTaskSchema }).strict();
export type AgentTaskMutationResponse = z.infer<typeof AgentTaskMutationResponseSchema>;

/**
 * Additive metadata returned alongside an owned session restore.  Older
 * payloads that predate recovery discovery parse as an empty recovery list.
 */
export const AgentTaskRestoreMetadataSchema = z.object({
    activeTaskId: AgentTaskIdSchema.nullable(),
    pausedTaskIds: z.array(AgentTaskIdSchema),
    taskRestoreStatus: AgentTaskRestoreStatusSchema,
    recoveryTaskIds: z.array(AgentTaskIdSchema).default([]),
}).strict();
export type AgentTaskRestoreMetadata = z.infer<typeof AgentTaskRestoreMetadataSchema>;

export function createAgentTaskDefaults(): Pick<ClientWriteFields, "voucherClient" | "serviceStatus"> {
    return { voucherClient: false, serviceStatus: "pre_booking" };
}
