"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentTaskSnapshotEnvelopeSchema = exports.AgentTaskSnapshotConflictSchema = exports.AgentTaskSafeSnapshotSchema = exports.AgentTaskSafeChoiceSetSchema = exports.AgentTaskSafeFieldStatusSchema = void 0;
exports.createAgentTaskSnapshotState = createAgentTaskSnapshotState;
exports.captureAgentTaskSnapshotRequest = captureAgentTaskSnapshotRequest;
exports.resetAgentTaskSnapshotState = resetAgentTaskSnapshotState;
exports.acceptAgentTaskSnapshot = acceptAgentTaskSnapshot;
exports.projectTaskForAuthorizedRest = projectTaskForAuthorizedRest;
exports.projectTaskForSafeChat = projectTaskForSafeChat;
const zod_1 = require("zod");
const task_types_1 = require("./task-types");
const client_input_policy_1 = require("./client-input-policy");
const SafeFieldStatusSchema = zod_1.z.enum(["missing", "confirmed", "tentative", "confirmed-and-tentative"]);
exports.AgentTaskSafeFieldStatusSchema = zod_1.z.object({
    field: zod_1.z.enum(client_input_policy_1.CLIENT_WRITE_FIELD_NAMES),
    status: SafeFieldStatusSchema,
    valueRef: task_types_1.AgentTaskReferenceSchema.optional(),
}).strict();
exports.AgentTaskSafeChoiceSetSchema = zod_1.z.object({
    choiceSetRef: task_types_1.AgentTaskReferenceSchema,
    optionIds: zod_1.z.array(task_types_1.AgentTaskReferenceSchema),
}).strict();
/** Safe projection contains structural references/status only. */
exports.AgentTaskSafeSnapshotSchema = zod_1.z.object({
    schemaVersion: zod_1.z.literal(1),
    taskId: task_types_1.AgentTaskReferenceSchema,
    sessionId: task_types_1.AgentTaskReferenceSchema,
    kind: task_types_1.AgentTaskCapabilityIdSchema,
    capabilityId: task_types_1.AgentTaskCapabilityIdSchema,
    revision: task_types_1.AgentTaskRevisionSchema,
    state: task_types_1.AgentTaskStateSchema,
    fieldStatus: zod_1.z.array(exports.AgentTaskSafeFieldStatusSchema),
    constraints: zod_1.z.object({ noSend: zod_1.z.boolean() }).strict(),
    target: zod_1.z.object({ targetRef: task_types_1.AgentTaskReferenceSchema }).strict().nullable(),
    choiceSets: zod_1.z.array(exports.AgentTaskSafeChoiceSetSchema),
    orderedChoiceRefs: zod_1.z.array(task_types_1.AgentTaskReferenceSchema),
    issues: zod_1.z.array(zod_1.z.object({
        code: task_types_1.AgentTaskIssueCodeSchema,
        field: zod_1.z.enum(client_input_policy_1.CLIENT_WRITE_FIELD_NAMES).optional(),
        severity: zod_1.z.enum(["info", "warning", "error"]),
    }).strict()),
    action: zod_1.z.object({ actionId: task_types_1.AgentTaskReferenceSchema }).strict().nullable(),
    consent: zod_1.z.object({
        choice: zod_1.z.enum(["unanswered", "yes", "no"]),
        hasServerBinding: zod_1.z.boolean(),
    }).strict(),
    times: zod_1.z.object({
        createdAt: task_types_1.AgentTaskIsoDateTimeSchema,
        updatedAt: task_types_1.AgentTaskIsoDateTimeSchema,
        expiresAt: task_types_1.AgentTaskIsoDateTimeSchema.optional(),
    }).strict(),
    currentSnapshotRef: task_types_1.AgentTaskReferenceSchema,
}).strict().superRefine((value, context) => {
    if (value.kind !== value.capabilityId) {
        context.addIssue({ code: "custom", path: ["kind"], message: "Safe task kind must match capabilityId" });
    }
});
exports.AgentTaskSnapshotConflictSchema = zod_1.z.object({
    status: zod_1.z.literal(409),
    latestRevision: task_types_1.AgentTaskRevisionSchema,
    latestSnapshotRef: task_types_1.AgentTaskReferenceSchema.optional(),
}).strict();
exports.AgentTaskSnapshotEnvelopeSchema = zod_1.z.object({
    identityEpoch: zod_1.z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    task: task_types_1.AgentTaskSchema,
    acknowledgedEventId: task_types_1.AgentTaskReferenceSchema.optional(),
    conflict: exports.AgentTaskSnapshotConflictSchema.optional(),
}).strict();
function compareRevisions(left, right) {
    return left === right ? 0 : left > right ? 1 : -1;
}
function stateWithAck(current, acknowledgedEventId) {
    if (!acknowledgedEventId)
        return current;
    const acknowledgedEventIds = current.acknowledgedEventIds.includes(acknowledgedEventId)
        ? current.acknowledgedEventIds
        : [...current.acknowledgedEventIds, acknowledgedEventId];
    const pendingEventIds = current.pendingEventIds.filter((eventId) => eventId !== acknowledgedEventId);
    if (acknowledgedEventIds === current.acknowledgedEventIds && pendingEventIds.length === current.pendingEventIds.length)
        return current;
    return { ...current, acknowledgedEventIds, pendingEventIds };
}
function assertSafeCounter(value, name) {
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new RangeError(`${name} must be a non-negative safe integer`);
    }
}
function nextRequestGeneration(current) {
    assertSafeCounter(current, "requestGeneration");
    if (current === Number.MAX_SAFE_INTEGER) {
        throw new RangeError("requestGeneration cannot advance beyond Number.MAX_SAFE_INTEGER");
    }
    return current + 1;
}
function initialClientSnapshotState(envelope, requestGeneration) {
    assertSafeCounter(requestGeneration, "requestGeneration");
    return {
        identityEpoch: envelope.identityEpoch,
        requestGeneration,
        task: envelope.task,
        acknowledgedEventIds: envelope.acknowledgedEventId ? [envelope.acknowledgedEventId] : [],
        pendingEventIds: [],
    };
}
/** Create an empty client state before the first snapshot request. */
function createAgentTaskSnapshotState(identityEpoch = 0) {
    assertSafeCounter(identityEpoch, "identityEpoch");
    return {
        identityEpoch,
        requestGeneration: 0,
        task: null,
        acknowledgedEventIds: [],
        pendingEventIds: [],
    };
}
/** Capture the generation that a request carries until its response arrives. */
function captureAgentTaskSnapshotRequest(current) {
    assertSafeCounter(current.identityEpoch, "identityEpoch");
    assertSafeCounter(current.requestGeneration, "requestGeneration");
    return { identityEpoch: current.identityEpoch, requestGeneration: current.requestGeneration };
}
/**
 * Clear task/ack/pending state and advance the client generation. The
 * generation is intentionally derived from the current state so a caller
 * cannot accidentally reuse an in-flight request's generation after a task
 * or account switch. It is transport metadata, not a server authority field.
 */
