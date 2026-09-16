import { z } from "zod";

import {
    AgentTaskCapabilityIdSchema,
    AgentTaskIssueCodeSchema,
    AgentTaskIsoDateTimeSchema,
    AgentTaskReferenceSchema,
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
    valueRef: AgentTaskReferenceSchema.optional(),
}).strict();
export type AgentTaskSafeFieldStatus = z.infer<typeof AgentTaskSafeFieldStatusSchema>;

export const AgentTaskSafeChoiceSetSchema = z.object({
    choiceSetRef: AgentTaskReferenceSchema,
    optionIds: z.array(AgentTaskReferenceSchema),
}).strict();

/** Safe projection contains structural references/status only. */
export const AgentTaskSafeSnapshotSchema = z.object({
    schemaVersion: z.literal(1),
    taskId: AgentTaskReferenceSchema,
    sessionId: AgentTaskReferenceSchema,
    kind: AgentTaskCapabilityIdSchema,
    capabilityId: AgentTaskCapabilityIdSchema,
    revision: AgentTaskRevisionSchema,
    state: AgentTaskStateSchema,
    fieldStatus: z.array(AgentTaskSafeFieldStatusSchema),
    constraints: z.object({ noSend: z.boolean() }).strict(),
    target: z.object({ targetRef: AgentTaskReferenceSchema }).strict().nullable(),
    choiceSets: z.array(AgentTaskSafeChoiceSetSchema),
    orderedChoiceRefs: z.array(AgentTaskReferenceSchema),
    issues: z.array(z.object({
        code: AgentTaskIssueCodeSchema,
        field: z.enum(CLIENT_WRITE_FIELD_NAMES).optional(),
        severity: z.enum(["info", "warning", "error"]),
    }).strict()),
    action: z.object({ actionId: AgentTaskReferenceSchema }).strict().nullable(),
    consent: z.object({
        choice: z.enum(["unanswered", "yes", "no"]),
        hasServerBinding: z.boolean(),
    }).strict(),
    times: z.object({
        createdAt: AgentTaskIsoDateTimeSchema,
        updatedAt: AgentTaskIsoDateTimeSchema,
        expiresAt: AgentTaskIsoDateTimeSchema.optional(),
    }).strict(),
    currentSnapshotRef: AgentTaskReferenceSchema,
}).strict().superRefine((value, context) => {
    if (value.kind !== value.capabilityId) {
        context.addIssue({ code: "custom", path: ["kind"], message: "Safe task kind must match capabilityId" });
    }
});
export type AgentTaskSafeSnapshot = z.infer<typeof AgentTaskSafeSnapshotSchema>;

export const AgentTaskSnapshotConflictSchema = z.object({
    status: z.literal(409),
    latestRevision: AgentTaskRevisionSchema,
    latestSnapshotRef: AgentTaskReferenceSchema.optional(),
}).strict();
export const AgentTaskSnapshotEnvelopeSchema = z.object({
    identityEpoch: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    task: AgentTaskSchema,
    acknowledgedEventId: AgentTaskReferenceSchema.optional(),
    conflict: AgentTaskSnapshotConflictSchema.optional(),
}).strict();
export type AgentTaskSnapshotEnvelope = z.infer<typeof AgentTaskSnapshotEnvelopeSchema>;

