"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentTaskPatchPartSchema = exports.AgentTaskPatchPartOperationSchema = exports.AgentEntitySelectPartSchema = exports.AgentTaskSnapshotPartSchema = exports.AgentFeedbackPartSchema = exports.AgentFormSubmitPartSchema = exports.AgentFormPartSchema = exports.AgentFormFieldSchema = exports.AgentAttachmentPartSchema = exports.AgentErrorPartSchema = exports.AgentNavigationPartSchema = exports.AgentActionResultPartSchema = exports.AgentActionProposalPartSchema = exports.AgentEntityChoicePartSchema = exports.AgentActivityPartSchema = exports.AgentMessageMetadataSchema = exports.AgentRendererNameSchema = void 0;
const zod_1 = require("zod");
const task_types_1 = require("./task-types");
const client_input_policy_1 = require("./client-input-policy");
exports.AgentRendererNameSchema = zod_1.z.enum([
    "text",
    "activity",
    "entity-choice",
    "action-proposal",
    "action-result",
    "navigation",
    "error",
    "attachment",
    "form",
    "feedback",
    "task-snapshot",
    "entity-select",
    "task-patch",
]);
exports.AgentMessageMetadataSchema = zod_1.z.object({
    sessionId: zod_1.z.string().min(1),
    traceId: zod_1.z.string().min(1),
    createdAt: zod_1.z.iso.datetime(),
    model: zod_1.z.string().min(1),
    agentVersion: zod_1.z.string().min(1),
});
exports.AgentActivityPartSchema = zod_1.z.object({
    label: zod_1.z.string().min(1),
    status: zod_1.z.enum(["pending", "running", "succeeded", "failed"]),
    detail: zod_1.z.string().optional(),
});
exports.AgentEntityChoicePartSchema = zod_1.z.object({
    entityType: zod_1.z.string().min(1),
    prompt: zod_1.z.string().min(1),
    choices: zod_1.z.array(zod_1.z.object({
        id: zod_1.z.string().min(1),
        label: zod_1.z.string().min(1),
        description: zod_1.z.string().optional(),
        metadata: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).optional(),
    })).min(2),
});
exports.AgentActionProposalPartSchema = zod_1.z.object({
    actionId: zod_1.z.string().min(1),
    capability: zod_1.z.string().min(1),
    title: zod_1.z.string().min(1),
    summary: zod_1.z.string().min(1),
    expiresAt: zod_1.z.iso.datetime(),
    expectedRevision: zod_1.z.string().min(1),
    risk: zod_1.z.string().min(1).optional(),
    branchId: zod_1.z.string().min(1).optional(),
    target: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).optional(),
    changes: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()),
    provider: zod_1.z.string().min(1).optional(),
    estimatedCost: zod_1.z.string().min(1).optional(),
    acknowledgementToken: zod_1.z.string().min(1).optional(),
});
exports.AgentActionResultPartSchema = zod_1.z.object({
    actionId: zod_1.z.string().min(1),
    status: zod_1.z.enum(["succeeded", "failed", "uncertain", "rejected", "expired", "cancelled"]),
    summary: zod_1.z.string().min(1),
    result: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()).optional(),
    completedAt: zod_1.z.iso.datetime().optional(),
    href: zod_1.z.string().startsWith("/").refine((value) => !value.startsWith("//"), "Only internal paths are allowed").optional(),
});
exports.AgentNavigationPartSchema = zod_1.z.object({
    href: zod_1.z.string().startsWith("/").refine((value) => !value.startsWith("//"), "Only internal paths are allowed"),
    label: zod_1.z.string().min(1),
});
exports.AgentErrorPartSchema = zod_1.z.object({
    code: zod_1.z.string().min(1),
    category: zod_1.z.enum([
        "model",
        "routing",
        "validation",
        "authorization",
        "capability",
        "provider",
        "persistence",
        "client",
    ]),
    message: zod_1.z.string().min(1),
    retryable: zod_1.z.boolean(),
    effectState: zod_1.z.enum(["nothing-happened", "succeeded-unconfirmed", "partial"]).optional(),
});
exports.AgentAttachmentPartSchema = zod_1.z.object({
    id: zod_1.z.string().min(1),
    name: zod_1.z.string().min(1),
    mediaType: zod_1.z.string().min(1),
    size: zod_1.z.number().int().nonnegative(),
});
exports.AgentFormFieldSchema = zod_1.z.object({
    name: zod_1.z.string().min(1),
    label: zod_1.z.string().min(1),
    type: zod_1.z.enum(["text", "number", "date", "textarea", "boolean"]),
    required: zod_1.z.boolean().optional(),
    inputMode: zod_1.z.enum(["none", "text", "tel", "url", "email", "numeric", "decimal", "search"]).optional(),
    placeholder: zod_1.z.string().max(200).optional(),
    maxLength: zod_1.z.number().int().positive().max(1000).optional(),
});
exports.AgentFormPartSchema = zod_1.z.object({
    formId: zod_1.z.string().min(1),
    title: zod_1.z.string().min(1),
    schemaVersion: zod_1.z.string().min(1),
    fields: zod_1.z.array(exports.AgentFormFieldSchema).optional(),
});
exports.AgentFormSubmitPartSchema = zod_1.z.object({
    formId: zod_1.z.string().min(1),
    values: zod_1.z.record(zod_1.z.string(), zod_1.z.unknown()),
});
exports.AgentFeedbackPartSchema = zod_1.z.object({
    messageId: zod_1.z.string().min(1),
    traceId: zod_1.z.string().min(1).optional(),
    prompt: zod_1.z.string().min(1).default("도움이 되었나요?"),
});
/** Safe reference/status payload for `data-task-snapshot`. */
exports.AgentTaskSnapshotPartSchema = zod_1.z.object({
    taskId: task_types_1.AgentTaskOpaqueRefSchema,
    snapshotRef: task_types_1.AgentTaskOpaqueRefSchema,
    revision: task_types_1.AgentTaskRevisionSchema,
    state: task_types_1.AgentTaskStateSchema,
    fieldStatus: zod_1.z.array(zod_1.z.object({
        field: zod_1.z.string().min(1),
        status: zod_1.z.enum(["missing", "confirmed", "tentative", "confirmed-and-tentative"]),
    }).strict()),
}).strict();
/** Structured, server-issued choice payload for `data-entity-select`. */
exports.AgentEntitySelectPartSchema = zod_1.z.object({
    taskId: task_types_1.AgentTaskOpaqueRefSchema,
    choiceSetRef: task_types_1.AgentTaskOpaqueRefSchema,
    prompt: zod_1.z.string().trim().min(1).max(500),
    options: zod_1.z.array(zod_1.z.object({
        optionId: task_types_1.AgentTaskOpaqueRefSchema,
        label: zod_1.z.string().trim().min(1).max(300),
        description: zod_1.z.string().trim().max(1000).optional(),
    }).strict()).min(1).max(100),
}).strict();
exports.AgentTaskPatchPartOperationSchema = zod_1.z.object({
    op: zod_1.z.enum(["set", "clear", "mark-tentative"]),
    field: zod_1.z.enum([...client_input_policy_1.CLIENT_WRITE_FIELD_NAMES, ...client_input_policy_1.AUTOMATION_INPUT_FIELD_NAMES]),
    operationRef: task_types_1.AgentTaskOpaqueRefSchema.optional(),
    valueRef: task_types_1.AgentTaskOpaqueRefSchema.optional(),
}).strict();
/**
 * Chat parts carry an event reference or redacted operation references.  Raw
 * protected values are intentionally absent from this schema.
 */
exports.AgentTaskPatchPartSchema = zod_1.z.object({
    taskId: task_types_1.AgentTaskOpaqueRefSchema,
    eventId: task_types_1.AgentTaskOpaqueRefSchema.optional(),
    expectedRevision: task_types_1.AgentTaskRevisionSchema.optional(),
    acceptedRevision: task_types_1.AgentTaskRevisionSchema.optional(),
    currentSnapshotRef: task_types_1.AgentTaskOpaqueRefSchema.optional(),
    operations: zod_1.z.array(exports.AgentTaskPatchPartOperationSchema).max(100).optional(),
}).strict().superRefine((value, context) => {
    if (!value.eventId && (!value.operations || value.operations.length === 0)) {
        context.addIssue({ code: "custom", path: ["eventId"], message: "A task patch part needs an event reference or operations" });
    }
});
