import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";

import type { BjjUIMessage } from "@babyjamjam/shared";
import type {
    AgentSessionEntity,
    AgentSessionOwner,
    AgentSessionSummary,
    CreateAgentSessionInput,
} from "domain/entities/agent-session.entity";
import type {
    AgentSessionArchiveResult,
    AgentSessionDeleteResult,
    AgentSessionPatch,
    AgentSessionUnarchiveResult,
    IAgentSessionRepository,
} from "domain/repositories/agent-session.repository.interface";
import { PrismaService } from "infrastructure/database/prisma.service";
import {
    lifecycleTaskActionEvidenceBlocks,
    type AgentTaskLifecycleActionEvidence,
    type AgentTaskLifecycleTaskEvidence,
} from "./agent-task-lifecycle-evidence";

type AgentSessionRecord = Prisma.agent_sessionGetPayload<{ include: { messages: true } }>;
const ALWAYS_BLOCKING_ACTION_STATUSES = ["executing", "uncertain"];
const EXPIRABLE_ACTION_STATUSES = ["proposed", "approved"];
const TERMINAL_ACTION_STATUSES = ["succeeded", "failed", "uncertain", "rejected", "expired", "cancelled"];
const TERMINAL_TASK_STATES = ["completed", "failed", "cancelled"];

function ownerScope(owner: AgentSessionOwner) {
    return { userId: owner.userId, branchId: owner.branchId };
}

function blockingActionWhere(now: Date, owner?: AgentSessionOwner, includeUnpersistedTerminal = false) {
    const ownerScope = owner ? { userId: owner.userId, branchId: owner.branchId } : {};
    const OR: Prisma.agent_actionWhereInput[] = [
        { ...ownerScope, status: { in: ALWAYS_BLOCKING_ACTION_STATUSES } },
        { ...ownerScope, status: { in: EXPIRABLE_ACTION_STATUSES }, expiresAt: { gt: now } },
    ];
    if (includeUnpersistedTerminal) {
        OR.push({ ...ownerScope, status: { in: TERMINAL_ACTION_STATUSES }, resultPartPersistedAt: null });
    }
    return { OR };
}

function blockingTaskWhere(now: Date, owner?: AgentSessionOwner) {
    return {
        ...(owner ? { userId: owner.userId, branchId: owner.branchId } : {}),
        purgedAt: null,
        expiresAt: { gt: now },
        status: { notIn: TERMINAL_TASK_STATES },
    };
}

/**
 * Owner deletion retains the task tombstone boundary: an unpurged nonterminal
 * task remains a blocking draft even after its draft TTL has elapsed.  The
 * hourly task purge owns the transition to purgedAt before a session may be
 * physically removed.
 */
function retainedTaskWhere(owner?: AgentSessionOwner) {
    return {
        ...(owner ? { userId: owner.userId, branchId: owner.branchId } : {}),
        purgedAt: null,
        status: { notIn: TERMINAL_TASK_STATES },
    };
}

function anyRetainedTaskWhere(owner?: AgentSessionOwner) {
    return { ...(owner ? ownerScope(owner) : {}), purgedAt: null };
}

type LifecycleEvidenceTransaction = {
    agent_task: { findMany: (input: unknown) => Promise<AgentTaskLifecycleTaskEvidence[]> };
    agent_action: { findMany: (input: unknown) => Promise<AgentTaskLifecycleActionEvidence[]> };
};

