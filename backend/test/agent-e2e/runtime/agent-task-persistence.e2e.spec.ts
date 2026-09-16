import { PrismaClient } from "@prisma/client";

import { createEmptyAgentTaskDraft, toAgentTaskContract, type AgentTaskDraft } from "domain/entities/agent-task.entity";
import { PrismaAgentTaskRepository } from "infrastructure/database/repositories/prisma-agent-task.repository";
import type { AgentTaskSessionScope } from "domain/repositories/agent-task.repository.interface";
import {
    assertApprovedAgentTaskPersistenceDatabaseTarget,
    createApprovedAgentTaskPersistenceClient,
} from "./agent-task-persistence.helper";

const describeAgentE2E = process.env["AGENT_E2E"] === "1" ? describe : describe.skip;

const USER_ID = "81000000-0000-4000-8000-000000000001";
const BRANCH_ID = "82000000-0000-4000-8000-000000000001";
const OTHER_USER_ID = "81000000-0000-4000-8000-000000000002";
const OTHER_BRANCH_ID = "82000000-0000-4000-8000-000000000002";
const HASH = "a".repeat(64);
const OTHER_HASH = "b".repeat(64);

function uuid(suffix: number, prefix = "83"): string {
    return `${prefix}000000-0000-4000-8000-${suffix.toString(16).padStart(12, "0")}`;
}

function futureDate(): Date {
    return new Date(Date.now() + 60 * 60 * 1000);
}

function draft(snapshotRef: string): AgentTaskDraft {
    const value = createEmptyAgentTaskDraft(snapshotRef);
    value.confirmed.name = "Synthetic client";
    value.tentative.dueDate = "later";
    value.server.references.target = {
        targetRef: uuid(900, "84"),
        clientId: 101,
    };
    value.server.references.choiceTargets = [{
        choiceSetRef: uuid(901, "85"),
        optionId: uuid(902, "86"),
        clientId: 101,
    }];
    value.server.references.phoneCandidates = {
        [uuid(903, "87")]: [
            { candidateRef: uuid(904, "88"), normalizedPhone: "01012345670" },
            { candidateRef: uuid(905, "88"), normalizedPhone: "01012345671" },
        ],
    };
    return value;
}

