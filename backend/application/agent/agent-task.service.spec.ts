import { randomUUID } from "node:crypto";

import { AgentTaskConflictException, AgentTaskService } from "./agent-task.service";
import { clientAgentTargetVersion } from "../../application/usecases/client/client-agent-target";
import { createEmptyAgentTaskDraft, type AgentTaskEntity, type AgentTaskEventEntity } from "domain/entities/agent-task.entity";
import type { ClientEntity } from "domain/entities/client.entity";

const owner = {
    userId: randomUUID(),
    branchId: randomUUID(),
    globalRole: "admin",
    branchRole: "manager",
};
const sessionId = randomUUID();
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

class TransactionAbort extends Error {
    constructor(readonly result: unknown) {
        super("abort");
    }
}

function tombstone(task: AgentTaskEntity) {
    return {
        taskId: task.taskId,
        sessionId: task.sessionId,
        userId: task.userId,
        branchId: task.branchId,
        expiresAt: task.expiresAt,
        purgedAt: task.purgedAt,
    };
}

function makeTask(overrides: Partial<AgentTaskEntity> = {}): AgentTaskEntity {
    const now = new Date();
    const taskId = overrides.taskId ?? randomUUID();
    const draft = overrides.draft ?? createEmptyAgentTaskDraft(randomUUID());
    return {
        taskId,
        sessionId,
        userId: owner.userId,
        branchId: owner.branchId,
        capabilityId: "clients.create",
        schemaVersion: 1,
        revision: 1,
        status: "collecting",
        activeSlot: 1,
        draft,
        targetRef: null,
        targetVersion: null,
        activeActionId: null,
        lastAcceptedAt: now,
        expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
        terminalAt: null,
        purgedAt: null,
        createdAt: now,
        updatedAt: now,
        ...overrides,
    };
}

function makeClientRecord(id = 7): ClientEntity {
    return {
        id,
        name: "기존 고객",
        address: null,
        phone: "01012345678",
        type: null,
        duration: null,
        fullPrice: null,
        grant: null,
        actualPrice: null,
        startDate: null,
        endDate: null,
        dueDate: null,
        birthDate: null,
        careCenter: null,
        voucherClient: false,
        birthday: null,
        serviceStatus: "pre_booking",
        breastPump: false,
        areaId: null,
    } as unknown as ClientEntity;
}

function makeConsentBinding() {
    return {
        recipientRef: randomUUID(),
        effectDigest: "a".repeat(64),
        templateRef: randomUUID(),
        policyDigest: "b".repeat(64),
        consentEventId: randomUUID(),
    };
}