async function readLifecycleEvidence(
    transaction: LifecycleEvidenceTransaction,
    sessionId: string,
    owner: AgentSessionOwner,
): Promise<{ tasks: AgentTaskLifecycleTaskEvidence[]; actions: AgentTaskLifecycleActionEvidence[] }> {
    const tasks = await transaction.agent_task.findMany({
        where: { sessionId, userId: owner.userId, branchId: owner.branchId },
        select: { id: true, sessionId: true, userId: true, branchId: true, activeActionId: true },
        orderBy: { id: "asc" },
    });
    const taskIds = tasks.map((task) => task.id);
    const activeActionIds = tasks.flatMap((task) => task.activeActionId === null ? [] : [task.activeActionId]);
    const actions = await transaction.agent_action.findMany({
        where: {
            OR: [
                { sessionId },
                ...(taskIds.length === 0 ? [] : [{ taskId: { in: taskIds } }]),
                ...(activeActionIds.length === 0 ? [] : [{ id: { in: activeActionIds } }]),
            ],
        },
        select: {
            id: true,
            taskId: true,
            sessionId: true,
            userId: true,
            branchId: true,
            status: true,
            expiresAt: true,
            resultPartPersistedAt: true,
        },
        orderBy: { id: "asc" },
    });
    return { tasks, actions };
}

function isUniqueConstraintError(error: unknown): boolean {
    if (error instanceof Prisma.PrismaClientKnownRequestError) return error.code === "P2002";
    if (!error || typeof error !== "object" || !("code" in error)) return false;
    return error.code === "P2002";
}

function toEntity(record: AgentSessionRecord): AgentSessionEntity {
    return {
        ...record,
        title: record.title ?? null,
        summary: record.summary ?? null,
        archivedAt: record.archivedAt ?? null,
        selectedEntities: record.selectedEntities as Record<string, unknown>,
        messages: record.messages
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
            .map((message) => ({
                id: message.id,
                role: message.role as BjjUIMessage["role"],
                parts: message.parts as unknown as BjjUIMessage["parts"],
            })),
    };
}

@Injectable()
export class PrismaAgentSessionRepository implements IAgentSessionRepository {
    constructor(private readonly prisma: PrismaService) {}

    async create(input: CreateAgentSessionInput): Promise<AgentSessionEntity> {
        const record = await this.prisma.agent_session.create({
            data: { id: randomUUID(), ...input, selectedEntities: {} },
            include: { messages: true },
        });
        return toEntity(record);
    }

    async list(owner: AgentSessionOwner): Promise<AgentSessionSummary[]> {
        const records = await this.prisma.agent_session.findMany({
            where: { ...ownerScope(owner), archivedAt: null, expiresAt: { gt: new Date() } },
            select: {
                id: true,
                userId: true,
                branchId: true,
                locale: true,
                title: true,
                model: true,
                agentVersion: true,
                createdAt: true,
                updatedAt: true,
                expiresAt: true,
                archivedAt: true,
            },
            orderBy: { updatedAt: "desc" },
            take: 100,
        });
        return records;
    }

    async findOwned(id: string, owner: AgentSessionOwner): Promise<AgentSessionEntity | null> {
        const record = await this.prisma.agent_session.findFirst({
            where: { id, ...ownerScope(owner), archivedAt: null, expiresAt: { gt: new Date() } },
            include: { messages: true },
        });
        return record ? toEntity(record) : null;
    }

    async findOwnedForRestore(id: string, owner: AgentSessionOwner): Promise<AgentSessionEntity | null> {
        const record = await this.prisma.agent_session.findFirst({
            where: { id, ...ownerScope(owner) },
            include: { messages: true },
        });
        return record ? toEntity(record) : null;
    }

    async updateOwned(
        id: string,
        owner: AgentSessionOwner,
        patch: AgentSessionPatch,
    ): Promise<AgentSessionEntity | null> {
        const data: Prisma.agent_sessionUpdateManyMutationInput = {
            ...patch,
            selectedEntities: patch.selectedEntities as Prisma.InputJsonValue | undefined,
        };
        const result = await this.prisma.agent_session.updateMany({ where: { id, ...ownerScope(owner) }, data });
        if (result.count !== 1) return null;
        const record = await this.prisma.agent_session.findFirst({
            where: { id, ...ownerScope(owner), expiresAt: { gt: new Date() } },
            include: { messages: true },
        });
        return record ? toEntity(record) : null;
    }

