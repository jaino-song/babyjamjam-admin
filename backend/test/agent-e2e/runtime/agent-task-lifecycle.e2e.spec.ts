import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";

import { AgentTaskService } from "application/agent/agent-task.service";
import { createEmptyAgentTaskDraft } from "domain/entities/agent-task.entity";
import { PrismaAgentSessionRepository } from "infrastructure/database/repositories/prisma-agent-session.repository";
import { PrismaAgentTaskRepository } from "infrastructure/database/repositories/prisma-agent-task.repository";
import type { VerifiedTenantPrincipal } from "infrastructure/tenant/tenant.context";
import {
    assertApprovedAgentTaskPersistenceDatabaseTarget,
    createApprovedAgentTaskPersistenceClient,
} from "./agent-task-persistence.helper";

const describeAgentE2E = process.env["AGENT_E2E"] === "1" ? describe : describe.skip;

const USER_ID = "a1000000-0000-4000-8000-000000000001";
const BRANCH_ID = "a2000000-0000-4000-8000-000000000001";
const SESSION_ID = "a3000000-0000-4000-8000-000000000001";
const FOREIGN_USER_ID = "a1000000-0000-4000-8000-000000000002";
const FOREIGN_BRANCH_ID = "a2000000-0000-4000-8000-000000000002";
const principal: VerifiedTenantPrincipal = {
    userId: USER_ID,
    branchId: BRANCH_ID,
    globalRole: "admin",
    branchRole: "manager",
};
const capability = {
    name: "clients.create",
    domain: "clients",
    version: "1.0.0",
    description: "Create",
    risk: "reversible-write" as const,
    requiredRoles: ["owner", "admin", "manager"],
    renderer: "action-proposal" as const,
    flagKey: "agent.capability.clients.create",
    sideEffect: true,
    approvalPolicy: "structured" as const,
    idempotencyPolicy: "action-id" as const,
};

