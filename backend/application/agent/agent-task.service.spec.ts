import { randomUUID } from "node:crypto";

import { AgentTaskConflictException, AgentTaskService } from "./agent-task.service";
import { clientAgentTargetVersion } from "../../application/usecases/client/client-agent-target";
import { createEmptyAgentTaskDraft, type AgentTaskEntity, type AgentTaskEventEntity } from "domain/entities/agent-task.entity";
import type { ClientEntity } from "domain/entities/client.entity";
import { agentBindingHash } from "domain/repositories/agent-linked-action.types";
import type { AgentAutomationEffect } from "domain/entities/agent-automation-consent";
import type { AgentTaskAutomationPort } from "./agent-task-automation.service";
import { createAgentAutomationQuestion } from "./agent-automation-question";

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
    readonly createInputs: any[] = [];
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

    async findOwnedRecovery(taskId: string, scopedOwner: { userId: string; branchId: string }) {
        const task = this.tasks.get(taskId);
        return task && task.userId === scopedOwner.userId && task.branchId === scopedOwner.branchId && task.activeActionId
            ? { status: "found", task } as const
            : { status: "not_found" } as const;
    }

    async listOwnedRecovery(scope: { userId: string; branchId: string; sessionId: string }) {
        return {
            status: "found",
            taskIds: [...this.tasks.values()]
                .filter((task) => this.scoped(task, scope) && task.activeActionId)
                .map((task) => task.taskId)
                .sort(),
        } as const;
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
            const retained = await transaction.ensureSessionRetention(eventInput.expiresAt ?? input.expiresAt);
            if (retained.status === "storage_failure") return { status: "storage_failure" };
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
                this.createInputs.push(input);
                const task = makeTask({
                    taskId: input.taskId,
                    sessionId: scope.sessionId,
                    userId: scope.userId,
                    branchId: scope.branchId,
                    capabilityId: input.capabilityId,
                    draft: input.draft,
                    revision: input.revision ?? 1,
                    status: input.status ?? "collecting",
                    activeSlot: input.status === "collecting" || input.status === "confirming_target" || input.status === "review_ready" ? 1 : null,
                    lastAcceptedAt: input.lastAcceptedAt ?? new Date(),
                    expiresAt: input.expiresAt,
                    targetRef: input.targetRef ?? null,
                    targetVersion: input.targetVersion ?? null,
                    activeActionId: input.activeActionId ?? null,
                    terminalAt: input.terminalAt ?? null,
                    purgedAt: input.purgedAt ?? null,
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
                    activeSlot: input.status === "collecting" || input.status === "confirming_target" || input.status === "review_ready"
                        ? 1
                        : input.status === undefined && lockedTask.activeSlot === 1 ? 1 : null,
                    lastAcceptedAt: input.preserveLastAcceptedAt
                        ? lockedTask.lastAcceptedAt
                        : input.acceptedAt ?? lockedTask.lastAcceptedAt,
                    expiresAt: input.expiresAt ?? lockedTask.expiresAt,
                    updatedAt: input.acceptedAt ?? lockedTask.updatedAt,
                    targetRef: input.targetRef === undefined ? lockedTask.targetRef : input.targetRef,
                    targetVersion: input.targetVersion === undefined ? lockedTask.targetVersion : input.targetVersion,
                    activeActionId: input.activeActionId === undefined ? lockedTask.activeActionId : input.activeActionId,
                    terminalAt: input.terminalAt === undefined ? lockedTask.terminalAt : input.terminalAt,
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
            ensureSessionRetention: async (minExpiry: Date) => {
                if (minExpiry <= this.session.expiresAt) return { status: "unchanged", expiresAt: this.session.expiresAt } as const;
                this.session.expiresAt = minExpiry;
                return { status: "extended", expiresAt: minExpiry } as const;
            },
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
        assertCanPrepareReview: jest.fn().mockResolvedValue(capability),
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

function commandInput(command: string, expectedRevision: number, clientEventId = randomUUID(), extra: Record<string, unknown> = {}) {
    return { command, expectedRevision, clientEventId, ...extra };
}

function automationService(repository: FakeTaskRepository) {
    const { policy, client } = buildService(repository);
    const automation: AgentTaskAutomationPort = { evaluate: jest.fn(async (task) => {
        const effects: AgentAutomationEffect[] = [{ kind: "client-rule", ruleId: "rule-a", scheduleId: null,
            recipientType: "client", templateKey: "SERVICE_INFO", change: "create",
            recipientDigest: agentBindingHash(task.draft.confirmed.phone), sourceDigest: agentBindingHash(task.draft.confirmed.name),
            templateDigest: "c".repeat(64), policyDigest: "d".repeat(64), recipeDigest: "e".repeat(64) }];
        return { version: 1 as const, noSendAtPresentation: task.draft.constraints.noSend, effects,
            question: createAgentAutomationQuestion({ effects, availability: "available", previous: task.draft.server.automation?.question }) };
    }) };
    return { service: new AgentTaskService(repository as never, policy as never, client as never, undefined, automation), automation };
}

describe("task automation answers", () => {
    it("binds explicit yes to the full displayed question, preserves unrelated corrections and resets changed effects", async () => {
        const repository = new FakeTaskRepository();
        const { service } = automationService(repository);
        const created = await service.create(owner, createInput());
        expect(created.snapshot.automation?.availability).toBe("available");
        const eventId = randomUUID();
        const answer = await service.patch(owner, created.snapshot.taskId, { clientEventId: eventId,
            expectedRevision: created.snapshot.revision, operations: [{ op: "set", field: "automationChoice", value: "yes" }] });
        expect(answer.snapshot.consent.binding).toMatchObject({ consentEventId: eventId,
            effectDigest: created.snapshot.automation!.effectDigest, recipientRef: created.snapshot.automation!.recipientSetRef });
        const unchanged = await service.patch(owner, answer.snapshot.taskId, { clientEventId: randomUUID(),
            expectedRevision: answer.snapshot.revision, operations: [{ op: "set", field: "address", value: "합성 주소" }] });
        expect(unchanged.snapshot.consent).toEqual(answer.snapshot.consent);
        const changed = await service.patch(owner, answer.snapshot.taskId, { clientEventId: randomUUID(),
            expectedRevision: unchanged.snapshot.revision, operations: [{ op: "set", field: "name", value: "합성 수정" }] });
        expect(changed.snapshot.consent).toEqual({ choice: "unanswered", binding: null });
        expect(changed.snapshot.automation!.questionRef).not.toBe(created.snapshot.automation!.questionRef);
    });

    it("requires original user provenance, rejects unseen accompanying edits and ordered revocations atomically", async () => {
        const repository = new FakeTaskRepository();
        const { service } = automationService(repository);
        const created = await service.create(owner, createInput());
        const before = JSON.stringify(repository.tasks.get(created.snapshot.taskId));
        const patch = (operations: unknown[], origin: "model" | "user" = "user", origins?: ("model" | "user")[]) => service.patch(owner,
            created.snapshot.taskId, { clientEventId: randomUUID(), expectedRevision: created.snapshot.revision, operations }, origin, undefined, origins);
        const yes = { op: "set", field: "automationChoice", value: "yes" };
        for (const request of [
            () => patch([yes], "model"),
            () => patch([yes], "user", ["model"]),
            () => patch([{ op: "set", field: "name", value: "다른 이름" }, yes]),
            () => patch([{ op: "set", field: "automationChoice", value: "no" }, yes]),
            () => patch([{ op: "clear", field: "automationChoice" }, yes]),
            () => patch([{ op: "set", field: "noSend", value: false }, yes]),
        ]) {
            await expect(request()).rejects.toMatchObject({ response: expect.objectContaining({ reason: "consent_required" }) });
            expect(JSON.stringify(repository.tasks.get(created.snapshot.taskId))).toBe(before);
        }
        expect(repository.events.size).toBe(1);
        await expect(patch([yes], "model", ["user"])).resolves.toMatchObject({ snapshot: { consent: { choice: "yes" } } });
    });

    it("never restores an old yes after noSend is removed or briefly enabled", async () => {
        const repository = new FakeTaskRepository();
        const { service } = automationService(repository);
        let { snapshot } = await service.create(owner, createInput());
        const patch = async (operations: unknown[]) => {
            ({ snapshot } = await service.patch(owner, snapshot.taskId, { clientEventId: randomUUID(), expectedRevision: snapshot.revision, operations }));
        };
        await patch([{ op: "set", field: "automationChoice", value: "yes" }]);
        await patch([{ op: "set", field: "noSend", value: true }]);
        expect(snapshot.consent).toEqual({ choice: "no", binding: null });
        await patch([{ op: "clear", field: "noSend" }]);
        expect(snapshot.consent).toEqual({ choice: "unanswered", binding: null });
        await patch([{ op: "set", field: "automationChoice", value: "yes" }]);
        await patch([{ op: "set", field: "noSend", value: true }, { op: "clear", field: "noSend" }]);
        expect(snapshot.consent).toEqual({ choice: "unanswered", binding: null });
    });
});

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

    it("anchors the initial retention deadline to the accepted event instant", async () => {
        const repository = new FakeTaskRepository();
        const service = buildService(repository).service;
        const eventId = randomUUID();

        const created = await service.create(owner, createInput(eventId));
        const task = repository.tasks.get(created.snapshot.taskId)!;
        const event = repository.events.get(eventId)!;

        expect(repository.createInputs[0].lastAcceptedAt).toEqual(event.acceptedAt);
        expect(task.lastAcceptedAt).toEqual(event.acceptedAt);
        expect(task.expiresAt.getTime() - task.lastAcceptedAt.getTime()).toBe(30 * 24 * 60 * 60 * 1000);
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

    it("checks update phone duplicates even when the target is missing", async () => {
        const repository = new FakeTaskRepository();
        const client = {
            findByPhone: jest.fn().mockResolvedValue({ id: 7 }),
            findById: jest.fn().mockResolvedValue(null),
        };
        const task = makeTask({
            capabilityId: "clients.update",
            draft: {
                ...createEmptyAgentTaskDraft(randomUUID()),
                confirmed: { phone: "010-9876-5432" },
            },
        });
        repository.tasks.set(task.taskId, task);

        const result = await buildService(repository, client).service.patch(owner, task.taskId, {
            clientEventId: randomUUID(),
            expectedRevision: task.revision,
            operations: [{ op: "set", field: "phone", value: "010-9876-5432" }],
        });

        expect(result.snapshot.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: "task.required" }),
            expect.objectContaining({ code: "task.duplicate", field: "phone" }),
        ]));
        expect(client.findByPhone).toHaveBeenCalledWith(owner.branchId, "01098765432");
        expect(client.findById).not.toHaveBeenCalled();
    });

    it("checks update phone duplicates without excluding a stale target", async () => {
        const repository = new FakeTaskRepository();
        const targetRef = randomUUID();
        const client = {
            findByPhone: jest.fn().mockResolvedValue({ id: 7 }),
            findById: jest.fn().mockResolvedValue(null),
        };
        const task = makeTask({
            capabilityId: "clients.update",
            targetRef,
            targetVersion: "a".repeat(64),
            draft: {
                ...createEmptyAgentTaskDraft(randomUUID()),
                confirmed: { phone: "010-9876-5432" },
                server: {
                    references: {
                        target: { targetRef: randomUUID(), clientId: 7 },
                        choiceTargets: [],
                        phoneCandidates: {},
                    },
                },
            },
        });
        repository.tasks.set(task.taskId, task);

        const result = await buildService(repository, client).service.patch(owner, task.taskId, {
            clientEventId: randomUUID(),
            expectedRevision: task.revision,
            operations: [{ op: "set", field: "phone", value: "010-9876-5432" }],
        });

        expect(result.snapshot.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: "task.stale" }),
            expect.objectContaining({ code: "task.duplicate", field: "phone" }),
        ]));
        expect(client.findByPhone).toHaveBeenCalledWith(owner.branchId, "01098765432");
        expect(client.findById).not.toHaveBeenCalled();
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
            recoveryTaskIds: [],
        });
        repository.session.archivedAt = new Date();
        await expect(service.restoreSession(owner, sessionId)).resolves.toEqual({ activeTaskId: null, pausedTaskIds: [], taskRestoreStatus: "session_archived", recoveryTaskIds: [] });
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

    it("runs pause, resume and cancel as ordered lifecycle transitions", async () => {
        const repository = new FakeTaskRepository();
        const service = buildService(repository).service;
        const created = await service.create(owner, createInput());
        const paused = await service.command(owner, created.snapshot.taskId, commandInput("pause", created.snapshot.revision));
        expect(paused.snapshot.state).toBe("paused");
        expect(paused.snapshot.revision).toBe(created.snapshot.revision + 1);
        expect(repository.tasks.get(created.snapshot.taskId)!.activeSlot).toBeNull();

        const pausedExpiry = repository.tasks.get(created.snapshot.taskId)!.expiresAt;
        const pauseNoOp = await service.command(owner, created.snapshot.taskId, commandInput("pause", paused.snapshot.revision));
        expect(pauseNoOp.snapshot.revision).toBe(paused.snapshot.revision);
        expect(repository.tasks.get(created.snapshot.taskId)!.expiresAt).toEqual(pausedExpiry);

        const resumed = await service.command(owner, created.snapshot.taskId, commandInput("resume", paused.snapshot.revision));
        expect(resumed.snapshot.state).toBe("collecting");
        expect(repository.tasks.get(created.snapshot.taskId)!.activeSlot).toBe(1);

        const cancelled = await service.command(owner, created.snapshot.taskId, commandInput("cancel", resumed.snapshot.revision));
        const cancelledRow = repository.tasks.get(created.snapshot.taskId)!;
        expect(cancelled.snapshot.state).toBe("cancelled");
        expect(cancelledRow.activeSlot).toBeNull();
        expect(cancelledRow.terminalAt).toBeInstanceOf(Date);
        expect(cancelledRow.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 7 * 24 * 60 * 60 * 1000 + 1000);
        expect(repository.events.size).toBe(5);
    });

    it("replays a command receipt and canonicalizes legacy choiceSetId", async () => {
        const repository = new FakeTaskRepository();
        const service = buildService(repository).service;
        const created = await service.create(owner, createInput());
        const eventId = randomUUID();
        const first = await service.command(owner, created.snapshot.taskId, commandInput("pause", created.snapshot.revision, eventId));
        const replay = await service.command(owner, created.snapshot.taskId, commandInput("pause", created.snapshot.revision, eventId));
        expect(replay.receipt).toEqual(first.receipt);
        expect(repository.tasks.get(created.snapshot.taskId)!.revision).toBe(first.snapshot.revision);

        const choiceSetRef = randomUUID();
        const optionId = randomUUID();
        const task = makeTask({ draft: {
            ...createEmptyAgentTaskDraft(randomUUID()),
            choiceSets: [{ choiceSetRef, options: [{ optionId, label: "고객" }] }],
            orderedChoiceRefs: [choiceSetRef],
            server: { references: {
                target: null,
                choiceTargets: [{ choiceSetRef, optionId, clientId: 7 }],
                phoneCandidates: {},
            } },
        } });
        repository.tasks.set(task.taskId, task);
        const client = makeClientRecord(7);
        const withTarget = buildService(repository, { findByPhone: jest.fn().mockResolvedValue(null), findById: jest.fn().mockResolvedValue(client) }).service;
        const selectEventId = randomUUID();
        const selected = await withTarget.command(owner, task.taskId, commandInput("select-target", task.revision, selectEventId, { choiceSetId: choiceSetRef, optionId }));
        const selectedReplay = await withTarget.command(owner, task.taskId, commandInput("select-target", selected.snapshot.revision - 1, selectEventId, { choiceSetRef, optionId }));
        expect(selectedReplay.receipt).toEqual(selected.receipt);
        expect(selected.snapshot.state).toBe("collecting");
        expect(selected.snapshot.target).toEqual({ targetRef: choiceSetRef, version: clientAgentTargetVersion(client) });
    });

    it("recomputes update readiness after selecting an existing client without filling PII", async () => {
        const repository = new FakeTaskRepository();
        const choiceSetRef = randomUUID();
        const optionId = randomUUID();
        const client = makeClientRecord(7);
        client.name = "고객 원본 이름";
        client.phone = "01099998888";
        const task = makeTask({
            capabilityId: "clients.update",
            draft: {
                ...createEmptyAgentTaskDraft(randomUUID()),
                confirmed: { dueDate: "2026-03-05" },
                issues: [
                    { code: "task.required", severity: "error", message: "A customer target is required" },
                    { code: "task.stale", severity: "error", message: "The customer target is stale" },
                    { code: "task.ambiguous", field: "name", severity: "error", message: "Choose a name" },
                ],
                choiceSets: [{ choiceSetRef, options: [{ optionId, label: "고객 원본 이름" }] }],
                orderedChoiceRefs: [choiceSetRef],
                server: {
                    references: {
                        target: null,
                        choiceTargets: [{ choiceSetRef, optionId, clientId: client.id }],
                        phoneCandidates: {},
                    },
                },
            },
        });
        repository.tasks.set(task.taskId, task);
        const service = buildService(repository, {
            findByPhone: jest.fn().mockResolvedValue(null),
            findById: jest.fn().mockResolvedValue(client),
        }).service;

        const result = await service.command(owner, task.taskId, commandInput("select-target", task.revision, randomUUID(), {
            choiceSetRef,
            optionId,
        }));

        expect(result.snapshot.target).toEqual({ targetRef: choiceSetRef, version: clientAgentTargetVersion(client) });
        expect(result.snapshot.confirmed).toEqual({ dueDate: "2026-03-05" });
        expect(result.snapshot.confirmed).not.toHaveProperty("name");
        expect(result.snapshot.confirmed).not.toHaveProperty("phone");
        expect(result.snapshot.issues).not.toEqual(expect.arrayContaining([
            expect.objectContaining({ code: "task.required" }),
            expect.objectContaining({ code: "task.stale" }),
        ]));
        expect(result.snapshot.issues).toEqual(expect.arrayContaining([
            expect.objectContaining({ code: "task.ambiguous", field: "name" }),
        ]));
    });

    it("rejects forged and mixed protected choices without consuming them", async () => {
        const repository = new FakeTaskRepository();
        const choiceSetRef = randomUUID();
        const optionId = randomUUID();
        const candidateRef = randomUUID();
        const task = makeTask({ draft: {
            ...createEmptyAgentTaskDraft(randomUUID()),
            choiceSets: [{ choiceSetRef, options: [{ optionId, label: "고객" }, { optionId: candidateRef, label: "전화" }] }],
            orderedChoiceRefs: [choiceSetRef],
            server: { references: {
                target: null,
                choiceTargets: [{ choiceSetRef, optionId, clientId: 7 }],
                phoneCandidates: { [choiceSetRef]: [{ candidateRef, normalizedPhone: "01012345678" }] },
            } },
        } });
        repository.tasks.set(task.taskId, task);
        const service = buildService(repository).service;
        await expect(service.command(owner, task.taskId, commandInput("select-target", task.revision, randomUUID(), { choiceSetRef, optionId }))).rejects.toMatchObject({
            response: expect.objectContaining({ code: "AGENT_TASK_CONFLICT", reason: "state" }),
        });
        await expect(service.command(owner, task.taskId, commandInput("select-target", task.revision, randomUUID(), { choiceSetRef, optionId: randomUUID() }))).rejects.toMatchObject({
            response: expect.objectContaining({ code: "AGENT_TASK_CONFLICT", reason: "state" }),
        });
        expect(repository.tasks.get(task.taskId)!.draft.orderedChoiceRefs).toEqual([choiceSetRef]);
        expect(repository.events.size).toBe(0);
    });

    it("selects a protected phone candidate and keeps it separate from customer targeting", async () => {
        const repository = new FakeTaskRepository();
        const choiceSetRef = randomUUID();
        const candidateRef = randomUUID();
        const task = makeTask({ draft: {
            ...createEmptyAgentTaskDraft(randomUUID()),
            choiceSets: [{ choiceSetRef, options: [{ optionId: candidateRef, label: "01012345678" }] }],
            orderedChoiceRefs: [choiceSetRef],
            server: { references: {
                target: null,
                choiceTargets: [],
                phoneCandidates: { [choiceSetRef]: [{ candidateRef, normalizedPhone: "01012345678" }] },
            } },
        } });
        repository.tasks.set(task.taskId, task);
        const service = buildService(repository).service;
        const result = await service.command(owner, task.taskId, commandInput("select-target", task.revision, randomUUID(), { choiceSetRef, optionId: candidateRef }));
        expect(result.snapshot.confirmed.phone).toBe("01012345678");
        expect(result.snapshot.target).toBeNull();
        expect(result.snapshot.choiceSets).toEqual([]);
        expect(repository.tasks.get(task.taskId)!.draft.server.references.phoneCandidates).toEqual({});
    });

    it("refuses review issuance when the action preparation port is unavailable", async () => {
        const repository = new FakeTaskRepository();
        const { service, policy } = buildService(repository);
        const created = await service.create(owner, createInput());
        const before = structuredClone(repository.tasks.get(created.snapshot.taskId)!);
        await expect(service.command(owner, created.snapshot.taskId,
            commandInput("prepare-review", created.snapshot.revision))).rejects.toMatchObject({ status: 503 });
        expect(repository.tasks.get(created.snapshot.taskId)).toEqual(before);
        expect(policy.assertCanPrepareReview).toHaveBeenCalledTimes(1);
    });

    it("discovers recovery ids independently from ordinary restore selection", async () => {
        const repository = new FakeTaskRepository();
        const recovery = makeTask({ status: "executing", activeActionId: randomUUID(), expiresAt: new Date(Date.now() - 1000) });
        repository.tasks.set(recovery.taskId, recovery);
        const service = buildService(repository).service;
        await expect(service.restoreSession(owner, sessionId)).resolves.toEqual({
            activeTaskId: null,
            pausedTaskIds: [],
            taskRestoreStatus: "available",
            recoveryTaskIds: [recovery.taskId],
        });
        await expect(service.get(owner, recovery.taskId)).resolves.toMatchObject({ taskId: recovery.taskId });
    });

    it("maps storage failure and foreign ownership to bounded errors", async () => {
        const repository = new FakeTaskRepository();
        const service = buildService(repository).service;
        await expect(service.get(owner, randomUUID())).rejects.toMatchObject({ status: 404 });
        repository.listOwned = jest.fn().mockResolvedValue({ status: "storage_failure" });
        await expect(service.restoreSession(owner, sessionId)).rejects.toMatchObject({ status: 503 });
    });

    it("attaches server-derived client choices with a deterministic replay and no TTL renewal", async () => {
        const repository = new FakeTaskRepository();
        const target = makeClientRecord(7);
        const client = {
            findByPhone: jest.fn().mockResolvedValue(null),
            findById: jest.fn().mockResolvedValue(target),
        };
        const task = makeTask();
        repository.tasks.set(task.taskId, task);
        const service = buildService(repository, client).service;
        const beforeAcceptedAt = task.lastAcceptedAt;
        const beforeExpiry = task.expiresAt;
        const beforeSessionExpiry = repository.session.expiresAt;

        const first = await service.attachChoices(owner, task.taskId, {
            expectedRevision: task.revision,
            producer: "client-target",
            results: [{ label: "caller supplied label", clientId: target.id, description: "활성" }],
        });
        const firstRow = repository.tasks.get(task.taskId)!;
        expect(first.snapshot.state).toBe("confirming_target");
        expect(first.snapshot.revision).toBe(task.revision + 1);
        expect(first.snapshot.choiceSets).toHaveLength(1);
        expect(first.snapshot.choiceSets[0]?.options[0]?.label).toBe(target.name);
        expect(first.snapshot.choiceSets[0]?.options[0]?.label).not.toBe("caller supplied label");
        expect(firstRow.lastAcceptedAt).toEqual(beforeAcceptedAt);
        expect(firstRow.expiresAt).toEqual(beforeExpiry);
        expect(repository.session.expiresAt).toEqual(beforeSessionExpiry);
        expect(firstRow.draft.server.references.choiceTargets).toEqual([
            expect.objectContaining({ clientId: target.id }),
        ]);

        const replay = await service.attachChoices(owner, task.taskId, {
            expectedRevision: task.revision,
            producer: "client-target",
            results: [{ label: "different caller label", clientId: target.id, description: "활성" }],
        });
        expect(replay.receipt).toEqual(first.receipt);
        expect(replay.snapshot).toEqual(first.snapshot);
        expect(repository.tasks.get(task.taskId)!.revision).toBe(first.snapshot.revision);
        expect(repository.events.size).toBe(1);
    });

    it("replaces only the phone producer choices and preserves unrelated client choices", async () => {
        const repository = new FakeTaskRepository();
        const clientChoiceRef = randomUUID();
        const clientOptionId = randomUUID();
        const phoneChoiceRef = randomUUID();
        const phoneOptionId = randomUUID();
        const task = makeTask({ draft: {
            ...createEmptyAgentTaskDraft(randomUUID()),
            choiceSets: [
                { choiceSetRef: clientChoiceRef, options: [{ optionId: clientOptionId, label: "고객" }] },
                { choiceSetRef: phoneChoiceRef, options: [{ optionId: phoneOptionId, label: "전화 후보" }] },
            ],
            orderedChoiceRefs: [clientChoiceRef, phoneChoiceRef],
            server: { references: {
                target: null,
                choiceTargets: [{ choiceSetRef: clientChoiceRef, optionId: clientOptionId, clientId: 7 }],
                phoneCandidates: { [phoneChoiceRef]: [{ candidateRef: phoneOptionId, normalizedPhone: "01012345678" }] },
            } },
        } });
        repository.tasks.set(task.taskId, task);
        const service = buildService(repository).service;

        const result = await service.attachChoices(owner, task.taskId, {
            expectedRevision: task.revision,
            producer: "phone-candidate",
            results: [{ label: "ignored", normalizedPhone: "010-9999-8888" }],
        });
        const row = repository.tasks.get(task.taskId)!;
        const refs = result.snapshot.choiceSets.map((set) => set.choiceSetRef);
        expect(result.snapshot.state).toBe("confirming_target");
        expect(refs).toContain(clientChoiceRef);
        expect(refs).not.toContain(phoneChoiceRef);
        expect(row.draft.server.references.choiceTargets).toEqual([
            { choiceSetRef: clientChoiceRef, optionId: clientOptionId, clientId: 7 },
        ]);
        const phoneRefs = Object.keys(row.draft.server.references.phoneCandidates);
        expect(phoneRefs).toHaveLength(1);
        expect(phoneRefs[0]).not.toBe(phoneChoiceRef);
        expect(row.draft.server.references.phoneCandidates[phoneRefs[0]!]?.[0]?.normalizedPhone).toBe("01099998888");
    });

    it("records an empty derived result without attaching a choice set or extending retention", async () => {
        const repository = new FakeTaskRepository();
        const task = makeTask();
        repository.tasks.set(task.taskId, task);
        const service = buildService(repository).service;
        const before = repository.tasks.get(task.taskId)!;
        const beforeSessionExpiry = repository.session.expiresAt;
        const result = await service.attachChoices(owner, task.taskId, {
            expectedRevision: task.revision,
            producer: "client-target",
            results: [],
        });
        const after = repository.tasks.get(task.taskId)!;

        expect(result.snapshot.revision).toBe(before.revision);
        expect(result.snapshot.state).toBe(before.status);
        expect(result.snapshot.choiceSets).toEqual([]);
        expect(after.lastAcceptedAt).toEqual(before.lastAcceptedAt);
        expect(after.expiresAt).toEqual(before.expiresAt);
        expect(repository.session.expiresAt).toEqual(beforeSessionExpiry);
        expect(repository.events.size).toBe(1);
        expect(repository.events.values().next().value).toEqual(expect.objectContaining({ operation: "choices:client-target:empty" }));
    });

    it.each(["paused", "awaiting_approval", "executing", "reconciling", "completed", "failed", "cancelled"] as const)(
        "refuses derived choices for %s tasks without mutation",
        async (status) => {
            const repository = new FakeTaskRepository();
            const task = makeTask({ status, activeSlot: status === "paused" ? 1 : null });
            repository.tasks.set(task.taskId, task);
            const service = buildService(repository).service;
            const before = JSON.stringify(task);

            await expect(service.attachChoices(owner, task.taskId, {
                expectedRevision: task.revision,
                producer: "client-target",
                results: [{ label: "candidate", clientId: 7 }],
            })).rejects.toMatchObject({ response: expect.objectContaining({ code: "AGENT_TASK_CONFLICT", reason: "state" }) });
            expect(JSON.stringify(repository.tasks.get(task.taskId))).toBe(before);
            expect(repository.events.size).toBe(0);
        },
    );

    it("refuses malformed mixed producer mappings and stale revisions before attaching", async () => {
        const repository = new FakeTaskRepository();
        const choiceSetRef = randomUUID();
        const optionId = randomUUID();
        const task = makeTask({ draft: {
            ...createEmptyAgentTaskDraft(randomUUID()),
            choiceSets: [{ choiceSetRef, options: [{ optionId, label: "혼합" }] }],
            orderedChoiceRefs: [choiceSetRef],
            server: { references: {
                target: null,
                choiceTargets: [{ choiceSetRef, optionId, clientId: 7 }],
                phoneCandidates: { [choiceSetRef]: [{ candidateRef: optionId, normalizedPhone: "01012345678" }] },
            } },
        } });
        repository.tasks.set(task.taskId, task);
        const service = buildService(repository).service;

        await expect(service.attachChoices(owner, task.taskId, {
            expectedRevision: task.revision,
            producer: "client-target",
            results: [{ label: "candidate", clientId: 7 }],
        })).rejects.toMatchObject({ response: expect.objectContaining({ code: "AGENT_TASK_CONFLICT", reason: "state" }) });
        await expect(service.attachChoices(owner, task.taskId, {
            expectedRevision: task.revision - 1,
            producer: "phone-candidate",
            results: [{ label: "candidate", normalizedPhone: "01012345678" }],
        })).rejects.toMatchObject({ response: expect.objectContaining({ code: "AGENT_TASK_CONFLICT", reason: "revision" }) });
        expect(repository.events.size).toBe(0);
    });

    it("replays a derived-choice receipt after the task is paused", async () => {
        const repository = new FakeTaskRepository();
        const target = makeClientRecord(7);
        const task = makeTask();
        repository.tasks.set(task.taskId, task);
        const service = buildService(repository, {
            findByPhone: jest.fn().mockResolvedValue(null),
            findById: jest.fn().mockResolvedValue(target),
        }).service;
        const first = await service.attachChoices(owner, task.taskId, {
            expectedRevision: task.revision,
            producer: "client-target",
            results: [{ label: "first", clientId: target.id }],
        });
        repository.tasks.get(task.taskId)!.status = "paused";
        const replay = await service.attachChoices(owner, task.taskId, {
            expectedRevision: task.revision,
            producer: "client-target",
            results: [{ label: "second", clientId: target.id }],
        });

        expect(replay.receipt).toEqual(first.receipt);
        expect(replay.snapshot.state).toBe("paused");
        expect(repository.tasks.get(task.taskId)!.revision).toBe(first.snapshot.revision);
        expect(repository.events.size).toBe(1);
    });

    it("returns task gone for an identical derived-choice replay after the task expires", async () => {
        const repository = new FakeTaskRepository();
        const target = makeClientRecord(7);
        const task = makeTask();
        repository.tasks.set(task.taskId, task);
        const service = buildService(repository, {
            findByPhone: jest.fn().mockResolvedValue(null),
            findById: jest.fn().mockResolvedValue(target),
        }).service;
        const first = await service.attachChoices(owner, task.taskId, {
            expectedRevision: task.revision,
            producer: "client-target",
            results: [{ label: "first", clientId: target.id }],
        });
        repository.tasks.get(task.taskId)!.expiresAt = new Date(Date.now() - 1_000);

        await expect(service.attachChoices(owner, task.taskId, {
            expectedRevision: task.revision,
            producer: "client-target",
            results: [{ label: "first", clientId: target.id }],
        })).rejects.toMatchObject({ status: 410 });
        expect(repository.tasks.get(task.taskId)!.revision).toBe(first.snapshot.revision);
        expect(repository.events.size).toBe(1);
    });

    it("replays conversation intake through the original task after a later task becomes active", async () => {
        const repository = new FakeTaskRepository();
        const service = buildService(repository).service;
        const source = await service.create(owner, createInput());
        const intakeEventId = randomUUID();
        const intakeHash = "a".repeat(64);
        const recorded = await service.recordConversationIntake(owner, source.snapshot.taskId, intakeEventId, intakeHash);
        expect(recorded.snapshot.taskId).toBe(source.snapshot.taskId);

        const paused = await service.command(owner, source.snapshot.taskId, commandInput("pause", source.snapshot.revision, randomUUID()));
        const later = await service.create(owner, createInput(randomUUID(), [{ op: "set", field: "name", value: "later" }, { op: "set", field: "phone", value: "010-9876-5432" }]));
        expect(later.snapshot.taskId).not.toBe(source.snapshot.taskId);

        const replay = await buildService(repository).service.replayConversationIntake(owner, sessionId, intakeEventId, intakeHash);
        expect(replay?.receipt.eventId).toBe(intakeEventId);
        expect(replay?.receipt.taskId).toBe(source.snapshot.taskId);
        expect(replay?.snapshot.taskId).toBe(source.snapshot.taskId);
        expect(replay?.snapshot.state).toBe("paused");
        expect(replay?.snapshot.taskId).not.toBe(later.snapshot.taskId);
        expect(paused.snapshot.state).toBe("paused");
    });

    it("rejects changed intake payloads and returns gone for an expired original", async () => {
        const repository = new FakeTaskRepository();
        const service = buildService(repository).service;
        const source = await service.create(owner, createInput());
        const intakeEventId = randomUUID();
        const intakeHash = "b".repeat(64);
        await service.recordConversationIntake(owner, source.snapshot.taskId, intakeEventId, intakeHash);
        const row = repository.tasks.get(source.snapshot.taskId)!;
        row.expiresAt = new Date(Date.now() - 1_000);

        await expect(service.replayConversationIntake(owner, sessionId, intakeEventId, "c".repeat(64))).rejects.toMatchObject({
            response: expect.objectContaining({ code: "AGENT_TASK_CONFLICT", reason: "event_payload" }),
        });
        await expect(service.replayConversationIntake(owner, sessionId, intakeEventId, intakeHash)).rejects.toMatchObject({ status: 410 });
        expect(repository.tasks.get(source.snapshot.taskId)!.expiresAt.getTime()).toBeLessThan(Date.now());
    });

    it("returns task gone for a purged original intake and storage unavailable on lookup failure", async () => {
        const repository = new FakeTaskRepository();
        const service = buildService(repository).service;
        const source = await service.create(owner, createInput());
        const intakeEventId = randomUUID();
        const intakeHash = "d".repeat(64);
        await service.recordConversationIntake(owner, source.snapshot.taskId, intakeEventId, intakeHash);
        repository.tasks.get(source.snapshot.taskId)!.purgedAt = new Date();
        await expect(service.replayConversationIntake(owner, sessionId, intakeEventId, intakeHash)).rejects.toMatchObject({ status: 410 });

        const unavailable = new FakeTaskRepository();
        unavailable.withTransaction = jest.fn().mockResolvedValue({ status: "storage_failure" });
        await expect(buildService(unavailable).service.replayConversationIntake(owner, sessionId, randomUUID(), intakeHash)).rejects.toMatchObject({ status: 503 });
    });

    it("atomically converts a resolved create task into an update task with only explicit user facts", async () => {
        const repository = new FakeTaskRepository();
        const target = makeClientRecord(7);
        const targetRef = randomUUID();
        const targetVersion = clientAgentTargetVersion(target);
        const sourceEventId = randomUUID();
        const source = makeTask({
            capabilityId: "clients.create",
            targetRef,
            targetVersion,
            draft: {
                ...createEmptyAgentTaskDraft(randomUUID()),
                confirmed: {
                    name: "explicit user name",
                    type: "server supplied type",
                    phone: "01012345678",
                },
                tentative: {
                    address: "wizard address",
                    fullPrice: "9999",
                },
                constraints: { noSend: true },
                provenance: {
                    confirmed: {
                        name: { source: "user", capturedAt: new Date().toISOString(), eventId: sourceEventId, valueRef: randomUUID() },
                        type: { source: "server", capturedAt: new Date().toISOString(), eventId: sourceEventId, valueRef: randomUUID() },
                        phone: { source: "model", capturedAt: new Date().toISOString(), eventId: sourceEventId, valueRef: randomUUID() },
                    },
                    tentative: {
                        address: { source: "wizard", capturedAt: new Date().toISOString(), eventId: sourceEventId, valueRef: randomUUID() },
                        fullPrice: { source: "lookup", capturedAt: new Date().toISOString(), eventId: sourceEventId, valueRef: randomUUID() },
                    },
                },
                server: { references: { target: { targetRef, clientId: target.id }, choiceTargets: [], phoneCandidates: {} } },
            },
        });
        repository.tasks.set(source.taskId, source);
        const client = {
            findByPhone: jest.fn().mockResolvedValue(null),
            findById: jest.fn().mockResolvedValue(target),
        };
        const { service, policy } = buildService(repository, client);
        const beforeSessionExpiry = repository.session.expiresAt;
        const conversionInput = commandInput("start-update", source.revision, sourceEventId, {
            targetRef,
            expectedTargetVersion: targetVersion,
        });

        const converted = await service.command(owner, source.taskId, conversionInput);
        const sourceRow = repository.tasks.get(source.taskId)!;
        const newTaskId = converted.snapshot.taskId;
        const newRow = repository.tasks.get(newTaskId)!;
        const receiptEvent = repository.events.get(sourceEventId)!;

        expect(newTaskId).not.toBe(source.taskId);
        expect(sourceRow.status).toBe("paused");
        expect(sourceRow.activeSlot).toBeNull();
        expect(newRow.capabilityId).toBe("clients.update");
        expect(converted.snapshot.state).toBe("collecting");
        expect(converted.snapshot.target?.version).toBe(targetVersion);
        expect(converted.snapshot.target?.targetRef).toEqual(newRow.targetRef);
        expect(converted.snapshot.target?.targetRef).not.toBe(targetRef);
        expect(converted.snapshot.confirmed).toEqual({ name: "explicit user name" });
        expect(converted.snapshot.tentative).toEqual({ address: "wizard address" });
        expect(converted.snapshot.confirmed).not.toHaveProperty("phone");
        expect(converted.snapshot.confirmed).not.toHaveProperty("type");
        expect(converted.snapshot.tentative).not.toHaveProperty("fullPrice");
        expect(converted.snapshot.constraints.noSend).toBe(true);
        expect(converted.snapshot.consent).toEqual({ choice: "unanswered", binding: null });
        expect(converted.snapshot.provenance.confirmed["name"]?.source).toBe("user");
        expect(converted.snapshot.provenance.tentative["address"]?.source).toBe("wizard");
        expect(receiptEvent.taskId).toBe(newTaskId);
        expect(receiptEvent.operation).toBe("command:start-update");
        expect(policy.assertCanCreate).toHaveBeenCalledWith(owner, "clients.update");
        expect(repository.session.expiresAt.getTime()).toBeGreaterThanOrEqual(beforeSessionExpiry.getTime());

        // Replaying the original command remains associated with the new task
        // even after the source is resumed and revised.
        await service.command(owner, source.taskId, commandInput("resume", sourceRow.revision));
        const replay = await service.command(owner, source.taskId, conversionInput);
        expect(replay.receipt).toEqual(converted.receipt);
        expect(replay.snapshot.taskId).toBe(newTaskId);
        expect(repository.tasks.size).toBe(2);
    });
});

describe("AgentTaskConflictException", () => {
    it("has a bounded task-local response body", () => {
        const exception = new AgentTaskConflictException("revision");
        expect(exception.getResponse()).toEqual({ code: "AGENT_TASK_CONFLICT", message: "Task input conflict", reason: "revision" });
    });
});