    async archiveOwned(
        id: string,
        owner: AgentSessionOwner,
        archivedAt: Date,
    ): Promise<AgentSessionArchiveResult> {
        return this.prisma.$transaction(async (transaction) => {
            const locked = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
                SELECT "id"
                FROM "agent_session"
                WHERE "id" = ${id}
                  AND "user_id" = CAST(${owner.userId} AS uuid)
                  AND "branch_id" = CAST(${owner.branchId} AS uuid)
                FOR UPDATE
            `);
            if (locked.length === 0) return "not_found";

            await transaction.$queryRaw(Prisma.sql`
                SELECT "id"
                FROM "agent_task"
                WHERE "session_id" = ${id}
                  AND "user_id" = CAST(${owner.userId} AS uuid)
                  AND "branch_id" = CAST(${owner.branchId} AS uuid)
                ORDER BY "id" ASC
                FOR UPDATE
            `);
            await transaction.$queryRaw(Prisma.sql`
                SELECT "id"
                FROM "agent_action"
                WHERE "session_id" = ${id}
                  AND "user_id" = CAST(${owner.userId} AS uuid)
                  AND "branch_id" = CAST(${owner.branchId} AS uuid)
                ORDER BY "id" ASC
                FOR UPDATE
            `);

            const blockingAction = await transaction.agent_action.findFirst({
                where: {
                    sessionId: id,
                    ...ownerScope(owner),
                    ...blockingActionWhere(new Date(), owner, true),
                },
                select: { id: true },
            });
            if (blockingAction) return "blocked";

            // A retained task draft is independently restorable even when no
            // action has been created yet.  Archive must therefore hold the
            // session lock and inspect the owned task boundary as well.  The
            // optional delegate keeps existing lightweight repository tests
            // compatible; production Prisma always exposes it.
            const taskDelegate = (transaction as unknown as {
                agent_task?: { findFirst: (input: unknown) => Promise<{ id: string } | null> };
            }).agent_task;
            if (taskDelegate) {
                const blockingTask = await taskDelegate.findFirst({
                    where: { sessionId: id, ...blockingTaskWhere(new Date(), owner) },
                    select: { id: true },
                });
                if (blockingTask) return "blocked";
            }

            const evidenceTransaction = transaction as unknown as {
                agent_task?: { findMany?: (input: unknown) => Promise<AgentTaskLifecycleTaskEvidence[]> };
                agent_action?: { findMany?: (input: unknown) => Promise<AgentTaskLifecycleActionEvidence[]> };
            };
            if (evidenceTransaction.agent_task?.findMany && evidenceTransaction.agent_action?.findMany) {
                const evidence = await readLifecycleEvidence(evidenceTransaction as LifecycleEvidenceTransaction, id, owner);
                if (evidence.tasks.some((task) => lifecycleTaskActionEvidenceBlocks(task, evidence.actions, new Date()))) {
                    return "blocked";
                }
            }

            await transaction.agent_session.updateMany({
                where: { id, ...ownerScope(owner), archivedAt: null },
                data: { archivedAt },
            });
            return "archived";
        });
    }

    async unarchiveOwned(id: string, owner: AgentSessionOwner): Promise<AgentSessionUnarchiveResult> {
        const result = await this.prisma.agent_session.updateMany({
            where: { id, ...ownerScope(owner), archivedAt: { not: null } },
            data: { archivedAt: null },
        });
        if (result.count === 1) return "unarchived";

        const session = await this.prisma.agent_session.findFirst({
            where: { id, ...ownerScope(owner) },
            select: { id: true },
        });
        return session ? "unarchived" : "not_found";
    }

    async deleteOwned(id: string, owner: AgentSessionOwner): Promise<AgentSessionDeleteResult> {
        const now = new Date();
        const taskDelegate = (this.prisma as unknown as {
            agent_task?: { findFirst: (input: unknown) => Promise<{ id: string } | null> };
        }).agent_task;
        const transaction = (this.prisma as unknown as {
            $transaction?: <T>(callback: (transaction: unknown) => Promise<T>) => Promise<T>;
        }).$transaction;
        if (taskDelegate && transaction) {
            return transaction.call(this.prisma, async (txUnknown) => {
                const tx = txUnknown as {
                    $queryRaw: <T>(query: Prisma.Sql) => Promise<T>;
                    agent_session: {
                        deleteMany: (input: unknown) => Promise<{ count: number }>;
                    };
                    agent_task: {
                        findFirst: (input: unknown) => Promise<{ id: string } | null>;
                        findMany?: (input: unknown) => Promise<AgentTaskLifecycleTaskEvidence[]>;
                    };
                    agent_action: { findFirst: (input: unknown) => Promise<{ id: string } | null> };
                };
                const locked = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
                    SELECT "id"
                    FROM "agent_session"
                    WHERE "id" = ${id}
                      AND "user_id" = CAST(${owner.userId} AS uuid)
                      AND "branch_id" = CAST(${owner.branchId} AS uuid)
                    FOR UPDATE
                `);
                if (locked.length === 0) return "not_found";

                await tx.$queryRaw(Prisma.sql`
                    SELECT "id"
                    FROM "agent_task"
                    WHERE "session_id" = ${id}
                      AND "user_id" = CAST(${owner.userId} AS uuid)
                      AND "branch_id" = CAST(${owner.branchId} AS uuid)
                    ORDER BY "id" ASC
                    FOR UPDATE
                `);
                await tx.$queryRaw(Prisma.sql`
                    SELECT "id"
                    FROM "agent_action"
                    WHERE "session_id" = ${id}
                      AND "user_id" = CAST(${owner.userId} AS uuid)
                      AND "branch_id" = CAST(${owner.branchId} AS uuid)
                    ORDER BY "id" ASC
                    FOR UPDATE
                `);
                const blockingTask = await tx.agent_task.findFirst({
                    where: { sessionId: id, ...retainedTaskWhere(owner) },
                    select: { id: true },
                });
                if (blockingTask) return "blocked";
                const blockingAction = await tx.agent_action.findFirst({
                    where: { sessionId: id, ...ownerScope(owner), ...blockingActionWhere(now, owner, true) },
                    select: { id: true },
                });
                if (blockingAction) return "blocked";

                const evidenceTransaction = tx as unknown as {
                    agent_task?: { findMany?: (input: unknown) => Promise<AgentTaskLifecycleTaskEvidence[]> };
                    agent_action?: { findMany?: (input: unknown) => Promise<AgentTaskLifecycleActionEvidence[]> };
                };
                if (evidenceTransaction.agent_task?.findMany && evidenceTransaction.agent_action?.findMany) {
                    const evidence = await readLifecycleEvidence(evidenceTransaction as LifecycleEvidenceTransaction, id, owner);
                    if (evidence.tasks.some((task) => lifecycleTaskActionEvidenceBlocks(task, evidence.actions, now))) {
                        return "blocked";
                    }
                }
                const deleted = await tx.agent_session.deleteMany({ where: { id, ...ownerScope(owner) } });
                return deleted.count === 1 ? "deleted" : "not_found";
            }) as Promise<AgentSessionDeleteResult>;
        }
        const result = await this.prisma.agent_session.deleteMany({
            where: {
                id,
                ...ownerScope(owner),
                actions: { none: blockingActionWhere(now, owner, true) },
            },
        });
        if (result.count === 1) return "deleted";
        const session = await this.prisma.agent_session.findFirst({ where: { id, ...ownerScope(owner) }, select: { id: true } });
        return session ? "blocked" : "not_found";
    }

    async appendMessages(
        id: string,
        owner: AgentSessionOwner,
        messages: BjjUIMessage[],
        traceId?: string,
    ): Promise<boolean> {
        const session = await this.prisma.agent_session.findFirst({ select: { id: true, title: true }, where: { id, ...ownerScope(owner) } });
        if (!session) return false;
        const title = this.titleFromMessages(messages);
        const timestamp = Date.now();
        const operations: Prisma.PrismaPromise<unknown>[] = [
            this.prisma.agent_message.createMany({
                data: messages.map((message, index) => ({
                    id: message.id || randomUUID(),
                    sessionId: id,
                    role: message.role,
                    parts: message.parts as unknown as Prisma.InputJsonValue,
                    traceId,
                    createdAt: new Date(timestamp + index),
                })),
                skipDuplicates: true,
            }),
            // Branch-pinned like every other session write here: under
            // TENANT_ISOLATION_MODE=enforce an update whose `where` lacks
            // branchId is rejected as unpinned_write before it runs.
            this.prisma.agent_session.updateMany({
                where: { id, ...ownerScope(owner) },
                data: { updatedAt: new Date() },
            }),
        ];
        if (title && !session.title) {
            operations.push(this.prisma.agent_session.updateMany({
                where: { id, ...ownerScope(owner), title: null },
                data: { title },
            }));
        }

        await this.prisma.$transaction(operations);
        return true;
    }

    async upsertActionResultMessage(
        id: string,
        owner: AgentSessionOwner,
        message: BjjUIMessage,
        traceId?: string,
    ): Promise<boolean> {
        try {
            return await this.prisma.$transaction((transaction) => this.persistActionResultMessage(
                transaction,
                id,
                owner,
                message,
                traceId,
                true,
            ));
        } catch (error) {
            // A concurrent deterministic insert can win after the initial
            // existence check. Retry in a fresh transaction because the
            // failed INSERT has already aborted the first transaction.
            if (!isUniqueConstraintError(error)) throw error;
            return this.prisma.$transaction((transaction) => this.persistActionResultMessage(
                transaction,
                id,
                owner,
                message,
                traceId,
                false,
            ));
        }
    }

    private async persistActionResultMessage(
        transaction: Prisma.TransactionClient,
        id: string,
        owner: AgentSessionOwner,
        message: BjjUIMessage,
        traceId: string | undefined,
        createIfMissing: boolean,
    ): Promise<boolean> {
        const session = await transaction.agent_session.findFirst({
            select: { id: true },
            where: { id, ...ownerScope(owner) },
        });
        if (!session) return false;

        const messageId = message.id || randomUUID();
        const messageData = {
            id: messageId,
            sessionId: id,
            role: message.role,
            parts: message.parts as unknown as Prisma.InputJsonValue,
            ...(traceId === undefined ? {} : { traceId }),
        };
        const existing = await transaction.agent_message.findFirst({
            where: { id: messageId, sessionId: id },
            select: { id: true },
        });
        let persisted = false;
        if (existing || !createIfMissing) {
            const updated = await transaction.agent_message.updateMany({
                where: { id: messageId, sessionId: id },
                data: {
                    role: messageData.role,
                    parts: messageData.parts,
                    ...(traceId === undefined ? {} : { traceId }),
                },
            });
            persisted = updated.count === 1;
        } else {
            await transaction.agent_message.create({ data: messageData });
            persisted = true;
        }
        if (!persisted) return false;

        const refreshed = await transaction.agent_session.updateMany({
            where: { id, ...ownerScope(owner) },
            data: { updatedAt: new Date(), summary: null },
        });
        return refreshed.count === 1;
    }

    private titleFromMessages(messages: BjjUIMessage[]): string | undefined {
        const text = messages.find((message) => message.role === "user")?.parts
            .filter((part): part is { type: "text"; text: string } => part.type === "text")
            .map((part) => part.text.trim())
            .filter(Boolean)
            .join(" ")
            .slice(0, 120);
        return text || undefined;
    }

    async deleteExpired(now: Date): Promise<number> {
        const taskDelegate = (this.prisma as unknown as {
            agent_task?: { findFirst: (input: unknown) => Promise<{ id: string } | null> };
        }).agent_task;
        const transaction = (this.prisma as unknown as {
            $transaction?: <T>(callback: (transaction: unknown) => Promise<T>) => Promise<T>;
        }).$transaction;
        if (taskDelegate && transaction) {
            return transaction.call(this.prisma, async (txUnknown) => {
                const tx = txUnknown as {
                    $queryRaw: <T>(query: Prisma.Sql) => Promise<T>;
                    agent_session: {
                        deleteMany: (input: unknown) => Promise<{ count: number }>;
                    };
                    agent_task: {
                        findFirst: (input: unknown) => Promise<{ id: string } | null>;
                        findMany?: (input: unknown) => Promise<AgentTaskLifecycleTaskEvidence[]>;
                    };
                    agent_action: {
                        findFirst: (input: unknown) => Promise<{ id: string } | null>;
                        findMany?: (input: unknown) => Promise<AgentTaskLifecycleActionEvidence[]>;
                    };
                };
                const candidates = await tx.$queryRaw<Array<{ id: string; userId: string; branchId: string }>>(Prisma.sql`
                    SELECT "id", "user_id" AS "userId", "branch_id" AS "branchId"
                    FROM "agent_session"
                    WHERE "expires_at" <= ${now}
                    ORDER BY "id" ASC
                    FOR UPDATE
                `);

                // Every expired-session candidate is already session-locked by
                // the discovery query.  Complete the remaining lock phases
                // globally before evaluating or deleting any candidate so a
                // later session/task is never acquired after an action lock.
                for (const candidate of candidates) {
                    await tx.$queryRaw(Prisma.sql`
                        SELECT "id"
                        FROM "agent_task"
                        WHERE "session_id" = ${candidate.id}
                          AND "user_id" = CAST(${candidate.userId} AS uuid)
                          AND "branch_id" = CAST(${candidate.branchId} AS uuid)
                        ORDER BY "id" ASC
                        FOR UPDATE
                    `);
                }
                for (const candidate of candidates) {
                    await tx.$queryRaw(Prisma.sql`
                        SELECT "id"
                        FROM "agent_action"
                        WHERE "session_id" = ${candidate.id}
                          AND "user_id" = CAST(${candidate.userId} AS uuid)
                          AND "branch_id" = CAST(${candidate.branchId} AS uuid)
                        ORDER BY "id" ASC
                        FOR UPDATE
                    `);
                }

                let deletedCount = 0;
                for (const candidate of candidates) {
                    const candidateOwner = { userId: candidate.userId, branchId: candidate.branchId };
                    const blockingTask = await tx.agent_task.findFirst({
                        where: { sessionId: candidate.id, ...anyRetainedTaskWhere(candidateOwner) },
                        select: { id: true },
                    });
                    if (blockingTask) continue;
                    const blockingAction = await tx.agent_action.findFirst({
                        where: { sessionId: candidate.id, ...blockingActionWhere(now, candidateOwner, true) },
                        select: { id: true },
                    });
                    if (blockingAction) continue;
                    if (tx.agent_task.findMany && tx.agent_action.findMany) {
                        const evidence = await readLifecycleEvidence(
                            tx as LifecycleEvidenceTransaction,
                            candidate.id,
                            { userId: candidate.userId, branchId: candidate.branchId },
                        );
                        if (evidence.tasks.some((task) => lifecycleTaskActionEvidenceBlocks(task, evidence.actions, now))) {
                            continue;
                        }
                    }
                    const deleted = await tx.agent_session.deleteMany({
                        where: { id: candidate.id, expiresAt: { lte: now } },
                    });
                    if (deleted.count === 1) deletedCount += 1;
                }
                return deletedCount;
            }) as Promise<number>;
        }
        return (await this.prisma.agent_session.deleteMany({
            where: {
                expiresAt: { lte: now },
                actions: { none: blockingActionWhere(now, undefined, true) },
            },
        })).count;
    }
}