function futureDate(days = 30): Date {
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function taskDraft(snapshotRef = randomUUID()) {
    const draft = createEmptyAgentTaskDraft(snapshotRef);
    draft.confirmed = { name: "lifecycle fixture", phone: "01012345678" };
    return draft;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const TASK_RETENTION_MS = 30 * DAY_MS;
const TERMINAL_RETENTION_MS = 7 * DAY_MS;

function createInput(clientEventId = randomUUID()) {
    return {
        sessionId: SESSION_ID,
        capabilityId: "clients.create" as const,
        clientEventId,
        operations: [
            { op: "set" as const, field: "name" as const, value: "lifecycle" },
            { op: "set" as const, field: "phone" as const, value: "01012345678" },
        ],
    };
}

async function createAction(
    prisma: PrismaClient,
    input: {
        taskId: string | null;
        id?: string;
        status: string;
        resultPartPersistedAt?: Date | null;
        sessionId?: string;
        userId?: string;
        branchId?: string;
        expiresAt?: Date;
    },
) {
    const id = input.id ?? randomUUID();
    await prisma.agent_action.create({
        data: {
            id,
            sessionId: input.sessionId ?? SESSION_ID,
            userId: input.userId ?? USER_ID,
            branchId: input.branchId ?? BRANCH_ID,
            capability: "clients.create",
            capabilityVersion: "1.0.0",
            risk: "reversible-write",
            status: input.status,
            proposal: { fixture: "lifecycle" },
            proposalRevision: "1",
            inputHash: "b".repeat(64),
            authorizationContext: { fixture: "lifecycle" },
            expiresAt: input.expiresAt ?? futureDate(),
            idempotencyKey: randomUUID(),
            requestDedupeKey: randomUUID(),
            dedupeExpiresAt: futureDate(),
            taskId: input.taskId,
            taskRevision: input.taskId === null ? null : 1,
            resultPartPersistedAt: input.resultPartPersistedAt ?? null,
        },
    });
    return id;
}

type TransactionBarrier = {
    prisma: PrismaClient;
    ready: Promise<void>;
    release(): void;
};

/**
 * Hold a real Prisma interactive transaction after a known raw-query count.
 * Tests use this barrier to choose which owner acquires the session lock first
 * without sleeps or an unverified simultaneous Promise.all.
 */
function transactionBarrier(base: PrismaClient, holdAtRawCount?: number, notifyAtRawCount?: number): TransactionBarrier {
    let resolveReady!: () => void;
    const ready = new Promise<void>((resolve) => { resolveReady = resolve; });
    let resolveRelease!: () => void;
    const released = new Promise<void>((resolve) => { resolveRelease = resolve; });
    let rawCount = 0;
    const proxied = new Proxy(base as unknown as Record<string | symbol, unknown>, {
        get(target, property, receiver) {
            if (property !== "$transaction") return Reflect.get(target, property, receiver);
            return (callback: (transaction: unknown) => Promise<unknown>) => base.$transaction(async (transaction) => {
                const transactionProxy = new Proxy(transaction as unknown as Record<string | symbol, unknown>, {
                    get(transactionTarget, transactionProperty, transactionReceiver) {
                        if (transactionProperty !== "$queryRaw") return Reflect.get(transactionTarget, transactionProperty, transactionReceiver);
                        return async (...args: unknown[]) => {
                            rawCount += 1;
                            // A notify barrier fires immediately before the
                            // query is issued.  This proves the follower has
                            // reached the contested lock even when PostgreSQL
                            // is still waiting for the first transaction.
                            if (notifyAtRawCount === rawCount) resolveReady();
                            const result = await (transactionTarget["$queryRaw"] as (...input: unknown[]) => Promise<unknown>).apply(transactionTarget, args);
                            if (holdAtRawCount === rawCount) {
                                resolveReady();
                                await released;
                            }
                            return result;
                        };
                    },
                });
                return callback(transactionProxy);
            });
        },
    });
    return { prisma: proxied as unknown as PrismaClient, ready, release: resolveRelease };
}

function taskService(repository: PrismaAgentTaskRepository): AgentTaskService {
    return new AgentTaskService(
        repository as never,
        {
            assertCanCreate: jest.fn().mockResolvedValue(capability),
            assertCanPatch: jest.fn().mockReturnValue(capability),
            assertCanPrepareReview: jest.fn().mockResolvedValue(capability),
        } as never,
        { findByPhone: jest.fn().mockResolvedValue(null), findById: jest.fn().mockResolvedValue(null) } as never,
    );
}

describeAgentE2E("agent task lifecycle against the guarded local database", () => {
    let prisma: PrismaClient;
    let repository: PrismaAgentTaskRepository;
    let service: AgentTaskService;

    beforeAll(async () => {
        assertApprovedAgentTaskPersistenceDatabaseTarget();
        prisma = createApprovedAgentTaskPersistenceClient();
        await prisma.$connect();
        await prisma.agent_session.deleteMany({
            where: {
                OR: [
                    { userId: USER_ID, branchId: BRANCH_ID },
                    { userId: FOREIGN_USER_ID, branchId: FOREIGN_BRANCH_ID },
                ],
            },
        });
        await prisma.user.deleteMany({ where: { id: { in: [USER_ID, FOREIGN_USER_ID] } } });
        await prisma.branch.deleteMany({ where: { id: { in: [BRANCH_ID, FOREIGN_BRANCH_ID] } } });
        await prisma.user.create({ data: { id: USER_ID, email: "agent-task-lifecycle@example.invalid" } });
        await prisma.branch.create({ data: { id: BRANCH_ID, name: "Agent task lifecycle branch", slug: "agent-task-lifecycle" } });
        await prisma.user.create({ data: { id: FOREIGN_USER_ID, email: "agent-task-lifecycle-foreign@example.invalid" } });
        await prisma.branch.create({ data: { id: FOREIGN_BRANCH_ID, name: "Agent task lifecycle foreign branch", slug: "agent-task-lifecycle-foreign" } });
        await prisma.agent_session.create({
            data: {
                id: SESSION_ID,
                userId: USER_ID,
                branchId: BRANCH_ID,
                locale: "ko",
                model: "lifecycle-test",
                agentVersion: "lifecycle-test",
                expiresAt: futureDate(),
            },
        });
        repository = new PrismaAgentTaskRepository(prisma as never);
        service = taskService(repository);
    });

    afterEach(async () => {
        await prisma.agent_task_event.deleteMany({ where: { sessionId: SESSION_ID } });
        await prisma.agent_action.deleteMany({ where: { sessionId: SESSION_ID } });
        await prisma.agent_task.deleteMany({ where: { sessionId: SESSION_ID } });
        await prisma.agent_session.upsert({
            where: { id: SESSION_ID },
            create: {
                id: SESSION_ID,
                userId: USER_ID,
                branchId: BRANCH_ID,
                locale: "ko",
                model: "lifecycle-test",
                agentVersion: "lifecycle-test",
                expiresAt: futureDate(),
            },
            update: { expiresAt: futureDate(), archivedAt: null },
        });
    });

    afterAll(async () => {
        await prisma.agent_session.deleteMany({
            where: {
                OR: [
                    { userId: USER_ID, branchId: BRANCH_ID },
                    { userId: FOREIGN_USER_ID, branchId: FOREIGN_BRANCH_ID },
                ],
            },
        });
        await prisma.branch.deleteMany({ where: { id: BRANCH_ID } });
        await prisma.user.deleteMany({ where: { id: USER_ID } });
        await prisma.branch.deleteMany({ where: { id: FOREIGN_BRANCH_ID } });
        await prisma.user.deleteMany({ where: { id: FOREIGN_USER_ID } });
        await prisma.$disconnect();
    });

    it("persists pause/resume/cancel transitions and immutable receipts", async () => {
        const created = await service.create(principal, {
            sessionId: SESSION_ID,
            capabilityId: "clients.create",
            clientEventId: randomUUID(),
            operations: [
                { op: "set", field: "name", value: "lifecycle" },
                { op: "set", field: "phone", value: "01012345678" },
            ],
        });
        const paused = await service.command(principal, created.snapshot.taskId, {
            command: "pause", expectedRevision: created.snapshot.revision, clientEventId: randomUUID(),
        });
        expect(paused.snapshot.state).toBe("paused");
        const pausedRow = await prisma.agent_task.findUnique({ where: { id: created.snapshot.taskId } });
        expect(pausedRow?.activeSlot).toBeNull();

        const resumed = await service.command(principal, created.snapshot.taskId, {
            command: "resume", expectedRevision: paused.snapshot.revision, clientEventId: randomUUID(),
        });
        const cancelled = await service.command(principal, created.snapshot.taskId, {
            command: "cancel", expectedRevision: resumed.snapshot.revision, clientEventId: randomUUID(),
        });
        expect(cancelled.snapshot.state).toBe("cancelled");
        const cancelledRow = await prisma.agent_task.findUnique({ where: { id: created.snapshot.taskId } });
        expect(cancelledRow).toEqual(expect.objectContaining({ activeSlot: null, terminalAt: expect.any(Date) }));
        expect(await prisma.agent_task_event.count({ where: { taskId: created.snapshot.taskId } })).toBe(4);
    });

    it("keeps exact accepted-change retention while reads, no-ops, and replay stay inert", async () => {
        const created = await service.create(principal, createInput());
        const createdRow = await prisma.agent_task.findUnique({ where: { id: created.snapshot.taskId } });
        const createdSession = await prisma.agent_session.findUnique({ where: { id: SESSION_ID } });
        expect(createdRow).not.toBeNull();
        expect(createdRow!.expiresAt.getTime() - createdRow!.lastAcceptedAt.getTime()).toBe(TASK_RETENTION_MS);

        await expect(service.get(principal, created.snapshot.taskId)).resolves.toMatchObject({ taskId: created.snapshot.taskId });
        await expect(service.restoreSession(principal, SESSION_ID)).resolves.toMatchObject({ taskRestoreStatus: "available" });
        const afterReads = await prisma.agent_task.findUnique({ where: { id: created.snapshot.taskId } });
        const sessionAfterReads = await prisma.agent_session.findUnique({ where: { id: SESSION_ID } });
        expect(afterReads?.lastAcceptedAt).toEqual(createdRow!.lastAcceptedAt);
        expect(afterReads?.expiresAt).toEqual(createdRow!.expiresAt);
        expect(sessionAfterReads?.expiresAt).toEqual(createdSession?.expiresAt);

        const pauseInput = { command: "pause" as const, expectedRevision: created.snapshot.revision, clientEventId: randomUUID() };
        const paused = await service.command(principal, created.snapshot.taskId, pauseInput);
        const pausedRow = await prisma.agent_task.findUnique({ where: { id: created.snapshot.taskId } });
        expect(pausedRow!.expiresAt.getTime() - pausedRow!.lastAcceptedAt.getTime()).toBe(TASK_RETENTION_MS);

        const noOp = await service.command(principal, created.snapshot.taskId, {
            command: "pause", expectedRevision: paused.snapshot.revision, clientEventId: randomUUID(),
        });
        expect(noOp.snapshot.revision).toBe(paused.snapshot.revision);
        const afterNoOp = await prisma.agent_task.findUnique({ where: { id: created.snapshot.taskId } });
        expect(afterNoOp?.lastAcceptedAt).toEqual(pausedRow?.lastAcceptedAt);
        expect(afterNoOp?.expiresAt).toEqual(pausedRow?.expiresAt);

        const replay = await service.command(principal, created.snapshot.taskId, pauseInput);
        expect(replay.receipt).toEqual(paused.receipt);
        const afterReplay = await prisma.agent_task.findUnique({ where: { id: created.snapshot.taskId } });
        expect(afterReplay?.lastAcceptedAt).toEqual(afterNoOp?.lastAcceptedAt);
        expect(afterReplay?.expiresAt).toEqual(afterNoOp?.expiresAt);

        const cancelled = await service.command(principal, created.snapshot.taskId, {
            command: "cancel", expectedRevision: paused.snapshot.revision, clientEventId: randomUUID(),
        });
        const cancelledRow = await prisma.agent_task.findUnique({ where: { id: created.snapshot.taskId } });
        expect(cancelledRow?.terminalAt).not.toBeNull();
        expect(cancelledRow!.expiresAt.getTime() - cancelledRow!.terminalAt!.getTime()).toBe(TERMINAL_RETENTION_MS);
        expect(cancelled.snapshot.state).toBe("cancelled");
    });

    it("keeps recovery discovery available after ordinary task/session expiry", async () => {
        const taskId = randomUUID();
        const actionId = randomUUID();
        const eventId = randomUUID();
        const created = await repository.createWithEvent({ userId: USER_ID, branchId: BRANCH_ID, sessionId: SESSION_ID }, {
            taskId,
            capabilityId: "clients.create",
            draft: taskDraft(),
            status: "executing",
            expiresAt: futureDate(),
        }, { clientEventId: eventId, operation: "create", requestHash: "a".repeat(64), acceptedRevision: 1 });
        expect(created.status).toBe("created");
        await prisma.agent_action.create({
            data: {
                id: actionId,
                sessionId: SESSION_ID,
                userId: USER_ID,
                branchId: BRANCH_ID,
                capability: "clients.create",
                capabilityVersion: "1.0.0",
                risk: "reversible-write",
                status: "executing",
                proposal: {},
                proposalRevision: "1",
                inputHash: "b".repeat(64),
                authorizationContext: {},
                expiresAt: futureDate(),
                idempotencyKey: randomUUID(),
                requestDedupeKey: randomUUID(),
                dedupeExpiresAt: futureDate(),
                taskId,
                taskRevision: 1,
            },
        });
        await prisma.agent_task.update({ where: { id: taskId }, data: { activeActionId: actionId } });
        await prisma.agent_session.update({ where: { id: SESSION_ID }, data: { expiresAt: new Date(Date.now() - 1000) } });

        const restore = await service.restoreSession(principal, SESSION_ID);
        expect(restore.taskRestoreStatus).toBe("session_expired");
        expect(restore.recoveryTaskIds).toEqual([taskId]);
        await expect(service.get(principal, taskId)).resolves.toMatchObject({ taskId });
    });

    it("purges expired unblocked payloads to the exact tombstone projection", async () => {
        const taskId = randomUUID();
        const eventId = randomUUID();
        const created = await repository.createWithEvent({ userId: USER_ID, branchId: BRANCH_ID, sessionId: SESSION_ID }, {
            taskId,
            capabilityId: "clients.create",
            draft: taskDraft(),
            expiresAt: futureDate(),
        }, { clientEventId: eventId, operation: "create", requestHash: "c".repeat(64), acceptedRevision: 1 });
        expect(created.status).toBe("created");
        const beforePurge = await prisma.agent_task.findUnique({ where: { id: taskId } });
        const eventBefore = await prisma.agent_task_event.findFirst({ where: { taskId }, orderBy: { acceptedAt: "asc" } });
        const expiredAt = new Date(Date.now() - 1000);
        await prisma.agent_task.update({ where: { id: taskId }, data: { expiresAt: expiredAt } });
        const cleanupAt = new Date("2026-09-17T00:00:00.000Z");
        expect(await repository.purgeExpired(cleanupAt)).toBe(1);
        const stored = await prisma.agent_task.findUnique({ where: { id: taskId } });
        expect(stored).toEqual(expect.objectContaining({
            id: taskId,
            revision: 1,
            status: "collecting",
            activeActionId: null,
            activeSlot: null,
            targetRef: null,
            targetVersion: null,
            expiresAt: expiredAt,
            purgedAt: cleanupAt,
            updatedAt: cleanupAt,
        }));
        expect(stored).toEqual(expect.objectContaining({
            sessionId: beforePurge!.sessionId,
            userId: beforePurge!.userId,
            branchId: beforePurge!.branchId,
            capabilityId: beforePurge!.capabilityId,
            schemaVersion: beforePurge!.schemaVersion,
            revision: beforePurge!.revision,
            status: beforePurge!.status,
            activeActionId: beforePurge!.activeActionId,
            lastAcceptedAt: beforePurge!.lastAcceptedAt,
            terminalAt: beforePurge!.terminalAt,
            createdAt: beforePurge!.createdAt,
        }));
        expect(stored?.draft).toEqual(expect.objectContaining({
            confirmed: {},
            tentative: {},
            clearedFields: [],
            provenance: { confirmed: {}, tentative: {} },
            constraints: { noSend: false },
            choiceSets: [],
            orderedChoiceRefs: [],
            consent: { choice: "unanswered", binding: null },
            server: { references: { target: null, choiceTargets: [], phoneCandidates: {} } },
        }));
        const purgedDraft = stored?.draft as Record<string, unknown>;
        expect((purgedDraft["server"] as Record<string, unknown>)?.["actionExpectedRevision"]).toBeUndefined();
        expect((purgedDraft["server"] as Record<string, unknown>)?.["actionProposalRevision"]).toBeUndefined();
        expect(Object.keys(purgedDraft).sort()).toEqual(Object.keys(createEmptyAgentTaskDraft(purgedDraft["currentSnapshotRef"] as string)).sort());
        const eventAfter = await prisma.agent_task_event.findFirst({ where: { taskId }, orderBy: { acceptedAt: "asc" } });
        expect(eventAfter).toEqual(eventBefore);
        expect(await repository.purgeExpired(cleanupAt)).toBe(0);
        expect(await prisma.agent_task_event.count({ where: { taskId } })).toBe(1);
    });

    it("returns 410 for a replay after purge without resurrecting the tombstone", async () => {
        const created = await service.create(principal, createInput());
        const pauseInput = { command: "pause" as const, expectedRevision: created.snapshot.revision, clientEventId: randomUUID() };
        const paused = await service.command(principal, created.snapshot.taskId, pauseInput);
        const eventBefore = await prisma.agent_task_event.findFirst({ where: { clientEventId: pauseInput.clientEventId } });
        const expiredAt = new Date(Date.now() - 1000);
        await prisma.agent_task.update({ where: { id: created.snapshot.taskId }, data: { expiresAt: expiredAt } });
        const cleanupAt = new Date(Date.now() + 1000);
        expect(await repository.purgeExpired(cleanupAt)).toBe(1);

        await expect(service.command(principal, created.snapshot.taskId, pauseInput)).rejects.toMatchObject({ status: 410 });
        await expect(service.get(principal, created.snapshot.taskId)).rejects.toMatchObject({ status: 410 });
        const eventAfter = await prisma.agent_task_event.findFirst({ where: { clientEventId: pauseInput.clientEventId } });
        const taskAfter = await prisma.agent_task.findUnique({ where: { id: created.snapshot.taskId } });
        expect(eventAfter).toEqual(eventBefore);
        expect(taskAfter).toEqual(expect.objectContaining({ revision: paused.snapshot.revision, purgedAt: cleanupAt }));
    });

    it("preserves unpersisted terminal results and uncertain evidence before allowing purge", async () => {
        const expiredAt = new Date(Date.now() - 1000);
        const cleanupAt = new Date(Date.now() + 1000);
        const terminalTaskId = randomUUID();
        const terminalCreated = await repository.createWithEvent({ userId: USER_ID, branchId: BRANCH_ID, sessionId: SESSION_ID }, {
            taskId: terminalTaskId,
            capabilityId: "clients.create",
            draft: taskDraft(),
            expiresAt: expiredAt,
        }, { clientEventId: randomUUID(), operation: "create", requestHash: "d".repeat(64), acceptedRevision: 1 });
        expect(terminalCreated.status).toBe("created");
        const terminalActionId = await createAction(prisma, { taskId: terminalTaskId, status: "succeeded" });
        await prisma.agent_task.update({ where: { id: terminalTaskId }, data: { activeActionId: terminalActionId } });
        expect(await repository.purgeExpired(cleanupAt)).toBe(0);

        await prisma.agent_action.update({ where: { id: terminalActionId }, data: { resultPartPersistedAt: cleanupAt } });
        const actionBeforePurge = await prisma.agent_action.findUnique({ where: { id: terminalActionId } });
        expect(await repository.purgeExpired(cleanupAt)).toBe(1);
        const terminalTaskAfter = await prisma.agent_task.findUnique({ where: { id: terminalTaskId } });
        const actionAfterPurge = await prisma.agent_action.findUnique({ where: { id: terminalActionId } });
        expect(terminalTaskAfter).toEqual(expect.objectContaining({ purgedAt: cleanupAt, activeActionId: terminalActionId }));
        expect(actionAfterPurge).toEqual(actionBeforePurge);

        const uncertainTaskId = randomUUID();
        const uncertainCreated = await repository.createWithEvent({ userId: USER_ID, branchId: BRANCH_ID, sessionId: SESSION_ID }, {
            taskId: uncertainTaskId,
            capabilityId: "clients.create",
            draft: taskDraft(),
            expiresAt: expiredAt,
        }, { clientEventId: randomUUID(), operation: "create", requestHash: "e".repeat(64), acceptedRevision: 1 });
        expect(uncertainCreated.status).toBe("created");
        const uncertainActionId = await createAction(prisma, {
            taskId: uncertainTaskId,
            status: "uncertain",
            resultPartPersistedAt: cleanupAt,
        });
        await prisma.agent_task.update({ where: { id: uncertainTaskId }, data: { activeActionId: uncertainActionId } });
        expect(await repository.purgeExpired(cleanupAt)).toBe(0);
        await expect(prisma.agent_task.findUnique({ where: { id: uncertainTaskId } })).resolves.toEqual(
            expect.objectContaining({ purgedAt: null, activeActionId: uncertainActionId }),
        );
    });

    it("fails closed for reverse and inconsistent task-action links while allowing settled history", async () => {
        const expiredAt = new Date(Date.now() - 1000);
        const cleanupAt = new Date(Date.now() + 1000);
        const cases = [
            { label: "reverse uncertain", status: "uncertain", resultPartPersistedAt: cleanupAt, taskId: null as string | null, actionTaskId: "reverse" as const },
            { label: "reverse proposed", status: "proposed", resultPartPersistedAt: cleanupAt, taskId: null as string | null, actionTaskId: "reverse" as const },
            { label: "reverse pending result", status: "succeeded", resultPartPersistedAt: null, taskId: null as string | null, actionTaskId: "reverse" as const },
            { label: "dangling forward", status: "succeeded", resultPartPersistedAt: cleanupAt, taskId: "forward" as const, actionTaskId: "none" as const },
            { label: "foreign reverse", status: "failed", resultPartPersistedAt: cleanupAt, taskId: null as string | null, actionTaskId: "foreign" as const },
        ] as const;

        for (const testCase of cases) {
            const taskId = randomUUID();
            const actionId = randomUUID();
            const created = await repository.createWithEvent({ userId: USER_ID, branchId: BRANCH_ID, sessionId: SESSION_ID }, {
                taskId,
                capabilityId: "clients.create",
                draft: taskDraft(),
                status: "cancelled",
                expiresAt: expiredAt,
            }, { clientEventId: randomUUID(), operation: "create", requestHash: randomUUID().replace(/-/g, "").padEnd(64, "0"), acceptedRevision: 1 });
            expect(created.status).toBe("created");

            const actionTaskId = testCase.actionTaskId === "reverse" || testCase.actionTaskId === "foreign"
                ? taskId
                : null;
            await createAction(prisma, {
                taskId: actionTaskId,
                id: actionId,
                status: testCase.status,
                resultPartPersistedAt: testCase.resultPartPersistedAt,
                ...(testCase.actionTaskId === "foreign" ? { userId: FOREIGN_USER_ID, branchId: FOREIGN_BRANCH_ID } : {}),
            });
            if (testCase.taskId === "forward") {
                await prisma.agent_task.update({ where: { id: taskId }, data: { activeActionId: actionId } });
            }

            expect(await repository.purgeExpired(cleanupAt)).toBe(0);
            await expect(prisma.agent_task.findUnique({ where: { id: taskId } })).resolves.toEqual(
                expect.objectContaining({ purgedAt: null }),
            );
        }

        const settledTaskId = randomUUID();
        const settledActionId = randomUUID();
        const settledCreated = await repository.createWithEvent({ userId: USER_ID, branchId: BRANCH_ID, sessionId: SESSION_ID }, {
            taskId: settledTaskId,
            capabilityId: "clients.create",
            draft: taskDraft(),
            status: "cancelled",
            expiresAt: expiredAt,
        }, { clientEventId: randomUUID(), operation: "create", requestHash: randomUUID().replace(/-/g, "").padEnd(64, "0"), acceptedRevision: 1 });
        expect(settledCreated.status).toBe("created");
        await createAction(prisma, {
            taskId: settledTaskId,
            id: settledActionId,
            status: "failed",
            resultPartPersistedAt: cleanupAt,
        });
        await prisma.agent_task.update({ where: { id: settledTaskId }, data: { activeActionId: settledActionId } });
        const actionBefore = await prisma.agent_action.findUnique({ where: { id: settledActionId } });
        expect(await repository.purgeExpired(cleanupAt)).toBe(1);
        expect(await repository.purgeExpired(cleanupAt)).toBe(0);
        await expect(prisma.agent_task.findUnique({ where: { id: settledTaskId } })).resolves.toEqual(
            expect.objectContaining({ purgedAt: cleanupAt, activeActionId: settledActionId }),
        );
        await expect(prisma.agent_action.findUnique({ where: { id: settledActionId } })).resolves.toEqual(actionBefore);
    });

    it("applies bidirectional evidence to archive and owner delete", async () => {
        const sessionRepository = new PrismaAgentSessionRepository(prisma as never);
        const taskId = randomUUID();
        const created = await repository.createWithEvent({ userId: USER_ID, branchId: BRANCH_ID, sessionId: SESSION_ID }, {
            taskId,
            capabilityId: "clients.create",
            draft: taskDraft(),
            status: "cancelled",
            expiresAt: new Date(Date.now() - 1000),
        }, { clientEventId: randomUUID(), operation: "create", requestHash: "f".repeat(64), acceptedRevision: 1 });
        expect(created.status).toBe("created");
        await prisma.agent_task.update({ where: { id: taskId }, data: { activeActionId: randomUUID() } });

        await expect(sessionRepository.archiveOwned(SESSION_ID, principal, new Date())).resolves.toBe("blocked");
        await expect(sessionRepository.deleteOwned(SESSION_ID, principal)).resolves.toBe("blocked");

        const actionId = await createAction(prisma, {
            taskId,
            status: "failed",
            resultPartPersistedAt: new Date(),
        });
        await prisma.agent_task.update({ where: { id: taskId }, data: { activeActionId: actionId } });
        await expect(sessionRepository.archiveOwned(SESSION_ID, principal, new Date())).resolves.toBe("archived");
        await expect(sessionRepository.deleteOwned(SESSION_ID, principal)).resolves.toBe("deleted");
    });

    it("deletes expired sessions only for settled evidence and retains dangling links", async () => {
        const sessionRepository = new PrismaAgentSessionRepository(prisma as never);
        const cleanupAt = new Date(Date.now() + 1000);
        const expiredAt = new Date(Date.now() - 1000);
        const danglingTaskId = randomUUID();
        const dangling = await repository.createWithEvent({ userId: USER_ID, branchId: BRANCH_ID, sessionId: SESSION_ID }, {
            taskId: danglingTaskId,
            capabilityId: "clients.create",
            draft: taskDraft(),
            status: "cancelled",
            expiresAt: expiredAt,
        }, { clientEventId: randomUUID(), operation: "create", requestHash: "g".repeat(64), acceptedRevision: 1 });
        expect(dangling.status).toBe("created");
        await prisma.agent_task.update({ where: { id: danglingTaskId }, data: { activeActionId: randomUUID() } });
        await prisma.agent_session.update({ where: { id: SESSION_ID }, data: { expiresAt: cleanupAt } });

        const settledSessionId = randomUUID();
        await prisma.agent_session.create({
            data: {
                id: settledSessionId,
                userId: USER_ID,
                branchId: BRANCH_ID,
                locale: "ko",
                model: "lifecycle-test",
                agentVersion: "lifecycle-test",
                expiresAt: futureDate(),
            },
        });
        const settledTaskId = randomUUID();
        const settled = await repository.createWithEvent({ userId: USER_ID, branchId: BRANCH_ID, sessionId: settledSessionId }, {
            taskId: settledTaskId,
            capabilityId: "clients.create",
            draft: taskDraft(),
            status: "cancelled",
            expiresAt: expiredAt,
        }, { clientEventId: randomUUID(), operation: "create", requestHash: "h".repeat(64), acceptedRevision: 1 });
        expect(settled.status).toBe("created");
        const settledActionId = await createAction(prisma, {
            taskId: settledTaskId,
            sessionId: settledSessionId,
            status: "failed",
            resultPartPersistedAt: cleanupAt,
        });
        await prisma.agent_task.update({ where: { id: settledTaskId }, data: { activeActionId: settledActionId } });
        await prisma.agent_session.update({ where: { id: settledSessionId }, data: { expiresAt: cleanupAt } });

        try {
            await expect(sessionRepository.deleteExpired(cleanupAt)).resolves.toBe(1);
            await expect(prisma.agent_session.findUnique({ where: { id: SESSION_ID } })).resolves.toEqual(expect.objectContaining({ id: SESSION_ID }));
            await expect(prisma.agent_session.findUnique({ where: { id: settledSessionId } })).resolves.toBeNull();
        } finally {
            await prisma.agent_task_event.deleteMany({ where: { sessionId: { in: [SESSION_ID, settledSessionId] } } });
            await prisma.agent_action.deleteMany({ where: { sessionId: { in: [SESSION_ID, settledSessionId] } } });
            await prisma.agent_task.deleteMany({ where: { sessionId: { in: [SESSION_ID, settledSessionId] } } });
            await prisma.agent_session.deleteMany({ where: { id: { in: [SESSION_ID, settledSessionId] } } });
        }
    });

    it("serializes edit-first against cleanup with an explicit lock barrier", async () => {
        const created = await service.create(principal, createInput());
        const expiresAt = futureDate(1);
        const cleanupAt = futureDate(2);
        await prisma.agent_task.update({ where: { id: created.snapshot.taskId }, data: { expiresAt } });

        const editBarrier = transactionBarrier(prisma, 1);
        // Candidate discovery is raw query 1; notify before raw query 2 so
        // cleanup is demonstrably waiting on the session row held by edit.
        const cleanupBarrier = transactionBarrier(prisma, undefined, 2);
        const editService = taskService(new PrismaAgentTaskRepository(editBarrier.prisma as never));
        const editPromise = editService.patch(principal, created.snapshot.taskId, {
            clientEventId: randomUUID(),
            expectedRevision: created.snapshot.revision,
            operations: [{ op: "set", field: "name", value: "edit-first" }],
        });
        await editBarrier.ready;

        const cleanupPromise = new PrismaAgentTaskRepository(cleanupBarrier.prisma as never).purgeExpired(cleanupAt);
        await cleanupBarrier.ready;
        editBarrier.release();

        const edited = await editPromise;
        const purged = await cleanupPromise;
        expect(edited.snapshot.revision).toBe(created.snapshot.revision + 1);
        expect(purged).toBe(0);
        await expect(prisma.agent_task.findUnique({ where: { id: created.snapshot.taskId } })).resolves.toEqual(
            expect.objectContaining({ revision: edited.snapshot.revision, purgedAt: null, expiresAt: expect.any(Date) }),
        );
    });

    it("serializes cleanup-first against edit and returns 410 without resurrection", async () => {
        const created = await service.create(principal, createInput());
        const expiresAt = futureDate(1);
        const cleanupAt = futureDate(2);
        await prisma.agent_task.update({ where: { id: created.snapshot.taskId }, data: { expiresAt } });

        const cleanupBarrier = transactionBarrier(prisma, 2);
        const editBarrier = transactionBarrier(prisma, undefined, 1);
        const cleanupRepository = new PrismaAgentTaskRepository(cleanupBarrier.prisma as never);
        const editService = taskService(new PrismaAgentTaskRepository(editBarrier.prisma as never));
        const cleanupPromise = cleanupRepository.purgeExpired(cleanupAt);
        await cleanupBarrier.ready;
        const editPromise = editService.patch(principal, created.snapshot.taskId, {
            clientEventId: randomUUID(),
            expectedRevision: created.snapshot.revision,
            operations: [{ op: "set", field: "name", value: "cleanup-first" }],
        });
        await editBarrier.ready;
        cleanupBarrier.release();

        expect(await cleanupPromise).toBe(1);
        await expect(editPromise).rejects.toMatchObject({ status: 410 });
        await expect(prisma.agent_task.findUnique({ where: { id: created.snapshot.taskId } })).resolves.toEqual(
            expect.objectContaining({ revision: created.snapshot.revision, purgedAt: cleanupAt }),
        );
    });

    it("makes create win over owner delete when its task transaction owns the session lock", async () => {
        const createBarrier = transactionBarrier(prisma, 2);
        const deleteBarrier = transactionBarrier(prisma, undefined, 1);
        const createService = taskService(new PrismaAgentTaskRepository(createBarrier.prisma as never));
        const sessionRepository = new PrismaAgentSessionRepository(deleteBarrier.prisma as never);
        const createPromise = createService.create(principal, createInput());
        await createBarrier.ready;

        const deletePromise = sessionRepository.deleteOwned(SESSION_ID, principal);
        await deleteBarrier.ready;
        createBarrier.release();

        const created = await createPromise;
        expect(await deletePromise).toBe("blocked");
        await expect(prisma.agent_task.findUnique({ where: { id: created.snapshot.taskId } })).resolves.toEqual(
            expect.objectContaining({ sessionId: SESSION_ID }),
        );
        await expect(prisma.agent_task_event.count({ where: { taskId: created.snapshot.taskId } })).resolves.toBe(1);
    });

    it("makes owner delete win over create with no task or event orphan", async () => {
        const deleteBarrier = transactionBarrier(prisma, 1);
        const createBarrier = transactionBarrier(prisma, undefined, 1);
        const sessionRepository = new PrismaAgentSessionRepository(deleteBarrier.prisma as never);
        const createService = taskService(new PrismaAgentTaskRepository(createBarrier.prisma as never));
        const deletePromise = sessionRepository.deleteOwned(SESSION_ID, principal);
        await deleteBarrier.ready;

        const createPromise = createService.create(principal, createInput());
        await createBarrier.ready;
        deleteBarrier.release();

        expect(await deletePromise).toBe("deleted");
        await expect(createPromise).rejects.toMatchObject({ status: 404 });
        expect(await prisma.agent_session.findUnique({ where: { id: SESSION_ID } })).toBeNull();
        expect(await prisma.agent_task.count({ where: { sessionId: SESSION_ID } })).toBe(0);
        expect(await prisma.agent_task_event.count({ where: { sessionId: SESSION_ID } })).toBe(0);
    });
});
