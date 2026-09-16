import { z } from "zod";
import { type AutomationConsentChoice, type ClientInputOperation, type ClientWriteFields } from "./client-input-policy";
export declare const AGENT_TASK_SCHEMA_VERSION: 1;
export declare const AgentTaskSchemaVersionSchema: z.ZodLiteral<1>;
export declare const AgentTaskStateSchema: z.ZodEnum<{
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
export type AgentTaskState = z.infer<typeof AgentTaskStateSchema>;
export declare const AgentTaskIdSchema: z.ZodString;
export declare const AgentTaskRevisionSchema: z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>;
export declare const AgentTaskEventIdSchema: z.ZodString;
export declare const AgentTaskEventHashSchema: z.ZodString;
export declare const AgentTaskSnapshotRefSchema: z.ZodString;
export declare const AgentTaskOpaqueRefSchema: z.ZodString;
export declare const AgentTaskIsoDateTimeSchema: z.ZodISODateTime;
export type AgentTaskRevision = z.infer<typeof AgentTaskRevisionSchema>;
export declare const AgentTaskSourceSchema: z.ZodEnum<{
    user: "user";
    wizard: "wizard";
    server: "server";
    lookup: "lookup";
    model: "model";
    system: "system";
}>;
export declare const AgentTaskFieldProvenanceSchema: z.ZodObject<{
    source: z.ZodEnum<{
        user: "user";
        wizard: "wizard";
        server: "server";
        lookup: "lookup";
        model: "model";
        system: "system";
    }>;
    capturedAt: z.ZodOptional<z.ZodISODateTime>;
    eventId: z.ZodOptional<z.ZodString>;
    valueRef: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const AgentTaskProvenanceSchema: z.ZodObject<{
    confirmed: z.ZodRecord<z.ZodString, z.ZodObject<{
        source: z.ZodEnum<{
            user: "user";
            wizard: "wizard";
            server: "server";
            lookup: "lookup";
            model: "model";
            system: "system";
        }>;
        capturedAt: z.ZodOptional<z.ZodISODateTime>;
        eventId: z.ZodOptional<z.ZodString>;
        valueRef: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
    tentative: z.ZodRecord<z.ZodString, z.ZodObject<{
        source: z.ZodEnum<{
            user: "user";
            wizard: "wizard";
            server: "server";
            lookup: "lookup";
            model: "model";
            system: "system";
        }>;
        capturedAt: z.ZodOptional<z.ZodISODateTime>;
        eventId: z.ZodOptional<z.ZodString>;
        valueRef: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const AgentTaskIssueSeveritySchema: z.ZodEnum<{
    error: "error";
    info: "info";
    warning: "warning";
}>;
export declare const AgentTaskIssueSchema: z.ZodObject<{
    code: z.ZodString;
    field: z.ZodOptional<z.ZodString>;
    severity: z.ZodEnum<{
        error: "error";
        info: "info";
        warning: "warning";
    }>;
    message: z.ZodString;
}, z.core.$strict>;
export declare const AgentTaskConstraintsSchema: z.ZodObject<{
    noSend: z.ZodBoolean;
    automationChoice: z.ZodEnum<{
        unanswered: "unanswered";
        yes: "yes";
        no: "no";
    }>;
}, z.core.$strict>;
export declare const AgentTaskTargetSchema: z.ZodObject<{
    targetRef: z.ZodString;
    version: z.ZodOptional<z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>>;
    targetVersion: z.ZodOptional<z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>>;
    choiceSetRef: z.ZodOptional<z.ZodString>;
    optionId: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export type AgentTaskTarget = z.infer<typeof AgentTaskTargetSchema>;
export declare const AgentTaskChoiceOptionSchema: z.ZodObject<{
    optionId: z.ZodString;
    label: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const AgentTaskChoiceSetSchema: z.ZodObject<{
    choiceSetRef: z.ZodString;
    options: z.ZodArray<z.ZodObject<{
        optionId: z.ZodString;
        label: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
    issuedAt: z.ZodOptional<z.ZodISODateTime>;
    expiresAt: z.ZodOptional<z.ZodISODateTime>;
}, z.core.$strict>;
export type AgentTaskChoiceSet = z.infer<typeof AgentTaskChoiceSetSchema>;
export declare const AgentTaskActionLinkSchema: z.ZodObject<{
    actionId: z.ZodString;
    expectedRevision: z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>;
    proposalRevision: z.ZodOptional<z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>>;
}, z.core.$strict>;
export declare const AgentTaskTimesSchema: z.ZodObject<{
    createdAt: z.ZodISODateTime;
    updatedAt: z.ZodISODateTime;
    acceptedAt: z.ZodOptional<z.ZodISODateTime>;
    pausedAt: z.ZodOptional<z.ZodISODateTime>;
    terminatedAt: z.ZodOptional<z.ZodISODateTime>;
    expiresAt: z.ZodOptional<z.ZodISODateTime>;
}, z.core.$strict>;
export declare const AgentAutomationConsentBindingSchema: z.ZodObject<{
    recipientRef: z.ZodString;
    effectDigest: z.ZodString;
    templateRef: z.ZodString;
    policyDigest: z.ZodString;
    consentEventId: z.ZodString;
}, z.core.$strict>;
export type AgentAutomationConsentBinding = z.infer<typeof AgentAutomationConsentBindingSchema>;
export declare const AgentAutomationConsentSchema: z.ZodObject<{
    choice: z.ZodEnum<{
        unanswered: "unanswered";
        yes: "yes";
        no: "no";
    }>;
    binding: z.ZodNullable<z.ZodObject<{
        recipientRef: z.ZodString;
        effectDigest: z.ZodString;
        templateRef: z.ZodString;
        policyDigest: z.ZodString;
        consentEventId: z.ZodString;
    }, z.core.$strict>>;
}, z.core.$strict>;
export declare const AgentAutomationConsentInputSchema: z.ZodObject<{
    choice: z.ZodEnum<{
        unanswered: "unanswered";
        yes: "yes";
        no: "no";
    }>;
}, z.core.$strict>;
export type AgentAutomationConsent = z.infer<typeof AgentAutomationConsentSchema>;
export declare const AgentTaskSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    taskId: z.ZodString;
    sessionId: z.ZodString;
    revision: z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>;
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
    confirmed: z.ZodObject<{
        name: z.ZodOptional<z.ZodString>;
        address: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        phone: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        duration: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        fullPrice: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        grant: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        actualPrice: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        startDate: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        endDate: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        careCenter: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
        voucherClient: z.ZodOptional<z.ZodBoolean>;
        birthday: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        dueDate: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        birthDate: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        serviceStatus: z.ZodOptional<z.ZodNullable<z.ZodEnum<{
            pre_booking: "pre_booking";
            waiting: "waiting";
            replacement_requested: "replacement_requested";
            active: "active";
            completed: "completed";
            terminated: "terminated";
        }>>>;
        breastPump: z.ZodOptional<z.ZodBoolean>;
        areaId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strict>;
    tentative: z.ZodObject<{
        name: z.ZodOptional<z.ZodString>;
        address: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        phone: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        duration: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        fullPrice: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        grant: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        actualPrice: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        startDate: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        endDate: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        careCenter: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
        voucherClient: z.ZodOptional<z.ZodBoolean>;
        birthday: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        dueDate: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        birthDate: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        serviceStatus: z.ZodOptional<z.ZodNullable<z.ZodEnum<{
            pre_booking: "pre_booking";
            waiting: "waiting";
            replacement_requested: "replacement_requested";
            active: "active";
            completed: "completed";
            terminated: "terminated";
        }>>>;
        breastPump: z.ZodOptional<z.ZodBoolean>;
        areaId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strict>;
    provenance: z.ZodObject<{
        confirmed: z.ZodRecord<z.ZodString, z.ZodObject<{
            source: z.ZodEnum<{
                user: "user";
                wizard: "wizard";
                server: "server";
                lookup: "lookup";
                model: "model";
                system: "system";
            }>;
            capturedAt: z.ZodOptional<z.ZodISODateTime>;
            eventId: z.ZodOptional<z.ZodString>;
            valueRef: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
        tentative: z.ZodRecord<z.ZodString, z.ZodObject<{
            source: z.ZodEnum<{
                user: "user";
                wizard: "wizard";
                server: "server";
                lookup: "lookup";
                model: "model";
                system: "system";
            }>;
            capturedAt: z.ZodOptional<z.ZodISODateTime>;
            eventId: z.ZodOptional<z.ZodString>;
            valueRef: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>;
    issues: z.ZodArray<z.ZodObject<{
        code: z.ZodString;
        field: z.ZodOptional<z.ZodString>;
        severity: z.ZodEnum<{
            error: "error";
            info: "info";
            warning: "warning";
        }>;
        message: z.ZodString;
    }, z.core.$strict>>;
    constraints: z.ZodObject<{
        noSend: z.ZodBoolean;
        automationChoice: z.ZodEnum<{
            unanswered: "unanswered";
            yes: "yes";
            no: "no";
        }>;
    }, z.core.$strict>;
    choiceSets: z.ZodArray<z.ZodObject<{
        choiceSetRef: z.ZodString;
        options: z.ZodArray<z.ZodObject<{
            optionId: z.ZodString;
            label: z.ZodString;
            description: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
        issuedAt: z.ZodOptional<z.ZodISODateTime>;
        expiresAt: z.ZodOptional<z.ZodISODateTime>;
    }, z.core.$strict>>;
    orderedChoiceRefs: z.ZodArray<z.ZodString>;
    target: z.ZodNullable<z.ZodObject<{
        targetRef: z.ZodString;
        version: z.ZodOptional<z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>>;
        targetVersion: z.ZodOptional<z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>>;
        choiceSetRef: z.ZodOptional<z.ZodString>;
        optionId: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
    consent: z.ZodObject<{
        choice: z.ZodEnum<{
            unanswered: "unanswered";
            yes: "yes";
            no: "no";
        }>;
        binding: z.ZodNullable<z.ZodObject<{
            recipientRef: z.ZodString;
            effectDigest: z.ZodString;
            templateRef: z.ZodString;
            policyDigest: z.ZodString;
            consentEventId: z.ZodString;
        }, z.core.$strict>>;
    }, z.core.$strict>;
    action: z.ZodNullable<z.ZodObject<{
        actionId: z.ZodString;
        expectedRevision: z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>;
        proposalRevision: z.ZodOptional<z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>>;
    }, z.core.$strict>>;
    times: z.ZodObject<{
        createdAt: z.ZodISODateTime;
        updatedAt: z.ZodISODateTime;
        acceptedAt: z.ZodOptional<z.ZodISODateTime>;
        pausedAt: z.ZodOptional<z.ZodISODateTime>;
        terminatedAt: z.ZodOptional<z.ZodISODateTime>;
        expiresAt: z.ZodOptional<z.ZodISODateTime>;
    }, z.core.$strict>;
    currentSnapshotRef: z.ZodString;
}, z.core.$strict>;
export type AgentTask = z.infer<typeof AgentTaskSchema>;
export declare const AgentTaskCreateRequestSchema: z.ZodObject<{
    schemaVersion: z.ZodOptional<z.ZodLiteral<1>>;
    clientEventId: z.ZodString;
    operations: z.ZodDefault<z.ZodArray<z.ZodType<ClientInputOperation, unknown, z.core.$ZodTypeInternals<ClientInputOperation, unknown>>>>;
}, z.core.$strict>;
export type AgentTaskCreateRequest = z.infer<typeof AgentTaskCreateRequestSchema>;
export declare const AgentTaskPatchRequestSchema: z.ZodObject<{
    clientEventId: z.ZodString;
    expectedRevision: z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>;
    operations: z.ZodArray<z.ZodType<ClientInputOperation, unknown, z.core.$ZodTypeInternals<ClientInputOperation, unknown>>>;
}, z.core.$strict>;
export type AgentTaskPatchRequest = z.infer<typeof AgentTaskPatchRequestSchema>;
export declare const AgentTaskSelectTargetCommandSchema: z.ZodUnion<readonly [z.ZodObject<{
    command: z.ZodLiteral<"select-target">;
    choiceSetId: z.ZodString;
    optionId: z.ZodString;
    clientEventId: z.ZodString;
    expectedRevision: z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>;
}, z.core.$strict>, z.ZodObject<{
    command: z.ZodLiteral<"select-target">;
    choiceSetRef: z.ZodString;
    optionId: z.ZodString;
    clientEventId: z.ZodString;
    expectedRevision: z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>;
}, z.core.$strict>]>;
export declare const AgentTaskCommandRequestSchema: z.ZodUnion<readonly [z.ZodUnion<readonly [z.ZodObject<{
    command: z.ZodLiteral<"select-target">;
    choiceSetId: z.ZodString;
    optionId: z.ZodString;
    clientEventId: z.ZodString;
    expectedRevision: z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>;
}, z.core.$strict>, z.ZodObject<{
    command: z.ZodLiteral<"select-target">;
    choiceSetRef: z.ZodString;
    optionId: z.ZodString;
    clientEventId: z.ZodString;
    expectedRevision: z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>;
}, z.core.$strict>]>, z.ZodObject<{
    command: z.ZodLiteral<"pause">;
    clientEventId: z.ZodString;
    expectedRevision: z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>;
}, z.core.$strict>, z.ZodObject<{
    command: z.ZodLiteral<"resume">;
    clientEventId: z.ZodString;
    expectedRevision: z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>;
}, z.core.$strict>, z.ZodObject<{
    command: z.ZodLiteral<"prepare-review">;
    clientEventId: z.ZodString;
    expectedRevision: z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>;
}, z.core.$strict>, z.ZodObject<{
    command: z.ZodLiteral<"cancel">;
    clientEventId: z.ZodString;
    expectedRevision: z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>;
}, z.core.$strict>]>;
export type AgentTaskCommandRequest = z.infer<typeof AgentTaskCommandRequestSchema>;
export declare const AgentTaskCommandNameSchema: z.ZodEnum<{
    "select-target": "select-target";
    pause: "pause";
    resume: "resume";
    "prepare-review": "prepare-review";
    cancel: "cancel";
}>;
export type AgentTaskCommandName = z.infer<typeof AgentTaskCommandNameSchema>;
export declare const AgentTaskEventReceiptSchema: z.ZodObject<{
    taskId: z.ZodString;
    eventId: z.ZodString;
    eventHash: z.ZodString;
    acceptedRevision: z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>;
    currentSnapshotRef: z.ZodString;
}, z.core.$strict>;
export type AgentTaskEventReceipt = z.infer<typeof AgentTaskEventReceiptSchema>;
export declare const AgentTaskMutationResponseSchema: z.ZodObject<{
    receipt: z.ZodObject<{
        taskId: z.ZodString;
        eventId: z.ZodString;
        eventHash: z.ZodString;
        acceptedRevision: z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>;
        currentSnapshotRef: z.ZodString;
    }, z.core.$strict>;
    snapshot: z.ZodObject<{
        schemaVersion: z.ZodLiteral<1>;
        taskId: z.ZodString;
        sessionId: z.ZodString;
        revision: z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>;
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
        confirmed: z.ZodObject<{
            name: z.ZodOptional<z.ZodString>;
            address: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            phone: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            duration: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            fullPrice: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            grant: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            actualPrice: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            startDate: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            endDate: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            careCenter: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
            voucherClient: z.ZodOptional<z.ZodBoolean>;
            birthday: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            dueDate: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            birthDate: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            serviceStatus: z.ZodOptional<z.ZodNullable<z.ZodEnum<{
                pre_booking: "pre_booking";
                waiting: "waiting";
                replacement_requested: "replacement_requested";
                active: "active";
                completed: "completed";
                terminated: "terminated";
            }>>>;
            breastPump: z.ZodOptional<z.ZodBoolean>;
            areaId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, z.core.$strict>;
        tentative: z.ZodObject<{
            name: z.ZodOptional<z.ZodString>;
            address: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            phone: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            duration: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            fullPrice: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            grant: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            actualPrice: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            startDate: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            endDate: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            careCenter: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
            voucherClient: z.ZodOptional<z.ZodBoolean>;
            birthday: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            dueDate: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            birthDate: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            serviceStatus: z.ZodOptional<z.ZodNullable<z.ZodEnum<{
                pre_booking: "pre_booking";
                waiting: "waiting";
                replacement_requested: "replacement_requested";
                active: "active";
                completed: "completed";
                terminated: "terminated";
            }>>>;
            breastPump: z.ZodOptional<z.ZodBoolean>;
            areaId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, z.core.$strict>;
        provenance: z.ZodObject<{
            confirmed: z.ZodRecord<z.ZodString, z.ZodObject<{
                source: z.ZodEnum<{
                    user: "user";
                    wizard: "wizard";
                    server: "server";
                    lookup: "lookup";
                    model: "model";
                    system: "system";
                }>;
                capturedAt: z.ZodOptional<z.ZodISODateTime>;
                eventId: z.ZodOptional<z.ZodString>;
                valueRef: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
            tentative: z.ZodRecord<z.ZodString, z.ZodObject<{
                source: z.ZodEnum<{
                    user: "user";
                    wizard: "wizard";
                    server: "server";
                    lookup: "lookup";
                    model: "model";
                    system: "system";
                }>;
                capturedAt: z.ZodOptional<z.ZodISODateTime>;
                eventId: z.ZodOptional<z.ZodString>;
                valueRef: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
        }, z.core.$strict>;
        issues: z.ZodArray<z.ZodObject<{
            code: z.ZodString;
            field: z.ZodOptional<z.ZodString>;
            severity: z.ZodEnum<{
                error: "error";
                info: "info";
                warning: "warning";
            }>;
            message: z.ZodString;
        }, z.core.$strict>>;
        constraints: z.ZodObject<{
            noSend: z.ZodBoolean;
            automationChoice: z.ZodEnum<{
                unanswered: "unanswered";
                yes: "yes";
                no: "no";
            }>;
        }, z.core.$strict>;
        choiceSets: z.ZodArray<z.ZodObject<{
            choiceSetRef: z.ZodString;
            options: z.ZodArray<z.ZodObject<{
                optionId: z.ZodString;
                label: z.ZodString;
                description: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
            issuedAt: z.ZodOptional<z.ZodISODateTime>;
            expiresAt: z.ZodOptional<z.ZodISODateTime>;
        }, z.core.$strict>>;
        orderedChoiceRefs: z.ZodArray<z.ZodString>;
        target: z.ZodNullable<z.ZodObject<{
            targetRef: z.ZodString;
            version: z.ZodOptional<z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>>;
            targetVersion: z.ZodOptional<z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>>;
            choiceSetRef: z.ZodOptional<z.ZodString>;
            optionId: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
        consent: z.ZodObject<{
            choice: z.ZodEnum<{
                unanswered: "unanswered";
                yes: "yes";
                no: "no";
            }>;
            binding: z.ZodNullable<z.ZodObject<{
                recipientRef: z.ZodString;
                effectDigest: z.ZodString;
                templateRef: z.ZodString;
                policyDigest: z.ZodString;
                consentEventId: z.ZodString;
            }, z.core.$strict>>;
        }, z.core.$strict>;
        action: z.ZodNullable<z.ZodObject<{
            actionId: z.ZodString;
            expectedRevision: z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>;
            proposalRevision: z.ZodOptional<z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>>;
        }, z.core.$strict>>;
        times: z.ZodObject<{
            createdAt: z.ZodISODateTime;
            updatedAt: z.ZodISODateTime;
            acceptedAt: z.ZodOptional<z.ZodISODateTime>;
            pausedAt: z.ZodOptional<z.ZodISODateTime>;
            terminatedAt: z.ZodOptional<z.ZodISODateTime>;
            expiresAt: z.ZodOptional<z.ZodISODateTime>;
        }, z.core.$strict>;
        currentSnapshotRef: z.ZodString;
    }, z.core.$strict>;
}, z.core.$strict>;
export type AgentTaskMutationResponse = z.infer<typeof AgentTaskMutationResponseSchema>;
/**
 * Build the initial state used by POST.  Defaults are intentionally kept out
 * of PATCH: an omitted update field must preserve its current value.
 */
export declare function createAgentTaskDefaults(): Pick<ClientWriteFields, "voucherClient" | "serviceStatus">;
export declare const createTaskDefaults: typeof createAgentTaskDefaults;
export type AgentTaskClientOperation = ClientInputOperation;
export type AgentTaskAutomationChoice = AutomationConsentChoice;
export declare const AgentTaskAutomationChoiceSchema: z.ZodEnum<{
    unanswered: "unanswered";
    yes: "yes";
    no: "no";
}>;
export declare const AgentTaskAutomationChoices: readonly ["unanswered", "yes", "no"];
export declare const CreateAgentTaskRequestSchema: z.ZodObject<{
    schemaVersion: z.ZodOptional<z.ZodLiteral<1>>;
    clientEventId: z.ZodString;
    operations: z.ZodDefault<z.ZodArray<z.ZodType<ClientInputOperation, unknown, z.core.$ZodTypeInternals<ClientInputOperation, unknown>>>>;
}, z.core.$strict>;
export declare const PatchAgentTaskRequestSchema: z.ZodObject<{
    clientEventId: z.ZodString;
    expectedRevision: z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>;
    operations: z.ZodArray<z.ZodType<ClientInputOperation, unknown, z.core.$ZodTypeInternals<ClientInputOperation, unknown>>>;
}, z.core.$strict>;
export declare const AgentTaskUpdateRequestSchema: z.ZodObject<{
    clientEventId: z.ZodString;
    expectedRevision: z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>;
    operations: z.ZodArray<z.ZodType<ClientInputOperation, unknown, z.core.$ZodTypeInternals<ClientInputOperation, unknown>>>;
}, z.core.$strict>;
export declare const AgentTaskCreateSchema: z.ZodObject<{
    schemaVersion: z.ZodOptional<z.ZodLiteral<1>>;
    clientEventId: z.ZodString;
    operations: z.ZodDefault<z.ZodArray<z.ZodType<ClientInputOperation, unknown, z.core.$ZodTypeInternals<ClientInputOperation, unknown>>>>;
}, z.core.$strict>;
export declare const AgentTaskPatchSchema: z.ZodObject<{
    clientEventId: z.ZodString;
    expectedRevision: z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>;
    operations: z.ZodArray<z.ZodType<ClientInputOperation, unknown, z.core.$ZodTypeInternals<ClientInputOperation, unknown>>>;
}, z.core.$strict>;
export declare const AgentTaskUpdateSchema: z.ZodObject<{
    clientEventId: z.ZodString;
    expectedRevision: z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>;
    operations: z.ZodArray<z.ZodType<ClientInputOperation, unknown, z.core.$ZodTypeInternals<ClientInputOperation, unknown>>>;
}, z.core.$strict>;
export declare const AgentTaskCommandSchema: z.ZodUnion<readonly [z.ZodUnion<readonly [z.ZodObject<{
    command: z.ZodLiteral<"select-target">;
    choiceSetId: z.ZodString;
    optionId: z.ZodString;
    clientEventId: z.ZodString;
    expectedRevision: z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>;
}, z.core.$strict>, z.ZodObject<{
    command: z.ZodLiteral<"select-target">;
    choiceSetRef: z.ZodString;
    optionId: z.ZodString;
    clientEventId: z.ZodString;
    expectedRevision: z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>;
}, z.core.$strict>]>, z.ZodObject<{
    command: z.ZodLiteral<"pause">;
    clientEventId: z.ZodString;
    expectedRevision: z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>;
}, z.core.$strict>, z.ZodObject<{
    command: z.ZodLiteral<"resume">;
    clientEventId: z.ZodString;
    expectedRevision: z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>;
}, z.core.$strict>, z.ZodObject<{
    command: z.ZodLiteral<"prepare-review">;
    clientEventId: z.ZodString;
    expectedRevision: z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>;
}, z.core.$strict>, z.ZodObject<{
    command: z.ZodLiteral<"cancel">;
    clientEventId: z.ZodString;
    expectedRevision: z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>;
}, z.core.$strict>]>;
export declare const AgentTaskCommandInputSchema: z.ZodUnion<readonly [z.ZodUnion<readonly [z.ZodObject<{
    command: z.ZodLiteral<"select-target">;
    choiceSetId: z.ZodString;
    optionId: z.ZodString;
    clientEventId: z.ZodString;
    expectedRevision: z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>;
}, z.core.$strict>, z.ZodObject<{
    command: z.ZodLiteral<"select-target">;
    choiceSetRef: z.ZodString;
    optionId: z.ZodString;
    clientEventId: z.ZodString;
    expectedRevision: z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>;
}, z.core.$strict>]>, z.ZodObject<{
    command: z.ZodLiteral<"pause">;
    clientEventId: z.ZodString;
    expectedRevision: z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>;
}, z.core.$strict>, z.ZodObject<{
    command: z.ZodLiteral<"resume">;
    clientEventId: z.ZodString;
    expectedRevision: z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>;
}, z.core.$strict>, z.ZodObject<{
    command: z.ZodLiteral<"prepare-review">;
    clientEventId: z.ZodString;
    expectedRevision: z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>;
}, z.core.$strict>, z.ZodObject<{
    command: z.ZodLiteral<"cancel">;
    clientEventId: z.ZodString;
    expectedRevision: z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>;
}, z.core.$strict>]>;
export declare const TaskCreateRequestSchema: z.ZodObject<{
    schemaVersion: z.ZodOptional<z.ZodLiteral<1>>;
    clientEventId: z.ZodString;
    operations: z.ZodDefault<z.ZodArray<z.ZodType<ClientInputOperation, unknown, z.core.$ZodTypeInternals<ClientInputOperation, unknown>>>>;
}, z.core.$strict>;
export declare const TaskUpdateRequestSchema: z.ZodObject<{
    clientEventId: z.ZodString;
    expectedRevision: z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>;
    operations: z.ZodArray<z.ZodType<ClientInputOperation, unknown, z.core.$ZodTypeInternals<ClientInputOperation, unknown>>>;
}, z.core.$strict>;
export declare const TaskCommandRequestSchema: z.ZodUnion<readonly [z.ZodUnion<readonly [z.ZodObject<{
    command: z.ZodLiteral<"select-target">;
    choiceSetId: z.ZodString;
    optionId: z.ZodString;
    clientEventId: z.ZodString;
    expectedRevision: z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>;
}, z.core.$strict>, z.ZodObject<{
    command: z.ZodLiteral<"select-target">;
    choiceSetRef: z.ZodString;
    optionId: z.ZodString;
    clientEventId: z.ZodString;
    expectedRevision: z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>;
}, z.core.$strict>]>, z.ZodObject<{
    command: z.ZodLiteral<"pause">;
    clientEventId: z.ZodString;
    expectedRevision: z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>;
}, z.core.$strict>, z.ZodObject<{
    command: z.ZodLiteral<"resume">;
    clientEventId: z.ZodString;
    expectedRevision: z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>;
}, z.core.$strict>, z.ZodObject<{
    command: z.ZodLiteral<"prepare-review">;
    clientEventId: z.ZodString;
    expectedRevision: z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>;
}, z.core.$strict>, z.ZodObject<{
    command: z.ZodLiteral<"cancel">;
    clientEventId: z.ZodString;
    expectedRevision: z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>;
}, z.core.$strict>]>;
export declare const AgentTaskSnapshotSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    taskId: z.ZodString;
    sessionId: z.ZodString;
    revision: z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>;
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
    confirmed: z.ZodObject<{
        name: z.ZodOptional<z.ZodString>;
        address: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        phone: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        duration: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        fullPrice: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        grant: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        actualPrice: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        startDate: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        endDate: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        careCenter: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
        voucherClient: z.ZodOptional<z.ZodBoolean>;
        birthday: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        dueDate: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        birthDate: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        serviceStatus: z.ZodOptional<z.ZodNullable<z.ZodEnum<{
            pre_booking: "pre_booking";
            waiting: "waiting";
            replacement_requested: "replacement_requested";
            active: "active";
            completed: "completed";
            terminated: "terminated";
        }>>>;
        breastPump: z.ZodOptional<z.ZodBoolean>;
        areaId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strict>;
    tentative: z.ZodObject<{
        name: z.ZodOptional<z.ZodString>;
        address: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        phone: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        duration: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        fullPrice: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        grant: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        actualPrice: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        startDate: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        endDate: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        careCenter: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
        voucherClient: z.ZodOptional<z.ZodBoolean>;
        birthday: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        dueDate: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        birthDate: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        serviceStatus: z.ZodOptional<z.ZodNullable<z.ZodEnum<{
            pre_booking: "pre_booking";
            waiting: "waiting";
            replacement_requested: "replacement_requested";
            active: "active";
            completed: "completed";
            terminated: "terminated";
        }>>>;
        breastPump: z.ZodOptional<z.ZodBoolean>;
        areaId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strict>;
    provenance: z.ZodObject<{
        confirmed: z.ZodRecord<z.ZodString, z.ZodObject<{
            source: z.ZodEnum<{
                user: "user";
                wizard: "wizard";
                server: "server";
                lookup: "lookup";
                model: "model";
                system: "system";
            }>;
            capturedAt: z.ZodOptional<z.ZodISODateTime>;
            eventId: z.ZodOptional<z.ZodString>;
            valueRef: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
        tentative: z.ZodRecord<z.ZodString, z.ZodObject<{
            source: z.ZodEnum<{
                user: "user";
                wizard: "wizard";
                server: "server";
                lookup: "lookup";
                model: "model";
                system: "system";
            }>;
            capturedAt: z.ZodOptional<z.ZodISODateTime>;
            eventId: z.ZodOptional<z.ZodString>;
            valueRef: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>;
    issues: z.ZodArray<z.ZodObject<{
        code: z.ZodString;
        field: z.ZodOptional<z.ZodString>;
        severity: z.ZodEnum<{
            error: "error";
            info: "info";
            warning: "warning";
        }>;
        message: z.ZodString;
    }, z.core.$strict>>;
    constraints: z.ZodObject<{
        noSend: z.ZodBoolean;
        automationChoice: z.ZodEnum<{
            unanswered: "unanswered";
            yes: "yes";
            no: "no";
        }>;
    }, z.core.$strict>;
    choiceSets: z.ZodArray<z.ZodObject<{
        choiceSetRef: z.ZodString;
        options: z.ZodArray<z.ZodObject<{
            optionId: z.ZodString;
            label: z.ZodString;
            description: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
        issuedAt: z.ZodOptional<z.ZodISODateTime>;
        expiresAt: z.ZodOptional<z.ZodISODateTime>;
    }, z.core.$strict>>;
    orderedChoiceRefs: z.ZodArray<z.ZodString>;
    target: z.ZodNullable<z.ZodObject<{
        targetRef: z.ZodString;
        version: z.ZodOptional<z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>>;
        targetVersion: z.ZodOptional<z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>>;
        choiceSetRef: z.ZodOptional<z.ZodString>;
        optionId: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
    consent: z.ZodObject<{
        choice: z.ZodEnum<{
            unanswered: "unanswered";
            yes: "yes";
            no: "no";
        }>;
        binding: z.ZodNullable<z.ZodObject<{
            recipientRef: z.ZodString;
            effectDigest: z.ZodString;
            templateRef: z.ZodString;
            policyDigest: z.ZodString;
            consentEventId: z.ZodString;
        }, z.core.$strict>>;
    }, z.core.$strict>;
    action: z.ZodNullable<z.ZodObject<{
        actionId: z.ZodString;
        expectedRevision: z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>;
        proposalRevision: z.ZodOptional<z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>>;
    }, z.core.$strict>>;
    times: z.ZodObject<{
        createdAt: z.ZodISODateTime;
        updatedAt: z.ZodISODateTime;
        acceptedAt: z.ZodOptional<z.ZodISODateTime>;
        pausedAt: z.ZodOptional<z.ZodISODateTime>;
        terminatedAt: z.ZodOptional<z.ZodISODateTime>;
        expiresAt: z.ZodOptional<z.ZodISODateTime>;
    }, z.core.$strict>;
    currentSnapshotRef: z.ZodString;
}, z.core.$strict>;
export declare const AgentTaskRestSnapshotSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    taskId: z.ZodString;
    sessionId: z.ZodString;
    revision: z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>;
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
    confirmed: z.ZodObject<{
        name: z.ZodOptional<z.ZodString>;
        address: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        phone: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        duration: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        fullPrice: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        grant: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        actualPrice: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        startDate: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        endDate: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        careCenter: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
        voucherClient: z.ZodOptional<z.ZodBoolean>;
        birthday: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        dueDate: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        birthDate: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        serviceStatus: z.ZodOptional<z.ZodNullable<z.ZodEnum<{
            pre_booking: "pre_booking";
            waiting: "waiting";
            replacement_requested: "replacement_requested";
            active: "active";
            completed: "completed";
            terminated: "terminated";
        }>>>;
        breastPump: z.ZodOptional<z.ZodBoolean>;
        areaId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strict>;
    tentative: z.ZodObject<{
        name: z.ZodOptional<z.ZodString>;
        address: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        phone: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        duration: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        fullPrice: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        grant: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        actualPrice: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        startDate: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        endDate: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        careCenter: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
        voucherClient: z.ZodOptional<z.ZodBoolean>;
        birthday: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        dueDate: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        birthDate: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        serviceStatus: z.ZodOptional<z.ZodNullable<z.ZodEnum<{
            pre_booking: "pre_booking";
            waiting: "waiting";
            replacement_requested: "replacement_requested";
            active: "active";
            completed: "completed";
            terminated: "terminated";
        }>>>;
        breastPump: z.ZodOptional<z.ZodBoolean>;
        areaId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strict>;
    provenance: z.ZodObject<{
        confirmed: z.ZodRecord<z.ZodString, z.ZodObject<{
            source: z.ZodEnum<{
                user: "user";
                wizard: "wizard";
                server: "server";
                lookup: "lookup";
                model: "model";
                system: "system";
            }>;
            capturedAt: z.ZodOptional<z.ZodISODateTime>;
            eventId: z.ZodOptional<z.ZodString>;
            valueRef: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
        tentative: z.ZodRecord<z.ZodString, z.ZodObject<{
            source: z.ZodEnum<{
                user: "user";
                wizard: "wizard";
                server: "server";
                lookup: "lookup";
                model: "model";
                system: "system";
            }>;
            capturedAt: z.ZodOptional<z.ZodISODateTime>;
            eventId: z.ZodOptional<z.ZodString>;
            valueRef: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>;
    issues: z.ZodArray<z.ZodObject<{
        code: z.ZodString;
        field: z.ZodOptional<z.ZodString>;
        severity: z.ZodEnum<{
            error: "error";
            info: "info";
            warning: "warning";
        }>;
        message: z.ZodString;
    }, z.core.$strict>>;
    constraints: z.ZodObject<{
        noSend: z.ZodBoolean;
        automationChoice: z.ZodEnum<{
            unanswered: "unanswered";
            yes: "yes";
            no: "no";
        }>;
    }, z.core.$strict>;
    choiceSets: z.ZodArray<z.ZodObject<{
        choiceSetRef: z.ZodString;
        options: z.ZodArray<z.ZodObject<{
            optionId: z.ZodString;
            label: z.ZodString;
            description: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
        issuedAt: z.ZodOptional<z.ZodISODateTime>;
        expiresAt: z.ZodOptional<z.ZodISODateTime>;
    }, z.core.$strict>>;
    orderedChoiceRefs: z.ZodArray<z.ZodString>;
    target: z.ZodNullable<z.ZodObject<{
        targetRef: z.ZodString;
        version: z.ZodOptional<z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>>;
        targetVersion: z.ZodOptional<z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>>;
        choiceSetRef: z.ZodOptional<z.ZodString>;
        optionId: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
    consent: z.ZodObject<{
        choice: z.ZodEnum<{
            unanswered: "unanswered";
            yes: "yes";
            no: "no";
        }>;
        binding: z.ZodNullable<z.ZodObject<{
            recipientRef: z.ZodString;
            effectDigest: z.ZodString;
            templateRef: z.ZodString;
            policyDigest: z.ZodString;
            consentEventId: z.ZodString;
        }, z.core.$strict>>;
    }, z.core.$strict>;
    action: z.ZodNullable<z.ZodObject<{
        actionId: z.ZodString;
        expectedRevision: z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>;
        proposalRevision: z.ZodOptional<z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>>;
    }, z.core.$strict>>;
    times: z.ZodObject<{
        createdAt: z.ZodISODateTime;
        updatedAt: z.ZodISODateTime;
        acceptedAt: z.ZodOptional<z.ZodISODateTime>;
        pausedAt: z.ZodOptional<z.ZodISODateTime>;
        terminatedAt: z.ZodOptional<z.ZodISODateTime>;
        expiresAt: z.ZodOptional<z.ZodISODateTime>;
    }, z.core.$strict>;
    currentSnapshotRef: z.ZodString;
}, z.core.$strict>;
export declare const TaskSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    taskId: z.ZodString;
    sessionId: z.ZodString;
    revision: z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>;
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
    confirmed: z.ZodObject<{
        name: z.ZodOptional<z.ZodString>;
        address: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        phone: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        duration: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        fullPrice: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        grant: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        actualPrice: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        startDate: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        endDate: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        careCenter: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
        voucherClient: z.ZodOptional<z.ZodBoolean>;
        birthday: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        dueDate: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        birthDate: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        serviceStatus: z.ZodOptional<z.ZodNullable<z.ZodEnum<{
            pre_booking: "pre_booking";
            waiting: "waiting";
            replacement_requested: "replacement_requested";
            active: "active";
            completed: "completed";
            terminated: "terminated";
        }>>>;
        breastPump: z.ZodOptional<z.ZodBoolean>;
        areaId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strict>;
    tentative: z.ZodObject<{
        name: z.ZodOptional<z.ZodString>;
        address: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        phone: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        duration: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        fullPrice: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        grant: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        actualPrice: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        startDate: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        endDate: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        careCenter: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
        voucherClient: z.ZodOptional<z.ZodBoolean>;
        birthday: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        dueDate: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        birthDate: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        serviceStatus: z.ZodOptional<z.ZodNullable<z.ZodEnum<{
            pre_booking: "pre_booking";
            waiting: "waiting";
            replacement_requested: "replacement_requested";
            active: "active";
            completed: "completed";
            terminated: "terminated";
        }>>>;
        breastPump: z.ZodOptional<z.ZodBoolean>;
        areaId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strict>;
    provenance: z.ZodObject<{
        confirmed: z.ZodRecord<z.ZodString, z.ZodObject<{
            source: z.ZodEnum<{
                user: "user";
                wizard: "wizard";
                server: "server";
                lookup: "lookup";
                model: "model";
                system: "system";
            }>;
            capturedAt: z.ZodOptional<z.ZodISODateTime>;
            eventId: z.ZodOptional<z.ZodString>;
            valueRef: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
        tentative: z.ZodRecord<z.ZodString, z.ZodObject<{
            source: z.ZodEnum<{
                user: "user";
                wizard: "wizard";
                server: "server";
                lookup: "lookup";
                model: "model";
                system: "system";
            }>;
            capturedAt: z.ZodOptional<z.ZodISODateTime>;
            eventId: z.ZodOptional<z.ZodString>;
            valueRef: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
    }, z.core.$strict>;
    issues: z.ZodArray<z.ZodObject<{
        code: z.ZodString;
        field: z.ZodOptional<z.ZodString>;
        severity: z.ZodEnum<{
            error: "error";
            info: "info";
            warning: "warning";
        }>;
        message: z.ZodString;
    }, z.core.$strict>>;
    constraints: z.ZodObject<{
        noSend: z.ZodBoolean;
        automationChoice: z.ZodEnum<{
            unanswered: "unanswered";
            yes: "yes";
            no: "no";
        }>;
    }, z.core.$strict>;
    choiceSets: z.ZodArray<z.ZodObject<{
        choiceSetRef: z.ZodString;
        options: z.ZodArray<z.ZodObject<{
            optionId: z.ZodString;
            label: z.ZodString;
            description: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
        issuedAt: z.ZodOptional<z.ZodISODateTime>;
        expiresAt: z.ZodOptional<z.ZodISODateTime>;
    }, z.core.$strict>>;
    orderedChoiceRefs: z.ZodArray<z.ZodString>;
    target: z.ZodNullable<z.ZodObject<{
        targetRef: z.ZodString;
        version: z.ZodOptional<z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>>;
        targetVersion: z.ZodOptional<z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>>;
        choiceSetRef: z.ZodOptional<z.ZodString>;
        optionId: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
    consent: z.ZodObject<{
        choice: z.ZodEnum<{
            unanswered: "unanswered";
            yes: "yes";
            no: "no";
        }>;
        binding: z.ZodNullable<z.ZodObject<{
            recipientRef: z.ZodString;
            effectDigest: z.ZodString;
            templateRef: z.ZodString;
            policyDigest: z.ZodString;
            consentEventId: z.ZodString;
        }, z.core.$strict>>;
    }, z.core.$strict>;
    action: z.ZodNullable<z.ZodObject<{
        actionId: z.ZodString;
        expectedRevision: z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>;
        proposalRevision: z.ZodOptional<z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>>;
    }, z.core.$strict>>;
    times: z.ZodObject<{
        createdAt: z.ZodISODateTime;
        updatedAt: z.ZodISODateTime;
        acceptedAt: z.ZodOptional<z.ZodISODateTime>;
        pausedAt: z.ZodOptional<z.ZodISODateTime>;
        terminatedAt: z.ZodOptional<z.ZodISODateTime>;
        expiresAt: z.ZodOptional<z.ZodISODateTime>;
    }, z.core.$strict>;
    currentSnapshotRef: z.ZodString;
}, z.core.$strict>;
export declare const TaskEventReceiptSchema: z.ZodObject<{
    taskId: z.ZodString;
    eventId: z.ZodString;
    eventHash: z.ZodString;
    acceptedRevision: z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>;
    currentSnapshotRef: z.ZodString;
}, z.core.$strict>;
