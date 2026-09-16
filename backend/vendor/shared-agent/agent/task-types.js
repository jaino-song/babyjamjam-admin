"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentTaskMutationResponseSchema = exports.AgentTaskEventReceiptSchema = exports.AgentTaskCommandNameSchema = exports.AgentTaskCommandRequestSchema = exports.AgentTaskSelectTargetCommandSchema = exports.AgentTaskPatchRequestSchema = exports.AgentTaskCreateRequestSchema = exports.AgentTaskSchema = exports.AgentAutomationConsentInputSchema = exports.AgentAutomationConsentSchema = exports.AgentAutomationConsentBindingSchema = exports.AgentTaskTimesSchema = exports.AgentTaskActionLinkSchema = exports.AgentTaskChoiceSetSchema = exports.AgentTaskChoiceOptionSchema = exports.AgentTaskTargetSchema = exports.AgentTaskConstraintsSchema = exports.AgentTaskIssueSchema = exports.AgentTaskIssueSeveritySchema = exports.AgentTaskIssueCodeSchema = exports.AgentTaskProvenanceSchema = exports.AgentTaskFieldProvenanceSchema = exports.AgentTaskSourceSchema = exports.AgentTaskIsoDateTimeSchema = exports.AgentTaskEventHashSchema = exports.AgentTaskSnapshotRefSchema = exports.AgentTaskEventIdSchema = exports.AgentTaskIdSchema = exports.AgentTaskReferenceSchema = exports.AgentActionRevisionTokenSchema = exports.AgentTaskRevisionSchema = exports.AgentTaskStateSchema = exports.AgentTaskKindSchema = exports.AgentTaskCapabilityIdSchema = exports.AgentTaskSchemaVersionSchema = exports.AGENT_TASK_SCHEMA_VERSION = void 0;
exports.createAgentTaskDefaults = createAgentTaskDefaults;
const zod_1 = require("zod");
const client_input_policy_1 = require("./client-input-policy");
exports.AGENT_TASK_SCHEMA_VERSION = 1;
exports.AgentTaskSchemaVersionSchema = zod_1.z.literal(exports.AGENT_TASK_SCHEMA_VERSION);
exports.AgentTaskCapabilityIdSchema = zod_1.z.enum(["clients.create", "clients.update"]);
exports.AgentTaskKindSchema = exports.AgentTaskCapabilityIdSchema;
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
/** Task revisions are persistence-safe ordered values, unlike action tokens. */
exports.AgentTaskRevisionSchema = zod_1.z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
exports.AgentActionRevisionTokenSchema = zod_1.z.string().trim().min(1).max(200);
/** Server-issued/client-generated references are UUIDs, never display text. */
exports.AgentTaskReferenceSchema = zod_1.z.uuid();
exports.AgentTaskIdSchema = exports.AgentTaskReferenceSchema;
exports.AgentTaskEventIdSchema = exports.AgentTaskReferenceSchema;
exports.AgentTaskSnapshotRefSchema = exports.AgentTaskReferenceSchema;
exports.AgentTaskEventHashSchema = zod_1.z.string().regex(/^[a-f0-9]{64}$/i);
exports.AgentTaskIsoDateTimeSchema = zod_1.z.iso.datetime();
exports.AgentTaskSourceSchema = zod_1.z.enum(["user", "wizard", "server", "lookup", "model", "system"]);
exports.AgentTaskFieldProvenanceSchema = zod_1.z.object({
    source: exports.AgentTaskSourceSchema,
    capturedAt: exports.AgentTaskIsoDateTimeSchema.optional(),
    eventId: exports.AgentTaskEventIdSchema.optional(),
    valueRef: exports.AgentTaskReferenceSchema.optional(),
}).strict();
exports.AgentTaskProvenanceSchema = zod_1.z.object({
    confirmed: zod_1.z.record(zod_1.z.string(), exports.AgentTaskFieldProvenanceSchema),
    tentative: zod_1.z.record(zod_1.z.string(), exports.AgentTaskFieldProvenanceSchema),
}).strict();
/** Codes are structural and cannot carry arbitrary display/PII strings. */
exports.AgentTaskIssueCodeSchema = zod_1.z.string().regex(/^task\.[a-z0-9]+(?:[._-][a-z0-9]+)*$/);
exports.AgentTaskIssueSeveritySchema = zod_1.z.enum(["info", "warning", "error"]);
exports.AgentTaskIssueSchema = zod_1.z.object({
    code: exports.AgentTaskIssueCodeSchema,
    field: zod_1.z.enum(client_input_policy_1.CLIENT_WRITE_FIELD_NAMES).optional(),
    severity: exports.AgentTaskIssueSeveritySchema,
    message: zod_1.z.string().trim().min(1).max(1000),
}).strict();
exports.AgentTaskConstraintsSchema = zod_1.z.object({ noSend: zod_1.z.boolean() }).strict();
exports.AgentTaskTargetSchema = zod_1.z.object({
    targetRef: exports.AgentTaskReferenceSchema,
    version: exports.AgentTaskRevisionSchema,
    choiceSetRef: exports.AgentTaskReferenceSchema.optional(),
    optionId: exports.AgentTaskReferenceSchema.optional(),
}).strict();
/** Authorized REST snapshots may retain presentation labels. Safe parts use refs only. */
exports.AgentTaskChoiceOptionSchema = zod_1.z.object({
    optionId: exports.AgentTaskReferenceSchema,
    label: zod_1.z.string().trim().min(1).max(300),
    description: zod_1.z.string().trim().max(1000).optional(),
}).strict();
exports.AgentTaskChoiceSetSchema = zod_1.z.object({
    choiceSetRef: exports.AgentTaskReferenceSchema,
    options: zod_1.z.array(exports.AgentTaskChoiceOptionSchema).min(1).max(100),
    issuedAt: exports.AgentTaskIsoDateTimeSchema.optional(),
    expiresAt: exports.AgentTaskIsoDateTimeSchema.optional(),
}).strict();
exports.AgentTaskActionLinkSchema = zod_1.z.object({
    actionId: exports.AgentTaskReferenceSchema,
    expectedRevision: exports.AgentActionRevisionTokenSchema,
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
    recipientRef: exports.AgentTaskReferenceSchema,
    effectDigest: exports.AgentTaskEventHashSchema,
    templateRef: exports.AgentTaskReferenceSchema,
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
exports.AgentAutomationConsentInputSchema = zod_1.z.object({ choice: client_input_policy_1.AutomationConsentChoiceSchema }).strict();
exports.AgentTaskSchema = zod_1.z.object({
    schemaVersion: exports.AgentTaskSchemaVersionSchema,
    taskId: exports.AgentTaskIdSchema,
    sessionId: exports.AgentTaskIdSchema,
    kind: exports.AgentTaskKindSchema,
    capabilityId: exports.AgentTaskCapabilityIdSchema,
    revision: exports.AgentTaskRevisionSchema,
    state: exports.AgentTaskStateSchema,
    confirmed: client_input_policy_1.ClientWriteFieldsSchema,
    tentative: client_input_policy_1.ClientTentativeValuesSchema,
    provenance: exports.AgentTaskProvenanceSchema,
    issues: zod_1.z.array(exports.AgentTaskIssueSchema),
    constraints: exports.AgentTaskConstraintsSchema,
    choiceSets: zod_1.z.array(exports.AgentTaskChoiceSetSchema),
    orderedChoiceRefs: zod_1.z.array(exports.AgentTaskReferenceSchema),
    target: exports.AgentTaskTargetSchema.nullable(),
    consent: exports.AgentAutomationConsentSchema,
    action: exports.AgentTaskActionLinkSchema.nullable(),
    times: exports.AgentTaskTimesSchema,
    currentSnapshotRef: exports.AgentTaskSnapshotRefSchema,
}).strict().superRefine((value, context) => {
    if (value.kind !== value.capabilityId) {
        context.addIssue({ code: "custom", path: ["kind"], message: "Task kind must match capabilityId" });
    }
});
exports.AgentTaskCreateRequestSchema = zod_1.z.object({
    schemaVersion: exports.AgentTaskSchemaVersionSchema.optional(),
    sessionId: exports.AgentTaskIdSchema,
    capabilityId: exports.AgentTaskCapabilityIdSchema,
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
    choiceSetId: exports.AgentTaskReferenceSchema,
    optionId: exports.AgentTaskReferenceSchema,
}).strict();
const SelectTargetByChoiceSetRefSchema = zod_1.z.object({
    ...AgentTaskCommandBaseShape,
    command: zod_1.z.literal("select-target"),
    choiceSetRef: exports.AgentTaskReferenceSchema,
    optionId: exports.AgentTaskReferenceSchema,
}).strict();
exports.AgentTaskSelectTargetCommandSchema = zod_1.z.union([SelectTargetByChoiceSetIdSchema, SelectTargetByChoiceSetRefSchema]);
exports.AgentTaskCommandRequestSchema = zod_1.z.union([
    exports.AgentTaskSelectTargetCommandSchema,
    zod_1.z.object({ ...AgentTaskCommandBaseShape, command: zod_1.z.literal("pause") }).strict(),
    zod_1.z.object({ ...AgentTaskCommandBaseShape, command: zod_1.z.literal("resume") }).strict(),
    zod_1.z.object({ ...AgentTaskCommandBaseShape, command: zod_1.z.literal("prepare-review") }).strict(),
    zod_1.z.object({ ...AgentTaskCommandBaseShape, command: zod_1.z.literal("cancel") }).strict(),
]);
exports.AgentTaskCommandNameSchema = zod_1.z.enum(["select-target", "pause", "resume", "prepare-review", "cancel"]);
exports.AgentTaskEventReceiptSchema = zod_1.z.object({
    taskId: exports.AgentTaskIdSchema,
    eventId: exports.AgentTaskEventIdSchema,
    eventHash: exports.AgentTaskEventHashSchema,
    acceptedRevision: exports.AgentTaskRevisionSchema,
    currentSnapshotRef: exports.AgentTaskSnapshotRefSchema,
}).strict();
exports.AgentTaskMutationResponseSchema = zod_1.z.object({ receipt: exports.AgentTaskEventReceiptSchema, snapshot: exports.AgentTaskSchema }).strict();
function createAgentTaskDefaults() {
    return { voucherClient: false, serviceStatus: "pre_booking" };
}
