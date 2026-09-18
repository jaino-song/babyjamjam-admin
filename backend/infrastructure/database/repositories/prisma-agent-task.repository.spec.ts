import { PrismaAgentTaskRepository } from "./prisma-agent-task.repository";
import { createEmptyAgentTaskDraft, toAgentTaskContract, type AgentTaskDraft } from "domain/entities/agent-task.entity";
import { createAgentAutomationQuestion } from "application/agent/agent-automation-question";
import type { AgentAutomationEffect } from "domain/entities/agent-automation-consent";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const BRANCH_ID = "20000000-0000-4000-8000-000000000001";
const SESSION_ID = "30000000-0000-4000-8000-000000000001";
const SESSION_ID_2 = "30000000-0000-4000-8000-000000000002";
const TASK_ID = "40000000-0000-4000-8000-000000000001";
const TASK_ID_2 = "40000000-0000-4000-8000-000000000002";
const TASK_ID_3 = "40000000-0000-4000-8000-000000000003";
const EVENT_ID = "50000000-0000-4000-8000-000000000001";
const SNAPSHOT_ID = "60000000-0000-4000-8000-000000000001";
const HASH = "a".repeat(64);
const OTHER_HASH = "b".repeat(64);

const owner = { userId: USER_ID, branchId: BRANCH_ID };
const scope = { ...owner, sessionId: SESSION_ID };

function futureDate(): Date {
    return new Date(Date.now() + 60 * 60 * 1000);
}

function draft(snapshotRef = SNAPSHOT_ID): AgentTaskDraft {
    return createEmptyAgentTaskDraft(snapshotRef);
}

interface TaskRecordFixture {
    id: string;
    sessionId: string;
    userId: string;
    branchId: string;
    capabilityId: string;
    schemaVersion: number;
    revision: number;
    status: string;
    activeSlot: number | null;
    draft: AgentTaskDraft;
    targetRef: string | null;
    targetVersion: string | null;
    activeActionId: string | null;
    lastAcceptedAt: Date;
    expiresAt: Date;
    terminalAt: Date | null;
    purgedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
}

function taskRecord(overrides: Partial<TaskRecordFixture> = {}): TaskRecordFixture {
    const createdAt = new Date("2026-09-16T00:00:00.000Z");
    return {
        id: TASK_ID,
        sessionId: SESSION_ID,
        userId: USER_ID,
        branchId: BRANCH_ID,
        capabilityId: "clients.create",
        schemaVersion: 1,
        revision: 1,
        status: "collecting",
        activeSlot: 1,
        draft: draft(),
        targetRef: null,
        targetVersion: null,
        activeActionId: null,
        lastAcceptedAt: createdAt,
        expiresAt: futureDate(),
        terminalAt: null,
        purgedAt: null,
        createdAt,
        updatedAt: createdAt,
        ...overrides,
    };
}

interface EventRecordFixture {
    id: string;
    sessionId: string;
    userId: string;
    branchId: string;
    clientEventId: string;
    taskId: string;
    operation: string;
    requestHash: string;
    acceptedRevision: number;
    resultActionId: string | null;
    acceptedAt: Date;
}

function eventRecord(overrides: Partial<EventRecordFixture> = {}): EventRecordFixture {
    return {
        id: "70000000-0000-4000-8000-000000000001",
        sessionId: SESSION_ID,
        userId: USER_ID,
        branchId: BRANCH_ID,
        clientEventId: EVENT_ID,
        taskId: TASK_ID,
        operation: "create",
        requestHash: HASH,
        acceptedRevision: 1,
        resultActionId: null,
        acceptedAt: new Date("2026-09-16T00:00:01.000Z"),
        ...overrides,
    };
}

function sessionLockRow() {
    return {
        id: SESSION_ID,
        userId: USER_ID,
        branchId: BRANCH_ID,
        expiresAt: futureDate(),
        archivedAt: null,
    };
}