function resetAgentTaskSnapshotState(current, nextIdentityEpoch = current.identityEpoch) {
    assertSafeCounter(current.identityEpoch, "identityEpoch");
    assertSafeCounter(current.requestGeneration, "requestGeneration");
    assertSafeCounter(nextIdentityEpoch, "identityEpoch");
    return {
        identityEpoch: nextIdentityEpoch,
        requestGeneration: nextRequestGeneration(current.requestGeneration),
        task: null,
        acknowledgedEventIds: [],
        pendingEventIds: [],
    };
}
/**
 * Accept server snapshots monotonically. A newer identity epoch replaces the
 * entire local task/ack/pending state; a 409 keeps unsent events pending and
 * never attempts an automatic merge. Callers must capture
 * `captureAgentTaskSnapshotRequest(state)` before dispatch and pass that same
 * context to this function when the response returns; capturing after the
 * response would defeat stale-response rejection.
 */
function acceptAgentTaskSnapshot(current, incoming, request) {
    assertSafeCounter(request.identityEpoch, "identityEpoch");
    assertSafeCounter(request.requestGeneration, "requestGeneration");
    if (!current) {
        if (incoming.identityEpoch < request.identityEpoch) {
            const state = createAgentTaskSnapshotState(request.identityEpoch);
            return { accepted: false, autoMerged: false, reason: "stale-identity", state, needsReconciliation: false };
        }
        return {
            accepted: true,
            autoMerged: false,
            reason: "accepted",
            state: initialClientSnapshotState(incoming, request.requestGeneration),
            needsReconciliation: Boolean(incoming.conflict),
        };
    }
    if (request.identityEpoch !== current.identityEpoch
        || request.requestGeneration !== current.requestGeneration) {
        return { accepted: false, autoMerged: false, reason: "stale-generation", state: current, needsReconciliation: false };
    }
    if (incoming.identityEpoch < current.identityEpoch) {
        return { accepted: false, autoMerged: false, reason: "stale-identity", state: current, needsReconciliation: false };
    }
    if (incoming.identityEpoch > current.identityEpoch) {
        return {
            accepted: true,
            autoMerged: false,
            reason: "accepted-new-identity",
            state: initialClientSnapshotState(incoming, current.requestGeneration),
            needsReconciliation: Boolean(incoming.conflict),
        };
    }
    if (!current.task) {
        return {
            accepted: true,
            autoMerged: false,
            reason: "accepted",
            state: initialClientSnapshotState(incoming, current.requestGeneration),
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
function projectTaskForAuthorizedRest(task) {
    return task_types_1.AgentTaskSchema.parse(task);
}
function fieldStatus(field, task) {
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
function projectTaskForSafeChat(task) {
    const parsedTask = task_types_1.AgentTaskSchema.parse(task);
    return exports.AgentTaskSafeSnapshotSchema.parse({
        schemaVersion: parsedTask.schemaVersion,
        taskId: parsedTask.taskId,
        sessionId: parsedTask.sessionId,
        kind: parsedTask.kind,
        capabilityId: parsedTask.capabilityId,
        revision: parsedTask.revision,
        state: parsedTask.state,
        fieldStatus: client_input_policy_1.CLIENT_WRITE_FIELD_NAMES.map((field) => fieldStatus(field, parsedTask)),
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
