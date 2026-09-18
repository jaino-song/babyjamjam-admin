import type { UIMessage } from "ai";
import { z } from "zod";

import {
    AgentTaskCapabilityIdSchema,
    AgentTaskDisplayedChoiceHintSchema,
    AgentTaskReferenceSchema,
    AgentTaskRevisionSchema,
    AgentTaskStateSchema,
} from "./task-types";
import { CLIENT_WRITE_FIELD_NAMES } from "./client-input-policy";

export const AgentRendererNameSchema = z.enum([
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

export type AgentRendererName = z.infer<typeof AgentRendererNameSchema>;

export const AgentMessageMetadataSchema = z.object({
    sessionId: z.string().min(1),
    traceId: z.string().min(1),
    createdAt: z.iso.datetime(),
    model: z.string().min(1),
    agentVersion: z.string().min(1),
});

export interface AgentMessageMetadata extends z.infer<typeof AgentMessageMetadataSchema> {}

export const AgentActivityPartSchema = z.object({
    label: z.string().min(1),
    status: z.enum(["pending", "running", "succeeded", "failed"]),
    detail: z.string().optional(),
});

export const AgentEntityChoicePartSchema = z.object({
    entityType: z.string().min(1),
    prompt: z.string().min(1),
    choices: z.array(z.object({
        id: z.string().min(1),
        label: z.string().min(1),
        description: z.string().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
    })).min(2),
});

export const AgentActionProposalPartSchema = z.object({
    actionId: z.string().min(1),
    capability: z.string().min(1),
    title: z.string().min(1),
    summary: z.string().min(1),
    expiresAt: z.iso.datetime(),
    expectedRevision: z.string().min(1),
    risk: z.string().min(1).optional(),
    branchId: z.string().min(1).optional(),
    target: z.record(z.string(), z.unknown()).optional(),
    changes: z.record(z.string(), z.unknown()),
    provider: z.string().min(1).optional(),
    estimatedCost: z.string().min(1).optional(),
    acknowledgementToken: z.string().min(1).optional(),
});

export const AgentActionResultPartSchema = z.object({
    actionId: z.string().min(1),
    status: z.enum(["succeeded", "failed", "uncertain", "rejected", "expired", "cancelled"]),
    summary: z.string().min(1),
    result: z.record(z.string(), z.unknown()).optional(),
    completedAt: z.iso.datetime().optional(),
    href: z.string().startsWith("/").refine((value) => !value.startsWith("//"), "Only internal paths are allowed").optional(),
});

export const AgentNavigationPartSchema = z.object({
    href: z.string().startsWith("/").refine((value) => !value.startsWith("//"), "Only internal paths are allowed"),
    label: z.string().min(1),
});

export const AgentErrorPartSchema = z.object({
    code: z.string().min(1),
    category: z.enum([
        "model",
        "routing",
        "validation",
        "authorization",
        "capability",
        "provider",
        "persistence",
        "client",
    ]),
    message: z.string().min(1),
    retryable: z.boolean(),
    effectState: z.enum(["nothing-happened", "succeeded-unconfirmed", "partial"]).optional(),
});

export const AgentAttachmentPartSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    mediaType: z.string().min(1),
    size: z.number().int().nonnegative(),
});

export const AgentFormFieldSchema = z.object({
    name: z.string().min(1),
    label: z.string().min(1),
    type: z.enum(["text", "number", "date", "textarea", "boolean"]),
    required: z.boolean().optional(),
    inputMode: z.enum(["none", "text", "tel", "url", "email", "numeric", "decimal", "search"]).optional(),
    placeholder: z.string().max(200).optional(),
    maxLength: z.number().int().positive().max(1000).optional(),
});

export type AgentFormField = z.infer<typeof AgentFormFieldSchema>;

export const AgentFormPartSchema = z.object({
    formId: z.string().min(1),
    title: z.string().min(1),
    schemaVersion: z.string().min(1),
    fields: z.array(AgentFormFieldSchema).optional(),
});

export const AgentFormSubmitPartSchema = z.object({
    formId: z.string().min(1),
    values: z.record(z.string(), z.unknown()),
});

export const AgentFeedbackPartSchema = z.object({
    messageId: z.string().min(1),
    traceId: z.string().min(1).optional(),
    prompt: z.string().min(1).default("도움이 되었나요?"),
});

/** Safe reference/status payload for `data-task-snapshot`. */
export const AgentTaskSnapshotPartSchema = z.object({
    taskId: AgentTaskReferenceSchema,
    snapshotRef: AgentTaskReferenceSchema,
    kind: AgentTaskCapabilityIdSchema,
    capabilityId: AgentTaskCapabilityIdSchema,
    revision: AgentTaskRevisionSchema,
    state: AgentTaskStateSchema,
    fieldStatus: z.array(z.object({
        field: z.enum(CLIENT_WRITE_FIELD_NAMES),
        status: z.enum(["missing", "confirmed", "tentative", "confirmed-and-tentative"]),
    }).strict()),
}).strict().superRefine((value, context) => {
    if (value.kind !== value.capabilityId) {
        context.addIssue({ code: "custom", path: ["kind"], message: "Task kind must match capabilityId" });
    }
});

/** Structured, server-issued reference payload for `data-entity-select`. */
export const AgentEntitySelectPartSchema = z.object({
    taskId: AgentTaskReferenceSchema,
    choiceSetRef: AgentTaskReferenceSchema,
    optionIds: z.array(AgentTaskReferenceSchema).min(1).max(100),
}).strict();

/**
 * Persisted chat parts carry only the server acceptance receipt reference.
 * Actual validated operations remain in the REST request contract.
 */
export const AgentTaskPatchPartSchema = z.object({
    taskId: AgentTaskReferenceSchema,
    eventId: AgentTaskReferenceSchema,
    acceptedRevision: AgentTaskRevisionSchema,
    currentSnapshotRef: AgentTaskReferenceSchema,
}).strict().superRefine((value, context) => {
    if (!value.eventId) {
        context.addIssue({ code: "custom", path: ["eventId"], message: "A task patch part needs a server event reference" });
    }
});

export type AgentDataParts = {
    activity: z.infer<typeof AgentActivityPartSchema>;
    "entity-choice": z.infer<typeof AgentEntityChoicePartSchema>;
    "action-proposal": z.infer<typeof AgentActionProposalPartSchema>;
    "action-result": z.infer<typeof AgentActionResultPartSchema>;
    navigation: z.infer<typeof AgentNavigationPartSchema>;
    error: z.infer<typeof AgentErrorPartSchema>;
    attachment: z.infer<typeof AgentAttachmentPartSchema>;
    form: z.infer<typeof AgentFormPartSchema>;
    "form-submit": z.infer<typeof AgentFormSubmitPartSchema>;
    feedback: z.infer<typeof AgentFeedbackPartSchema>;
    "task-snapshot": z.infer<typeof AgentTaskSnapshotPartSchema>;
    "entity-select": z.infer<typeof AgentEntitySelectPartSchema>;
    "task-patch": z.infer<typeof AgentTaskPatchPartSchema>;
};

export type BjjUITools = Record<string, {
    input: unknown;
    output: unknown | undefined;
}>;

export type BjjUIMessage = UIMessage<AgentMessageMetadata, AgentDataParts, BjjUITools>;

export type AgentConversationMessage = BjjUIMessage & {
    /** Optional server-issued hint retained for byte-for-byte retries. */
    displayedChoice?: z.infer<typeof AgentTaskDisplayedChoiceHintSchema>;
};
