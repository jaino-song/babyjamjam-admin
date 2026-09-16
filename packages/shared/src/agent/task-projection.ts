import { z } from "zod";

import {
    AgentTaskIsoDateTimeSchema,
    AgentTaskOpaqueRefSchema,
    AgentTaskRevisionSchema,
    AgentTaskSchema,
    AgentTaskStateSchema,
    type AgentTask,
    type AgentTaskRevision,
} from "./task-types";
import { CLIENT_WRITE_FIELD_NAMES, type ClientWriteField } from "./client-input-policy";

const SafeFieldStatusSchema = z.enum(["missing", "confirmed", "tentative", "confirmed-and-tentative"]);

export const AgentTaskSafeFieldStatusSchema = z.object({
    field: z.enum(CLIENT_WRITE_FIELD_NAMES),
    status: SafeFieldStatusSchema,
    valueRef: AgentTaskOpaqueRefSchema.optional(),
}).strict();

export type AgentTaskSafeFieldStatus = z.infer<typeof AgentTaskSafeFieldStatusSchema>;

export const AgentTaskSafeChoiceSetSchema = z.object({
    choiceSetRef: AgentTaskOpaqueRefSchema,
    optionIds: z.array(AgentTaskOpaqueRefSchema),
}).strict();

export const AgentTaskSafeSnapshotSchema = z.object({
    schemaVersion: z.literal(1),
    taskId: AgentTaskOpaqueRefSchema,
    sessionId: AgentTaskOpaqueRefSchema,
    revision: AgentTaskRevisionSchema,
    state: AgentTaskStateSchema,
    fieldStatus: z.array(AgentTaskSafeFieldStatusSchema),
    constraints: z.object({
        noSend: z.boolean(),
        automationChoice: z.enum(["unanswered", "yes", "no"]),
    }).strict(),
    target: z.object({
        targetRef: AgentTaskOpaqueRefSchema,
        version: AgentTaskRevisionSchema,
    }).strict().nullable(),
    choiceSets: z.array(AgentTaskSafeChoiceSetSchema),
    orderedChoiceRefs: z.array(AgentTaskOpaqueRefSchema),
    issues: z.array(z.object({
        code: z.string().min(1),
        field: z.string().min(1).optional(),
        severity: z.enum(["info", "warning", "error"]),
    }).strict()),
    action: z.object({
        actionId: AgentTaskOpaqueRefSchema,
        expectedRevision: AgentTaskRevisionSchema,
    }).strict().nullable(),
    consent: z.object({
        choice: z.enum(["unanswered", "yes", "no"]),
        hasServerBinding: z.boolean(),
    }).strict(),
    times: z.object({
        createdAt: AgentTaskIsoDateTimeSchema,
        updatedAt: AgentTaskIsoDateTimeSchema,
        expiresAt: AgentTaskIsoDateTimeSchema.optional(),
    }).strict(),
    currentSnapshotRef: AgentTaskOpaqueRefSchema,
}).strict();

export type AgentTaskSafeSnapshot = z.infer<typeof AgentTaskSafeSnapshotSchema>;

export const AgentTaskSnapshotConflictSchema = z.object({
    status: z.literal(409),
    latestRevision: AgentTaskRevisionSchema,
    latestSnapshotRef: AgentTaskOpaqueRefSchema.optional(),
}).strict();

export const AgentTaskSnapshotEnvelopeSchema = z.object({
    identityEpoch: z.number().int().nonnegative(),
    task: AgentTaskSchema,
    acknowledgedEventId: AgentTaskOpaqueRefSchema.optional(),
    conflict: AgentTaskSnapshotConflictSchema.optional(),
}).strict();

export type AgentTaskSnapshotEnvelope = z.infer<typeof AgentTaskSnapshotEnvelopeSchema>;

export interface AgentTaskClientSnapshotState {
    identityEpoch: number;
    task: AgentTask;
    acknowledgedEventIds: readonly string[];
    pendingEventIds: readonly string[];
}

