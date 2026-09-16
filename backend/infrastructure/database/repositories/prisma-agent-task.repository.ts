import { Injectable } from "@nestjs/common";
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
    return ACTIVE_TASK_STATES.has(status) ? 1 : null;
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
