import { z } from "zod";
import { type ClientWriteFields } from "./client-input-policy";
export declare const AGENT_TASK_SCHEMA_VERSION: 1;
export declare const AgentTaskSchemaVersionSchema: z.ZodLiteral<1>;
export declare const AgentTaskCapabilityIdSchema: z.ZodEnum<{
    "clients.create": "clients.create";
    "clients.update": "clients.update";
}>;
export declare const AgentTaskKindSchema: z.ZodEnum<{
    "clients.create": "clients.create";
    "clients.update": "clients.update";
}>;
export type AgentTaskCapabilityId = z.infer<typeof AgentTaskCapabilityIdSchema>;
export type AgentTaskKind = z.infer<typeof AgentTaskKindSchema>;
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
/**
 * Session restore classification is deliberately independent from recovery
 * task discovery.  A session may be available, archived, or expired while
 * still exposing separately scoped unresolved task evidence.
 */
export declare const AgentTaskRestoreStatusSchema: z.ZodEnum<{
    available: "available";
    session_archived: "session_archived";
    session_expired: "session_expired";
}>;
export type AgentTaskRestoreStatus = z.infer<typeof AgentTaskRestoreStatusSchema>;
/** Task revisions are persistence-safe ordered values, unlike action tokens. */
export declare const AgentTaskRevisionSchema: z.ZodNumber;
export type AgentTaskRevision = z.infer<typeof AgentTaskRevisionSchema>;
export declare const AgentActionRevisionTokenSchema: z.ZodString;
/** Server-issued/client-generated references are UUIDs, never display text. */
export declare const AgentTaskReferenceSchema: z.ZodUUID;
export declare const AgentTaskIdSchema: z.ZodUUID;
export declare const AgentTaskEventIdSchema: z.ZodUUID;
export declare const AgentTaskSnapshotRefSchema: z.ZodUUID;
export declare const AgentTaskEventHashSchema: z.ZodString;
export declare const AgentTaskIsoDateTimeSchema: z.ZodISODateTime;
/**
 * A server-issued rendering hint used to interpret ordinal/choice replies.
 * The hint is advisory: ownership and freshness are rechecked against the
 * current task before a selection is accepted.
 */
export declare const AgentTaskDisplayedChoiceHintSchema: z.ZodObject<{
    taskId: z.ZodUUID;
    choiceSetRef: z.ZodUUID;
    revision: z.ZodNumber;
}, z.core.$strict>;
export type AgentTaskDisplayedChoiceHint = z.infer<typeof AgentTaskDisplayedChoiceHintSchema>;
/** Short alias retained for callers that name the rendered value directly. */
export declare const AgentDisplayedChoiceHintSchema: z.ZodObject<{
    taskId: z.ZodUUID;
    choiceSetRef: z.ZodUUID;
    revision: z.ZodNumber;
}, z.core.$strict>;
export type AgentDisplayedChoiceHint = AgentTaskDisplayedChoiceHint;
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
    eventId: z.ZodOptional<z.ZodUUID>;
    valueRef: z.ZodOptional<z.ZodUUID>;
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
        eventId: z.ZodOptional<z.ZodUUID>;
        valueRef: z.ZodOptional<z.ZodUUID>;
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
        eventId: z.ZodOptional<z.ZodUUID>;
        valueRef: z.ZodOptional<z.ZodUUID>;
    }, z.core.$strict>>;
}, z.core.$strict>;
/**
 * Issue codes are structural and intentionally finite. They are safe to copy
 * into model/chat projections because no user-provided value can become a
 * code accidentally (for example a phone number or birthday).
 */
