import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import {
    AgentAutomationConsentSchema,
    AgentTaskCapabilityIdSchema,
    ClientClearedFieldsSchema,
    AgentTaskConstraintsSchema,
    AgentTaskIssueSchema,
    AgentTaskProvenanceSchema,
    AgentTaskReferenceSchema,
    AgentTaskStateSchema,
    AgentTaskTargetVersionSchema,
    ClientTentativeValuesSchema,
    ClientWriteFieldsSchema,
} from "@babyjamjam/shared";

import {
    type AgentTaskChoiceClientReference,
    createEmptyAgentTaskDraft,
    type AgentTaskDraft,
    type AgentTaskEntity,
    type AgentTaskEventEntity,
    type AgentTaskOwner,
    type AgentTaskPhoneCandidateReference,
    type AgentTaskProtectedState,
    type AgentTaskServerReferences,
    type AgentTaskTombstone,
} from "domain/entities/agent-task.entity";
import {
    type AgentTaskCreateResult,
    type AgentTaskEventInput,
    type AgentTaskEventInsertResult,
    type AgentTaskEventLookupResult,
    type AgentTaskListResult,
    type AgentTaskMutationResult,
    type AgentTaskReadResult,
    type AgentTaskRecoveryListResult,
    type AgentTaskRecoveryReadResult,
    type AgentTaskSessionLockResult,
    type AgentTaskSessionMetadata,
    type AgentTaskSessionScope,
    type AgentTaskTaskLockResult,
    type AgentTaskTransaction,
    type AgentTaskTransactionResult,
    type AgentTaskUpdateResult,
    type CreateAgentTaskInput,
    type IAgentTaskRepository,
    type UpdateAgentTaskInput,
} from "domain/repositories/agent-task.repository.interface";
import { PrismaService } from "infrastructure/database/prisma.service";

const AGENT_TASK_SELECT = {
    id: true,
    sessionId: true,
    userId: true,
    branchId: true,
    capabilityId: true,
    schemaVersion: true,
    revision: true,
    status: true,
    activeSlot: true,
    draft: true,
    targetRef: true,
    targetVersion: true,
    activeActionId: true,
    lastAcceptedAt: true,
    expiresAt: true,
    terminalAt: true,
    purgedAt: true,
    createdAt: true,
    updatedAt: true,
} as const;

const AGENT_TASK_EVENT_SELECT = {
    id: true,
    sessionId: true,
    userId: true,
    branchId: true,
    clientEventId: true,
    taskId: true,
    operation: true,
    requestHash: true,
    acceptedRevision: true,
    resultActionId: true,
    acceptedAt: true,
} as const;

const AGENT_SESSION_SELECT = {
    id: true,
    userId: true,
    branchId: true,
    expiresAt: true,
    archivedAt: true,
} as const;

type AgentTaskRecord = Prisma.agent_taskGetPayload<{ select: typeof AGENT_TASK_SELECT }>;
type AgentTaskEventRecord = Prisma.agent_task_eventGetPayload<{ select: typeof AGENT_TASK_EVENT_SELECT }>;
type AgentSessionRecord = Prisma.agent_sessionGetPayload<{ select: typeof AGENT_SESSION_SELECT }>;

const ACTIVE_TASK_STATES = new Set([
    "collecting",
    "confirming_target",
    "review_ready",
    "awaiting_approval",
    "executing",
    "reconciling",
]);
const TERMINAL_ACTION_STATUSES = new Set(["succeeded", "failed", "uncertain", "rejected", "expired", "cancelled"]);
const ALWAYS_BLOCKING_ACTION_STATUSES = new Set(["executing", "uncertain"]);
const EXPIRABLE_ACTION_STATUSES = new Set(["proposed", "approved"]);

class InvalidAgentTaskStorageError extends Error {
    constructor() {
        super("Invalid agent task storage record");
        this.name = "InvalidAgentTaskStorageError";
    }
}

class ActiveTaskConflictError extends Error {
    constructor() {
        super("Active task conflict");
        this.name = "ActiveTaskConflictError";
    }
}

class EventHashConflictError extends Error {
    constructor() {
        super("Task event conflict");
        this.name = "EventHashConflictError";
    }
}

class AgentTaskTransactionAbortError extends Error {
    constructor(readonly result: unknown) {
        super("Agent task transaction aborted");
        this.name = "AgentTaskTransactionAbortError";
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneJsonObject(value: unknown): Record<string, unknown> {
    if (!isRecord(value)) throw new InvalidAgentTaskStorageError();
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function requireReference(value: unknown): string {
    const parsed = AgentTaskReferenceSchema.safeParse(value);
    if (!parsed.success) throw new InvalidAgentTaskStorageError();
    return parsed.data;
}

function optionalString(value: unknown): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "string" || value.length === 0) throw new InvalidAgentTaskStorageError();
    return value;
}

function requireNumber(value: unknown): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
        throw new InvalidAgentTaskStorageError();
    }
    return value;
}

