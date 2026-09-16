import { z } from "zod";
import { type AgentTask } from "./task-types";
export declare const AgentTaskSafeFieldStatusSchema: z.ZodObject<{
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
    valueRef: z.ZodOptional<z.ZodUUID>;
}, z.core.$strict>;
export type AgentTaskSafeFieldStatus = z.infer<typeof AgentTaskSafeFieldStatusSchema>;
export declare const AgentTaskSafeChoiceSetSchema: z.ZodObject<{
    choiceSetRef: z.ZodUUID;
    optionIds: z.ZodArray<z.ZodUUID>;
}, z.core.$strict>;
/** Safe projection contains structural references/status only. */
export declare const AgentTaskSafeSnapshotSchema: z.ZodObject<{
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
        valueRef: z.ZodOptional<z.ZodUUID>;
    }, z.core.$strict>>;
    clearedFields: z.ZodPipe<z.ZodArray<z.ZodEnum<{
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
    }>>, z.ZodTransform<("type" | "address" | "duration" | "fullPrice" | "grant" | "actualPrice" | "startDate" | "endDate" | "careCenter" | "birthday" | "dueDate" | "birthDate" | "serviceStatus" | "areaId")[], ("type" | "address" | "duration" | "fullPrice" | "grant" | "actualPrice" | "startDate" | "endDate" | "careCenter" | "birthday" | "dueDate" | "birthDate" | "serviceStatus" | "areaId")[]>>;
    constraints: z.ZodObject<{
        noSend: z.ZodBoolean;
    }, z.core.$strict>;
    target: z.ZodNullable<z.ZodObject<{
        targetRef: z.ZodUUID;
    }, z.core.$strict>>;
    choiceSets: z.ZodArray<z.ZodObject<{
        choiceSetRef: z.ZodUUID;
        optionIds: z.ZodArray<z.ZodUUID>;
    }, z.core.$strict>>;
    orderedChoiceRefs: z.ZodArray<z.ZodUUID>;
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
    }, z.core.$strict>>;
    action: z.ZodNullable<z.ZodObject<{
        actionId: z.ZodUUID;
    }, z.core.$strict>>;
    consent: z.ZodObject<{
        choice: z.ZodEnum<{
            unanswered: "unanswered";
            yes: "yes";
            no: "no";
        }>;
        hasServerBinding: z.ZodBoolean;
    }, z.core.$strict>;
    times: z.ZodObject<{
        createdAt: z.ZodISODateTime;
        updatedAt: z.ZodISODateTime;
        expiresAt: z.ZodOptional<z.ZodISODateTime>;
    }, z.core.$strict>;
    currentSnapshotRef: z.ZodUUID;
}, z.core.$strict>;
export type AgentTaskSafeSnapshot = z.infer<typeof AgentTaskSafeSnapshotSchema>;
export declare const AgentTaskSnapshotConflictSchema: z.ZodObject<{
    status: z.ZodLiteral<409>;
    latestRevision: z.ZodNumber;
    latestSnapshotRef: z.ZodOptional<z.ZodUUID>;
}, z.core.$strict>;
export declare const AgentTaskSnapshotEnvelopeSchema: z.ZodObject<{
    identityEpoch: z.ZodNumber;
    task: z.ZodObject<{
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
    acknowledgedEventId: z.ZodOptional<z.ZodUUID>;
    conflict: z.ZodOptional<z.ZodObject<{
        status: z.ZodLiteral<409>;
        latestRevision: z.ZodNumber;
        latestSnapshotRef: z.ZodOptional<z.ZodUUID>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type AgentTaskSnapshotEnvelope = z.infer<typeof AgentTaskSnapshotEnvelopeSchema>;
export interface AgentTaskClientSnapshotState {
    identityEpoch: number;
    /** Client transport generation; never comes from a server snapshot. */
    requestGeneration: number;
    task: AgentTask | null;
    acknowledgedEventIds: readonly string[];
    pendingEventIds: readonly string[];
}
/** Metadata captured when a snapshot request is dispatched. */
export interface AgentTaskSnapshotRequestContext {
    identityEpoch: number;
    requestGeneration: number;
}
export type AgentTaskSnapshotAcceptanceReason = "accepted" | "accepted-new-identity" | "acknowledged-event" | "same-revision" | "lower-revision" | "stale-generation" | "stale-identity" | "different-task" | "different-session" | "conflict-latest";
export interface AgentTaskSnapshotAcceptance {
    accepted: boolean;
    autoMerged: false;
    reason: AgentTaskSnapshotAcceptanceReason;
    state: AgentTaskClientSnapshotState;
    needsReconciliation: boolean;
}
/** Create an empty client state before the first snapshot request. */
export declare function createAgentTaskSnapshotState(identityEpoch?: number): AgentTaskClientSnapshotState;
/** Capture the generation that a request carries until its response arrives. */
export declare function captureAgentTaskSnapshotRequest(current: AgentTaskClientSnapshotState): AgentTaskSnapshotRequestContext;
/**
 * Clear task/ack/pending state and advance the client generation. The
 * generation is intentionally derived from the current state so a caller
 * cannot accidentally reuse an in-flight request's generation after a task
 * or account switch. It is transport metadata, not a server authority field.
 */
export declare function resetAgentTaskSnapshotState(current: AgentTaskClientSnapshotState, nextIdentityEpoch?: number): AgentTaskClientSnapshotState;
/**
 * Accept server snapshots monotonically. A newer identity epoch replaces the
 * entire local task/ack/pending state; a 409 keeps unsent events pending and
 * never attempts an automatic merge. Callers must capture
 * `captureAgentTaskSnapshotRequest(state)` before dispatch and pass that same
 * context to this function when the response returns; capturing after the
 * response would defeat stale-response rejection.
 */
export declare function acceptAgentTaskSnapshot(current: AgentTaskClientSnapshotState, incoming: AgentTaskSnapshotEnvelope, request: AgentTaskSnapshotRequestContext): AgentTaskSnapshotAcceptance;
/** Authorized REST callers receive the protected editing snapshot. */
export declare function projectTaskForAuthorizedRest(task: AgentTask): AgentTask;
/** Safe model/chat projection never copies values or presentation labels. */
export declare function projectTaskForSafeChat(task: AgentTask): AgentTaskSafeSnapshot;