class FakeTaskRepository {
    readonly tasks = new Map<string, AgentTaskEntity>();
    readonly events = new Map<string, AgentTaskEventEntity>();
    session = { expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), archivedAt: null as Date | null };

    private scoped(task: AgentTaskEntity, scope: { userId: string; branchId: string; sessionId: string }) {
        return task.userId === scope.userId && task.branchId === scope.branchId && task.sessionId === scope.sessionId;
    }

    async findOwned(taskId: string, scopedOwner: { userId: string; branchId: string }) {
        const task = this.tasks.get(taskId);
        if (!task || task.userId !== scopedOwner.userId || task.branchId !== scopedOwner.branchId) return { status: "not_found" } as const;
        if (this.session.archivedAt) return { status: "session_archived", session: { sessionId: task.sessionId, ...scopedOwner, ...this.session } } as const;
        if (this.session.expiresAt <= new Date()) return { status: "session_expired", session: { sessionId: task.sessionId, ...scopedOwner, ...this.session } } as const;
        if (task.purgedAt) return { status: "task_purged", tombstone: tombstone(task) } as const;
        if (task.expiresAt <= new Date()) return { status: "task_expired", tombstone: tombstone(task), task } as const;
        return { status: "found", task } as const;
    }

    async listOwned(scope: { userId: string; branchId: string; sessionId: string }) {
        if (this.session.archivedAt) return { status: "session_archived", session: { ...scope, ...this.session } } as const;
        if (this.session.expiresAt <= new Date()) return { status: "session_expired", session: { ...scope, ...this.session } } as const;
        return { status: "found", tasks: [...this.tasks.values()].filter((task) => this.scoped(task, scope)) } as const;
    }

    async withTransaction<T>(scope: { userId: string; branchId: string; sessionId: string }, operation: (transaction: any) => Promise<T>) {
        try {
            return { status: "ok", value: await operation(this.transaction(scope)) } as const;
        } catch (error) {
            if (error instanceof TransactionAbort) return { status: "aborted", value: error.result as T } as const;
            return { status: "storage_failure" } as const;
        }
    }

    async createWithEvent(scope: { userId: string; branchId: string; sessionId: string }, input: any, eventInput: any) {
        const session = await this.withTransaction(scope, async (transaction) => {
            const locked = await transaction.lockSession();
            if (locked.status !== "locked") return locked;
            const existing = await transaction.findEvent(eventInput.clientEventId);
            if (existing.status === "found") {
                if (existing.event.requestHash !== eventInput.requestHash) return { status: "event_hash_conflict", event: existing.event };
                const current = await transaction.readTask(existing.event.taskId);
                if (current.status === "found" || current.status === "task_expired") {
                    return { status: "event_replay", task: current.task, receipt: this.receipt(existing.event, current.task) };
                }
                return current;
            }
            const created = await transaction.createTask(input);
            if (created.status !== "created") return created;
            const inserted = await transaction.insertEvent(eventInput);
            if (inserted.status !== "inserted") return { status: "storage_failure" };
            return { status: "created", task: created.task, receipt: this.receipt(inserted.event, created.task) };
        });
        return session.status === "ok" || session.status === "aborted" ? session.value : session;
    }

    async updateWithEvent() {
        return { status: "storage_failure" } as const;
    }

    private transaction(scope: { userId: string; branchId: string; sessionId: string }) {
        let lockedTask: AgentTaskEntity | null = null;
        const read = (taskId: string) => {
            const task = this.tasks.get(taskId);
            if (!task || !this.scoped(task, scope)) return { status: "not_found" } as const;
            if (task.purgedAt) return { status: "task_purged", tombstone: tombstone(task) } as const;
            if (task.expiresAt <= new Date()) return { status: "task_expired", tombstone: tombstone(task), task } as const;
            return { status: "found", task } as const;
        };
        return {
            lockSession: async () => {
                if (this.session.archivedAt) return { status: "session_archived", session: { ...scope, ...this.session } } as const;
                if (this.session.expiresAt <= new Date()) return { status: "session_expired", session: { ...scope, ...this.session } } as const;
                return { status: "locked", session: { ...scope, ...this.session } } as const;
            },
            lockTask: async (taskId: string) => {
                const result = read(taskId);
                if (result.status === "found" || result.status === "task_expired") lockedTask = result.task;
                return result.status === "found"
                    ? { status: "locked", task: result.task } as const
                    : result;
            },
            findEvent: async (clientEventId: string) => {
                const event = this.events.get(clientEventId);
                return event && event.sessionId === scope.sessionId && event.userId === scope.userId && event.branchId === scope.branchId
                    ? { status: "found", event } as const
                    : { status: "not_found" } as const;
            },
            createTask: async (input: any) => {
                const task = makeTask({
                    taskId: input.taskId,
                    sessionId: scope.sessionId,
                    userId: scope.userId,
                    branchId: scope.branchId,
                    capabilityId: input.capabilityId,
                    draft: input.draft,
                    revision: input.revision ?? 1,
                    status: input.status ?? "collecting",
                    activeSlot: input.status === "paused" || input.status === "collecting" || input.status === "confirming_target" || input.status === "review_ready" ? 1 : null,
                    expiresAt: input.expiresAt,
                });
                this.tasks.set(task.taskId, task);
                lockedTask = task;
                return { status: "created", task } as const;
            },
            updateTask: async (input: any) => {
                if (!lockedTask) return { status: "not_found" } as const;
                if (input.expectedRevision !== lockedTask.revision) return { status: "stale_revision", currentTask: lockedTask } as const;
                const task = makeTask({
                    ...lockedTask,
                    revision: lockedTask.revision + 1,
                    draft: input.draft ?? lockedTask.draft,
                    status: input.status ?? lockedTask.status,
                    activeSlot: input.status === "paused" || input.status === "collecting" || input.status === "confirming_target" || input.status === "review_ready"
                        ? 1
                        : input.status === undefined && lockedTask.activeSlot === 1 ? 1 : null,
                    lastAcceptedAt: input.acceptedAt ?? lockedTask.lastAcceptedAt,
                    expiresAt: input.expiresAt ?? lockedTask.expiresAt,
                    updatedAt: input.acceptedAt ?? lockedTask.updatedAt,
                });
                this.tasks.set(task.taskId, task);
                lockedTask = task;
                return { status: "updated", task } as const;
            },
            insertEvent: async (input: any) => {
                if (!lockedTask) return { status: "storage_failure" } as const;
                if (this.events.has(input.clientEventId)) return { status: "event_hash_conflict" } as const;
                const event: AgentTaskEventEntity = {
                    id: randomUUID(),
                    sessionId: scope.sessionId,
                    userId: scope.userId,
                    branchId: scope.branchId,
                    clientEventId: input.clientEventId,
                    taskId: lockedTask.taskId,
                    operation: input.operation,
                    requestHash: input.requestHash,
                    acceptedRevision: input.acceptedRevision,
                    resultActionId: input.resultActionId ?? null,
                    acceptedAt: input.acceptedAt ?? new Date(),
                };
                this.events.set(event.clientEventId, event);
                return { status: "inserted", event } as const;
            },
            readTask: async (taskId: string) => read(taskId),
            abort: <T>(result: T): never => { throw new TransactionAbort(result); },
        };
    }

    private receipt(event: AgentTaskEventEntity, task: AgentTaskEntity) {
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
}

function buildService(repository: FakeTaskRepository, client = { findByPhone: jest.fn().mockResolvedValue(null), findById: jest.fn().mockResolvedValue(null) }) {
    const policy = {
        assertCanCreate: jest.fn().mockResolvedValue(capability),
        assertCanPatch: jest.fn().mockReturnValue(capability),
    };
    const service = new AgentTaskService(repository as never, policy as never, client as never);
    return { service, policy, client };
}

function createInput(eventId: string = randomUUID(), operations: unknown[] = [
    { op: "set", field: "name", value: "홍길동" },
    { op: "set", field: "phone", value: "010-1234-5678" },
]) {
    return { sessionId, capabilityId: "clients.create", clientEventId: eventId, operations };
}

