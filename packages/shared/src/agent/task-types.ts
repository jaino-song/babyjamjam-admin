import { z } from "zod";

import {
    AUTOMATION_CONSENT_CHOICES,
    AutomationConsentChoiceSchema,
    ClientInputOperationSchema,
    ClientInputOperationsSchema,
    ClientWriteFieldsSchema,
    CLIENT_CREATE_DEFAULTS,
    type AutomationConsentChoice,
    type ClientInputOperation,
    type ClientWriteFields,
} from "./client-input-policy";

export const AGENT_TASK_SCHEMA_VERSION = 1 as const;
export const AgentTaskSchemaVersionSchema = z.literal(AGENT_TASK_SCHEMA_VERSION);

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

export const AgentTaskIdSchema = z.string().trim().min(1).max(200);
export const AgentTaskRevisionSchema = z.union([
    z.number().int().nonnegative(),
    z.string().trim().min(1).max(200),
]);
export const AgentTaskEventIdSchema = z.string().trim().min(1).max(200);
export const AgentTaskEventHashSchema = z.string().trim().min(1).max(512);
export const AgentTaskSnapshotRefSchema = z.string().trim().min(1).max(512);
export const AgentTaskOpaqueRefSchema = z.string().trim().min(1).max(512);
export const AgentTaskIsoDateTimeSchema = z.iso.datetime();

export type AgentTaskRevision = z.infer<typeof AgentTaskRevisionSchema>;

export const AgentTaskSourceSchema = z.enum([
    "user",
    "wizard",
    "server",
    "lookup",
    "model",
    "system",
]);

export const AgentTaskFieldProvenanceSchema = z.object({
    source: AgentTaskSourceSchema,
    capturedAt: AgentTaskIsoDateTimeSchema.optional(),
    eventId: AgentTaskEventIdSchema.optional(),
    valueRef: AgentTaskOpaqueRefSchema.optional(),
}).strict();

export const AgentTaskProvenanceSchema = z.object({
    confirmed: z.record(z.string(), AgentTaskFieldProvenanceSchema),
    tentative: z.record(z.string(), AgentTaskFieldProvenanceSchema),
}).strict();

export const AgentTaskIssueSeveritySchema = z.enum(["info", "warning", "error"]);
export const AgentTaskIssueSchema = z.object({
    code: z.string().trim().min(1).max(120),
    field: z.string().trim().min(1).max(120).optional(),
    severity: AgentTaskIssueSeveritySchema,
    message: z.string().trim().min(1).max(1000),
}).strict();

export const AgentTaskConstraintsSchema = z.object({
    noSend: z.boolean(),
    automationChoice: AutomationConsentChoiceSchema,
}).strict();

export const AgentTaskTargetSchema = z.object({
    targetRef: AgentTaskOpaqueRefSchema,
    version: AgentTaskRevisionSchema.optional(),
    targetVersion: AgentTaskRevisionSchema.optional(),
    choiceSetRef: AgentTaskOpaqueRefSchema.optional(),
    optionId: AgentTaskOpaqueRefSchema.optional(),
}).strict().superRefine((value, context) => {
    if (value.version === undefined && value.targetVersion === undefined) {
        context.addIssue({ code: "custom", path: ["version"], message: "A server-issued target version is required" });
    }
});

export type AgentTaskTarget = z.infer<typeof AgentTaskTargetSchema>;

export const AgentTaskChoiceOptionSchema = z.object({
    optionId: AgentTaskOpaqueRefSchema,
    label: z.string().trim().min(1).max(300),
    description: z.string().trim().max(1000).optional(),
}).strict();

export const AgentTaskChoiceSetSchema = z.object({
    choiceSetRef: AgentTaskOpaqueRefSchema,
    options: z.array(AgentTaskChoiceOptionSchema).min(1).max(100),
    issuedAt: AgentTaskIsoDateTimeSchema.optional(),
    expiresAt: AgentTaskIsoDateTimeSchema.optional(),
}).strict();

export type AgentTaskChoiceSet = z.infer<typeof AgentTaskChoiceSetSchema>;