export type AgentTaskSnapshotAcceptanceReason =
    | "accepted"
    | "accepted-new-identity"
    | "acknowledged-event"
    | "same-revision"
    | "lower-revision"
    | "stale-identity"
    | "different-task"
    | "conflict-latest";

export interface AgentTaskSnapshotAcceptance {
    accepted: boolean;
    autoMerged: false;
    reason: AgentTaskSnapshotAcceptanceReason;
    state: AgentTaskClientSnapshotState;
    needsReconciliation: boolean;
}

function revisionNumber(value: AgentTaskRevision): number | null {
    if (typeof value === "number") return value;
    if (/^\d+$/.test(value)) return Number(value);
    const suffix = value.match(/(?:^|[^\d])(\d+)$/)?.[1];
    return suffix ? Number(suffix) : null;
}

function compareRevisions(left: AgentTaskRevision, right: AgentTaskRevision): number {
    const leftNumber = revisionNumber(left);
    const rightNumber = revisionNumber(right);
    if (leftNumber !== null && rightNumber !== null && leftNumber !== rightNumber) {
        return leftNumber > rightNumber ? 1 : -1;
    }
    if (String(left) === String(right)) return 0;
    // Opaque revisions are intentionally not guessed.  Treat them as equal so
    // an untrusted client cannot replace a snapshot solely through ordering.
    return 0;
}

function stateWithAck(
    current: AgentTaskClientSnapshotState,
    acknowledgedEventId: string | undefined,
): AgentTaskClientSnapshotState {
    if (!acknowledgedEventId || current.acknowledgedEventIds.includes(acknowledgedEventId)) return current;
    return {
        ...current,
        acknowledgedEventIds: [...current.acknowledgedEventIds, acknowledgedEventId],
    };
}

function initialClientSnapshotState(envelope: AgentTaskSnapshotEnvelope): AgentTaskClientSnapshotState {
    return {
        identityEpoch: envelope.identityEpoch,
        task: envelope.task,
        acknowledgedEventIds: envelope.acknowledgedEventId ? [envelope.acknowledgedEventId] : [],
        pendingEventIds: [],
    };
}

/**
 * Accept a server snapshot monotonically.  A 409 response supplies the latest
 * server task, but pending client events remain pending; the reducer never
 * attempts to merge unsent edits into that latest state.
 */
export function acceptAgentTaskSnapshot(
    current: AgentTaskClientSnapshotState | null,
    incoming: AgentTaskSnapshotEnvelope,
): AgentTaskSnapshotAcceptance {
    if (!current) {
        return {
            accepted: true,
            autoMerged: false,
            reason: "accepted",
            state: initialClientSnapshotState(incoming),
            needsReconciliation: Boolean(incoming.conflict),
        };
    }

    if (incoming.task.taskId !== current.task.taskId) {
        return { accepted: false, autoMerged: false, reason: "different-task", state: current, needsReconciliation: false };
    }

    if (incoming.identityEpoch < current.identityEpoch) {
        return { accepted: false, autoMerged: false, reason: "stale-identity", state: current, needsReconciliation: false };
    }

    if (incoming.identityEpoch > current.identityEpoch) {
        return {
            accepted: true,
            autoMerged: false,
            reason: "accepted-new-identity",
            state: {
                ...initialClientSnapshotState(incoming),
                pendingEventIds: current.pendingEventIds,
            },
            needsReconciliation: Boolean(incoming.conflict),
        };
    }

    const revisionComparison = compareRevisions(incoming.task.revision, current.task.revision);
    if (revisionComparison < 0) {
        return { accepted: false, autoMerged: false, reason: "lower-revision", state: current, needsReconciliation: false };
    }

    if (incoming.conflict) {
        return {
            accepted: true,
            autoMerged: false,
            reason: "conflict-latest",
            state: stateWithAck({ ...current, task: incoming.task }, incoming.acknowledgedEventId),
            needsReconciliation: true,
        };
    }

    if (revisionComparison === 0) {
        const next = stateWithAck(current, incoming.acknowledgedEventId);
        return {
            accepted: next !== current,
            autoMerged: false,
            reason: next !== current ? "acknowledged-event" : "same-revision",
            state: next,
            needsReconciliation: false,
        };
    }

    return {
        accepted: true,
        autoMerged: false,
        reason: "accepted",
        state: stateWithAck({ ...current, task: incoming.task }, incoming.acknowledgedEventId),
        needsReconciliation: false,
    };
}

