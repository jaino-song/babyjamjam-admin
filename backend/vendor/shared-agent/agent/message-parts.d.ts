import type { UIMessage } from "ai";
import { z } from "zod";
export declare const AgentRendererNameSchema: z.ZodEnum<{
    error: "error";
    text: "text";
    activity: "activity";
    "entity-choice": "entity-choice";
    "action-proposal": "action-proposal";
    "action-result": "action-result";
    navigation: "navigation";
    attachment: "attachment";
    form: "form";
    feedback: "feedback";
    "task-snapshot": "task-snapshot";
    "entity-select": "entity-select";
    "task-patch": "task-patch";
}>;
export type AgentRendererName = z.infer<typeof AgentRendererNameSchema>;
export declare const AgentMessageMetadataSchema: z.ZodObject<{
    sessionId: z.ZodString;
    traceId: z.ZodString;
    createdAt: z.ZodISODateTime;
    model: z.ZodString;
    agentVersion: z.ZodString;
}, z.core.$strip>;
export interface AgentMessageMetadata extends z.infer<typeof AgentMessageMetadataSchema> {
}
export declare const AgentActivityPartSchema: z.ZodObject<{
    label: z.ZodString;
    status: z.ZodEnum<{
        succeeded: "succeeded";
        failed: "failed";
        pending: "pending";
        running: "running";
    }>;
    detail: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const AgentEntityChoicePartSchema: z.ZodObject<{
    entityType: z.ZodString;
    prompt: z.ZodString;
    choices: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        label: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
        metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export declare const AgentActionProposalPartSchema: z.ZodObject<{
    actionId: z.ZodString;
    capability: z.ZodString;
    title: z.ZodString;
    summary: z.ZodString;
    expiresAt: z.ZodISODateTime;
    expectedRevision: z.ZodString;
    risk: z.ZodOptional<z.ZodString>;
    branchId: z.ZodOptional<z.ZodString>;
    target: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    changes: z.ZodRecord<z.ZodString, z.ZodUnknown>;
    provider: z.ZodOptional<z.ZodString>;
    estimatedCost: z.ZodOptional<z.ZodString>;
    acknowledgementToken: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const AgentActionResultPartSchema: z.ZodObject<{
    actionId: z.ZodString;
    status: z.ZodEnum<{
        rejected: "rejected";
        succeeded: "succeeded";
        failed: "failed";
        expired: "expired";
        uncertain: "uncertain";
        cancelled: "cancelled";
    }>;
    summary: z.ZodString;
    result: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    completedAt: z.ZodOptional<z.ZodISODateTime>;
    href: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const AgentNavigationPartSchema: z.ZodObject<{
    href: z.ZodString;
    label: z.ZodString;
}, z.core.$strip>;
export declare const AgentErrorPartSchema: z.ZodObject<{
    code: z.ZodString;
    category: z.ZodEnum<{
        model: "model";
        capability: "capability";
        provider: "provider";
        routing: "routing";
        validation: "validation";
        authorization: "authorization";
        persistence: "persistence";
        client: "client";
    }>;
    message: z.ZodString;
    retryable: z.ZodBoolean;
    effectState: z.ZodOptional<z.ZodEnum<{
        "nothing-happened": "nothing-happened";
        "succeeded-unconfirmed": "succeeded-unconfirmed";
        partial: "partial";
    }>>;
}, z.core.$strip>;
export declare const AgentAttachmentPartSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    mediaType: z.ZodString;
    size: z.ZodNumber;
}, z.core.$strip>;
export declare const AgentFormFieldSchema: z.ZodObject<{
    name: z.ZodString;
    label: z.ZodString;
    type: z.ZodEnum<{
        number: "number";
        boolean: "boolean";
        date: "date";
        text: "text";
        textarea: "textarea";
    }>;
    required: z.ZodOptional<z.ZodBoolean>;
    inputMode: z.ZodOptional<z.ZodEnum<{
        search: "search";
        email: "email";
        url: "url";
        text: "text";
        none: "none";
        tel: "tel";
        numeric: "numeric";
        decimal: "decimal";
    }>>;
    placeholder: z.ZodOptional<z.ZodString>;
    maxLength: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export type AgentFormField = z.infer<typeof AgentFormFieldSchema>;
export declare const AgentFormPartSchema: z.ZodObject<{
    formId: z.ZodString;
    title: z.ZodString;
    schemaVersion: z.ZodString;
    fields: z.ZodOptional<z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        label: z.ZodString;
        type: z.ZodEnum<{
            number: "number";
            boolean: "boolean";
            date: "date";
            text: "text";
            textarea: "textarea";
        }>;
        required: z.ZodOptional<z.ZodBoolean>;
        inputMode: z.ZodOptional<z.ZodEnum<{
            search: "search";
            email: "email";
            url: "url";
            text: "text";
            none: "none";
            tel: "tel";
            numeric: "numeric";
            decimal: "decimal";
        }>>;
        placeholder: z.ZodOptional<z.ZodString>;
        maxLength: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>>;
}, z.core.$strip>;
export declare const AgentFormSubmitPartSchema: z.ZodObject<{
    formId: z.ZodString;
    values: z.ZodRecord<z.ZodString, z.ZodUnknown>;
}, z.core.$strip>;
export declare const AgentFeedbackPartSchema: z.ZodObject<{
    messageId: z.ZodString;
    traceId: z.ZodOptional<z.ZodString>;
    prompt: z.ZodDefault<z.ZodString>;
}, z.core.$strip>;
/** Safe reference/status payload for `data-task-snapshot`. */
export declare const AgentTaskSnapshotPartSchema: z.ZodObject<{
    taskId: z.ZodUUID;
    snapshotRef: z.ZodUUID;
    kind: z.ZodEnum<{
        "clients.create": "clients.create";
        "clients.update": "clients.update";
    }>;
    capabilityId: z.ZodEnum<{
        "clients.create": "clients.create";
        "clients.update": "clients.update";
    }>;
    revision: z.ZodNumber;
    state: z.ZodEnum<{
        executing: "executing";
        failed: "failed";
        cancelled: "cancelled";
        completed: "completed";
        collecting: "collecting";
        confirming_target: "confirming_target";
        review_ready: "review_ready";
        awaiting_approval: "awaiting_approval";
        paused: "paused";
        reconciling: "reconciling";
    }>;
    fieldStatus: z.ZodArray<z.ZodObject<{
        field: z.ZodEnum<{
            type: "type";
            name: "name";
            address: "address";
            phone: "phone";
            duration: "duration";
            fullPrice: "fullPrice";
            grant: "grant";
            actualPrice: "actualPrice";
            startDate: "startDate";
            endDate: "endDate";
            careCenter: "careCenter";
            voucherClient: "voucherClient";
            birthday: "birthday";
            dueDate: "dueDate";
            birthDate: "birthDate";
            serviceStatus: "serviceStatus";
            breastPump: "breastPump";
            areaId: "areaId";
        }>;
        status: z.ZodEnum<{
            confirmed: "confirmed";
            tentative: "tentative";
            missing: "missing";
            "confirmed-and-tentative": "confirmed-and-tentative";
        }>;
    }, z.core.$strict>>;
}, z.core.$strict>;
/** Structured, server-issued reference payload for `data-entity-select`. */
export declare const AgentEntitySelectPartSchema: z.ZodObject<{
    taskId: z.ZodUUID;
    choiceSetRef: z.ZodUUID;
    optionIds: z.ZodArray<z.ZodUUID>;
}, z.core.$strict>;
/**
 * Persisted chat parts carry only the server acceptance receipt reference.
 * Actual validated operations remain in the REST request contract.
 */
export declare const AgentTaskPatchPartSchema: z.ZodObject<{
    taskId: z.ZodUUID;
    eventId: z.ZodUUID;
    acceptedRevision: z.ZodNumber;
    currentSnapshotRef: z.ZodUUID;
}, z.core.$strict>;
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