export const AgentTaskActionLinkSchema = z.object({
    actionId: AgentTaskOpaqueRefSchema,
    expectedRevision: AgentTaskRevisionSchema,
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
    recipientRef: AgentTaskOpaqueRefSchema,
    effectDigest: AgentTaskEventHashSchema,
    templateRef: AgentTaskOpaqueRefSchema,
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

export const AgentAutomationConsentInputSchema = z.object({
    choice: AutomationConsentChoiceSchema,
}).strict();

export type AgentAutomationConsent = z.infer<typeof AgentAutomationConsentSchema>;

export const AgentTaskSchema = z.object({
    schemaVersion: AgentTaskSchemaVersionSchema,
    taskId: AgentTaskIdSchema,
    sessionId: AgentTaskIdSchema,
    revision: AgentTaskRevisionSchema,
    state: AgentTaskStateSchema,
    confirmed: ClientWriteFieldsSchema,
    tentative: ClientWriteFieldsSchema,
    provenance: AgentTaskProvenanceSchema,
    issues: z.array(AgentTaskIssueSchema),
    constraints: AgentTaskConstraintsSchema,
    choiceSets: z.array(AgentTaskChoiceSetSchema),
    orderedChoiceRefs: z.array(AgentTaskOpaqueRefSchema),
    target: AgentTaskTargetSchema.nullable(),
    consent: AgentAutomationConsentSchema,
    action: AgentTaskActionLinkSchema.nullable(),
    times: AgentTaskTimesSchema,
    currentSnapshotRef: AgentTaskSnapshotRefSchema,
}).strict();

export type AgentTask = z.infer<typeof AgentTaskSchema>;

export const AgentTaskCreateRequestSchema = z.object({
    schemaVersion: AgentTaskSchemaVersionSchema.optional(),
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
    choiceSetId: AgentTaskOpaqueRefSchema,
    optionId: AgentTaskOpaqueRefSchema,
}).strict();

const SelectTargetByChoiceSetRefSchema = z.object({
    ...AgentTaskCommandBaseShape,
    command: z.literal("select-target"),
    choiceSetRef: AgentTaskOpaqueRefSchema,
    optionId: AgentTaskOpaqueRefSchema,
}).strict();

export const AgentTaskSelectTargetCommandSchema = z.union([
    SelectTargetByChoiceSetIdSchema,
    SelectTargetByChoiceSetRefSchema,
]);

export const AgentTaskCommandRequestSchema = z.union([
    AgentTaskSelectTargetCommandSchema,
    z.object({ ...AgentTaskCommandBaseShape, command: z.literal("pause") }).strict(),
    z.object({ ...AgentTaskCommandBaseShape, command: z.literal("resume") }).strict(),
    z.object({ ...AgentTaskCommandBaseShape, command: z.literal("prepare-review") }).strict(),
    z.object({ ...AgentTaskCommandBaseShape, command: z.literal("cancel") }).strict(),
]);

export type AgentTaskCommandRequest = z.infer<typeof AgentTaskCommandRequestSchema>;

export const AgentTaskCommandNameSchema = z.enum([
    "select-target",
    "pause",
    "resume",
    "prepare-review",
    "cancel",
]);

export type AgentTaskCommandName = z.infer<typeof AgentTaskCommandNameSchema>;

export const AgentTaskEventReceiptSchema = z.object({
    taskId: AgentTaskIdSchema,
    eventId: AgentTaskEventIdSchema,
    eventHash: AgentTaskEventHashSchema,
    acceptedRevision: AgentTaskRevisionSchema,
    currentSnapshotRef: AgentTaskSnapshotRefSchema,
}).strict();

export type AgentTaskEventReceipt = z.infer<typeof AgentTaskEventReceiptSchema>;

export const AgentTaskMutationResponseSchema = z.object({
    receipt: AgentTaskEventReceiptSchema,
    snapshot: AgentTaskSchema,
}).strict();

export type AgentTaskMutationResponse = z.infer<typeof AgentTaskMutationResponseSchema>;

/**
 * Build the initial state used by POST.  Defaults are intentionally kept out
 * of PATCH: an omitted update field must preserve its current value.
 */
export function createAgentTaskDefaults(): Pick<
    ClientWriteFields,
    "voucherClient" | "serviceStatus"
> {
    return { ...CLIENT_CREATE_DEFAULTS };
}

export const createTaskDefaults = createAgentTaskDefaults;

export type AgentTaskClientOperation = ClientInputOperation;
export type AgentTaskAutomationChoice = AutomationConsentChoice;
export const AgentTaskAutomationChoiceSchema = AutomationConsentChoiceSchema;
export const AgentTaskAutomationChoices = AUTOMATION_CONSENT_CHOICES;

// Explicit aliases make the names easy to discover from server and client
// call sites while retaining one canonical Zod schema per contract.
export const CreateAgentTaskRequestSchema = AgentTaskCreateRequestSchema;
export const PatchAgentTaskRequestSchema = AgentTaskPatchRequestSchema;
export const AgentTaskUpdateRequestSchema = AgentTaskPatchRequestSchema;
export const AgentTaskCreateSchema = AgentTaskCreateRequestSchema;
export const AgentTaskPatchSchema = AgentTaskPatchRequestSchema;
export const AgentTaskUpdateSchema = AgentTaskPatchRequestSchema;
export const AgentTaskCommandSchema = AgentTaskCommandRequestSchema;
export const AgentTaskCommandInputSchema = AgentTaskCommandRequestSchema;
export const TaskCreateRequestSchema = AgentTaskCreateRequestSchema;
export const TaskUpdateRequestSchema = AgentTaskPatchRequestSchema;
export const TaskCommandRequestSchema = AgentTaskCommandRequestSchema;
export const AgentTaskSnapshotSchema = AgentTaskSchema;
export const AgentTaskRestSnapshotSchema = AgentTaskSchema;
export const TaskSchema = AgentTaskSchema;
export const TaskEventReceiptSchema = AgentTaskEventReceiptSchema;