export interface AgentTaskClientSnapshotState {
    identityEpoch: number;
    task: AgentTask | null;
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
    | "different-session"
    | "conflict-latest";

export interface AgentTaskSnapshotAcceptance {
    accepted: boolean;
    autoMerged: false;
    reason: AgentTaskSnapshotAcceptanceReason;
    state: AgentTaskClientSnapshotState;
    needsReconciliation: boolean;
}

function compareRevisions(left: AgentTaskRevision, right: AgentTaskRevision): number {
    return left === right ? 0 : left > right ? 1 : -1;
}

function stateWithAck(
    current: AgentTaskClientSnapshotState,
    acknowledgedEventId: string | undefined,
): AgentTaskClientSnapshotState {
    if (!acknowledgedEventId) return current;
    const acknowledgedEventIds = current.acknowledgedEventIds.includes(acknowledgedEventId)
        ? current.acknowledgedEventIds
        : [...current.acknowledgedEventIds, acknowledgedEventId];
    const pendingEventIds = current.pendingEventIds.filter((eventId) => eventId !== acknowledgedEventId);
    if (acknowledgedEventIds === current.acknowledgedEventIds && pendingEventIds.length === current.pendingEventIds.length) return current;
    return { ...current, acknowledgedEventIds, pendingEventIds };
}

function initialClientSnapshotState(envelope: AgentTaskSnapshotEnvelope): AgentTaskClientSnapshotState {
    return {
        identityEpoch: envelope.identityEpoch,
        task: envelope.task,
        acknowledgedEventIds: envelope.acknowledgedEventId ? [envelope.acknowledgedEventId] : [],
        pendingEventIds: [],
    };
}

/** Clear task/ack/pending state while retaining the account identity epoch. */
export function resetAgentTaskSnapshotState(identityEpoch: number): AgentTaskClientSnapshotState {
    if (!Number.isSafeInteger(identityEpoch) || identityEpoch < 0) {
        throw new RangeError("identityEpoch must be a non-negative safe integer");
    }
    return { identityEpoch, task: null, acknowledgedEventIds: [], pendingEventIds: [] };
}

/**
 * Accept server snapshots monotonically. A newer identity epoch replaces the
 * entire local task/ack/pending state; a 409 keeps unsent events pending and
 * never attempts an automatic merge.
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

    if (incoming.identityEpoch < current.identityEpoch) {
        return { accepted: false, autoMerged: false, reason: "stale-identity", state: current, needsReconciliation: false };
    }

    if (incoming.identityEpoch > current.identityEpoch) {
        return {
            accepted: true,
            autoMerged: false,
            reason: "accepted-new-identity",
            state: initialClientSnapshotState(incoming),
            needsReconciliation: Boolean(incoming.conflict),
        };
    }

    if (!current.task) {
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
    if (incoming.task.sessionId !== current.task.sessionId) {
        return { accepted: false, autoMerged: false, reason: "different-session", state: current, needsReconciliation: false };
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

/** Authorized REST callers receive the protected editing snapshot. */
export function projectTaskForAuthorizedRest(task: AgentTask): AgentTask {
    return AgentTaskSchema.parse(task);
}

function fieldStatus(field: ClientWriteField, task: AgentTask): AgentTaskSafeFieldStatus {
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

/** Safe model/chat projection never copies values or presentation labels. */
export function projectTaskForSafeChat(task: AgentTask): AgentTaskSafeSnapshot {
    const parsedTask = AgentTaskSchema.parse(task);
    return AgentTaskSafeSnapshotSchema.parse({
        schemaVersion: parsedTask.schemaVersion,
        taskId: parsedTask.taskId,
        sessionId: parsedTask.sessionId,
        kind: parsedTask.kind,
        capabilityId: parsedTask.capabilityId,
        revision: parsedTask.revision,
        state: parsedTask.state,
        fieldStatus: CLIENT_WRITE_FIELD_NAMES.map((field) => fieldStatus(field, parsedTask)),
        constraints: parsedTask.constraints,
        target: parsedTask.target ? { targetRef: parsedTask.target.targetRef } : null,
        choiceSets: parsedTask.choiceSets.map((choiceSet) => ({
            choiceSetRef: choiceSet.choiceSetRef,
            optionIds: choiceSet.options.map((option) => option.optionId),
        })),
        orderedChoiceRefs: parsedTask.orderedChoiceRefs,
        issues: parsedTask.issues.map(({ code, field, severity }) => ({ code, ...(field ? { field } : {}), severity })),
        action: parsedTask.action ? { actionId: parsedTask.action.actionId } : null,
        consent: { choice: parsedTask.consent.choice, hasServerBinding: parsedTask.consent.binding !== null },
        times: {
            createdAt: parsedTask.times.createdAt,
            updatedAt: parsedTask.times.updatedAt,
            ...(parsedTask.times.expiresAt ? { expiresAt: parsedTask.times.expiresAt } : {}),
        },
        currentSnapshotRef: parsedTask.currentSnapshotRef,
    });
}
