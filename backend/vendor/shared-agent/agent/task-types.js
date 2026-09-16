"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskEventReceiptSchema = exports.TaskSchema = exports.AgentTaskRestSnapshotSchema = exports.AgentTaskSnapshotSchema = exports.TaskCommandRequestSchema = exports.TaskUpdateRequestSchema = exports.TaskCreateRequestSchema = exports.AgentTaskCommandInputSchema = exports.AgentTaskCommandSchema = exports.AgentTaskUpdateSchema = exports.AgentTaskPatchSchema = exports.AgentTaskCreateSchema = exports.AgentTaskUpdateRequestSchema = exports.PatchAgentTaskRequestSchema = exports.CreateAgentTaskRequestSchema = exports.AgentTaskAutomationChoices = exports.AgentTaskAutomationChoiceSchema = exports.createTaskDefaults = exports.AgentTaskMutationResponseSchema = exports.AgentTaskEventReceiptSchema = exports.AgentTaskCommandNameSchema = exports.AgentTaskCommandRequestSchema = exports.AgentTaskSelectTargetCommandSchema = exports.AgentTaskPatchRequestSchema = exports.AgentTaskCreateRequestSchema = exports.AgentTaskSchema = exports.AgentAutomationConsentInputSchema = exports.AgentAutomationConsentSchema = exports.AgentAutomationConsentBindingSchema = exports.AgentTaskTimesSchema = exports.AgentTaskActionLinkSchema = exports.AgentTaskChoiceSetSchema = exports.AgentTaskChoiceOptionSchema = exports.AgentTaskTargetSchema = exports.AgentTaskConstraintsSchema = exports.AgentTaskIssueSchema = exports.AgentTaskIssueSeveritySchema = exports.AgentTaskProvenanceSchema = exports.AgentTaskFieldProvenanceSchema = exports.AgentTaskSourceSchema = exports.AgentTaskIsoDateTimeSchema = exports.AgentTaskOpaqueRefSchema = exports.AgentTaskSnapshotRefSchema = exports.AgentTaskEventHashSchema = exports.AgentTaskEventIdSchema = exports.AgentTaskRevisionSchema = exports.AgentTaskIdSchema = exports.AgentTaskStateSchema = exports.AgentTaskSchemaVersionSchema = exports.AGENT_TASK_SCHEMA_VERSION = void 0;
exports.createAgentTaskDefaults = createAgentTaskDefaults;
const zod_1 = require("zod");
const client_input_policy_1 = require("./client-input-policy");
exports.AGENT_TASK_SCHEMA_VERSION = 1;
exports.AgentTaskSchemaVersionSchema = zod_1.z.literal(exports.AGENT_TASK_SCHEMA_VERSION);
exports.AgentTaskStateSchema = zod_1.z.enum([
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
exports.AgentTaskIdSchema = zod_1.z.string().trim().min(1).max(200);
exports.AgentTaskRevisionSchema = zod_1.z.union([
    zod_1.z.number().int().nonnegative(),
    zod_1.z.string().trim().min(1).max(200),
]);
exports.AgentTaskEventIdSchema = zod_1.z.string().trim().min(1).max(200);
exports.AgentTaskEventHashSchema = zod_1.z.string().trim().min(1).max(512);
exports.AgentTaskSnapshotRefSchema = zod_1.z.string().trim().min(1).max(512);
exports.AgentTaskOpaqueRefSchema = zod_1.z.string().trim().min(1).max(512);
exports.AgentTaskIsoDateTimeSchema = zod_1.z.iso.datetime();
exports.AgentTaskSourceSchema = zod_1.z.enum([
    "user",
    "wizard",
    "server",
    "lookup",
    "model",
    "system",
]);
exports.AgentTaskFieldProvenanceSchema = zod_1.z.object({
    source: exports.AgentTaskSourceSchema,
    capturedAt: exports.AgentTaskIsoDateTimeSchema.optional(),
    eventId: exports.AgentTaskEventIdSchema.optional(),
    valueRef: exports.AgentTaskOpaqueRefSchema.optional(),
}).strict();
exports.AgentTaskProvenanceSchema = zod_1.z.object({
    confirmed: zod_1.z.record(zod_1.z.string(), exports.AgentTaskFieldProvenanceSchema),
    tentative: zod_1.z.record(zod_1.z.string(), exports.AgentTaskFieldProvenanceSchema),
}).strict();
exports.AgentTaskIssueSeveritySchema = zod_1.z.enum(["info", "warning", "error"]);
exports.AgentTaskIssueSchema = zod_1.z.object({
    code: zod_1.z.string().trim().min(1).max(120),
    field: zod_1.z.string().trim().min(1).max(120).optional(),
    severity: exports.AgentTaskIssueSeveritySchema,
    message: zod_1.z.string().trim().min(1).max(1000),
}).strict();
exports.AgentTaskConstraintsSchema = zod_1.z.object({
    noSend: zod_1.z.boolean(),
    automationChoice: client_input_policy_1.AutomationConsentChoiceSchema,
}).strict();
exports.AgentTaskTargetSchema = zod_1.z.object({
    targetRef: exports.AgentTaskOpaqueRefSchema,
    version: exports.AgentTaskRevisionSchema.optional(),
    targetVersion: exports.AgentTaskRevisionSchema.optional(),
    choiceSetRef: exports.AgentTaskOpaqueRefSchema.optional(),
    optionId: exports.AgentTaskOpaqueRefSchema.optional(),
}).strict().superRefine((value, context) => {
    if (value.version === undefined && value.targetVersion === undefined) {
        context.addIssue({ code: "custom", path: ["version"], message: "A server-issued target version is required" });
    }
});
exports.AgentTaskChoiceOptionSchema = zod_1.z.object({
    optionId: exports.AgentTaskOpaqueRefSchema,
    label: zod_1.z.string().trim().min(1).max(300),
    description: zod_1.z.string().trim().max(1000).optional(),
}).strict();
exports.AgentTaskChoiceSetSchema = zod_1.z.object({
    choiceSetRef: exports.AgentTaskOpaqueRefSchema,
    options: zod_1.z.array(exports.AgentTaskChoiceOptionSchema).min(1).max(100),
    issuedAt: exports.AgentTaskIsoDateTimeSchema.optional(),
    expiresAt: exports.AgentTaskIsoDateTimeSchema.optional(),
}).strict();
exports.AgentTaskActionLinkSchema = zod_1.z.object({
    actionId: exports.AgentTaskOpaqueRefSchema,
    expectedRevision: exports.AgentTaskRevisionSchema,
    proposalRevision: exports.AgentTaskRevisionSchema.optional(),
}).strict();
exports.AgentTaskTimesSchema = zod_1.z.object({
    createdAt: exports.AgentTaskIsoDateTimeSchema,
    updatedAt: exports.AgentTaskIsoDateTimeSchema,
    acceptedAt: exports.AgentTaskIsoDateTimeSchema.optional(),
    pausedAt: exports.AgentTaskIsoDateTimeSchema.optional(),
    terminatedAt: exports.AgentTaskIsoDateTimeSchema.optional(),
    expiresAt: exports.AgentTaskIsoDateTimeSchema.optional(),
}).strict();
exports.AgentAutomationConsentBindingSchema = zod_1.z.object({
    recipientRef: exports.AgentTaskOpaqueRefSchema,
    effectDigest: exports.AgentTaskEventHashSchema,
    templateRef: exports.AgentTaskOpaqueRefSchema,
    policyDigest: exports.AgentTaskEventHashSchema,
    consentEventId: exports.AgentTaskEventIdSchema,
}).strict();
exports.AgentAutomationConsentSchema = zod_1.z.object({
    choice: client_input_policy_1.AutomationConsentChoiceSchema,
    binding: exports.AgentAutomationConsentBindingSchema.nullable(),
}).strict().superRefine((value, context) => {
    if (value.choice === "yes" && value.binding === null) {
        context.addIssue({ code: "custom", path: ["binding"], message: "A yes consent requires a server-issued binding" });
    }
    if (value.choice !== "yes" && value.binding !== null) {
        context.addIssue({ code: "custom", path: ["binding"], message: "Only yes consent may carry a binding" });
    }
});
exports.AgentAutomationConsentInputSchema = zod_1.z.object({
    choice: client_input_policy_1.AutomationConsentChoiceSchema,
}).strict();
exports.AgentTaskSchema = zod_1.z.object({
    schemaVersion: exports.AgentTaskSchemaVersionSchema,
    taskId: exports.AgentTaskIdSchema,
    sessionId: exports.AgentTaskIdSchema,
    revision: exports.AgentTaskRevisionSchema,
    state: exports.AgentTaskStateSchema,
    confirmed: client_input_policy_1.ClientWriteFieldsSchema,
    tentative: client_input_policy_1.ClientWriteFieldsSchema,
    provenance: exports.AgentTaskProvenanceSchema,
    issues: zod_1.z.array(exports.AgentTaskIssueSchema),
    constraints: exports.AgentTaskConstraintsSchema,
    choiceSets: zod_1.z.array(exports.AgentTaskChoiceSetSchema),
    orderedChoiceRefs: zod_1.z.array(exports.AgentTaskOpaqueRefSchema),
    target: exports.AgentTaskTargetSchema.nullable(),
    consent: exports.AgentAutomationConsentSchema,
    action: exports.AgentTaskActionLinkSchema.nullable(),
    times: exports.AgentTaskTimesSchema,
    currentSnapshotRef: exports.AgentTaskSnapshotRefSchema,
}).strict();
exports.AgentTaskCreateRequestSchema = zod_1.z.object({
    schemaVersion: exports.AgentTaskSchemaVersionSchema.optional(),
    clientEventId: exports.AgentTaskEventIdSchema,
    operations: client_input_policy_1.ClientInputOperationsSchema.default([]),
}).strict();
exports.AgentTaskPatchRequestSchema = zod_1.z.object({
    clientEventId: exports.AgentTaskEventIdSchema,
    expectedRevision: exports.AgentTaskRevisionSchema,
    operations: client_input_policy_1.ClientInputOperationsSchema.min(1),
}).strict();
const AgentTaskCommandBaseShape = {
    clientEventId: exports.AgentTaskEventIdSchema,
    expectedRevision: exports.AgentTaskRevisionSchema,
};
const SelectTargetByChoiceSetIdSchema = zod_1.z.object({
    ...AgentTaskCommandBaseShape,
    command: zod_1.z.literal("select-target"),
    choiceSetId: exports.AgentTaskOpaqueRefSchema,
    optionId: exports.AgentTaskOpaqueRefSchema,
}).strict();
const SelectTargetByChoiceSetRefSchema = zod_1.z.object({
    ...AgentTaskCommandBaseShape,
    command: zod_1.z.literal("select-target"),
    choiceSetRef: exports.AgentTaskOpaqueRefSchema,
    optionId: exports.AgentTaskOpaqueRefSchema,
}).strict();
exports.AgentTaskSelectTargetCommandSchema = zod_1.z.union([
    SelectTargetByChoiceSetIdSchema,
    SelectTargetByChoiceSetRefSchema,
]);
exports.AgentTaskCommandRequestSchema = zod_1.z.union([
    exports.AgentTaskSelectTargetCommandSchema,
    zod_1.z.object({ ...AgentTaskCommandBaseShape, command: zod_1.z.literal("pause") }).strict(),
    zod_1.z.object({ ...AgentTaskCommandBaseShape, command: zod_1.z.literal("resume") }).strict(),
    zod_1.z.object({ ...AgentTaskCommandBaseShape, command: zod_1.z.literal("prepare-review") }).strict(),
    zod_1.z.object({ ...AgentTaskCommandBaseShape, command: zod_1.z.literal("cancel") }).strict(),
]);
exports.AgentTaskCommandNameSchema = zod_1.z.enum([
    "select-target",
    "pause",
    "resume",
    "prepare-review",
    "cancel",
]);
exports.AgentTaskEventReceiptSchema = zod_1.z.object({
    taskId: exports.AgentTaskIdSchema,
    eventId: exports.AgentTaskEventIdSchema,
    eventHash: exports.AgentTaskEventHashSchema,
    acceptedRevision: exports.AgentTaskRevisionSchema,
    currentSnapshotRef: exports.AgentTaskSnapshotRefSchema,
}).strict();
exports.AgentTaskMutationResponseSchema = zod_1.z.object({
    receipt: exports.AgentTaskEventReceiptSchema,
    snapshot: exports.AgentTaskSchema,
}).strict();
/**
 * Build the initial state used by POST.  Defaults are intentionally kept out
 * of PATCH: an omitted update field must preserve its current value.
 */
function createAgentTaskDefaults() {
    return { ...client_input_policy_1.CLIENT_CREATE_DEFAULTS };
}
exports.createTaskDefaults = createAgentTaskDefaults;
exports.AgentTaskAutomationChoiceSchema = client_input_policy_1.AutomationConsentChoiceSchema;
exports.AgentTaskAutomationChoices = client_input_policy_1.AUTOMATION_CONSENT_CHOICES;
// Explicit aliases make the names easy to discover from server and client
// call sites while retaining one canonical Zod schema per contract.
exports.CreateAgentTaskRequestSchema = exports.AgentTaskCreateRequestSchema;
exports.PatchAgentTaskRequestSchema = exports.AgentTaskPatchRequestSchema;
exports.AgentTaskUpdateRequestSchema = exports.AgentTaskPatchRequestSchema;
exports.AgentTaskCreateSchema = exports.AgentTaskCreateRequestSchema;
exports.AgentTaskPatchSchema = exports.AgentTaskPatchRequestSchema;
exports.AgentTaskUpdateSchema = exports.AgentTaskPatchRequestSchema;
exports.AgentTaskCommandSchema = exports.AgentTaskCommandRequestSchema;
exports.AgentTaskCommandInputSchema = exports.AgentTaskCommandRequestSchema;
exports.TaskCreateRequestSchema = exports.AgentTaskCreateRequestSchema;
exports.TaskUpdateRequestSchema = exports.AgentTaskPatchRequestSchema;
exports.TaskCommandRequestSchema = exports.AgentTaskCommandRequestSchema;
exports.AgentTaskSnapshotSchema = exports.AgentTaskSchema;
exports.AgentTaskRestSnapshotSchema = exports.AgentTaskSchema;
exports.TaskSchema = exports.AgentTaskSchema;
exports.TaskEventReceiptSchema = exports.AgentTaskEventReceiptSchema;
