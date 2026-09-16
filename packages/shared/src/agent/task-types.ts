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
export const AgentTaskCommandRequestSchema = z.union([
    AgentTaskSelectTargetCommandSchema,
    z.object({ ...AgentTaskCommandBaseShape, command: z.literal("pause") }).strict(),
    z.object({ ...AgentTaskCommandBaseShape, command: z.literal("resume") }).strict(),
    z.object({ ...AgentTaskCommandBaseShape, command: z.literal("prepare-review") }).strict(),
    z.object({ ...AgentTaskCommandBaseShape, command: z.literal("cancel") }).strict(),
]);
export type AgentTaskCommandRequest = z.infer<typeof AgentTaskCommandRequestSchema>;
export const AgentTaskCommandNameSchema = z.enum(["select-target", "pause", "resume", "prepare-review", "cancel"]);
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

export function createAgentTaskDefaults(): Pick<ClientWriteFields, "voucherClient" | "serviceStatus"> {
    return { voucherClient: false, serviceStatus: "pre_booking" };
}