describeAgentE2E("agent task persistence against the guarded local database", () => {
    let prisma: PrismaClient;
    let repository: PrismaAgentTaskRepository;
    const sessionIds = new Set<string>();
    let fixtureReady = false;

    async function removeSession(sessionId: string): Promise<void> {
        await prisma.agent_task_event.deleteMany({ where: { sessionId } });
        await prisma.agent_action.deleteMany({ where: { sessionId } });
        await prisma.agent_task.deleteMany({ where: { sessionId } });
        await prisma.agent_session.deleteMany({ where: { id: sessionId } });
    }

    async function createSession(index: number, expiresAt = futureDate()): Promise<AgentTaskSessionScope> {
        const sessionId = uuid(index, "89");
        sessionIds.add(sessionId);
        await prisma.agent_session.create({
            data: {
                id: sessionId,
                userId: USER_ID,
                branchId: BRANCH_ID,
                locale: "ko",
                model: "persistence-test",
                agentVersion: "persistence-test",
                expiresAt,
            },
        });
        return { userId: USER_ID, branchId: BRANCH_ID, sessionId };
    }

    async function createTask(scope: AgentTaskSessionScope, taskNumber: number, eventNumber: number, status?: "collecting" | "paused") {
        return repository.createWithEvent(scope, {
            taskId: uuid(taskNumber, "90"),
            capabilityId: "clients.create",
            draft: draft(uuid(taskNumber, "91")),
            status,
            targetRef: uuid(910, "92"),
            targetVersion: HASH,
            expiresAt: futureDate(),
        }, {
            clientEventId: uuid(eventNumber, "93"),
            operation: "create",
            requestHash: HASH,
            acceptedRevision: 1,
        });
    }

    beforeAll(async () => {
        assertApprovedAgentTaskPersistenceDatabaseTarget();
        prisma = createApprovedAgentTaskPersistenceClient();
        await prisma.$connect();
        await prisma.agent_session.deleteMany({ where: { userId: USER_ID, branchId: BRANCH_ID } });
        await prisma.user.deleteMany({ where: { id: USER_ID } });
        await prisma.branch.deleteMany({ where: { id: BRANCH_ID } });
        await prisma.user.create({ data: { id: USER_ID, email: "agent-task-test@example.invalid" } });
        await prisma.branch.create({ data: { id: BRANCH_ID, name: "Agent task test branch", slug: "agent-task-persistence-test" } });
        repository = new PrismaAgentTaskRepository(prisma as unknown as never);
        fixtureReady = true;
    });

    afterEach(async () => {
        if (!fixtureReady) return;
        const ids = [...sessionIds];
        sessionIds.clear();
        for (const sessionId of ids) await removeSession(sessionId);
    });

    afterAll(async () => {
        if (!fixtureReady) return;
        await prisma.branch.deleteMany({ where: { id: BRANCH_ID } });
        await prisma.user.deleteMany({ where: { id: USER_ID } });
        await prisma.$disconnect();
    });

    it("round-trips partial and tentative draft state with canonical target columns", async () => {
        const scope = await createSession(1);
        const result = await createTask(scope, 1, 1);

        expect(result.status).toBe("created");
        if (result.status !== "created") return;
        expect(result.task.activeSlot).toBe(1);
        expect(result.task.targetRef).toBe(uuid(910, "92"));
        expect(result.task.targetVersion).toBe(HASH);
        expect(result.task.draft.confirmed.name).toBe("Synthetic client");
        expect(result.task.draft.tentative.dueDate).toBe("later");
        expect(result.task.draft.server.references.target?.clientId).toBe(101);
        expect(JSON.stringify(toAgentTaskContract(result.task))).not.toContain("01012345670");
        expect(JSON.stringify(toAgentTaskContract(result.task))).not.toContain("01012345671");

        const stored = await prisma.agent_task.findUnique({ where: { id: result.task.taskId } });
        expect(stored?.activeSlot).toBe(1);
        expect(stored?.targetVersion).toBe(HASH);
    });

    it("allows multiple paused tasks and derives activeSlot=null without caller input", async () => {
        const scope = await createSession(2);
        const first = await createTask(scope, 2, 2, "paused");
        const second = await createTask(scope, 3, 3, "paused");

        expect(first.status).toBe("created");
        expect(second.status).toBe("created");
        expect(await prisma.agent_task.count({ where: { sessionId: scope.sessionId, activeSlot: null } })).toBe(2);
    });

    it("returns typed session refusals for archived and expired sessions", async () => {
        const archived = await createSession(4);
        await prisma.agent_session.update({ where: { id: archived.sessionId }, data: { archivedAt: new Date() } });
        await expect(createTask(archived, 4, 4)).resolves.toEqual({ status: "session_archived", session: expect.any(Object) });

        const expired = await createSession(5, new Date(Date.now() - 1_000));
        await expect(createTask(expired, 5, 5)).resolves.toEqual({ status: "session_expired", session: expect.any(Object) });
    });

    it("keeps foreign owner reads as not_found", async () => {
        const scope = await createSession(6);
        const created = await createTask(scope, 6, 6);
        if (created.status !== "created") throw new Error("Expected fixture task");

        await expect(repository.findOwned(created.task.taskId, { userId: OTHER_USER_ID, branchId: BRANCH_ID }))
            .resolves.toEqual({ status: "not_found" });
        await expect(repository.findOwned(created.task.taskId, { userId: USER_ID, branchId: OTHER_BRANCH_ID }))
            .resolves.toEqual({ status: "not_found" });
    });

    it("returns stale_revision without changing the task or adding an event", async () => {
        const scope = await createSession(7);
        const created = await createTask(scope, 7, 7);
        if (created.status !== "created") throw new Error("Expected fixture task");

        const result = await repository.updateWithEvent(scope, created.task.taskId, {
            expectedRevision: 0,
            draft: draft(uuid(707, "91")),
        }, {
            clientEventId: uuid(707, "93"),
            operation: "patch",
            requestHash: HASH,
            acceptedRevision: 1,
        });
        expect(result.status).toBe("stale_revision");
        expect(await prisma.agent_task.findUnique({ where: { id: created.task.taskId } })).toEqual(expect.objectContaining({ revision: 1 }));
        expect(await prisma.agent_task_event.count({ where: { sessionId: scope.sessionId } })).toBe(1);
    });

    it("replays the same event without extending acceptedAt or expiry", async () => {
        const scope = await createSession(8);
        const created = await createTask(scope, 8, 8);
        if (created.status !== "created") throw new Error("Expected fixture task");
        const before = await prisma.agent_task.findUnique({ where: { id: created.task.taskId } });
        if (!before) throw new Error("Expected stored task");

        const result = await repository.updateWithEvent(scope, created.task.taskId, {
            expectedRevision: 1,
            draft: draft(uuid(808, "91")),
            acceptedAt: new Date(Date.now() + 60 * 60 * 1000),
        }, {
            clientEventId: uuid(8, "93"),
            operation: "patch",
            requestHash: HASH,
            acceptedRevision: 1,
        });
        expect(result.status).toBe("event_replay");
        const after = await prisma.agent_task.findUnique({ where: { id: created.task.taskId } });
        expect(after?.lastAcceptedAt).toEqual(before.lastAcceptedAt);
        expect(after?.expiresAt).toEqual(before.expiresAt);
        expect(after?.revision).toBe(before.revision);
    });

    it("rejects same event ID with a different hash", async () => {
        const scope = await createSession(9);
        const created = await createTask(scope, 9, 9);
        if (created.status !== "created") throw new Error("Expected fixture task");

        const result = await repository.updateWithEvent(scope, created.task.taskId, {
            expectedRevision: 1,
            draft: draft(uuid(909, "91")),
        }, {
            clientEventId: uuid(9, "93"),
            operation: "patch",
            requestHash: OTHER_HASH,
            acceptedRevision: 1,
        });
        expect(result.status).toBe("event_hash_conflict");
        expect(await prisma.agent_task.findUnique({ where: { id: created.task.taskId } })).toEqual(expect.objectContaining({ revision: 1 }));
    });

    it("updates exactly one revision and inserts the receipt atomically", async () => {
        const scope = await createSession(10);
        const created = await createTask(scope, 10, 10);
        if (created.status !== "created") throw new Error("Expected fixture task");

        const result = await repository.updateWithEvent(scope, created.task.taskId, {
            expectedRevision: 1,
            draft: draft(uuid(1010, "91")),
        }, {
            clientEventId: uuid(1010, "93"),
            operation: "patch",
            requestHash: OTHER_HASH,
            acceptedRevision: 2,
        });
        expect(result.status).toBe("updated");
        expect(await prisma.agent_task.findUnique({ where: { id: created.task.taskId } })).toEqual(expect.objectContaining({ revision: 2 }));
        expect(await prisma.agent_task_event.count({ where: { sessionId: scope.sessionId } })).toBe(2);
    });

    it("rolls back the task update when receipt insertion fails", async () => {
        const scope = await createSession(15);
        const created = await createTask(scope, 15, 15);
        if (created.status !== "created") throw new Error("Expected fixture task");
        const before = await prisma.agent_task.findUnique({ where: { id: created.task.taskId } });
        if (!before) throw new Error("Expected stored task");

        const result = await repository.updateWithEvent(scope, created.task.taskId, {
            expectedRevision: 1,
            draft: draft(uuid(1515, "91")),
        }, {
            clientEventId: uuid(1515, "93"),
            operation: "x".repeat(41),
            requestHash: OTHER_HASH,
            acceptedRevision: 2,
        });

        expect(result).toEqual({ status: "storage_failure" });
        const after = await prisma.agent_task.findUnique({ where: { id: created.task.taskId } });
        expect(after).toEqual(before);
        expect(await prisma.agent_task_event.count({ where: { sessionId: scope.sessionId } })).toBe(1);
    });

    it("rolls back task and receipt writes when a typed transaction abort is requested", async () => {
        const scope = await createSession(16);
        const created = await createTask(scope, 16, 16);
        if (created.status !== "created") throw new Error("Expected fixture task");
        const before = await prisma.agent_task.findUnique({ where: { id: created.task.taskId } });
        if (!before) throw new Error("Expected stored task");

        const result = await repository.withTransaction(scope, async (unitOfWork) => {
            const session = await unitOfWork.lockSession();
            if (session.status !== "locked") throw new Error("Expected locked session");
            const locked = await unitOfWork.lockTask(created.task.taskId);
            if (locked.status !== "locked") throw new Error("Expected locked task");
            const updated = await unitOfWork.updateTask({
                expectedRevision: locked.task.revision,
                draft: draft(uuid(1616, "91")),
                acceptedAt: new Date(Date.now() + 60 * 60 * 1000),
            });
            if (updated.status !== "updated") throw new Error("Expected updated task");
            const inserted = await unitOfWork.insertEvent({
                clientEventId: uuid(1616, "93"),
                operation: "abort-test",
                requestHash: OTHER_HASH,
                acceptedRevision: updated.task.revision,
            });
            if (inserted.status !== "inserted") throw new Error("Expected inserted receipt");
            unitOfWork.abort({ status: "storage_failure" });
        });

        expect(result).toEqual({ status: "aborted", value: { status: "storage_failure" } });
        const after = await prisma.agent_task.findUnique({ where: { id: created.task.taskId } });
        expect(after).toEqual(before);
        expect(await prisma.agent_task_event.count({ where: { sessionId: scope.sessionId } })).toBe(1);
    });

    it("persists a no-op receipt without task mutation and replays it after a later edit", async () => {
        const scope = await createSession(17);
        const created = await createTask(scope, 17, 17);
        if (created.status !== "created") throw new Error("Expected fixture task");
        const noOpEventId = uuid(1701, "93");
        const noOpHash = "c".repeat(64);
        const before = await prisma.agent_task.findUnique({ where: { id: created.task.taskId } });
        if (!before) throw new Error("Expected stored task");

        const noOp = await repository.withTransaction(scope, async (unitOfWork) => {
            const session = await unitOfWork.lockSession();
            if (session.status !== "locked") throw new Error("Expected locked session");
            const locked = await unitOfWork.lockTask(created.task.taskId);
            if (locked.status !== "locked") throw new Error("Expected locked task");
            const existing = await unitOfWork.findEvent(noOpEventId);
            if (existing.status !== "not_found") throw new Error("Expected no-op event to be new");
            const inserted = await unitOfWork.insertEvent({
                clientEventId: noOpEventId,
                operation: "noop",
                requestHash: noOpHash,
                acceptedRevision: locked.task.revision,
            });
            if (inserted.status !== "inserted") throw new Error("Expected no-op receipt");
            return inserted.event;
        });
        expect(noOp.status).toBe("ok");
        const afterNoOp = await prisma.agent_task.findUnique({ where: { id: created.task.taskId } });
        expect(afterNoOp).toEqual(before);

        const laterDraft = draft(uuid(1717, "91"));
        laterDraft.confirmed.name = "Later edit";
        const later = await repository.updateWithEvent(scope, created.task.taskId, {
            expectedRevision: 1,
            draft: laterDraft,
        }, {
            clientEventId: uuid(1717, "93"),
            operation: "patch",
            requestHash: OTHER_HASH,
            acceptedRevision: 2,
        });
        expect(later.status).toBe("updated");

        const replay = await repository.updateWithEvent(scope, created.task.taskId, {
            expectedRevision: 0,
            draft: draft(uuid(1718, "91")),
        }, {
            clientEventId: noOpEventId,
            operation: "noop",
            requestHash: noOpHash,
            acceptedRevision: 1,
        });
        expect(replay.status).toBe("event_replay");
        if (replay.status !== "event_replay") return;
        expect(replay.task.revision).toBe(2);
        expect(replay.task.draft.confirmed.name).toBe("Later edit");
        expect(replay.task.draft.currentSnapshotRef).toBe(uuid(1717, "91"));
    });

    it("allows the same client event ID in different owner/session scopes", async () => {
        const firstScope = await createSession(11);
        const secondScope = await createSession(12);
        const eventId = uuid(1100, "93");
        const first = await repository.createWithEvent(firstScope, {
            taskId: uuid(1101, "90"), capabilityId: "clients.create", draft: draft(uuid(1101, "91")), expiresAt: futureDate(),
        }, { clientEventId: eventId, operation: "create", requestHash: HASH, acceptedRevision: 1 });
        const second = await repository.createWithEvent(secondScope, {
            taskId: uuid(1102, "90"), capabilityId: "clients.create", draft: draft(uuid(1102, "91")), expiresAt: futureDate(),
        }, { clientEventId: eventId, operation: "create", requestHash: HASH, acceptedRevision: 1 });

        expect(first.status).toBe("created");
        expect(second.status).toBe("created");
        expect(await prisma.agent_task_event.count({ where: { clientEventId: eventId } })).toBe(2);
    });

    it("maps concurrent active creates to one created task and one active conflict", async () => {
        const scope = await createSession(13);
        const results = await Promise.all([
            createTask(scope, 1301, 1301),
            createTask(scope, 1302, 1302),
        ]);

        expect(results.map((result) => result.status).sort()).toEqual(["active_task_conflict", "created"]);
        expect(await prisma.agent_task.count({ where: { sessionId: scope.sessionId, activeSlot: 1 } })).toBe(1);
        expect(await prisma.agent_task_event.count({ where: { sessionId: scope.sessionId } })).toBe(1);
    });

    it("returns owned expiry tombstones without extending them", async () => {
        const scope = await createSession(14);
        const created = await createTask(scope, 14, 14);
        if (created.status !== "created") throw new Error("Expected fixture task");
        const expiredAt = new Date(Date.now() - 1_000);
        await prisma.agent_task.update({ where: { id: created.task.taskId }, data: { expiresAt: expiredAt } });

        const result = await repository.findOwned(created.task.taskId, scope);
        expect(result.status).toBe("task_expired");
        const stored = await prisma.agent_task.findUnique({ where: { id: created.task.taskId } });
        expect(stored?.expiresAt).toEqual(expiredAt);
    });
});
