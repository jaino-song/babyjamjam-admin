import { PrismaAgentTaskRepository } from "./prisma-agent-task.repository";
import { createEmptyAgentTaskDraft, type AgentTaskDraft } from "domain/entities/agent-task.entity";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const BRANCH_ID = "20000000-0000-4000-8000-000000000001";
const SESSION_ID = "30000000-0000-4000-8000-000000000001";
const TASK_ID = "40000000-0000-4000-8000-000000000001";
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

function makeTaskRecord(): TaskRecordFixture {
    return taskRecord();
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

function makeEventRecord(): EventRecordFixture {
    return eventRecord();
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
});
