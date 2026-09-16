"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentTaskSafeChatSnapshotSchema = exports.projectTaskForChat = exports.projectTaskForModel = exports.projectSafeTaskSnapshot = exports.projectTaskForAuthorized = exports.projectAuthorizedTaskSnapshot = exports.acceptTaskSnapshot = exports.applyTaskSnapshot = exports.reduceTaskSnapshot = exports.AgentTaskSnapshotEnvelopeSchema = exports.AgentTaskSnapshotConflictSchema = exports.AgentTaskSafeSnapshotSchema = exports.AgentTaskSafeChoiceSetSchema = exports.AgentTaskSafeFieldStatusSchema = void 0;
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
    valueRef: task_types_1.AgentTaskOpaqueRefSchema.optional(),
}).strict();
exports.AgentTaskSafeChoiceSetSchema = zod_1.z.object({
    choiceSetRef: task_types_1.AgentTaskOpaqueRefSchema,
    optionIds: zod_1.z.array(task_types_1.AgentTaskOpaqueRefSchema),
}).strict();
exports.AgentTaskSafeSnapshotSchema = zod_1.z.object({
    schemaVersion: zod_1.z.literal(1),
    taskId: task_types_1.AgentTaskOpaqueRefSchema,
    sessionId: task_types_1.AgentTaskOpaqueRefSchema,
    revision: task_types_1.AgentTaskRevisionSchema,
    state: task_types_1.AgentTaskStateSchema,
    fieldStatus: zod_1.z.array(exports.AgentTaskSafeFieldStatusSchema),
    constraints: zod_1.z.object({
        noSend: zod_1.z.boolean(),
        automationChoice: zod_1.z.enum(["unanswered", "yes", "no"]),
    }).strict(),
    target: zod_1.z.object({
        targetRef: task_types_1.AgentTaskOpaqueRefSchema,
        version: task_types_1.AgentTaskRevisionSchema,
    }).strict().nullable(),
    choiceSets: zod_1.z.array(exports.AgentTaskSafeChoiceSetSchema),
    orderedChoiceRefs: zod_1.z.array(task_types_1.AgentTaskOpaqueRefSchema),
    issues: zod_1.z.array(zod_1.z.object({
        code: zod_1.z.string().min(1),
        field: zod_1.z.string().min(1).optional(),
        severity: zod_1.z.enum(["info", "warning", "error"]),
    }).strict()),
    action: zod_1.z.object({
        actionId: task_types_1.AgentTaskOpaqueRefSchema,
        expectedRevision: task_types_1.AgentTaskRevisionSchema,
    }).strict().nullable(),
    consent: zod_1.z.object({
        choice: zod_1.z.enum(["unanswered", "yes", "no"]),
        hasServerBinding: zod_1.z.boolean(),
    }).strict(),
    times: zod_1.z.object({
        createdAt: task_types_1.AgentTaskIsoDateTimeSchema,
        updatedAt: task_types_1.AgentTaskIsoDateTimeSchema,
        expiresAt: task_types_1.AgentTaskIsoDateTimeSchema.optional(),
    }).strict(),
    currentSnapshotRef: task_types_1.AgentTaskOpaqueRefSchema,
}).strict();
exports.AgentTaskSnapshotConflictSchema = zod_1.z.object({
    status: zod_1.z.literal(409),
    latestRevision: task_types_1.AgentTaskRevisionSchema,
    latestSnapshotRef: task_types_1.AgentTaskOpaqueRefSchema.optional(),
}).strict();
exports.AgentTaskSnapshotEnvelopeSchema = zod_1.z.object({
    identityEpoch: zod_1.z.number().int().nonnegative(),
    task: task_types_1.AgentTaskSchema,
    acknowledgedEventId: task_types_1.AgentTaskOpaqueRefSchema.optional(),
    conflict: exports.AgentTaskSnapshotConflictSchema.optional(),
}).strict();
function revisionNumber(value) {
    if (typeof value === "number")
        return value;
    if (/^\d+$/.test(value))
        return Number(value);
    const suffix = value.match(/(?:^|[^\d])(\d+)$/)?.[1];
    return suffix ? Number(suffix) : null;
}
function compareRevisions(left, right) {
    const leftNumber = revisionNumber(left);
    const rightNumber = revisionNumber(right);
    if (leftNumber !== null && rightNumber !== null && leftNumber !== rightNumber) {
        return leftNumber > rightNumber ? 1 : -1;
    }
    if (String(left) === String(right))
        return 0;
    // Opaque revisions are intentionally not guessed.  Treat them as equal so
    // an untrusted client cannot replace a snapshot solely through ordering.
    return 0;
}
function stateWithAck(current, acknowledgedEventId) {
    if (!acknowledgedEventId || current.acknowledgedEventIds.includes(acknowledgedEventId))
        return current;
    return {
        ...current,
        acknowledgedEventIds: [...current.acknowledgedEventIds, acknowledgedEventId],
    };
}
function initialClientSnapshotState(envelope) {
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
function acceptAgentTaskSnapshot(current, incoming) {
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
exports.reduceTaskSnapshot = acceptAgentTaskSnapshot;
exports.applyTaskSnapshot = acceptAgentTaskSnapshot;
exports.acceptTaskSnapshot = acceptAgentTaskSnapshot;
/** Authorized REST callers receive the complete, protected editing snapshot. */
function projectTaskForAuthorizedRest(task) {
    return task_types_1.AgentTaskSchema.parse(task);
}
exports.projectAuthorizedTaskSnapshot = projectTaskForAuthorizedRest;
exports.projectTaskForAuthorized = projectTaskForAuthorizedRest;
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
/**
 * Model/chat projection.  It intentionally never spreads `confirmed` or
 * `tentative`; protected values are represented by availability and opaque
 * provenance references only.
 */
function projectTaskForSafeChat(task) {
    const parsedTask = task_types_1.AgentTaskSchema.parse(task);
    return exports.AgentTaskSafeSnapshotSchema.parse({
        schemaVersion: parsedTask.schemaVersion,
        taskId: parsedTask.taskId,
        sessionId: parsedTask.sessionId,
        revision: parsedTask.revision,
        state: parsedTask.state,
        fieldStatus: client_input_policy_1.CLIENT_WRITE_FIELD_NAMES.map((field) => fieldStatus(field, parsedTask)),
        constraints: parsedTask.constraints,
        target: parsedTask.target
            ? {
                targetRef: parsedTask.target.targetRef,
                version: parsedTask.target.version ?? parsedTask.target.targetVersion,
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
exports.projectSafeTaskSnapshot = projectTaskForSafeChat;
exports.projectTaskForModel = projectTaskForSafeChat;
exports.projectTaskForChat = projectTaskForSafeChat;
exports.AgentTaskSafeChatSnapshotSchema = exports.AgentTaskSafeSnapshotSchema;