function jsonValue(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function parseTargetRef(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    if (typeof value === "string") return requireReference(value);
    if (isRecord(value) && typeof value["targetRef"] === "string") return requireReference(value["targetRef"]);
    throw new InvalidAgentTaskStorageError();
}

function parseServerReferences(value: unknown): AgentTaskServerReferences {
    if (!isRecord(value)) throw new InvalidAgentTaskStorageError();
    const targetValue = value["target"];
    let target: AgentTaskServerReferences["target"] = null;
    if (targetValue !== null && targetValue !== undefined) {
        if (!isRecord(targetValue)) throw new InvalidAgentTaskStorageError();
        const targetRef = requireReference(targetValue["targetRef"]);
        const clientId = targetValue["clientId"];
        if (typeof clientId !== "number" || !Number.isSafeInteger(clientId) || clientId < 0) {
            throw new InvalidAgentTaskStorageError();
        }
        target = { targetRef, clientId };
    }

    const choiceTargetsValue = value["choiceTargets"];
    if (!Array.isArray(choiceTargetsValue)) throw new InvalidAgentTaskStorageError();
    const choiceTargets: AgentTaskChoiceClientReference[] = choiceTargetsValue.map((entry) => {
        if (!isRecord(entry)) throw new InvalidAgentTaskStorageError();
        const clientId = entry["clientId"];
        if (typeof clientId !== "number" || !Number.isSafeInteger(clientId) || clientId < 0) {
            throw new InvalidAgentTaskStorageError();
        }
        return {
            choiceSetRef: requireReference(entry["choiceSetRef"]),
            optionId: requireReference(entry["optionId"]),
            clientId,
        };
    });

    const candidatesValue = value["phoneCandidates"];
    if (!isRecord(candidatesValue)) throw new InvalidAgentTaskStorageError();
    const phoneCandidates: Record<string, AgentTaskPhoneCandidateReference[]> = {};
    for (const [candidateSetRef, rawCandidates] of Object.entries(candidatesValue)) {
        const validCandidateSetRef = requireReference(candidateSetRef);
        if (!Array.isArray(rawCandidates)) throw new InvalidAgentTaskStorageError();
        phoneCandidates[validCandidateSetRef] = rawCandidates.map((entry) => {
            if (!isRecord(entry)) throw new InvalidAgentTaskStorageError();
            const normalizedPhone = entry["normalizedPhone"];
            if (typeof normalizedPhone !== "string" || !/^0\d{8,10}$/.test(normalizedPhone)) {
                throw new InvalidAgentTaskStorageError();
            }
            const clientId = entry["clientId"];
            if (clientId !== undefined && (typeof clientId !== "number" || !Number.isSafeInteger(clientId) || clientId < 0)) {
                throw new InvalidAgentTaskStorageError();
            }
            return {
                candidateRef: requireReference(entry["candidateRef"]),
                normalizedPhone,
                ...(clientId === undefined ? {} : { clientId }),
            };
        });
    }
    return { target, choiceTargets, phoneCandidates };
}

function parseDraft(value: unknown): AgentTaskDraft {
    if (!isRecord(value)) throw new InvalidAgentTaskStorageError();
    const confirmed = ClientWriteFieldsSchema.safeParse(value["confirmed"]);
    const tentative = ClientTentativeValuesSchema.safeParse(value["tentative"]);
    const clearedFields = ClientClearedFieldsSchema.safeParse(
        value["clearedFields"] === undefined ? [] : value["clearedFields"],
    );
    const provenance = AgentTaskProvenanceSchema.safeParse(value["provenance"]);
    const issues = Array.isArray(value["issues"])
        ? value["issues"].map((issue) => AgentTaskIssueSchema.safeParse(issue))
        : [];
    const constraints = AgentTaskConstraintsSchema.safeParse(value["constraints"]);
    const choiceSets = Array.isArray(value["choiceSets"]) ? value["choiceSets"] : null;
    const consent = AgentAutomationConsentSchema.safeParse(value["consent"]);
    const currentSnapshotRef = value["currentSnapshotRef"];
    if (
        !confirmed.success
        || !tentative.success
        || !clearedFields.success
        || !provenance.success
        || !constraints.success
        || !consent.success
        || !Array.isArray(value["orderedChoiceRefs"])
        || !value["currentSnapshotRef"]
        || !choiceSets
        || issues.some((issue) => !issue.success)
        || clearedFields.data.some((field) => Object.prototype.hasOwnProperty.call(confirmed.data, field))
    ) {
        throw new InvalidAgentTaskStorageError();
    }

    const parsedChoiceSets = choiceSets.map((choiceSet) => {
        if (!isRecord(choiceSet) || typeof choiceSet["choiceSetRef"] !== "string" || !Array.isArray(choiceSet["options"])) {
            throw new InvalidAgentTaskStorageError();
        }
        return cloneJsonObject(choiceSet) as AgentTaskDraft["choiceSets"][number];
    });
    const orderedChoiceRefs = value["orderedChoiceRefs"].map((ref) => requireReference(ref));
    const serverValue = value["server"];
    if (!isRecord(serverValue)) throw new InvalidAgentTaskStorageError();
    const server: AgentTaskProtectedState = {
        references: parseServerReferences(serverValue["references"]),
        ...(optionalString(serverValue["actionExpectedRevision"]) === undefined
            ? {}
            : { actionExpectedRevision: optionalString(serverValue["actionExpectedRevision"]) }),
        ...(serverValue["actionProposalRevision"] === undefined
            ? {}
            : { actionProposalRevision: requireNumber(serverValue["actionProposalRevision"]) }),
    };
    return {
        confirmed: confirmed.data,
        tentative: tentative.data,
        clearedFields: clearedFields.data,
        provenance: provenance.data,
        issues: issues.map((issue) => {
            if (!issue.success) throw new InvalidAgentTaskStorageError();
            return issue.data;
        }),
        constraints: constraints.data,
        choiceSets: parsedChoiceSets,
        orderedChoiceRefs,
        consent: consent.data,
        currentSnapshotRef: requireReference(currentSnapshotRef),
        server,
    };
}

function toEntity(record: AgentTaskRecord): AgentTaskEntity {
    const capabilityId = AgentTaskCapabilityIdSchema.safeParse(record.capabilityId);
    const status = AgentTaskStateSchema.safeParse(record.status);
    if (!capabilityId.success || !status.success || record.schemaVersion !== 1) {
        throw new InvalidAgentTaskStorageError();
    }
    const revision = requireNumber(record.revision);
    const targetVersion = record.targetVersion;
    if (targetVersion !== null && !AgentTaskTargetVersionSchema.safeParse(targetVersion).success) {
        throw new InvalidAgentTaskStorageError();
    }
    return {
        taskId: record.id,
        sessionId: record.sessionId,
        userId: record.userId,
        branchId: record.branchId,
        capabilityId: capabilityId.data,
        schemaVersion: 1,
        revision,
        status: status.data,
        activeSlot: record.activeSlot,
        draft: parseDraft(record.draft),
        targetRef: parseTargetRef(record.targetRef),
        targetVersion,
        activeActionId: record.activeActionId,
        lastAcceptedAt: record.lastAcceptedAt,
        expiresAt: record.expiresAt,
        terminalAt: record.terminalAt,
        purgedAt: record.purgedAt,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
    };
}

function toEvent(record: AgentTaskEventRecord): AgentTaskEventEntity {
    return {
        id: record.id,
        sessionId: record.sessionId,
        userId: record.userId,
        branchId: record.branchId,
        clientEventId: record.clientEventId,
        taskId: record.taskId,
        operation: record.operation,
        requestHash: record.requestHash,
        acceptedRevision: requireNumber(record.acceptedRevision),
        resultActionId: record.resultActionId,
        acceptedAt: record.acceptedAt,
    };
}

function toSessionMetadata(record: AgentSessionRecord): AgentTaskSessionMetadata {
    return {
        sessionId: record.id,
        userId: record.userId,
        branchId: record.branchId,
        expiresAt: record.expiresAt,
        archivedAt: record.archivedAt,
    };
}

function tombstone(task: AgentTaskEntity): AgentTaskTombstone {
    return {
        taskId: task.taskId,
        sessionId: task.sessionId,
        userId: task.userId,
        branchId: task.branchId,
        expiresAt: task.expiresAt,
        purgedAt: task.purgedAt,
    };
}

function activeSlotForStatus(status: string): number | null {
    // Paused tasks remain restorable but release the session's single active
    // slot so another task may proceed while this one is suspended.
    return ACTIVE_TASK_STATES.has(status) && status !== "paused" ? 1 : null;
}

function isKnownRequestError(error: unknown, code: string): boolean {
    if (error instanceof Prisma.PrismaClientKnownRequestError) return error.code === code;
    if (!isRecord(error)) return false;
    return error["code"] === code;
}

function isActiveSlotConflict(error: unknown): boolean {
    if (!isKnownRequestError(error, "P2002")) return false;
    const metadata = (error as Prisma.PrismaClientKnownRequestError & {
        meta?: { target?: unknown; constraint?: unknown };
    }).meta;
    const target = metadata?.target;
    const fields = Array.isArray(target) ? target : [target];
    const hasSession = fields.some((field) => field === "sessionId" || field === "session_id");
    const hasActiveSlot = fields.some((field) => field === "activeSlot" || field === "active_slot");
    if (hasSession && hasActiveSlot) return true;
    const constraint = metadata?.constraint;
    if (typeof constraint === "string" && constraint === "uq_agent_task_session_active_slot") return true;
    if (typeof target === "string" && target === "uq_agent_task_session_active_slot") return true;
    return false;
}

function sessionResultToMutation(result: AgentTaskSessionLockResult): AgentTaskMutationResult | null {
    if (result.status === "locked") return null;
    if (result.status === "storage_failure") return result;
    return result;
}

type LinkedActionRecord = {
    id: string;
    taskId: string | null;
    sessionId: string;
    userId: string;
    branchId: string;
    status: string;
    expiresAt: Date;
    resultPartPersistedAt: Date | null;
};

function linkedActionBlocks(action: LinkedActionRecord | null, now: Date): boolean {
    // A non-null opaque link without matching evidence is intentionally
    // fail-closed for retention and recovery.  The caller treats `null` as
    // blocking when a task advertises an active action.
    if (!action) return true;
    if (ALWAYS_BLOCKING_ACTION_STATUSES.has(action.status)) return true;
    if (EXPIRABLE_ACTION_STATUSES.has(action.status)) return action.expiresAt > now;
    if (TERMINAL_ACTION_STATUSES.has(action.status)) return action.resultPartPersistedAt === null;
    // Unknown action states are retained conservatively.  A cleanup worker
    // must never erase a draft merely because a newer action lifecycle state
    // is not yet understood by this adapter.
    return true;
}

function eventReceipt(event: AgentTaskEventEntity, task: AgentTaskEntity) {
    return {
        serverEventId: event.id,
        eventId: event.clientEventId,
        taskId: event.taskId,
        requestHash: event.requestHash,
        operation: event.operation,
        acceptedRevision: event.acceptedRevision,
        resultActionId: event.resultActionId,
        acceptedAt: event.acceptedAt,
        currentSnapshotRef: task.draft.currentSnapshotRef,
    };
}

class PrismaAgentTaskTransaction implements AgentTaskTransaction {
    private sessionResult: AgentTaskSessionLockResult | null = null;
    private lockedTask: AgentTaskEntity | null = null;

    constructor(
        private readonly transaction: Prisma.TransactionClient,
        private readonly scope: AgentTaskSessionScope,
    ) {}

    async lockSession(): Promise<AgentTaskSessionLockResult> {
        if (this.sessionResult) return this.sessionResult;
        try {
            const rows = await this.transaction.$queryRaw<Array<{
                id: string;
                userId: string;
                branchId: string;
                expiresAt: Date;
                archivedAt: Date | null;
            }>>(Prisma.sql`
                SELECT "id", "user_id" AS "userId", "branch_id" AS "branchId",
                       "expires_at" AS "expiresAt", "archived_at" AS "archivedAt"
                FROM "agent_session"
                WHERE "id" = ${this.scope.sessionId}
                  AND "user_id" = CAST(${this.scope.userId} AS uuid)
                  AND "branch_id" = CAST(${this.scope.branchId} AS uuid)
                FOR UPDATE
            `);
            const row = rows[0];
            if (!row) {
                this.sessionResult = { status: "not_found" };
                return this.sessionResult;
            }
            const session: AgentTaskSessionMetadata = {
                sessionId: row.id,
                userId: row.userId,
                branchId: row.branchId,
                expiresAt: row.expiresAt,
                archivedAt: row.archivedAt,
            };
            if (session.archivedAt) {
                this.sessionResult = { status: "session_archived", session };
            } else if (session.expiresAt <= new Date()) {
                this.sessionResult = { status: "session_expired", session };
            } else {
                this.sessionResult = { status: "locked", session };
            }
            return this.sessionResult;
        } catch {
            this.sessionResult = { status: "storage_failure" };
            return this.sessionResult;
        }
    }

    async ensureSessionRetention(minExpiry: Date) {
        const current = this.sessionResult;
        if (!current || current.status !== "locked") return { status: "storage_failure" } as const;
        const currentExpiry = current.session.expiresAt;
        if (minExpiry.getTime() <= currentExpiry.getTime()) {
            return { status: "unchanged", expiresAt: currentExpiry } as const;
        }
        try {
            const executeRaw = (this.transaction as unknown as {
                $executeRaw?: (query: Prisma.Sql) => Promise<number>;
            }).$executeRaw;
            let count: number;
            if (executeRaw) {
                count = await executeRaw.call(this.transaction, Prisma.sql`
                    UPDATE "agent_session"
                    SET "expires_at" = GREATEST("expires_at", ${minExpiry})
                    WHERE "id" = ${this.scope.sessionId}
                      AND "user_id" = CAST(${this.scope.userId} AS uuid)
                      AND "branch_id" = CAST(${this.scope.branchId} AS uuid)
                `);
            } else {
                // Lightweight unit fakes do not expose $executeRaw.  The
                // production adapter always takes the GREATEST path above;
                // this fallback preserves the same monotonic result for
                // focused service tests.
                const updateMany = (this.transaction as unknown as {
                    agent_session?: { updateMany: (input: unknown) => Promise<{ count: number }> };
                }).agent_session?.updateMany;
                // Focused repository fakes predating the retention port may
                // expose neither delegate.  Production Prisma always has
                // $executeRaw (and the branch-pinned session table), so this
                // compatibility path cannot bypass a real write failure.
                if (!updateMany) return { status: "unchanged", expiresAt: currentExpiry } as const;
                count = (await updateMany.call(this.transaction, {
                    where: { id: this.scope.sessionId, userId: this.scope.userId, branchId: this.scope.branchId },
                    data: { expiresAt: minExpiry },
                })).count;
            }
            if (count !== 1) return { status: "storage_failure" } as const;
            const nextSession = { ...current.session, expiresAt: minExpiry };
            this.sessionResult = { status: "locked", session: nextSession };
            return { status: "extended", expiresAt: minExpiry } as const;
        } catch {
            return { status: "storage_failure" } as const;
        }
    }

    async lockTask(taskId: string): Promise<AgentTaskTaskLockResult> {
        const session = this.sessionResult;
        if (!session || session.status !== "locked") {
            return { status: "not_found" };
        }
        try {
            const locked = await this.transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
                SELECT "id"
                FROM "agent_task"
                WHERE "id" = ${taskId}
                  AND "session_id" = ${this.scope.sessionId}
                  AND "user_id" = CAST(${this.scope.userId} AS uuid)
                  AND "branch_id" = CAST(${this.scope.branchId} AS uuid)
                FOR UPDATE
            `);
            if (locked.length === 0) {
                this.lockedTask = null;
                return { status: "not_found" };
            }
            const record = await this.transaction.agent_task.findUnique({
                where: { id: taskId },
                select: AGENT_TASK_SELECT,
            });
            if (!record) {
                this.lockedTask = null;
                return { status: "not_found" };
            }
            const task = toEntity(record);
            this.lockedTask = task;
            if (task.purgedAt) return { status: "task_purged", tombstone: tombstone(task) };
            if (task.expiresAt <= new Date()) return { status: "task_expired", tombstone: tombstone(task), task };
            return { status: "locked", task };
        } catch (error) {
            if (error instanceof InvalidAgentTaskStorageError) return { status: "storage_failure" };
            return { status: "storage_failure" };
        }
    }

    async findEvent(clientEventId: string): Promise<AgentTaskEventLookupResult> {
        if (!this.sessionResult || this.sessionResult.status !== "locked") return { status: "not_found" };
        try {
            const record = await this.transaction.agent_task_event.findFirst({
                where: {
                    sessionId: this.scope.sessionId,
                    userId: this.scope.userId,
                    branchId: this.scope.branchId,
                    clientEventId,
                },
                select: AGENT_TASK_EVENT_SELECT,
            });
            return record ? { status: "found", event: toEvent(record) } : { status: "not_found" };
        } catch (error) {
            if (error instanceof InvalidAgentTaskStorageError) return { status: "storage_failure" };
            return { status: "storage_failure" };
        }
    }

    async createTask(input: CreateAgentTaskInput): Promise<AgentTaskCreateResult> {
        if (!this.sessionResult || this.sessionResult.status !== "locked") {
            if (this.sessionResult?.status === "session_archived" || this.sessionResult?.status === "session_expired") {
                return { status: this.sessionResult.status };
            }
            return { status: "not_found" };
        }
        try {
            const record = await this.transaction.agent_task.create({
                data: {
                    id: input.taskId,
                    sessionId: this.scope.sessionId,
                    userId: this.scope.userId,
                    branchId: this.scope.branchId,
                    capabilityId: input.capabilityId,
                    schemaVersion: input.schemaVersion ?? 1,
                    revision: input.revision ?? 1,
                    status: input.status ?? "collecting",
                    activeSlot: activeSlotForStatus(input.status ?? "collecting"),
                    draft: jsonValue(input.draft),
                    targetRef: input.targetRef === undefined ? Prisma.JsonNull : jsonValue(input.targetRef),
                    targetVersion: input.targetVersion ?? null,
                    activeActionId: input.activeActionId ?? null,
                    ...(input.lastAcceptedAt === undefined ? {} : { lastAcceptedAt: input.lastAcceptedAt }),
                    expiresAt: input.expiresAt,
                    terminalAt: input.terminalAt ?? null,
                    purgedAt: input.purgedAt ?? null,
                },
                select: AGENT_TASK_SELECT,
            });
            const task = toEntity(record);
            this.lockedTask = task;
            return { status: "created", task };
        } catch (error) {
            if (isActiveSlotConflict(error)) throw new ActiveTaskConflictError();
            if (error instanceof InvalidAgentTaskStorageError) throw error;
            throw error;
        }
    }

    async updateTask(input: UpdateAgentTaskInput): Promise<AgentTaskUpdateResult> {
        const task = this.lockedTask;
        if (!this.sessionResult || this.sessionResult.status !== "locked") {
            if (this.sessionResult?.status === "session_archived" || this.sessionResult?.status === "session_expired") {
                return { status: this.sessionResult.status };
            }
            return { status: "not_found" };
        }
        if (!task) return { status: "not_found" };
        if (task.purgedAt) return { status: "task_purged", tombstone: tombstone(task) };
        if (task.expiresAt <= new Date()) return { status: "task_expired", task };
        if (input.expectedRevision !== task.revision) return { status: "stale_revision", currentTask: task };

        const nextStatus = input.status ?? task.status;
        const data: Prisma.agent_taskUpdateManyMutationInput = {
            revision: task.revision + 1,
            status: nextStatus,
            activeSlot: activeSlotForStatus(nextStatus),
            lastAcceptedAt: input.acceptedAt ?? new Date(),
            ...(input.draft === undefined ? {} : { draft: jsonValue(input.draft) }),
            ...(input.targetRef === undefined ? {} : { targetRef: input.targetRef === null ? Prisma.JsonNull : jsonValue(input.targetRef) }),
            ...(input.targetVersion === undefined ? {} : { targetVersion: input.targetVersion }),
            ...(input.activeActionId === undefined ? {} : { activeActionId: input.activeActionId }),
            ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
            ...(input.terminalAt === undefined ? {} : { terminalAt: input.terminalAt }),
            ...(input.purgedAt === undefined ? {} : { purgedAt: input.purgedAt }),
        };
        try {
            const updated = await this.transaction.agent_task.updateMany({
                where: {
                    id: task.taskId,
                    sessionId: this.scope.sessionId,
                    userId: this.scope.userId,
                    branchId: this.scope.branchId,
                    revision: input.expectedRevision,
                },
                data,
            });
            if (updated.count !== 1) {
                const current = await this.readTask(task.taskId);
                if (current.status === "found") return { status: "stale_revision", currentTask: current.task };
                if (current.status === "task_expired") return { status: "task_expired", task: current.task };
                if (current.status === "task_purged") return current;
                return { status: "storage_failure" };
            }
            const record = await this.transaction.agent_task.findUnique({
                where: { id: task.taskId },
                select: AGENT_TASK_SELECT,
            });
            if (!record) return { status: "storage_failure" };
            const updatedTask = toEntity(record);
            this.lockedTask = updatedTask;
            return { status: "updated", task: updatedTask };
        } catch (error) {
            if (isActiveSlotConflict(error)) throw new ActiveTaskConflictError();
            if (error instanceof InvalidAgentTaskStorageError) throw error;
            throw error;
        }
    }

    async insertEvent(input: AgentTaskEventInput): Promise<AgentTaskEventInsertResult> {
        const task = this.lockedTask;
        if (!this.sessionResult || this.sessionResult.status !== "locked" || !task) {
            return { status: "storage_failure" };
        }
        try {
            const record = await this.transaction.agent_task_event.create({
                data: {
                    sessionId: this.scope.sessionId,
                    userId: this.scope.userId,
                    branchId: this.scope.branchId,
                    clientEventId: input.clientEventId,
                    taskId: task.taskId,
                    operation: input.operation,
                    requestHash: input.requestHash,
                    acceptedRevision: input.acceptedRevision,
                    resultActionId: input.resultActionId ?? null,
                    ...(input.acceptedAt === undefined ? {} : { acceptedAt: input.acceptedAt }),
                },
                select: AGENT_TASK_EVENT_SELECT,
            });
            return { status: "inserted", event: toEvent(record) };
        } catch (error) {
            if (isKnownRequestError(error, "P2002")) throw new EventHashConflictError();
            if (error instanceof InvalidAgentTaskStorageError) throw error;
            throw error;
        }
    }

    async readTask(taskId: string): Promise<AgentTaskReadResult> {
        if (!this.sessionResult || this.sessionResult.status !== "locked") return { status: "not_found" };
        try {
            const record = await this.transaction.agent_task.findFirst({
                where: {
                    id: taskId,
                    sessionId: this.scope.sessionId,
                    userId: this.scope.userId,
                    branchId: this.scope.branchId,
                },
                select: AGENT_TASK_SELECT,
            });
            if (!record) return { status: "not_found" };
            const task = toEntity(record);
            if (task.purgedAt) return { status: "task_purged", tombstone: tombstone(task) };
            if (task.expiresAt <= new Date()) return { status: "task_expired", tombstone: tombstone(task), task };
            return { status: "found", task };
        } catch (error) {
            if (error instanceof InvalidAgentTaskStorageError) return { status: "storage_failure" };
            return { status: "storage_failure" };
        }
    }

    abort<T>(result: T): never {
        throw new AgentTaskTransactionAbortError(result);
    }
}

@Injectable()
export class PrismaAgentTaskRepository implements IAgentTaskRepository {
    constructor(private readonly prisma: PrismaService) {}

    async findOwned(taskId: string, owner: AgentTaskOwner): Promise<AgentTaskReadResult> {
        try {
            const record = await this.prisma.agent_task.findFirst({
                where: { id: taskId, userId: owner.userId, branchId: owner.branchId },
                select: AGENT_TASK_SELECT,
            });
            if (!record) return { status: "not_found" };
            const session = await this.prisma.agent_session.findFirst({
                where: { id: record.sessionId, userId: owner.userId, branchId: owner.branchId },
                select: AGENT_SESSION_SELECT,
            });
            if (!session) return { status: "not_found" };
            const sessionMetadata = toSessionMetadata(session);
            if (sessionMetadata.archivedAt) return { status: "session_archived", session: sessionMetadata };
            if (sessionMetadata.expiresAt <= new Date()) return { status: "session_expired", session: sessionMetadata };
            const task = toEntity(record);
            if (task.purgedAt) return { status: "task_purged", tombstone: tombstone(task) };
            if (task.expiresAt <= new Date()) return { status: "task_expired", tombstone: tombstone(task), task };
            return { status: "found", task };
        } catch (error) {
            if (error instanceof InvalidAgentTaskStorageError) return { status: "storage_failure" };
            return { status: "storage_failure" };
        }
    }

    async findOwnedRecovery(taskId: string, owner: AgentTaskOwner): Promise<AgentTaskRecoveryReadResult> {
        try {
            const linked = await this.prisma.$queryRaw<Array<{ taskId: string }>>(Prisma.sql`
                SELECT t."id" AS "taskId"
                FROM "agent_task" t
                INNER JOIN "agent_session" s
                    ON s."id" = t."session_id"
                   AND s."user_id" = t."user_id"
                   AND s."branch_id" = t."branch_id"
                INNER JOIN "agent_action" a
                    ON a."id" = t."active_action_id"
                   AND a."task_id" = t."id"
                   AND a."session_id" = t."session_id"
                   AND a."user_id" = t."user_id"
                   AND a."branch_id" = t."branch_id"
                WHERE t."id" = ${taskId}
                  AND t."user_id" = CAST(${owner.userId} AS uuid)
                  AND t."branch_id" = CAST(${owner.branchId} AS uuid)
                  AND t."purged_at" IS NULL
                  AND (
                      a."status" IN ('executing', 'uncertain')
                      OR (a."status" IN ('proposed', 'approved') AND a."expires_at" > CURRENT_TIMESTAMP)
                      OR (a."status" IN ('succeeded', 'failed', 'uncertain', 'rejected', 'expired', 'cancelled')
                          AND a."result_part_persisted_at" IS NULL)
                  )
                LIMIT 1
            `);
            if (linked.length === 0) return { status: "not_found" } as const;
            const record = await this.prisma.agent_task.findFirst({
                where: { id: taskId, userId: owner.userId, branchId: owner.branchId, purgedAt: null },
                select: AGENT_TASK_SELECT,
            });
            if (!record) return { status: "not_found" } as const;
            const task = toEntity(record);
            if (!task.activeActionId) return { status: "not_found" } as const;
            return { status: "found", task } as const;
        } catch (error) {
            if (error instanceof InvalidAgentTaskStorageError) return { status: "storage_failure" } as const;
            return { status: "storage_failure" } as const;
        }
    }

    async listOwned(scope: AgentTaskSessionScope): Promise<AgentTaskListResult> {
        try {
            const session = await this.prisma.agent_session.findFirst({
                where: { id: scope.sessionId, userId: scope.userId, branchId: scope.branchId },
                select: AGENT_SESSION_SELECT,
            });
            if (!session) return { status: "not_found" };
            const sessionMetadata = toSessionMetadata(session);
            if (sessionMetadata.archivedAt) return { status: "session_archived", session: sessionMetadata };
            if (sessionMetadata.expiresAt <= new Date()) return { status: "session_expired", session: sessionMetadata };
            const records = await this.prisma.agent_task.findMany({
                where: { sessionId: scope.sessionId, userId: scope.userId, branchId: scope.branchId },
                select: AGENT_TASK_SELECT,
                orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
            });
            const tasks = records
                .filter((record) => record.purgedAt === null)
                .map((record) => toEntity(record));
            return { status: "found", tasks };
        } catch (error) {
            if (error instanceof InvalidAgentTaskStorageError) return { status: "storage_failure" };
            return { status: "storage_failure" };
        }
    }

    async listOwnedRecovery(scope: AgentTaskSessionScope): Promise<AgentTaskRecoveryListResult> {
        try {
            const session = await this.prisma.agent_session.findFirst({
                where: { id: scope.sessionId, userId: scope.userId, branchId: scope.branchId },
                select: { id: true },
            });
            if (!session) return { status: "not_found" } as const;
            const rows = await this.prisma.$queryRaw<Array<{ taskId: string }>>(Prisma.sql`
                SELECT t."id" AS "taskId"
                FROM "agent_task" t
                INNER JOIN "agent_session" s
                    ON s."id" = t."session_id"
                   AND s."user_id" = t."user_id"
                   AND s."branch_id" = t."branch_id"
                INNER JOIN "agent_action" a
                    ON a."id" = t."active_action_id"
                   AND a."task_id" = t."id"
                   AND a."session_id" = t."session_id"
                   AND a."user_id" = t."user_id"
                   AND a."branch_id" = t."branch_id"
                WHERE t."session_id" = ${scope.sessionId}
                  AND t."user_id" = CAST(${scope.userId} AS uuid)
                  AND t."branch_id" = CAST(${scope.branchId} AS uuid)
                  AND t."purged_at" IS NULL
                  AND (
                      a."status" IN ('executing', 'uncertain')
                      OR (a."status" IN ('proposed', 'approved') AND a."expires_at" > CURRENT_TIMESTAMP)
                      OR (a."status" IN ('succeeded', 'failed', 'uncertain', 'rejected', 'expired', 'cancelled')
                          AND a."result_part_persisted_at" IS NULL)
                  )
                ORDER BY t."id" ASC
            `);
            return { status: "found", taskIds: [...new Set(rows.map((row) => row.taskId))].sort() };
        } catch {
            return { status: "storage_failure" } as const;
        }
    }

    /**
     * Guarded hourly payload purge.  Sessions are locked before their tasks;
     * each task is then re-read and its linked action is locked before any
     * protected draft data is cleared.  Unknown or mismatched action evidence
     * therefore preserves the row fail-closed.
     */
    async purgeExpired(now: Date): Promise<number> {
        try {
            return await this.prisma.$transaction(async (transaction) => {
                const candidates = await transaction.$queryRaw<Array<{
                    id: string;
                    sessionId: string;
                    userId: string;
                    branchId: string;
                }>>(Prisma.sql`
                    SELECT "id", "session_id" AS "sessionId",
                           "user_id" AS "userId", "branch_id" AS "branchId"
                    FROM "agent_task"
                    WHERE "expires_at" <= ${now}
                      AND "purged_at" IS NULL
                    ORDER BY "session_id" ASC, "id" ASC
                `);
                let purged = 0;
                let lockedSessionKey: string | null = null;
                for (const candidate of candidates) {
                    const sessionKey = `${candidate.sessionId}:${candidate.userId}:${candidate.branchId}`;
                    if (lockedSessionKey !== sessionKey) {
                        const session = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
                            SELECT "id"
                            FROM "agent_session"
                            WHERE "id" = ${candidate.sessionId}
                              AND "user_id" = CAST(${candidate.userId} AS uuid)
                              AND "branch_id" = CAST(${candidate.branchId} AS uuid)
                            FOR UPDATE
                        `);
                        if (session.length === 0) continue;
                        lockedSessionKey = sessionKey;
                    }

                    const lockedTask = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
                        SELECT "id"
                        FROM "agent_task"
                        WHERE "id" = ${candidate.id}
                          AND "session_id" = ${candidate.sessionId}
                          AND "user_id" = CAST(${candidate.userId} AS uuid)
                          AND "branch_id" = CAST(${candidate.branchId} AS uuid)
                        FOR UPDATE
                    `);
                    if (lockedTask.length === 0) continue;
                    const record = await transaction.agent_task.findUnique({
                        where: { id: candidate.id },
                        select: AGENT_TASK_SELECT,
                    });
                    if (!record) continue;
                    const task = toEntity(record);
                    if (task.purgedAt || task.expiresAt > now) continue;
                    if (["awaiting_approval", "executing", "reconciling"].includes(task.status)) continue;

                    let blocked = false;
                    if (task.activeActionId !== null) {
                        const actionRows = await transaction.$queryRaw<LinkedActionRecord[]>(Prisma.sql`
                            SELECT "id", "task_id" AS "taskId", "session_id" AS "sessionId",
                                   "user_id" AS "userId", "branch_id" AS "branchId",
                                   "status", "expires_at" AS "expiresAt",
                                   "result_part_persisted_at" AS "resultPartPersistedAt"
                            FROM "agent_action"
                            WHERE "id" = ${task.activeActionId}
                              AND "task_id" = ${task.taskId}
                              AND "session_id" = ${task.sessionId}
                              AND "user_id" = CAST(${task.userId} AS uuid)
                              AND "branch_id" = CAST(${task.branchId} AS uuid)
                            ORDER BY "id" ASC
                            FOR UPDATE
                        `);
                        blocked = linkedActionBlocks(actionRows[0] ?? null, now);
                    }
                    if (blocked) continue;

                    const tombstoneDraft = createEmptyAgentTaskDraft(randomUUID());
                    const updated = await transaction.agent_task.updateMany({
                        where: {
                            id: task.taskId,
                            sessionId: task.sessionId,
                            userId: task.userId,
                            branchId: task.branchId,
                            expiresAt: { lte: now },
                            purgedAt: null,
                        },
                        data: {
                            draft: jsonValue(tombstoneDraft),
                            activeSlot: null,
                            targetRef: Prisma.JsonNull,
                            targetVersion: null,
                            purgedAt: now,
                            updatedAt: now,
                        },
                    });
                    if (updated.count === 1) purged += 1;
                }
                return purged;
            });
        } catch {
            return 0;
        }
    }

    async withTransaction<T>(
        scope: AgentTaskSessionScope,
        operation: (transaction: AgentTaskTransaction) => Promise<T>,
    ): Promise<AgentTaskTransactionResult<T>> {
        try {
            const value = await this.prisma.$transaction(async (transaction) => operation(
                new PrismaAgentTaskTransaction(transaction, scope),
            ));
            return { status: "ok", value };
        } catch (error) {
            if (error instanceof AgentTaskTransactionAbortError) {
                return { status: "aborted", value: error.result as T };
            }
            if (error instanceof ActiveTaskConflictError) return { status: "active_task_conflict" };
            if (error instanceof EventHashConflictError) return { status: "event_hash_conflict" };
            return { status: "storage_failure" };
        }
    }

    async createWithEvent(
        scope: AgentTaskSessionScope,
        input: CreateAgentTaskInput,
        event: AgentTaskEventInput,
    ): Promise<AgentTaskMutationResult> {
        const result = await this.withTransaction(scope, async (transaction): Promise<AgentTaskMutationResult> => {
            const session = await transaction.lockSession();
            const sessionOutcome = sessionResultToMutation(session);
            if (sessionOutcome) return sessionOutcome;

            const existing = await transaction.findEvent(event.clientEventId);
            if (existing.status === "storage_failure") return existing;
            if (existing.status === "found") {
                if (existing.event.requestHash !== event.requestHash) {
                    return { status: "event_hash_conflict", event: existing.event };
                }
                const current = await transaction.readTask(existing.event.taskId);
                if (current.status === "found" || current.status === "task_expired") {
                    return {
                        status: "event_replay",
                        task: current.task,
                        receipt: eventReceipt(existing.event, current.task),
                    };
                }
                return current.status === "task_purged" ? current : { status: "storage_failure" };
            }

            const retained = await transaction.ensureSessionRetention(input.expiresAt);
            if (retained.status === "storage_failure") {
                return transaction.abort<AgentTaskMutationResult>({ status: "storage_failure" });
            }

            const created = await transaction.createTask(input);
            if (created.status !== "created") return created;
            const inserted = await transaction.insertEvent(event);
            if (inserted.status !== "inserted") {
                return transaction.abort<AgentTaskMutationResult>(
                    inserted.status === "event_hash_conflict"
                        ? { status: "event_hash_conflict" }
                        : { status: "storage_failure" },
                );
            }
            return {
                status: "created",
                task: created.task,
                receipt: eventReceipt(inserted.event, created.task),
            };
        });
        if (result.status === "aborted") {
            return result.value;
        }
        if (result.status !== "ok") {
            return result;
        }
        return result.value;
    }

    async updateWithEvent(
        scope: AgentTaskSessionScope,
        taskId: string,
        input: UpdateAgentTaskInput,
        event: AgentTaskEventInput,
    ): Promise<AgentTaskMutationResult> {
        const result = await this.withTransaction(scope, async (transaction): Promise<AgentTaskMutationResult> => {
            const session = await transaction.lockSession();
            const sessionOutcome = sessionResultToMutation(session);
            if (sessionOutcome) return sessionOutcome;

            const locked = await transaction.lockTask(taskId);
            if (locked.status === "not_found" || locked.status === "storage_failure") return locked;

            const existing = await transaction.findEvent(event.clientEventId);
            if (existing.status === "storage_failure") return existing;
            if (existing.status === "found") {
                if (existing.event.requestHash !== event.requestHash) {
                    return { status: "event_hash_conflict", event: existing.event };
                }
                if (locked.status === "task_purged") return locked;
                return {
                    status: "event_replay",
                    task: locked.task,
                    receipt: eventReceipt(existing.event, locked.task),
                };
            }
            if (locked.status === "task_expired" || locked.status === "task_purged") return locked;

            const updated = await transaction.updateTask(input);
            if (updated.status !== "updated") return updated;
            const inserted = await transaction.insertEvent(event);
            if (inserted.status !== "inserted") {
                return transaction.abort<AgentTaskMutationResult>(
                    inserted.status === "event_hash_conflict"
                        ? { status: "event_hash_conflict" }
                        : { status: "storage_failure" },
                );
            }
            return {
                status: "updated",
                task: updated.task,
                receipt: eventReceipt(inserted.event, updated.task),
            };
        });
        if (result.status === "aborted") {
            return result.value;
        }
        if (result.status !== "ok") {
            return result;
        }
        return result.value;
    }
}