describe("AgentTaskService", () => {
    it("creates a scoped task and replays the same receipt after a fresh service instance", async () => {
        const repository = new FakeTaskRepository();
        const first = buildService(repository).service;
        const input = createInput();
        const created = await first.create(owner, input);
        const second = buildService(repository).service;
        const replay = await second.create(owner, {
            ...input,
            operations: [
                { op: "set", field: "name", value: "홍길동" },
                { op: "set", field: "phone", value: "01012345678" },
            ],
        });

        expect(created.receipt).toEqual(replay.receipt);
        expect(replay.snapshot.taskId).toBe(created.snapshot.taskId);
        expect(repository.tasks.size).toBe(1);
    });

    it("rejects a reused event id with a different semantic payload and no receipt", async () => {
        const repository = new FakeTaskRepository();
        const service = buildService(repository).service;
        const eventId = randomUUID();
        await service.create(owner, createInput(eventId));

        await expect(service.create(owner, createInput(eventId, [{ op: "set", field: "name", value: "다른 이름" }]))).rejects.toMatchObject({
            response: expect.objectContaining({ code: "AGENT_TASK_CONFLICT", reason: "event_payload" }),
        });
        expect(repository.events.size).toBe(1);
    });

    it("keeps operation order significant in the canonical event hash", async () => {
        const repository = new FakeTaskRepository();
        const service = buildService(repository).service;
        const eventId = randomUUID();
        await service.create(owner, createInput(eventId, [
            { op: "set", field: "dueDate", value: "2026-03-05" },
            { op: "discard-change", field: "dueDate" },
        ]));

        await expect(service.create(owner, createInput(eventId, [
            { op: "discard-change", field: "dueDate" },
            { op: "set", field: "dueDate", value: "2026-03-05" },
        ]))).rejects.toMatchObject({ response: expect.objectContaining({ reason: "event_payload" }) });
    });

    it("rejects stale revisions without mutating the task", async () => {
        const repository = new FakeTaskRepository();
        const service = buildService(repository).service;
        const created = await service.create(owner, createInput());
        const taskBefore = repository.tasks.get(created.snapshot.taskId)!;
        const before = JSON.stringify(taskBefore);

        await expect(service.patch(owner, created.snapshot.taskId, {
            clientEventId: randomUUID(),
            expectedRevision: 0,
            operations: [{ op: "set", field: "name", value: "새 이름" }],
        })).rejects.toMatchObject({ response: expect.objectContaining({ code: "AGENT_TASK_CONFLICT", reason: "revision" }) });
        expect(JSON.stringify(repository.tasks.get(created.snapshot.taskId))).toBe(before);
    });

    it("extends retention only for an accepted changed draft", async () => {
        const repository = new FakeTaskRepository();
        const service = buildService(repository).service;
        const created = await service.create(owner, createInput());
        repository.tasks.get(created.snapshot.taskId)!.expiresAt = new Date(Date.now() + 60 * 60 * 1000);
        const before = repository.tasks.get(created.snapshot.taskId)!.expiresAt;
        const result = await service.patch(owner, created.snapshot.taskId, {
            clientEventId: randomUUID(),
            expectedRevision: created.snapshot.revision,
            operations: [{ op: "set", field: "address", value: "서울" }],
        });

        expect(result.snapshot.revision).toBe(created.snapshot.revision + 1);
        expect(repository.tasks.get(created.snapshot.taskId)!.expiresAt.getTime()).toBeGreaterThan(before.getTime());
    });

    it("maps invalid operations to a bounded validation error", async () => {
        const repository = new FakeTaskRepository();
        const service = buildService(repository).service;

        await expect(service.create(owner, {
            ...createInput(),
            operations: [{ op: "set", field: "notAField", value: "raw" }],
        })).rejects.toMatchObject({ status: 400 });
    });

    it("keeps update drafts partial and does not require create identifiers", async () => {
        const repository = new FakeTaskRepository();
        const result = await buildService(repository).service.create(owner, {
            sessionId,
            capabilityId: "clients.update",
            clientEventId: randomUUID(),
            operations: [{ op: "set", field: "dueDate", value: "2026-03-05" }],
        });

        expect(result.snapshot.confirmed).toEqual({ dueDate: "2026-03-05" });
        expect(result.snapshot.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: "task.required" }),
        ]));
        expect(result.snapshot.issues).not.toEqual(expect.arrayContaining([
            expect.objectContaining({ field: "name" }),
            expect.objectContaining({ field: "phone" }),
        ]));
    });

    it("validates an update target and keeps due-date-only readiness scoped", async () => {
        const repository = new FakeTaskRepository();
        const targetClient = makeClientRecord();
        const targetRef = randomUUID();
        const task = makeTask({
            capabilityId: "clients.update",
            targetRef,
            targetVersion: clientAgentTargetVersion(targetClient),
            draft: {
                ...createEmptyAgentTaskDraft(randomUUID()),
                server: { references: { target: { targetRef, clientId: targetClient.id }, choiceTargets: [], phoneCandidates: {} } },
            },
        });
        repository.tasks.set(task.taskId, task);
        const client = {
            findByPhone: jest.fn().mockResolvedValue(null),
            findById: jest.fn().mockResolvedValue(targetClient),
        };

        const result = await buildService(repository, client).service.patch(owner, task.taskId, {
            clientEventId: randomUUID(),
            expectedRevision: task.revision,
            operations: [{ op: "set", field: "dueDate", value: "2026-03-05" }],
        });

        expect(result.snapshot.confirmed).toEqual({ dueDate: "2026-03-05" });
        expect(result.snapshot.issues).not.toEqual(expect.arrayContaining([
            expect.objectContaining({ field: "name" }),
            expect.objectContaining({ field: "phone" }),
        ]));
        expect(result.snapshot.issues).not.toEqual(expect.arrayContaining([
            expect.objectContaining({ code: "task.stale" }),
        ]));
        expect(client.findByPhone).not.toHaveBeenCalled();
    });

    it("records a stale target issue from the authoritative branch lookup", async () => {
        const repository = new FakeTaskRepository();
        const targetClient = makeClientRecord();
        const targetRef = randomUUID();
        const task = makeTask({
            capabilityId: "clients.update",
            targetRef,
            targetVersion: "a".repeat(64),
            draft: {
                ...createEmptyAgentTaskDraft(randomUUID()),
                server: { references: { target: { targetRef, clientId: targetClient.id }, choiceTargets: [], phoneCandidates: {} } },
            },
        });
        repository.tasks.set(task.taskId, task);

        const result = await buildService(repository, {
            findByPhone: jest.fn().mockResolvedValue(null),
            findById: jest.fn().mockResolvedValue(targetClient),
        }).service.patch(owner, task.taskId, {
            clientEventId: randomUUID(),
            expectedRevision: task.revision,
            operations: [{ op: "set", field: "dueDate", value: "2026-03-05" }],
        });

        expect(result.snapshot.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: "task.stale" }),
        ]));
    });

    it("checks duplicate phones only for a proposed update field and excludes its target client", async () => {
        const repository = new FakeTaskRepository();
        const targetClient = makeClientRecord();
        const targetRef = randomUUID();
        const task = makeTask({
            capabilityId: "clients.update",
            targetRef,
            targetVersion: clientAgentTargetVersion(targetClient),
            draft: {
                ...createEmptyAgentTaskDraft(randomUUID()),
                server: { references: { target: { targetRef, clientId: targetClient.id }, choiceTargets: [], phoneCandidates: {} } },
            },
        });
        repository.tasks.set(task.taskId, task);
        const client = {
            findByPhone: jest.fn().mockResolvedValue({ id: 99 }),
            findById: jest.fn().mockResolvedValue(targetClient),
        };

        const result = await buildService(repository, client).service.patch(owner, task.taskId, {
            clientEventId: randomUUID(),
            expectedRevision: task.revision,
            operations: [{ op: "set", field: "phone", value: "010-9876-5432" }],
        });

        expect(result.snapshot.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: "task.duplicate", field: "phone" }),
        ]));
        expect(client.findByPhone).toHaveBeenCalledWith(owner.branchId, "01098765432");
    });

    it.each([
        ["9-digit", "02-123-4567", "021234567"],
        ["10-digit", "02-1234-5678", "0212345678"],
    ])("accepts a canonical provider %s update phone", async (_label, phone, normalizedPhone) => {
        const repository = new FakeTaskRepository();
        const targetClient = makeClientRecord();
        const targetRef = randomUUID();
        const client = {
            findByPhone: jest.fn().mockResolvedValue(null),
            findById: jest.fn().mockResolvedValue(targetClient),
        };
        const task = makeTask({
            capabilityId: "clients.update",
            targetRef,
            targetVersion: clientAgentTargetVersion(targetClient),
            draft: {
                ...createEmptyAgentTaskDraft(randomUUID()),
                server: { references: { target: { targetRef, clientId: targetClient.id }, choiceTargets: [], phoneCandidates: {} } },
            },
        });
        repository.tasks.set(task.taskId, task);

        const result = await buildService(repository, client).service.patch(owner, task.taskId, {
            clientEventId: randomUUID(),
            expectedRevision: task.revision,
            operations: [{ op: "set", field: "phone", value: phone }],
        });

        expect(result.snapshot.confirmed.phone).toBe(normalizedPhone);
        expect(result.snapshot.issues).not.toEqual(expect.arrayContaining([
            expect.objectContaining({ field: "phone", code: "task.invalid" }),
        ]));
        expect(client.findByPhone).toHaveBeenCalledWith(owner.branchId, normalizedPhone);
    });

    it("allows an update target to retain its own canonical phone", async () => {
        const repository = new FakeTaskRepository();
        const targetClient = makeClientRecord();
        targetClient.phone = "0212345678";
        const targetRef = randomUUID();
        const client = {
            findByPhone: jest.fn().mockResolvedValue(targetClient),
            findById: jest.fn().mockResolvedValue(targetClient),
        };
        const task = makeTask({
            capabilityId: "clients.update",
            targetRef,
            targetVersion: clientAgentTargetVersion(targetClient),
            draft: {
                ...createEmptyAgentTaskDraft(randomUUID()),
                server: { references: { target: { targetRef, clientId: targetClient.id }, choiceTargets: [], phoneCandidates: {} } },
            },
        });
        repository.tasks.set(task.taskId, task);

        const result = await buildService(repository, client).service.patch(owner, task.taskId, {
            clientEventId: randomUUID(),
            expectedRevision: task.revision,
            operations: [{ op: "set", field: "phone", value: "02-1234-5678" }],
        });

        expect(result.snapshot.issues).not.toEqual(expect.arrayContaining([
            expect.objectContaining({ field: "phone", code: "task.duplicate" }),
        ]));
        expect(client.findByPhone).toHaveBeenCalledWith(owner.branchId, "0212345678");
    });

    it("records a bounded invalid issue for an update phone rejected by the provider validator", async () => {
        const repository = new FakeTaskRepository();
        const targetClient = makeClientRecord();
        const targetRef = randomUUID();
        const client = {
            findByPhone: jest.fn().mockResolvedValue(null),
            findById: jest.fn().mockResolvedValue(targetClient),
        };
        const task = makeTask({
            capabilityId: "clients.update",
            targetRef,
            targetVersion: clientAgentTargetVersion(targetClient),
            draft: {
                ...createEmptyAgentTaskDraft(randomUUID()),
                server: { references: { target: { targetRef, clientId: targetClient.id }, choiceTargets: [], phoneCandidates: {} } },
            },
        });
        repository.tasks.set(task.taskId, task);

        const result = await buildService(repository, client).service.patch(owner, task.taskId, {
            clientEventId: randomUUID(),
            expectedRevision: task.revision,
            operations: [{ op: "set", field: "phone", value: "12345" }],
        });

        expect(result.snapshot.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({ field: "phone", code: "task.invalid" }),
        ]));
        expect(client.findByPhone).not.toHaveBeenCalled();
    });

    it("persists an explicit clear, treats a repeated clear as a no-op, and replays it after a later edit", async () => {
        const repository = new FakeTaskRepository();
        const service = buildService(repository).service;
        const created = await service.create(owner, createInput());
        const clearEvent = randomUUID();
        const cleared = await service.patch(owner, created.snapshot.taskId, {
            clientEventId: clearEvent,
            expectedRevision: created.snapshot.revision,
            operations: [{ op: "clear", field: "address" }],
        });
        const afterClear = repository.tasks.get(created.snapshot.taskId)!;
        const expiryAfterClear = afterClear.expiresAt;
        const repeated = await service.patch(owner, created.snapshot.taskId, {
            clientEventId: randomUUID(),
            expectedRevision: cleared.snapshot.revision,
            operations: [{ op: "clear", field: "address" }],
        });
        const afterNoop = repository.tasks.get(created.snapshot.taskId)!;
        expect(afterNoop.revision).toBe(cleared.snapshot.revision);
        expect(afterNoop.expiresAt).toEqual(expiryAfterClear);
        expect(repeated.receipt.acceptedRevision).toBe(cleared.snapshot.revision);

        const later = await service.patch(owner, created.snapshot.taskId, {
            clientEventId: randomUUID(),
            expectedRevision: cleared.snapshot.revision,
            operations: [{ op: "set", field: "address", value: "서울" }],
        });
        const replay = await buildService(repository).service.patch(owner, created.snapshot.taskId, {
            clientEventId: repeated.receipt.eventId,
            expectedRevision: cleared.snapshot.revision,
            operations: [{ op: "clear", field: "address" }],
        });
        expect(later.snapshot.confirmed.address).toBe("서울");
        expect(replay.snapshot.confirmed.address).toBe("서울");
        expect(replay.snapshot.revision).toBe(later.snapshot.revision);
        expect(replay.receipt.acceptedRevision).toBe(cleared.snapshot.revision);
    });

    it("keeps an unlinked review-ready task unchanged for a same-value set", async () => {
        const repository = new FakeTaskRepository();
        const service = buildService(repository).service;
        const created = await service.create(owner, createInput());
        const task = repository.tasks.get(created.snapshot.taskId)!;
        task.status = "review_ready";
        task.draft.server.actionExpectedRevision = "review-only-v1";
        task.draft.server.actionProposalRevision = 4;
        const before = {
            revision: task.revision,
            status: task.status,
            snapshotRef: task.draft.currentSnapshotRef,
            expiresAt: task.expiresAt,
            actionExpectedRevision: task.draft.server.actionExpectedRevision,
            actionProposalRevision: task.draft.server.actionProposalRevision,
        };

        const result = await service.patch(owner, task.taskId, {
            clientEventId: randomUUID(),
            expectedRevision: task.revision,
            operations: [{ op: "set", field: "name", value: "홍길동" }],
        });

        expect(result.snapshot.revision).toBe(before.revision);
        expect(result.snapshot.state).toBe(before.status);
        expect(result.snapshot.currentSnapshotRef).toBe(before.snapshotRef);
        expect(repository.tasks.get(task.taskId)!.expiresAt).toEqual(before.expiresAt);
        expect(repository.tasks.get(task.taskId)!.draft.server).toMatchObject({
            actionExpectedRevision: before.actionExpectedRevision,
            actionProposalRevision: before.actionProposalRevision,
        });
    });

    it("keeps review-ready discard and repeated-clear no-ops at the current revision", async () => {
        const operations = [
            { op: "discard-change", field: "address" },
            { op: "clear", field: "address" },
        ] as const;
        for (const operation of operations) {
            const repository = new FakeTaskRepository();
            const service = buildService(repository).service;
            const created = await service.create(owner, createInput());
            const task = repository.tasks.get(created.snapshot.taskId)!;
            task.status = "review_ready";
            task.draft.server.actionExpectedRevision = "review-only-v1";
            task.draft.server.actionProposalRevision = 4;
            if (operation.op === "clear") task.draft.clearedFields = ["address"];
            const beforeRevision = task.revision;
            const beforeSnapshotRef = task.draft.currentSnapshotRef;
            const beforeExpiry = task.expiresAt;

            const result = await service.patch(owner, task.taskId, {
                clientEventId: randomUUID(),
                expectedRevision: task.revision,
                operations: [operation],
            });

            expect(result.snapshot.revision).toBe(beforeRevision);
            expect(result.snapshot.state).toBe("review_ready");
            expect(result.snapshot.currentSnapshotRef).toBe(beforeSnapshotRef);
            expect(repository.tasks.get(task.taskId)!.expiresAt).toEqual(beforeExpiry);
            expect(repository.tasks.get(task.taskId)!.draft.server).toMatchObject({
                actionExpectedRevision: "review-only-v1",
                actionProposalRevision: 4,
            });
        }
    });

    it("records a same-value authoritative user confirmation as a semantic edit", async () => {
        const repository = new FakeTaskRepository();
        const service = buildService(repository).service;
        const created = await service.create(owner, createInput());
        const task = repository.tasks.get(created.snapshot.taskId)!;
        task.draft.provenance.confirmed["name"] = {
            source: "model",
            capturedAt: "2026-01-01T00:00:00.000Z",
            eventId: randomUUID(),
            valueRef: randomUUID(),
        };
        task.expiresAt = new Date(Date.now() + 60 * 60 * 1000);
        const beforeExpiry = task.expiresAt;

        const result = await service.patch(owner, task.taskId, {
            clientEventId: randomUUID(),
            expectedRevision: task.revision,
            operations: [{ op: "set", field: "name", value: "홍길동" }],
        });

        expect(result.snapshot.revision).toBe(created.snapshot.revision + 1);
        expect(result.snapshot.provenance.confirmed["name"]?.source).toBe("user");
        expect(repository.tasks.get(task.taskId)!.expiresAt.getTime()).toBeGreaterThan(beforeExpiry.getTime());
    });

    it("treats another same-value user confirmation as a semantic no-op", async () => {
        const repository = new FakeTaskRepository();
        const service = buildService(repository).service;
        const created = await service.create(owner, createInput());
        const task = repository.tasks.get(created.snapshot.taskId)!;
        const beforeExpiry = task.expiresAt;
        const beforeProvenance = { ...task.draft.provenance.confirmed["name"] };

        const result = await service.patch(owner, task.taskId, {
            clientEventId: randomUUID(),
            expectedRevision: task.revision,
            operations: [{ op: "set", field: "name", value: "홍길동" }],
        });

        expect(result.snapshot.revision).toBe(created.snapshot.revision);
        expect(repository.tasks.get(task.taskId)!.expiresAt).toEqual(beforeExpiry);
        expect(repository.tasks.get(task.taskId)!.draft.provenance.confirmed["name"]).toEqual(beforeProvenance);
    });

    it("discards only a proposed field and removes stale phone choices and readiness facts", async () => {
        const repository = new FakeTaskRepository();
        const phoneChoiceSetRef = randomUUID();
        const optionRef = randomUUID();
        const unrelatedChoiceSetRef = randomUUID();
        const unrelatedOptionRef = randomUUID();
        const task = makeTask({ draft: {
            ...createEmptyAgentTaskDraft(randomUUID()),
            confirmed: { name: "홍길동", phone: "01012345678" },
            issues: [{ code: "task.duplicate", field: "phone", severity: "error", message: "Additional task information is required" }],
            choiceSets: [
                { choiceSetRef: phoneChoiceSetRef, options: [{ optionId: optionRef, label: "01012345678" }] },
                { choiceSetRef: unrelatedChoiceSetRef, options: [{ optionId: unrelatedOptionRef, label: "다른 선택" }] },
            ],
            orderedChoiceRefs: [phoneChoiceSetRef, unrelatedChoiceSetRef],
            server: {
                references: {
                    target: null,
                    choiceTargets: [
                        { choiceSetRef: phoneChoiceSetRef, optionId: optionRef, clientId: 1 },
                        { choiceSetRef: unrelatedChoiceSetRef, optionId: unrelatedOptionRef, clientId: 2 },
                    ],
                    phoneCandidates: { [phoneChoiceSetRef]: [{ candidateRef: randomUUID(), normalizedPhone: "01012345678" }] },
                },
            },
        }, });
        repository.tasks.set(task.taskId, task);
        const service = buildService(repository).service;

        const result = await service.patch(owner, task.taskId, {
            clientEventId: randomUUID(),
            expectedRevision: task.revision,
            operations: [{ op: "discard-change", field: "phone" }],
        });

        expect(result.snapshot.confirmed.phone).toBeUndefined();
        expect(result.snapshot.choiceSets.map((choiceSet) => choiceSet.choiceSetRef)).toEqual([unrelatedChoiceSetRef]);
        expect(result.snapshot.orderedChoiceRefs).toEqual([unrelatedChoiceSetRef]);
        expect(result.snapshot.issues.filter((issue) => issue.code === "task.duplicate")).toEqual([]);
        expect(repository.tasks.get(task.taskId)?.draft.server.references.phoneCandidates).toEqual({});
    });

    it("preserves a resolved update target while discarding proposed identifiers", async () => {
        const repository = new FakeTaskRepository();
        const targetRef = randomUUID();
        const targetClient = makeClientRecord();
        const client = { findByPhone: jest.fn().mockResolvedValue(null), findById: jest.fn().mockResolvedValue(targetClient) };
        const task = makeTask({
            capabilityId: "clients.update",
            targetRef,
            targetVersion: clientAgentTargetVersion(targetClient),
            draft: {
                ...createEmptyAgentTaskDraft(randomUUID()),
                confirmed: { name: "제안 이름", phone: "01012345678" },
                server: { references: { target: { targetRef, clientId: 7 }, choiceTargets: [], phoneCandidates: {} } },
            },
        });
        repository.tasks.set(task.taskId, task);
        const service = buildService(repository, client).service;

        const result = await service.patch(owner, task.taskId, {
            clientEventId: randomUUID(),
            expectedRevision: task.revision,
            operations: [
                { op: "discard-change", field: "name" },
                { op: "discard-change", field: "phone" },
            ],
        });

        expect(result.snapshot.confirmed).toEqual({});
        expect(result.snapshot.target).toEqual({ targetRef, version: clientAgentTargetVersion(targetClient) });
        expect(client.findById).toHaveBeenCalledWith(owner.branchId, 7);
    });

    it("treats repeated discard as a durable no-op with unchanged retention", async () => {
        const repository = new FakeTaskRepository();
        const task = makeTask({ draft: { ...createEmptyAgentTaskDraft(randomUUID()), confirmed: { startDate: "2026-03-01" } } });
        repository.tasks.set(task.taskId, task);
        const service = buildService(repository).service;
        const first = await service.patch(owner, task.taskId, {
            clientEventId: randomUUID(),
            expectedRevision: task.revision,
            operations: [{ op: "discard-change", field: "startDate" }],
        });
        const afterFirst = repository.tasks.get(task.taskId)!;
        const expiry = afterFirst.expiresAt;
        const second = await service.patch(owner, task.taskId, {
            clientEventId: randomUUID(),
            expectedRevision: first.snapshot.revision,
            operations: [{ op: "discard-change", field: "startDate" }],
        });
        const afterSecond = repository.tasks.get(task.taskId)!;

        expect(second.receipt.acceptedRevision).toBe(first.snapshot.revision);
        expect(afterSecond.revision).toBe(first.snapshot.revision);
        expect(afterSecond.expiresAt).toEqual(expiry);
    });

    it("refuses unbound automation yes without mutating the draft", async () => {
        const repository = new FakeTaskRepository();
        const service = buildService(repository).service;
        const created = await service.create(owner, createInput());
        const before = JSON.stringify(repository.tasks.get(created.snapshot.taskId));

        await expect(service.patch(owner, created.snapshot.taskId, {
            clientEventId: randomUUID(),
            expectedRevision: created.snapshot.revision,
            operations: [{ op: "set", field: "automationChoice", value: "yes" }],
        })).rejects.toMatchObject({ response: expect.objectContaining({ code: "AGENT_TASK_CONFLICT", reason: "consent_required" }) });
        expect(JSON.stringify(repository.tasks.get(created.snapshot.taskId))).toBe(before);
    });

    it("evaluates ordered consent against the final choice", async () => {
        const repository = new FakeTaskRepository();
        const service = buildService(repository).service;
        const created = await service.create(owner, createInput());

        const noConsent = await service.patch(owner, created.snapshot.taskId, {
            clientEventId: randomUUID(),
            expectedRevision: created.snapshot.revision,
            operations: [
                { op: "set", field: "automationChoice", value: "yes" },
                { op: "set", field: "automationChoice", value: "no" },
            ],
        });
        expect(noConsent.snapshot.consent.choice).toBe("no");

        const before = JSON.stringify(repository.tasks.get(created.snapshot.taskId));
        const beforeEvents = repository.events.size;
        await expect(service.patch(owner, created.snapshot.taskId, {
            clientEventId: randomUUID(),
            expectedRevision: noConsent.snapshot.revision,
            operations: [{ op: "set", field: "automationChoice", value: "yes" }],
        })).rejects.toMatchObject({ response: expect.objectContaining({ code: "AGENT_TASK_CONFLICT", reason: "consent_required" }) });
        expect(JSON.stringify(repository.tasks.get(created.snapshot.taskId))).toBe(before);
        expect(repository.events.size).toBe(beforeEvents);

        const unanswered = await service.patch(owner, created.snapshot.taskId, {
            clientEventId: randomUUID(),
            expectedRevision: noConsent.snapshot.revision,
            operations: [
                { op: "set", field: "automationChoice", value: "yes" },
                { op: "clear", field: "automationChoice" },
            ],
        });
        expect(unanswered.snapshot.consent.choice).toBe("unanswered");
    });

    it.each([
        [[{ op: "clear", field: "automationChoice" }, { op: "set", field: "automationChoice", value: "yes" }]],
        [[{ op: "set", field: "automationChoice", value: "no" }, { op: "set", field: "automationChoice", value: "yes" }]],
    ] as const)("refuses yes after an intermediate consent revocation", async (operations) => {
        const repository = new FakeTaskRepository();
        const service = buildService(repository).service;
        const created = await service.create(owner, createInput());
        const task = repository.tasks.get(created.snapshot.taskId)!;
        task.draft.consent = { choice: "yes", binding: makeConsentBinding() };
        const before = JSON.stringify(task);
        const beforeEvents = repository.events.size;

        await expect(service.patch(owner, task.taskId, {
            clientEventId: randomUUID(),
            expectedRevision: task.revision,
            operations,
        })).rejects.toMatchObject({ response: expect.objectContaining({ code: "AGENT_TASK_CONFLICT", reason: "consent_required" }) });

        expect(JSON.stringify(repository.tasks.get(task.taskId))).toBe(before);
        expect(repository.events.size).toBe(beforeEvents);
    });

    it("accepts a final revoked consent choice and preserves a continuously yes binding", async () => {
        for (const operation of [
            { op: "clear", field: "automationChoice" },
            { op: "set", field: "automationChoice", value: "no" },
        ] as const) {
            const repository = new FakeTaskRepository();
            const service = buildService(repository).service;
            const created = await service.create(owner, createInput());
            const task = repository.tasks.get(created.snapshot.taskId)!;
            task.draft.consent = { choice: "yes", binding: makeConsentBinding() };

            const result = await service.patch(owner, task.taskId, {
                clientEventId: randomUUID(),
                expectedRevision: task.revision,
                operations: [operation],
            });

            expect(result.snapshot.consent.choice).toBe(operation.op === "clear" ? "unanswered" : "no");
            expect(result.snapshot.consent.binding).toBeNull();
        }

        const repository = new FakeTaskRepository();
        const service = buildService(repository).service;
        const created = await service.create(owner, createInput());
        const task = repository.tasks.get(created.snapshot.taskId)!;
        const binding = makeConsentBinding();
        task.draft.consent = { choice: "yes", binding };

        const result = await service.patch(owner, task.taskId, {
            clientEventId: randomUUID(),
            expectedRevision: task.revision,
            operations: [
                { op: "set", field: "automationChoice", value: "yes" },
                { op: "set", field: "address", value: "서울" },
            ],
        });

        expect(result.snapshot.consent.choice).toBe("yes");
        expect(result.snapshot.consent.binding).toEqual(binding);
        expect(result.snapshot.confirmed.address).toBe("서울");
    });

    it("allows replay of an owned expired task within the replay window but rejects a fresh event", async () => {
        const repository = new FakeTaskRepository();
        const service = buildService(repository).service;
        const created = await service.create(owner, createInput());
        const acceptedPatch = await service.patch(owner, created.snapshot.taskId, {
            clientEventId: randomUUID(),
            expectedRevision: created.snapshot.revision,
            operations: [{ op: "set", field: "name", value: "수정" }],
        });
        const task = repository.tasks.get(created.snapshot.taskId)!;
        task.expiresAt = new Date(Date.now() - 1_000);

        await expect(buildService(repository).service.patch(owner, task.taskId, {
            clientEventId: acceptedPatch.receipt.eventId,
            expectedRevision: created.snapshot.revision,
            operations: [{ op: "set", field: "name", value: "수정" }],
        })).resolves.toMatchObject({ receipt: acceptedPatch.receipt, snapshot: { taskId: task.taskId } });
        await expect(buildService(repository).service.patch(owner, task.taskId, {
            clientEventId: randomUUID(),
            expectedRevision: task.revision,
            operations: [{ op: "set", field: "name", value: "새 이름" }],
        })).rejects.toMatchObject({ status: 410 });
    });

    it("restores only live active and paused tasks with explicit session status", async () => {
        const repository = new FakeTaskRepository();
        const service = buildService(repository).service;
        const active = makeTask({ status: "collecting", activeSlot: 1 });
        const paused = makeTask({ status: "paused", activeSlot: 1 });
        const terminal = makeTask({ status: "completed", activeSlot: null });
        const expired = makeTask({ status: "collecting", activeSlot: 1, expiresAt: new Date(Date.now() - 1_000) });
        repository.tasks.set(active.taskId, active);
        repository.tasks.set(paused.taskId, paused);
        repository.tasks.set(terminal.taskId, terminal);
        repository.tasks.set(expired.taskId, expired);

        await expect(service.restoreSession(owner, sessionId)).resolves.toEqual({
            activeTaskId: active.taskId,
            pausedTaskIds: [paused.taskId],
            taskRestoreStatus: "available",
        });
        repository.session.archivedAt = new Date();
        await expect(service.restoreSession(owner, sessionId)).resolves.toEqual({ activeTaskId: null, pausedTaskIds: [], taskRestoreStatus: "session_archived" });
    });

    it.each([
        "paused", "awaiting_approval", "executing", "reconciling", "completed", "failed", "cancelled",
    ] as const)("refuses edits in %s without mutation", async (status) => {
        const repository = new FakeTaskRepository();
        const task = makeTask({ status, activeSlot: status === "paused" ? 1 : null });
        repository.tasks.set(task.taskId, task);
        const service = buildService(repository).service;
        const before = JSON.stringify(task);

        await expect(service.patch(owner, task.taskId, {
            clientEventId: randomUUID(),
            expectedRevision: task.revision,
            operations: [{ op: "set", field: "name", value: "blocked" }],
        })).rejects.toMatchObject({ response: expect.objectContaining({ code: "AGENT_TASK_CONFLICT", reason: "state" }) });
        expect(JSON.stringify(repository.tasks.get(task.taskId))).toBe(before);
    });

    it.each(["collecting", "confirming_target"] as const)("accepts bounded edits in %s", async (status) => {
        const repository = new FakeTaskRepository();
        const task = makeTask({ status, activeSlot: 1 });
        repository.tasks.set(task.taskId, task);
        const result = await buildService(repository).service.patch(owner, task.taskId, {
            clientEventId: randomUUID(),
            expectedRevision: task.revision,
            operations: [{ op: "set", field: "name", value: "accepted" }],
        });

        expect(result.snapshot.state).toBe(status);
        expect(result.snapshot.confirmed.name).toBe("accepted");
    });

    it("demotes review_ready after an edit based on an authoritative target lookup", async () => {
        const repository = new FakeTaskRepository();
        const client = { findByPhone: jest.fn().mockResolvedValue(null), findById: jest.fn().mockResolvedValue({ id: 7 }) };
        const task = makeTask({ status: "review_ready", activeSlot: 1, capabilityId: "clients.update", draft: {
            ...createEmptyAgentTaskDraft(randomUUID()),
            server: { references: { target: { targetRef: randomUUID(), clientId: 7 }, choiceTargets: [], phoneCandidates: {} } },
        } });
        task.draft.server.actionExpectedRevision = "review-only-v1";
        task.draft.server.actionProposalRevision = 4;
        repository.tasks.set(task.taskId, task);
        const service = buildService(repository, client).service;

        const result = await service.patch(owner, task.taskId, {
            clientEventId: randomUUID(),
            expectedRevision: 1,
            operations: [{ op: "set", field: "name", value: "수정" }],
        });
        expect(result.snapshot.state).toBe("confirming_target");
        expect(client.findById).toHaveBeenCalledWith(owner.branchId, 7);
        expect(repository.tasks.get(task.taskId)!.draft.server.actionExpectedRevision).toBeUndefined();
        expect(repository.tasks.get(task.taskId)!.draft.server.actionProposalRevision).toBeUndefined();
    });

    it("maps storage failure and foreign ownership to bounded errors", async () => {
        const repository = new FakeTaskRepository();
        const service = buildService(repository).service;
        await expect(service.get(owner, randomUUID())).rejects.toMatchObject({ status: 404 });
        repository.listOwned = jest.fn().mockResolvedValue({ status: "storage_failure" });
        await expect(service.restoreSession(owner, sessionId)).rejects.toMatchObject({ status: 503 });
    });
});

describe("AgentTaskConflictException", () => {
    it("has a bounded task-local response body", () => {
        const exception = new AgentTaskConflictException("revision");
        expect(exception.getResponse()).toEqual({ code: "AGENT_TASK_CONFLICT", message: "Task input conflict", reason: "revision" });
    });
});