function transactionWithSessionAndTask(record: TaskRecordFixture) {
    const transaction = {
        $queryRaw: jest.fn()
            .mockResolvedValueOnce([sessionLockRow()])
            .mockResolvedValueOnce([{ id: TASK_ID }]),
        agent_task: {
            create: jest.fn().mockResolvedValue(record),
            findUnique: jest.fn().mockResolvedValue(record),
            findFirst: jest.fn().mockResolvedValue(record),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        agent_task_event: {
            findFirst: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue(eventRecord()),
        },
    };
    return transaction;
}

function repositoryForTransaction(transaction: ReturnType<typeof transactionWithSessionAndTask>) {
    const prisma = {
        $transaction: jest.fn().mockImplementation(async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction)),
    };
    return { repository: new PrismaAgentTaskRepository(prisma as never), prisma };
}

function purgeTransaction(
    record: TaskRecordFixture,
    localActions: readonly Record<string, unknown>[] = [],
    globalActions: readonly Record<string, unknown>[] = localActions,
) {
    const transaction = {
        $queryRaw: jest.fn()
            .mockResolvedValueOnce([{ id: TASK_ID, sessionId: SESSION_ID, userId: USER_ID, branchId: BRANCH_ID }])
            .mockResolvedValueOnce([{ id: SESSION_ID }])
            .mockResolvedValueOnce([{ id: TASK_ID }])
            .mockResolvedValueOnce(localActions)
            .mockResolvedValueOnce(globalActions),
        agent_task: {
            findUnique: jest.fn().mockResolvedValue(record),
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
    };
    const prisma = {
        $transaction: jest.fn().mockImplementation(async (callback: (tx: typeof transaction) => Promise<number>) => callback(transaction)),
    };
    return { transaction, repository: new PrismaAgentTaskRepository(prisma as never) };
}

describe("PrismaAgentTaskRepository", () => {
    it("derives activeSlot=1 for an active task and never accepts caller slot state", async () => {
        const record = taskRecord({ activeSlot: 1 });
        const transaction = transactionWithSessionAndTask(record);
        transaction.$queryRaw.mockReset().mockResolvedValueOnce([sessionLockRow()]);
        const { repository } = repositoryForTransaction(transaction);

        const result = await repository.createWithEvent(scope, {
            taskId: TASK_ID,
            capabilityId: "clients.create",
            draft: draft(),
            status: "collecting",
            expiresAt: futureDate(),
        }, {
            clientEventId: EVENT_ID,
            operation: "create",
            requestHash: HASH,
            acceptedRevision: 1,
        });

        expect(result.status).toBe("created");
        expect(transaction.agent_task.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ activeSlot: 1 }),
        }));
    });

    it("derives activeSlot=null for paused tasks", async () => {
        const record = taskRecord({ status: "paused", activeSlot: null });
        const transaction = transactionWithSessionAndTask(record);
        transaction.$queryRaw.mockReset().mockResolvedValueOnce([sessionLockRow()]);
        const { repository } = repositoryForTransaction(transaction);

        await repository.createWithEvent(scope, {
            taskId: TASK_ID,
            capabilityId: "clients.create",
            draft: draft(),
            status: "paused",
            expiresAt: futureDate(),
        }, {
            clientEventId: EVENT_ID,
            operation: "create",
            requestHash: HASH,
            acceptedRevision: 1,
        });

        expect(transaction.agent_task.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ activeSlot: null }),
        }));
    });

    it("returns stale_revision before mutation or event insertion", async () => {
        const record = taskRecord({ revision: 2 });
        const transaction = transactionWithSessionAndTask(record);
        const { repository } = repositoryForTransaction(transaction);

        const result = await repository.updateWithEvent(scope, TASK_ID, {
            expectedRevision: 1,
            draft: draft(),
        }, {
            clientEventId: EVENT_ID,
            operation: "patch",
            requestHash: HASH,
            acceptedRevision: 2,
        });

        expect(result).toEqual({ status: "stale_revision", currentTask: expect.objectContaining({ revision: 2 }) });
        expect(transaction.agent_task.updateMany).not.toHaveBeenCalled();
        expect(transaction.agent_task_event.create).not.toHaveBeenCalled();
    });

    it("replays a matching event without extending expiry or mutating the task", async () => {
        const acceptedAt = new Date("2026-09-16T00:00:01.000Z");
        const record = taskRecord({ lastAcceptedAt: acceptedAt });
        const transaction = transactionWithSessionAndTask(record);
        transaction.agent_task_event.findFirst.mockResolvedValue(eventRecord());
        const { repository } = repositoryForTransaction(transaction);

        const result = await repository.updateWithEvent(scope, TASK_ID, {
            expectedRevision: 1,
            draft: draft(),
            acceptedAt: new Date("2026-09-16T01:00:00.000Z"),
        }, {
            clientEventId: EVENT_ID,
            operation: "patch",
            requestHash: HASH,
            acceptedRevision: 2,
        });

        expect(result.status).toBe("event_replay");
        expect(transaction.agent_task.updateMany).not.toHaveBeenCalled();
        expect(transaction.agent_task_event.create).not.toHaveBeenCalled();
        expect(record.lastAcceptedAt).toEqual(acceptedAt);
    });

    it("returns event_hash_conflict for the same event ID with another hash", async () => {
        const transaction = transactionWithSessionAndTask(taskRecord());
        transaction.agent_task_event.findFirst.mockResolvedValue(eventRecord({ requestHash: HASH }));
        const { repository } = repositoryForTransaction(transaction);

        const result = await repository.updateWithEvent(scope, TASK_ID, {
            expectedRevision: 1,
            draft: draft(),
        }, {
            clientEventId: EVENT_ID,
            operation: "patch",
            requestHash: OTHER_HASH,
            acceptedRevision: 2,
        });

        expect(result).toEqual({ status: "event_hash_conflict", event: expect.objectContaining({ requestHash: HASH }) });
        expect(transaction.agent_task.updateMany).not.toHaveBeenCalled();
        expect(transaction.agent_task_event.create).not.toHaveBeenCalled();
    });

    it("maps the active-slot unique violation to a typed conflict", async () => {
        const transaction = transactionWithSessionAndTask(taskRecord());
        transaction.agent_task.create.mockRejectedValue({
            code: "P2002",
            meta: { target: ["session_id", "active_slot"] },
        });
        const { repository } = repositoryForTransaction(transaction);

        const result = await repository.createWithEvent(scope, {
            taskId: TASK_ID,
            capabilityId: "clients.create",
            draft: draft(),
            expiresAt: futureDate(),
        }, {
            clientEventId: EVENT_ID,
            operation: "create",
            requestHash: HASH,
            acceptedRevision: 1,
        });

        expect(result).toEqual({ status: "active_task_conflict" });
        expect(transaction.agent_task_event.create).not.toHaveBeenCalled();
    });

    it("rolls back through an explicit transaction abort seam", async () => {
        const transaction = transactionWithSessionAndTask(taskRecord());
        const { repository } = repositoryForTransaction(transaction);

        const result = await repository.withTransaction(scope, async (unitOfWork) => {
            await unitOfWork.lockSession();
            unitOfWork.abort({ status: "storage_failure" });
        });

        expect(result).toEqual({ status: "aborted", value: { status: "storage_failure" } });
        expect(transaction.agent_task.updateMany).not.toHaveBeenCalled();
    });

    it("returns not_found for a foreign or missing task without widening the scope", async () => {
        const prisma = {
            agent_task: { findFirst: jest.fn().mockResolvedValue(null) },
            agent_session: { findFirst: jest.fn() },
        };
        const repository = new PrismaAgentTaskRepository(prisma as never);

        await expect(repository.findOwned(TASK_ID, { userId: "90000000-0000-4000-8000-000000000001", branchId: BRANCH_ID }))
            .resolves.toEqual({ status: "not_found" });
        expect(prisma.agent_session.findFirst).not.toHaveBeenCalled();
    });

    it("does not extend expiry or acceptedAt on reads", async () => {
        const record = taskRecord();
        const prisma = {
            agent_task: { findFirst: jest.fn().mockResolvedValue(record) },
            agent_session: { findFirst: jest.fn().mockResolvedValue({
                id: SESSION_ID,
                userId: USER_ID,
                branchId: BRANCH_ID,
                expiresAt: futureDate(),
                archivedAt: null,
            }) },
        };
        const repository = new PrismaAgentTaskRepository(prisma as never);

        await expect(repository.findOwned(TASK_ID, owner)).resolves.toEqual(expect.objectContaining({ status: "found" }));
        expect(record.lastAcceptedAt).toEqual(new Date("2026-09-16T00:00:00.000Z"));
    });

    it("restores legacy draft JSON without a clearedFields marker as an empty marker set", async () => {
        const legacyDraft = { ...draft() } as Record<string, unknown>;
        delete legacyDraft["clearedFields"];
        const record = taskRecord({ draft: legacyDraft as unknown as AgentTaskDraft });
        const prisma = {
            agent_task: { findFirst: jest.fn().mockResolvedValue(record) },
            agent_session: { findFirst: jest.fn().mockResolvedValue(sessionLockRow()) },
        };
        const repository = new PrismaAgentTaskRepository(prisma as never);

        const result = await repository.findOwned(TASK_ID, owner);

        expect(result).toMatchObject({ status: "found", task: { draft: { clearedFields: [] } } });
    });

    it("restores the protected question without exposing private recipe descriptors", async () => {
        const effects: AgentAutomationEffect[] = [{ kind: "client-rule", ruleId: "private-rule", scheduleId: null,
            recipientType: "client", templateKey: "CLIENT_GREETING", change: "create",
            recipientDigest: HASH, sourceDigest: HASH, templateDigest: HASH, policyDigest: HASH, recipeDigest: HASH }];
        const question = createAgentAutomationQuestion({ effects, availability: "available" });
        const value = draft();
        value.server.automation = { version: 1, question, effects, noSendAtPresentation: false };
        const prisma = { agent_task: { findFirst: jest.fn().mockResolvedValue(taskRecord({ draft: value })) },
            agent_session: { findFirst: jest.fn().mockResolvedValue(sessionLockRow()) } };
        const result = await new PrismaAgentTaskRepository(prisma as never).findOwned(TASK_ID, owner);
        if (result.status !== "found") throw new Error("protected question was not restored");
        expect(result.task.draft.server.automation).toEqual(value.server.automation);
        const snapshot = toAgentTaskContract(result.task);
        expect(snapshot.automation).toEqual(question);
        expect(JSON.stringify(snapshot)).not.toContain("private-rule");
        expect(JSON.stringify(snapshot)).not.toContain("recipientDigest");
    });

    it.each([null, { version: 1 }, { version: 2 }])("refuses malformed present automation state instead of treating it as legacy: %p", async (automation) => {
        const value = { ...draft(), server: { ...draft().server, automation } };
        const prisma = { agent_task: { findFirst: jest.fn().mockResolvedValue(taskRecord({ draft: value as unknown as AgentTaskDraft })) },
            agent_session: { findFirst: jest.fn().mockResolvedValue(sessionLockRow()) } };
        await expect(new PrismaAgentTaskRepository(prisma as never).findOwned(TASK_ID, owner)).resolves.toEqual({ status: "storage_failure" });
    });

    it("refuses a stored question whose no-send constraint disagrees with its draft", async () => {
        const question = createAgentAutomationQuestion({ effects: [], availability: "none" });
        const value = draft();
        value.server.automation = { version: 1, question, effects: [], noSendAtPresentation: true };
        const prisma = { agent_task: { findFirst: jest.fn().mockResolvedValue(taskRecord({ draft: value })) },
            agent_session: { findFirst: jest.fn().mockResolvedValue(sessionLockRow()) } };
        await expect(new PrismaAgentTaskRepository(prisma as never).findOwned(TASK_ID, owner)).resolves.toEqual({ status: "storage_failure" });
    });

    it("round-trips an explicit clear marker through stored draft JSON", async () => {
        const clearedDraft: AgentTaskDraft = {
            ...draft(),
            confirmed: { name: "홍길동" },
            clearedFields: ["address"],
            provenance: { confirmed: {}, tentative: {} },
        };
        const storedRecord = taskRecord({ draft: clearedDraft });
        const transaction = transactionWithSessionAndTask(storedRecord);
        transaction.$queryRaw.mockReset().mockResolvedValueOnce([sessionLockRow()]);
        transaction.agent_task.create.mockResolvedValue(storedRecord);
        const { repository } = repositoryForTransaction(transaction);

        const result = await repository.createWithEvent(scope, {
            taskId: TASK_ID,
            capabilityId: "clients.create",
            draft: clearedDraft,
            status: "collecting",
            expiresAt: futureDate(),
        }, {
            clientEventId: EVENT_ID,
            operation: "create",
            requestHash: HASH,
            acceptedRevision: 1,
        });

        expect(transaction.agent_task.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ draft: expect.objectContaining({ clearedFields: ["address"] }) }),
        }));
        expect(result).toMatchObject({ status: "created", task: { draft: { clearedFields: ["address"] } } });
    });

    it("returns only same-owner recovery tasks joined to a blocking action", async () => {
        const record = taskRecord({ activeActionId: "action-a", expiresAt: new Date("2026-01-01T00:00:00.000Z") });
        const prisma = {
            $queryRaw: jest.fn().mockResolvedValue([{ taskId: TASK_ID }]),
            agent_task: { findFirst: jest.fn().mockResolvedValue(record) },
        };
        const repository = new PrismaAgentTaskRepository(prisma as never);

        await expect(repository.findOwnedRecovery(TASK_ID, owner)).resolves.toEqual({ status: "found", task: expect.objectContaining({ taskId: TASK_ID }) });
        expect(prisma.agent_task.findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: TASK_ID, userId: USER_ID, branchId: BRANCH_ID, purgedAt: null },
        }));
    });

    it("returns deterministic unique recovery IDs and keeps missing sessions distinct", async () => {
        const prisma = {
            $queryRaw: jest.fn().mockResolvedValue([{ taskId: "z" }, { taskId: "a" }, { taskId: "z" }]),
            agent_session: { findFirst: jest.fn().mockResolvedValue({ id: SESSION_ID }) },
        };
        const repository = new PrismaAgentTaskRepository(prisma as never);

        await expect(repository.listOwnedRecovery(scope)).resolves.toEqual({ status: "found", taskIds: ["a", "z"] });
        prisma.agent_session.findFirst.mockResolvedValue(null);
        await expect(repository.listOwnedRecovery(scope)).resolves.toEqual({ status: "not_found" });
    });

    it("purges only expired unblocked payloads and preserves canonical row tombstone fields", async () => {
        const now = new Date("2026-09-17T00:00:00.000Z");
        const oldDraft: AgentTaskDraft = {
            ...draft(),
            confirmed: { name: "sensitive" },
            tentative: { phone: "01012345678" },
            clearedFields: ["address"],
            server: {
                references: {
                    target: { targetRef: "61000000-0000-4000-8000-000000000001", clientId: 99 },
                    choiceTargets: [{ choiceSetRef: "62000000-0000-4000-8000-000000000001", optionId: "63000000-0000-4000-8000-000000000001", clientId: 99 }],
                    phoneCandidates: { "64000000-0000-4000-8000-000000000001": [{ candidateRef: "65000000-0000-4000-8000-000000000001", normalizedPhone: "01012345678" }] },
                },
                actionExpectedRevision: "opaque-action-revision",
                actionProposalRevision: 4,
            },
        };
        const record = taskRecord({
            draft: oldDraft,
            status: "collecting",
            activeSlot: 1,
            activeActionId: null,
            expiresAt: new Date("2026-09-16T00:00:00.000Z"),
            terminalAt: null,
            purgedAt: null,
        });
        const transaction = {
            $queryRaw: jest.fn()
                .mockResolvedValueOnce([{ id: TASK_ID, sessionId: SESSION_ID, userId: USER_ID, branchId: BRANCH_ID }])
                .mockResolvedValueOnce([{ id: SESSION_ID }])
                .mockResolvedValueOnce([{ id: TASK_ID }])
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([]),
            agent_task: {
                findUnique: jest.fn().mockResolvedValue(record),
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
        };
        const prisma = {
            $transaction: jest.fn().mockImplementation(async (callback: (tx: typeof transaction) => Promise<number>) => callback(transaction)),
        };
        const repository = new PrismaAgentTaskRepository(prisma as never);

        await expect(repository.purgeExpired(now)).resolves.toBe(1);
        const update = transaction.agent_task.updateMany.mock.calls[0]?.[0];
        expect(update.where).toEqual(expect.objectContaining({ id: TASK_ID, sessionId: SESSION_ID, purgedAt: null }));
        expect(update.data).toEqual(expect.objectContaining({ activeSlot: null, targetVersion: null, purgedAt: now, updatedAt: now }));
        const purgedDraft = update.data.draft as Record<string, unknown>;
        expect(purgedDraft["confirmed"]).toEqual({});
        expect(purgedDraft["tentative"]).toEqual({});
        expect(purgedDraft["clearedFields"]).toEqual([]);
        expect(purgedDraft["server"]).toEqual({ references: { target: null, choiceTargets: [], phoneCandidates: {} } });
        expect(purgedDraft["currentSnapshotRef"]).toEqual(expect.any(String));
    });

    it("locks every candidate session, then tasks, then actions in stable order", async () => {
        const now = new Date("2026-09-17T00:00:00.000Z");
        const first = taskRecord({ id: TASK_ID, expiresAt: new Date("2026-09-16T00:00:00.000Z") });
        const second = taskRecord({ id: TASK_ID_2, expiresAt: new Date("2026-09-16T00:00:00.000Z") });
        const third = taskRecord({
            id: TASK_ID_3,
            sessionId: SESSION_ID_2,
            expiresAt: new Date("2026-09-16T00:00:00.000Z"),
        });
        const records = new Map([
            [TASK_ID, first],
            [TASK_ID_2, second],
            [TASK_ID_3, third],
        ]);
        const transaction = {
            $queryRaw: jest.fn()
                .mockResolvedValueOnce([
                    { id: TASK_ID, sessionId: SESSION_ID, userId: USER_ID, branchId: BRANCH_ID },
                    { id: TASK_ID_2, sessionId: SESSION_ID, userId: USER_ID, branchId: BRANCH_ID },
                    { id: TASK_ID_3, sessionId: SESSION_ID_2, userId: USER_ID, branchId: BRANCH_ID },
                ])
                .mockResolvedValueOnce([{ id: SESSION_ID }])
                .mockResolvedValueOnce([{ id: SESSION_ID_2 }])
                .mockResolvedValueOnce([{ id: TASK_ID }])
                .mockResolvedValueOnce([{ id: TASK_ID_2 }])
                .mockResolvedValueOnce([{ id: TASK_ID_3 }])
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([]),
            agent_task: {
                findUnique: jest.fn().mockImplementation(({ where }: { where: { id: string } }) => records.get(where.id)),
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
        };
        const prisma = {
            $transaction: jest.fn().mockImplementation(async (callback: (tx: typeof transaction) => Promise<number>) => callback(transaction)),
        };
        const repository = new PrismaAgentTaskRepository(prisma as never);

        await expect(repository.purgeExpired(now)).resolves.toBe(3);

        const sqlCalls = transaction.$queryRaw.mock.calls.map(([query]: [{ sql?: string }]) => query.sql ?? "");
        expect(sqlCalls.slice(1, 3).every((sql) => sql.includes('FROM "agent_session"') && sql.includes("FOR UPDATE"))).toBe(true);
        expect(sqlCalls.slice(3, 6).every((sql) => sql.includes('FROM "agent_task"') && sql.includes("FOR UPDATE"))).toBe(true);
        expect(sqlCalls.slice(6, 8).every((sql) => sql.includes('FROM "agent_action"') && sql.includes("FOR UPDATE"))).toBe(true);
        expect(sqlCalls.slice(8).every((sql) => sql.includes('FROM "agent_action"') && !sql.includes("FOR UPDATE"))).toBe(true);
        expect(transaction.agent_task.updateMany).toHaveBeenCalledTimes(3);
    });

    it.each(["executing", "uncertain"])("retains an expired task with a %s linked action", async (status) => {
        const now = new Date("2026-09-17T00:00:00.000Z");
        const record = taskRecord({ activeActionId: "action-a", expiresAt: new Date("2026-09-16T00:00:00.000Z") });
        const transaction = {
            $queryRaw: jest.fn()
                .mockResolvedValueOnce([{ id: TASK_ID, sessionId: SESSION_ID, userId: USER_ID, branchId: BRANCH_ID }])
                .mockResolvedValueOnce([{ id: SESSION_ID }])
                .mockResolvedValueOnce([{ id: TASK_ID }])
                .mockResolvedValueOnce([{
                    id: "action-a", taskId: TASK_ID, sessionId: SESSION_ID, userId: USER_ID, branchId: BRANCH_ID,
                    status, expiresAt: new Date("2026-09-01T00:00:00.000Z"), resultPartPersistedAt: null,
                }])
                .mockResolvedValueOnce([{
                    id: "action-a", taskId: TASK_ID, sessionId: SESSION_ID, userId: USER_ID, branchId: BRANCH_ID,
                    status, expiresAt: new Date("2026-09-01T00:00:00.000Z"), resultPartPersistedAt: null,
                }]),
            agent_task: { findUnique: jest.fn().mockResolvedValue(record), updateMany: jest.fn() },
        };
        const prisma = { $transaction: jest.fn().mockImplementation(async (callback: (tx: typeof transaction) => Promise<number>) => callback(transaction)) };
        const repository = new PrismaAgentTaskRepository(prisma as never);

        await expect(repository.purgeExpired(now)).resolves.toBe(0);
        expect(transaction.agent_task.updateMany).not.toHaveBeenCalled();
    });

    it.each([
        ["reverse uncertain", "uncertain", new Date("2026-09-18T00:00:00.000Z"), null],
        ["reverse proposed", "proposed", new Date("2026-09-18T00:00:00.000Z"), new Date("2026-09-18T00:00:00.000Z")],
        ["reverse pending result", "succeeded", new Date("2026-09-18T00:00:00.000Z"), null],
        ["reverse unknown", "future-state", new Date("2026-09-18T00:00:00.000Z"), new Date("2026-09-18T00:00:00.000Z")],
    ])("fails closed for %s evidence", async (_label, status, expiresAt, resultPartPersistedAt) => {
        const now = new Date("2026-09-17T00:00:00.000Z");
        const record = taskRecord({ activeActionId: null, expiresAt: new Date("2026-09-16T00:00:00.000Z") });
        const action = {
            id: "action-reverse",
            taskId: TASK_ID,
            sessionId: SESSION_ID,
            userId: USER_ID,
            branchId: BRANCH_ID,
            status,
            expiresAt,
            resultPartPersistedAt,
        };
        const { repository, transaction } = purgeTransaction(record, [action], [action]);

        await expect(repository.purgeExpired(now)).resolves.toBe(0);
        expect(transaction.agent_task.updateMany).not.toHaveBeenCalled();
    });

    it("fails closed for a forward link whose reverse action points nowhere", async () => {
        const now = new Date("2026-09-17T00:00:00.000Z");
        const record = taskRecord({ activeActionId: "action-forward", expiresAt: new Date("2026-09-16T00:00:00.000Z") });
        const action = {
            id: "action-forward",
            taskId: null,
            sessionId: SESSION_ID,
            userId: USER_ID,
            branchId: BRANCH_ID,
            status: "failed",
            expiresAt: new Date("2026-09-01T00:00:00.000Z"),
            resultPartPersistedAt: new Date("2026-09-02T00:00:00.000Z"),
        };
        const { repository, transaction } = purgeTransaction(record, [action], [action]);

        await expect(repository.purgeExpired(now)).resolves.toBe(0);
        expect(transaction.agent_task.updateMany).not.toHaveBeenCalled();
    });

    it("purges settled forward evidence and leaves a repeated cleanup idempotent", async () => {
        const now = new Date("2026-09-17T00:00:00.000Z");
        const record = taskRecord({ activeActionId: "action-settled", expiresAt: new Date("2026-09-16T00:00:00.000Z") });
        const action = {
            id: "action-settled",
            taskId: TASK_ID,
            sessionId: SESSION_ID,
            userId: USER_ID,
            branchId: BRANCH_ID,
            status: "failed",
            expiresAt: new Date("2026-09-01T00:00:00.000Z"),
            resultPartPersistedAt: new Date("2026-09-02T00:00:00.000Z"),
        };
        const { repository, transaction } = purgeTransaction(record, [action], [action]);

        await expect(repository.purgeExpired(now)).resolves.toBe(1);
        await expect(repository.purgeExpired(now)).resolves.toBe(0);
        expect(transaction.agent_task.updateMany).toHaveBeenCalledTimes(1);
    });
});