export const reduceTaskSnapshot = acceptAgentTaskSnapshot;
export const applyTaskSnapshot = acceptAgentTaskSnapshot;
export const acceptTaskSnapshot = acceptAgentTaskSnapshot;

/** Authorized REST callers receive the complete, protected editing snapshot. */
export function projectTaskForAuthorizedRest(task: AgentTask): AgentTask {
    return AgentTaskSchema.parse(task);
}

export const projectAuthorizedTaskSnapshot = projectTaskForAuthorizedRest;
export const projectTaskForAuthorized = projectTaskForAuthorizedRest;

function fieldStatus(
    field: ClientWriteField,
    task: AgentTask,
): AgentTaskSafeFieldStatus {
    const hasConfirmed = Object.prototype.hasOwnProperty.call(task.confirmed, field);
    const hasTentative = Object.prototype.hasOwnProperty.call(task.tentative, field);
    const status = hasConfirmed && hasTentative
        ? "confirmed-and-tentative"
        : hasConfirmed
            ? "confirmed"
            : hasTentative
                ? "tentative"
                : "missing";
    const valueRef = task.provenance.tentative[field]?.valueRef ?? task.provenance.confirmed[field]?.valueRef;
    return { field, status, ...(valueRef ? { valueRef } : {}) };
}

/**
 * Model/chat projection.  It intentionally never spreads `confirmed` or
 * `tentative`; protected values are represented by availability and opaque
 * provenance references only.
 */
export function projectTaskForSafeChat(task: AgentTask): AgentTaskSafeSnapshot {
    const parsedTask = AgentTaskSchema.parse(task);
    return AgentTaskSafeSnapshotSchema.parse({
        schemaVersion: parsedTask.schemaVersion,
        taskId: parsedTask.taskId,
        sessionId: parsedTask.sessionId,
        revision: parsedTask.revision,
        state: parsedTask.state,
        fieldStatus: CLIENT_WRITE_FIELD_NAMES.map((field) => fieldStatus(field, parsedTask)),
        constraints: parsedTask.constraints,
        target: parsedTask.target
            ? {
                targetRef: parsedTask.target.targetRef,
                version: parsedTask.target.version ?? parsedTask.target.targetVersion!,
            }
            : null,
        choiceSets: parsedTask.choiceSets.map((choiceSet) => ({
            choiceSetRef: choiceSet.choiceSetRef,
            optionIds: choiceSet.options.map((option) => option.optionId),
        })),
        orderedChoiceRefs: parsedTask.orderedChoiceRefs,
        issues: parsedTask.issues.map(({ code, field, severity }) => ({ code, ...(field ? { field } : {}), severity })),
        action: parsedTask.action
            ? { actionId: parsedTask.action.actionId, expectedRevision: parsedTask.action.expectedRevision }
            : null,
        consent: {
            choice: parsedTask.consent.choice,
            hasServerBinding: parsedTask.consent.binding !== null,
        },
        times: {
            createdAt: parsedTask.times.createdAt,
            updatedAt: parsedTask.times.updatedAt,
            ...(parsedTask.times.expiresAt ? { expiresAt: parsedTask.times.expiresAt } : {}),
        },
        currentSnapshotRef: parsedTask.currentSnapshotRef,
    });
}

export const projectSafeTaskSnapshot = projectTaskForSafeChat;
export const projectTaskForModel = projectTaskForSafeChat;
export const projectTaskForChat = projectTaskForSafeChat;
export const AgentTaskSafeChatSnapshotSchema = AgentTaskSafeSnapshotSchema;