export declare const AGENT_TASK_ISSUE_CODES: readonly ["task.required", "task.invalid", "task.duplicate", "task.ambiguous", "task.stale", "task.consent_required"];
export declare const AgentTaskIssueCodeSchema: z.ZodEnum<{
    "task.required": "task.required";
    "task.invalid": "task.invalid";
    "task.duplicate": "task.duplicate";
    "task.ambiguous": "task.ambiguous";
    "task.stale": "task.stale";
    "task.consent_required": "task.consent_required";
}>;
export declare const AgentTaskIssueSeveritySchema: z.ZodEnum<{
    error: "error";
    info: "info";
    warning: "warning";
}>;
export declare const AgentTaskIssueSchema: z.ZodObject<{
    code: z.ZodEnum<{
        "task.required": "task.required";
        "task.invalid": "task.invalid";
        "task.duplicate": "task.duplicate";
        "task.ambiguous": "task.ambiguous";
        "task.stale": "task.stale";
        "task.consent_required": "task.consent_required";
    }>;
    field: z.ZodOptional<z.ZodEnum<{
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
    }>>;
    severity: z.ZodEnum<{
        error: "error";
        info: "info";
        warning: "warning";
    }>;
    message: z.ZodString;
}, z.core.$strict>;
export declare const AgentTaskConstraintsSchema: z.ZodObject<{
    noSend: z.ZodBoolean;
}, z.core.$strict>;
/** Provider target versions are SHA-256 snapshots, distinct from task revisions. */
export declare const AgentTaskTargetVersionSchema: z.ZodString;
export type AgentTaskTargetVersion = z.infer<typeof AgentTaskTargetVersionSchema>;
export declare const AgentTaskTargetSchema: z.ZodObject<{
    targetRef: z.ZodUUID;
    version: z.ZodString;
    choiceSetRef: z.ZodOptional<z.ZodUUID>;
    optionId: z.ZodOptional<z.ZodUUID>;
}, z.core.$strict>;
export type AgentTaskTarget = z.infer<typeof AgentTaskTargetSchema>;
/** Authorized REST snapshots may retain presentation labels. Safe parts use refs only. */
export declare const AgentTaskChoiceOptionSchema: z.ZodObject<{
    optionId: z.ZodUUID;
    label: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export declare const AgentTaskChoiceSetSchema: z.ZodObject<{
    choiceSetRef: z.ZodUUID;
    options: z.ZodArray<z.ZodObject<{
        optionId: z.ZodUUID;
        label: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
    }, z.core.$strict>>;
    issuedAt: z.ZodOptional<z.ZodISODateTime>;
    expiresAt: z.ZodOptional<z.ZodISODateTime>;
}, z.core.$strict>;
export type AgentTaskChoiceSet = z.infer<typeof AgentTaskChoiceSetSchema>;
export declare const AgentTaskActionLinkSchema: z.ZodObject<{
    actionId: z.ZodUUID;
    expectedRevision: z.ZodString;
    proposalRevision: z.ZodOptional<z.ZodNumber>;
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
    recipientRef: z.ZodUUID;
    effectDigest: z.ZodString;
    templateRef: z.ZodUUID;
    policyDigest: z.ZodString;
    consentEventId: z.ZodUUID;
}, z.core.$strict>;
export type AgentAutomationConsentBinding = z.infer<typeof AgentAutomationConsentBindingSchema>;
export declare const AgentAutomationConsentSchema: z.ZodObject<{
    choice: z.ZodEnum<{
        unanswered: "unanswered";
        yes: "yes";
        no: "no";
    }>;
    binding: z.ZodNullable<z.ZodObject<{
        recipientRef: z.ZodUUID;
        effectDigest: z.ZodString;
        templateRef: z.ZodUUID;
        policyDigest: z.ZodString;
        consentEventId: z.ZodUUID;
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
/** Delivery descriptions contain references, never phone/name/body preimages. */
export declare const AgentAutomationEffectKindSchema: z.ZodEnum<{
    "client-rule": "client-rule";
    "employee-assignment": "employee-assignment";
    "service-record-link": "service-record-link";
}>;
export declare const AgentAutomationQuestionAvailabilitySchema: z.ZodEnum<{
    available: "available";
    none: "none";
    unavailable: "unavailable";
}>;
export declare const AgentAutomationUnavailableReasonSchema: z.ZodEnum<{
    "missing-input": "missing-input";
    "missing-default-rules": "missing-default-rules";
    "sender-unavailable": "sender-unavailable";
    "unsupported-content": "unsupported-content";
    "source-unavailable": "source-unavailable";
}>;
export declare const AgentAutomationEffectSummarySchema: z.ZodObject<{
    effectRef: z.ZodUUID;
    recipientRef: z.ZodUUID;
    kind: z.ZodEnum<{
        "client-rule": "client-rule";
        "employee-assignment": "employee-assignment";
        "service-record-link": "service-record-link";
    }>;
    recipientType: z.ZodEnum<{
        client: "client";
        "primary-employee": "primary-employee";
        "secondary-employee": "secondary-employee";
    }>;
    change: z.ZodEnum<{
        create: "create";
        refresh: "refresh";
        cancel: "cancel";
    }>;
    templateKey: z.ZodEnum<{
        SERVICE_INFO: "SERVICE_INFO";
        CLIENT_GREETING: "CLIENT_GREETING";
        PRICE_INFO: "PRICE_INFO";
        REMINDER: "REMINDER";
        THANKS: "THANKS";
        SURVEY: "SURVEY";
        INFO: "INFO";
        SERVICE_END_NOTICE: "SERVICE_END_NOTICE";
        EMPLOYEE_ASSIGNED: "EMPLOYEE_ASSIGNED";
        SERVICE_RECORD_LINK: "SERVICE_RECORD_LINK";
    }>;
}, z.core.$strict>;
export declare const AgentAutomationQuestionSchema: z.ZodObject<{
    questionRef: z.ZodUUID;
    availability: z.ZodEnum<{
        available: "available";
        none: "none";
        unavailable: "unavailable";
    }>;
    reason: z.ZodOptional<z.ZodEnum<{
        "missing-input": "missing-input";
        "missing-default-rules": "missing-default-rules";
        "sender-unavailable": "sender-unavailable";
        "unsupported-content": "unsupported-content";
        "source-unavailable": "source-unavailable";
    }>>;
    recipientSetRef: z.ZodUUID;
    templateSetRef: z.ZodUUID;
    effectDigest: z.ZodString;
    policyDigest: z.ZodString;
    effects: z.ZodArray<z.ZodObject<{
        effectRef: z.ZodUUID;
        recipientRef: z.ZodUUID;
        kind: z.ZodEnum<{
            "client-rule": "client-rule";
            "employee-assignment": "employee-assignment";
            "service-record-link": "service-record-link";
        }>;
        recipientType: z.ZodEnum<{
            client: "client";
            "primary-employee": "primary-employee";
            "secondary-employee": "secondary-employee";
        }>;
        change: z.ZodEnum<{
            create: "create";
            refresh: "refresh";
            cancel: "cancel";
        }>;
        templateKey: z.ZodEnum<{
            SERVICE_INFO: "SERVICE_INFO";
            CLIENT_GREETING: "CLIENT_GREETING";
            PRICE_INFO: "PRICE_INFO";
            REMINDER: "REMINDER";
            THANKS: "THANKS";
            SURVEY: "SURVEY";
            INFO: "INFO";
            SERVICE_END_NOTICE: "SERVICE_END_NOTICE";
            EMPLOYEE_ASSIGNED: "EMPLOYEE_ASSIGNED";
            SERVICE_RECORD_LINK: "SERVICE_RECORD_LINK";
        }>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type AgentAutomationQuestion = z.infer<typeof AgentAutomationQuestionSchema>;
export type AgentAutomationEffectSummary = z.infer<typeof AgentAutomationEffectSummarySchema>;
export declare const AgentTaskSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    taskId: z.ZodUUID;
    sessionId: z.ZodUUID;
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
    confirmed: z.ZodObject<{
        name: z.ZodOptional<z.ZodString>;
        address: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        phone: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        duration: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
        fullPrice: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        grant: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        actualPrice: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        startDate: z.ZodOptional<z.ZodNullable<z.ZodUnion<readonly [z.ZodString, z.ZodString]>>>;
        endDate: z.ZodOptional<z.ZodNullable<z.ZodUnion<readonly [z.ZodString, z.ZodString]>>>;
        careCenter: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
        voucherClient: z.ZodOptional<z.ZodBoolean>;
        birthday: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        dueDate: z.ZodOptional<z.ZodNullable<z.ZodUnion<readonly [z.ZodString, z.ZodString]>>>;
        birthDate: z.ZodOptional<z.ZodNullable<z.ZodUnion<readonly [z.ZodString, z.ZodString]>>>;
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
        duration: z.ZodOptional<z.ZodNullable<z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>>>;
        fullPrice: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        grant: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        actualPrice: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        startDate: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        endDate: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        careCenter: z.ZodOptional<z.ZodNullable<z.ZodUnion<readonly [z.ZodBoolean, z.ZodString]>>>;
        voucherClient: z.ZodOptional<z.ZodUnion<readonly [z.ZodBoolean, z.ZodString]>>;
        birthday: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        dueDate: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        birthDate: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        serviceStatus: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        breastPump: z.ZodOptional<z.ZodUnion<readonly [z.ZodBoolean, z.ZodString]>>;
        areaId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strict>;
    clearedFields: z.ZodDefault<z.ZodPipe<z.ZodArray<z.ZodEnum<{
        type: "type";
        address: "address";
        duration: "duration";
        fullPrice: "fullPrice";
        grant: "grant";
        actualPrice: "actualPrice";
        startDate: "startDate";
        endDate: "endDate";
        careCenter: "careCenter";
        birthday: "birthday";
        dueDate: "dueDate";
        birthDate: "birthDate";
        serviceStatus: "serviceStatus";
        areaId: "areaId";
    }>>, z.ZodTransform<("type" | "address" | "duration" | "fullPrice" | "grant" | "actualPrice" | "startDate" | "endDate" | "careCenter" | "birthday" | "dueDate" | "birthDate" | "serviceStatus" | "areaId")[], ("type" | "address" | "duration" | "fullPrice" | "grant" | "actualPrice" | "startDate" | "endDate" | "careCenter" | "birthday" | "dueDate" | "birthDate" | "serviceStatus" | "areaId")[]>>>;
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
            eventId: z.ZodOptional<z.ZodUUID>;
            valueRef: z.ZodOptional<z.ZodUUID>;
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
            eventId: z.ZodOptional<z.ZodUUID>;
            valueRef: z.ZodOptional<z.ZodUUID>;
        }, z.core.$strict>>;
    }, z.core.$strict>;
    issues: z.ZodArray<z.ZodObject<{
        code: z.ZodEnum<{
            "task.required": "task.required";
            "task.invalid": "task.invalid";
            "task.duplicate": "task.duplicate";
            "task.ambiguous": "task.ambiguous";
            "task.stale": "task.stale";
            "task.consent_required": "task.consent_required";
        }>;
        field: z.ZodOptional<z.ZodEnum<{
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
        }>>;
        severity: z.ZodEnum<{
            error: "error";
            info: "info";
            warning: "warning";
        }>;
        message: z.ZodString;
    }, z.core.$strict>>;
    constraints: z.ZodObject<{
        noSend: z.ZodBoolean;
    }, z.core.$strict>;
    choiceSets: z.ZodArray<z.ZodObject<{
        choiceSetRef: z.ZodUUID;
        options: z.ZodArray<z.ZodObject<{
            optionId: z.ZodUUID;
            label: z.ZodString;
            description: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>>;
        issuedAt: z.ZodOptional<z.ZodISODateTime>;
        expiresAt: z.ZodOptional<z.ZodISODateTime>;
    }, z.core.$strict>>;
    orderedChoiceRefs: z.ZodArray<z.ZodUUID>;
    target: z.ZodNullable<z.ZodObject<{
        targetRef: z.ZodUUID;
        version: z.ZodString;
        choiceSetRef: z.ZodOptional<z.ZodUUID>;
        optionId: z.ZodOptional<z.ZodUUID>;
    }, z.core.$strict>>;
    consent: z.ZodObject<{
        choice: z.ZodEnum<{
            unanswered: "unanswered";
            yes: "yes";
            no: "no";
        }>;
        binding: z.ZodNullable<z.ZodObject<{
            recipientRef: z.ZodUUID;
            effectDigest: z.ZodString;
            templateRef: z.ZodUUID;
            policyDigest: z.ZodString;
            consentEventId: z.ZodUUID;
        }, z.core.$strict>>;
    }, z.core.$strict>;
    automation: z.ZodOptional<z.ZodObject<{
        questionRef: z.ZodUUID;
        availability: z.ZodEnum<{
            available: "available";
            none: "none";
            unavailable: "unavailable";
        }>;
        reason: z.ZodOptional<z.ZodEnum<{
            "missing-input": "missing-input";
            "missing-default-rules": "missing-default-rules";
            "sender-unavailable": "sender-unavailable";
            "unsupported-content": "unsupported-content";
            "source-unavailable": "source-unavailable";
        }>>;
        recipientSetRef: z.ZodUUID;
        templateSetRef: z.ZodUUID;
        effectDigest: z.ZodString;
        policyDigest: z.ZodString;
        effects: z.ZodArray<z.ZodObject<{
            effectRef: z.ZodUUID;
            recipientRef: z.ZodUUID;
            kind: z.ZodEnum<{
                "client-rule": "client-rule";
                "employee-assignment": "employee-assignment";
                "service-record-link": "service-record-link";
            }>;
            recipientType: z.ZodEnum<{
                client: "client";
                "primary-employee": "primary-employee";
                "secondary-employee": "secondary-employee";
            }>;
            change: z.ZodEnum<{
                create: "create";
                refresh: "refresh";
                cancel: "cancel";
            }>;
            templateKey: z.ZodEnum<{
                SERVICE_INFO: "SERVICE_INFO";
                CLIENT_GREETING: "CLIENT_GREETING";
                PRICE_INFO: "PRICE_INFO";
                REMINDER: "REMINDER";
                THANKS: "THANKS";
                SURVEY: "SURVEY";
                INFO: "INFO";
                SERVICE_END_NOTICE: "SERVICE_END_NOTICE";
                EMPLOYEE_ASSIGNED: "EMPLOYEE_ASSIGNED";
                SERVICE_RECORD_LINK: "SERVICE_RECORD_LINK";
            }>;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    action: z.ZodNullable<z.ZodObject<{
        actionId: z.ZodUUID;
        expectedRevision: z.ZodString;
        proposalRevision: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strict>>;
    times: z.ZodObject<{
        createdAt: z.ZodISODateTime;
        updatedAt: z.ZodISODateTime;
        acceptedAt: z.ZodOptional<z.ZodISODateTime>;
        pausedAt: z.ZodOptional<z.ZodISODateTime>;
        terminatedAt: z.ZodOptional<z.ZodISODateTime>;
        expiresAt: z.ZodOptional<z.ZodISODateTime>;
    }, z.core.$strict>;
    currentSnapshotRef: z.ZodUUID;
}, z.core.$strict>;
export type AgentTask = z.infer<typeof AgentTaskSchema>;
export declare const AgentTaskCreateRequestSchema: z.ZodObject<{
    schemaVersion: z.ZodOptional<z.ZodLiteral<1>>;
    sessionId: z.ZodUUID;
    capabilityId: z.ZodEnum<{
        "clients.create": "clients.create";
        "clients.update": "clients.update";
    }>;
    clientEventId: z.ZodUUID;
    operations: z.ZodDefault<z.ZodArray<z.ZodType<import("./client-input-policy").ClientInputOperation, unknown, z.core.$ZodTypeInternals<import("./client-input-policy").ClientInputOperation, unknown>>>>;
}, z.core.$strict>;
export type AgentTaskCreateRequest = z.infer<typeof AgentTaskCreateRequestSchema>;
export declare const AgentTaskPatchRequestSchema: z.ZodObject<{
    clientEventId: z.ZodUUID;
    expectedRevision: z.ZodNumber;
    operations: z.ZodArray<z.ZodType<import("./client-input-policy").ClientInputOperation, unknown, z.core.$ZodTypeInternals<import("./client-input-policy").ClientInputOperation, unknown>>>;
}, z.core.$strict>;
export type AgentTaskPatchRequest = z.infer<typeof AgentTaskPatchRequestSchema>;
export declare const AgentTaskSelectTargetCommandSchema: z.ZodUnion<readonly [z.ZodObject<{
    command: z.ZodLiteral<"select-target">;
    choiceSetId: z.ZodUUID;
    optionId: z.ZodUUID;
    clientEventId: z.ZodUUID;
    expectedRevision: z.ZodNumber;
}, z.core.$strict>, z.ZodObject<{
    command: z.ZodLiteral<"select-target">;
    choiceSetRef: z.ZodUUID;
    optionId: z.ZodUUID;
    clientEventId: z.ZodUUID;
    expectedRevision: z.ZodNumber;
}, z.core.$strict>]>;
export declare const AgentTaskStartUpdateCommandSchema: z.ZodObject<{
    command: z.ZodLiteral<"start-update">;
    targetRef: z.ZodUUID;
    expectedTargetVersion: z.ZodString;
    clientEventId: z.ZodUUID;
    expectedRevision: z.ZodNumber;
}, z.core.$strict>;
export declare const AgentTaskCommandRequestSchema: z.ZodUnion<readonly [z.ZodUnion<readonly [z.ZodObject<{
    command: z.ZodLiteral<"select-target">;
    choiceSetId: z.ZodUUID;
    optionId: z.ZodUUID;
    clientEventId: z.ZodUUID;
    expectedRevision: z.ZodNumber;
}, z.core.$strict>, z.ZodObject<{
    command: z.ZodLiteral<"select-target">;
    choiceSetRef: z.ZodUUID;
    optionId: z.ZodUUID;
    clientEventId: z.ZodUUID;
    expectedRevision: z.ZodNumber;
}, z.core.$strict>]>, z.ZodObject<{
    command: z.ZodLiteral<"start-update">;
    targetRef: z.ZodUUID;
    expectedTargetVersion: z.ZodString;
    clientEventId: z.ZodUUID;
    expectedRevision: z.ZodNumber;
}, z.core.$strict>, z.ZodObject<{
    command: z.ZodLiteral<"pause">;
    clientEventId: z.ZodUUID;
    expectedRevision: z.ZodNumber;
}, z.core.$strict>, z.ZodObject<{
    command: z.ZodLiteral<"resume">;
    clientEventId: z.ZodUUID;
    expectedRevision: z.ZodNumber;
}, z.core.$strict>, z.ZodObject<{
    command: z.ZodLiteral<"prepare-review">;
    clientEventId: z.ZodUUID;
    expectedRevision: z.ZodNumber;
}, z.core.$strict>, z.ZodObject<{
    command: z.ZodLiteral<"cancel">;
    clientEventId: z.ZodUUID;
    expectedRevision: z.ZodNumber;
}, z.core.$strict>]>;
export type AgentTaskCommandRequest = z.infer<typeof AgentTaskCommandRequestSchema>;
export declare const AgentTaskCommandNameSchema: z.ZodEnum<{
    cancel: "cancel";
    "select-target": "select-target";
    "start-update": "start-update";
    pause: "pause";
    resume: "resume";
    "prepare-review": "prepare-review";
}>;
export type AgentTaskCommandName = z.infer<typeof AgentTaskCommandNameSchema>;
export declare const AgentTaskEventReceiptSchema: z.ZodObject<{
    taskId: z.ZodUUID;
    eventId: z.ZodUUID;
    eventHash: z.ZodString;
    acceptedRevision: z.ZodNumber;
    currentSnapshotRef: z.ZodUUID;
}, z.core.$strict>;
export type AgentTaskEventReceipt = z.infer<typeof AgentTaskEventReceiptSchema>;
export declare const AgentTaskMutationResponseSchema: z.ZodObject<{
    receipt: z.ZodObject<{
        taskId: z.ZodUUID;
        eventId: z.ZodUUID;
        eventHash: z.ZodString;
        acceptedRevision: z.ZodNumber;
        currentSnapshotRef: z.ZodUUID;
    }, z.core.$strict>;
    snapshot: z.ZodObject<{
        schemaVersion: z.ZodLiteral<1>;
        taskId: z.ZodUUID;
        sessionId: z.ZodUUID;
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
        confirmed: z.ZodObject<{
            name: z.ZodOptional<z.ZodString>;
            address: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            phone: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            type: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            duration: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
            fullPrice: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            grant: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            actualPrice: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            startDate: z.ZodOptional<z.ZodNullable<z.ZodUnion<readonly [z.ZodString, z.ZodString]>>>;
            endDate: z.ZodOptional<z.ZodNullable<z.ZodUnion<readonly [z.ZodString, z.ZodString]>>>;
            careCenter: z.ZodOptional<z.ZodNullable<z.ZodBoolean>>;
            voucherClient: z.ZodOptional<z.ZodBoolean>;
            birthday: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            dueDate: z.ZodOptional<z.ZodNullable<z.ZodUnion<readonly [z.ZodString, z.ZodString]>>>;
            birthDate: z.ZodOptional<z.ZodNullable<z.ZodUnion<readonly [z.ZodString, z.ZodString]>>>;
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
            duration: z.ZodOptional<z.ZodNullable<z.ZodUnion<readonly [z.ZodNumber, z.ZodString]>>>;
            fullPrice: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            grant: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            actualPrice: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            startDate: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            endDate: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            careCenter: z.ZodOptional<z.ZodNullable<z.ZodUnion<readonly [z.ZodBoolean, z.ZodString]>>>;
            voucherClient: z.ZodOptional<z.ZodUnion<readonly [z.ZodBoolean, z.ZodString]>>;
            birthday: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            dueDate: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            birthDate: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            serviceStatus: z.ZodOptional<z.ZodNullable<z.ZodString>>;
            breastPump: z.ZodOptional<z.ZodUnion<readonly [z.ZodBoolean, z.ZodString]>>;
            areaId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
        }, z.core.$strict>;
        clearedFields: z.ZodDefault<z.ZodPipe<z.ZodArray<z.ZodEnum<{
            type: "type";
            address: "address";
            duration: "duration";
            fullPrice: "fullPrice";
            grant: "grant";
            actualPrice: "actualPrice";
            startDate: "startDate";
            endDate: "endDate";
            careCenter: "careCenter";
            birthday: "birthday";
            dueDate: "dueDate";
            birthDate: "birthDate";
            serviceStatus: "serviceStatus";
            areaId: "areaId";
        }>>, z.ZodTransform<("type" | "address" | "duration" | "fullPrice" | "grant" | "actualPrice" | "startDate" | "endDate" | "careCenter" | "birthday" | "dueDate" | "birthDate" | "serviceStatus" | "areaId")[], ("type" | "address" | "duration" | "fullPrice" | "grant" | "actualPrice" | "startDate" | "endDate" | "careCenter" | "birthday" | "dueDate" | "birthDate" | "serviceStatus" | "areaId")[]>>>;
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
                eventId: z.ZodOptional<z.ZodUUID>;
                valueRef: z.ZodOptional<z.ZodUUID>;
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
                eventId: z.ZodOptional<z.ZodUUID>;
                valueRef: z.ZodOptional<z.ZodUUID>;
            }, z.core.$strict>>;
        }, z.core.$strict>;
        issues: z.ZodArray<z.ZodObject<{
            code: z.ZodEnum<{
                "task.required": "task.required";
                "task.invalid": "task.invalid";
                "task.duplicate": "task.duplicate";
                "task.ambiguous": "task.ambiguous";
                "task.stale": "task.stale";
                "task.consent_required": "task.consent_required";
            }>;
            field: z.ZodOptional<z.ZodEnum<{
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
            }>>;
            severity: z.ZodEnum<{
                error: "error";
                info: "info";
                warning: "warning";
            }>;
            message: z.ZodString;
        }, z.core.$strict>>;
        constraints: z.ZodObject<{
            noSend: z.ZodBoolean;
        }, z.core.$strict>;
        choiceSets: z.ZodArray<z.ZodObject<{
            choiceSetRef: z.ZodUUID;
            options: z.ZodArray<z.ZodObject<{
                optionId: z.ZodUUID;
                label: z.ZodString;
                description: z.ZodOptional<z.ZodString>;
            }, z.core.$strict>>;
            issuedAt: z.ZodOptional<z.ZodISODateTime>;
            expiresAt: z.ZodOptional<z.ZodISODateTime>;
        }, z.core.$strict>>;
        orderedChoiceRefs: z.ZodArray<z.ZodUUID>;
        target: z.ZodNullable<z.ZodObject<{
            targetRef: z.ZodUUID;
            version: z.ZodString;
            choiceSetRef: z.ZodOptional<z.ZodUUID>;
            optionId: z.ZodOptional<z.ZodUUID>;
        }, z.core.$strict>>;
        consent: z.ZodObject<{
            choice: z.ZodEnum<{
                unanswered: "unanswered";
                yes: "yes";
                no: "no";
            }>;
            binding: z.ZodNullable<z.ZodObject<{
                recipientRef: z.ZodUUID;
                effectDigest: z.ZodString;
                templateRef: z.ZodUUID;
                policyDigest: z.ZodString;
                consentEventId: z.ZodUUID;
            }, z.core.$strict>>;
        }, z.core.$strict>;
        automation: z.ZodOptional<z.ZodObject<{
            questionRef: z.ZodUUID;
            availability: z.ZodEnum<{
                available: "available";
                none: "none";
                unavailable: "unavailable";
            }>;
            reason: z.ZodOptional<z.ZodEnum<{
                "missing-input": "missing-input";
                "missing-default-rules": "missing-default-rules";
                "sender-unavailable": "sender-unavailable";
                "unsupported-content": "unsupported-content";
                "source-unavailable": "source-unavailable";
            }>>;
            recipientSetRef: z.ZodUUID;
            templateSetRef: z.ZodUUID;
            effectDigest: z.ZodString;
            policyDigest: z.ZodString;
            effects: z.ZodArray<z.ZodObject<{
                effectRef: z.ZodUUID;
                recipientRef: z.ZodUUID;
                kind: z.ZodEnum<{
                    "client-rule": "client-rule";
                    "employee-assignment": "employee-assignment";
                    "service-record-link": "service-record-link";
                }>;
                recipientType: z.ZodEnum<{
                    client: "client";
                    "primary-employee": "primary-employee";
                    "secondary-employee": "secondary-employee";
                }>;
                change: z.ZodEnum<{
                    create: "create";
                    refresh: "refresh";
                    cancel: "cancel";
                }>;
                templateKey: z.ZodEnum<{
                    SERVICE_INFO: "SERVICE_INFO";
                    CLIENT_GREETING: "CLIENT_GREETING";
                    PRICE_INFO: "PRICE_INFO";
                    REMINDER: "REMINDER";
                    THANKS: "THANKS";
                    SURVEY: "SURVEY";
                    INFO: "INFO";
                    SERVICE_END_NOTICE: "SERVICE_END_NOTICE";
                    EMPLOYEE_ASSIGNED: "EMPLOYEE_ASSIGNED";
                    SERVICE_RECORD_LINK: "SERVICE_RECORD_LINK";
                }>;
            }, z.core.$strict>>;
        }, z.core.$strict>>;
        action: z.ZodNullable<z.ZodObject<{
            actionId: z.ZodUUID;
            expectedRevision: z.ZodString;
            proposalRevision: z.ZodOptional<z.ZodNumber>;
        }, z.core.$strict>>;
        times: z.ZodObject<{
            createdAt: z.ZodISODateTime;
            updatedAt: z.ZodISODateTime;
            acceptedAt: z.ZodOptional<z.ZodISODateTime>;
            pausedAt: z.ZodOptional<z.ZodISODateTime>;
            terminatedAt: z.ZodOptional<z.ZodISODateTime>;
            expiresAt: z.ZodOptional<z.ZodISODateTime>;
        }, z.core.$strict>;
        currentSnapshotRef: z.ZodUUID;
    }, z.core.$strict>;
}, z.core.$strict>;
export type AgentTaskMutationResponse = z.infer<typeof AgentTaskMutationResponseSchema>;
/**
 * Additive metadata returned alongside an owned session restore.  Older
 * payloads that predate recovery discovery parse as an empty recovery list.
 */
export declare const AgentTaskRestoreMetadataSchema: z.ZodObject<{
    activeTaskId: z.ZodNullable<z.ZodUUID>;
    pausedTaskIds: z.ZodArray<z.ZodUUID>;
    taskRestoreStatus: z.ZodEnum<{
        available: "available";
        session_archived: "session_archived";
        session_expired: "session_expired";
    }>;
    recoveryTaskIds: z.ZodDefault<z.ZodArray<z.ZodUUID>>;
}, z.core.$strict>;
export type AgentTaskRestoreMetadata = z.infer<typeof AgentTaskRestoreMetadataSchema>;
export declare function createAgentTaskDefaults(): Pick<ClientWriteFields, "voucherClient" | "serviceStatus">;
