import { ConfigService } from "@nestjs/config";
import { PrismaClient, Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { ConversationTaskOrchestratorService } from "application/agent/conversation-task-orchestrator.service";
import { conversationMessageEventId, conversationMessageHash } from "application/agent/conversation-task-policy";
import { AgentTaskService } from "application/agent/agent-task.service";
import { AgentSessionService } from "application/agent/agent-session.service";
import { ActionCoordinatorService, AgentActionCertainFailureError, AgentActionUncertainError } from "application/agent/action-coordinator.service";
import { PrismaAgentTaskRepository } from "infrastructure/database/repositories/prisma-agent-task.repository";
import { PrismaAgentActionRepository } from "infrastructure/database/repositories/prisma-agent-action.repository";
import { PrismaAgentSessionRepository } from "infrastructure/database/repositories/prisma-agent-session.repository";
import type { VerifiedTenantPrincipal } from "infrastructure/tenant/tenant.context";
import { agentBindingHash } from "domain/repositories/agent-linked-action.types";
import { createAgentAutomationQuestion } from "application/agent/agent-automation-question";
import type { AgentTaskAutomationPort, AgentTaskAutomationSource } from "application/agent/agent-task-automation.service";
import type { AgentAutomationEffect } from "domain/entities/agent-automation-consent";
import type { CapabilityDefinition } from "application/agent/capability.types";
import { assertApprovedAgentTaskPersistenceDatabaseTarget, createApprovedAgentTaskPersistenceClient } from "./agent-task-persistence.helper";

const describeDb = process.env["AGENT_E2E"] === "1" ? describe : describe.skip;
const userId = "b6100000-0000-4000-8000-000000000001";
const branchId = "b6200000-0000-4000-8000-000000000001";
const principal: VerifiedTenantPrincipal = { userId, branchId, globalRole: "admin", branchRole: "manager" };
const owner = { userId, branchId };
const DAY = 86400000;
function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    return { promise, resolve };
}

/** Injection happens after a real DB write; rollback assertions use an independent read. */
function failAfterWrite(base: PrismaClient, delegate: string, method: string, refuse = false): PrismaClient {
    return new Proxy(base, { get(target, key, receiver) {
        if (key !== "$transaction") return Reflect.get(target, key, receiver);
        return (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => base.$transaction(async (tx) => callback(new Proxy(tx, {
            get(transaction, table, proxy) {
                const value = Reflect.get(transaction, table, proxy);
                if (table !== delegate) return value;
                return new Proxy(value, { get(model, operation) {
                    const fn = Reflect.get(model, operation);
                    if (operation !== method) return typeof fn === "function" ? fn.bind(model) : fn;
                    return async (...args: unknown[]) => {
                        await fn.apply(model, args);
                        if (refuse) return { count: 0 };
                        throw new Error("SYNTHETIC_POSTWRITE_INTERRUPTION");
                    };
                } });
            },
        })));
    } });
}

describeDb("atomic task review and execution on guarded PostgreSQL", () => {
    let db: PrismaClient;
    let tasks: PrismaAgentTaskRepository;
    let sessions: PrismaAgentSessionRepository;
    let service: AgentTaskService;
    let actions: ActionCoordinatorService;
    let sessionId: string;
    const sessionIds: string[] = [];
    const inspect = jest.fn();
    const revalidate = jest.fn();
    const execute = jest.fn();
    const reconcile = jest.fn();
    const meta = { name: "clients.create", domain: "clients", version: "phase6", description: "Synthetic review",
        risk: "reversible-write" as const, sideEffect: true, requiredRoles: ["admin"], renderer: "action-proposal" as const,
        flagKey: "agent.capability.clients.create", approvalPolicy: "structured" as "structured" | "strong", idempotencyPolicy: "action-id" as const };
    const definition = { meta, inputSchema: z.object({ name: z.string(), phone: z.string() }).passthrough(),
        outputSchema: z.object({ status: z.string(), protectedName: z.string().optional() }), inspect, revalidate,
        execute, executeApprovedTarget: execute, reconcile,
        planAutomationImpact: undefined as CapabilityDefinition["planAutomationImpact"] };
    const flags = { isCapabilityEnabled: jest.fn().mockResolvedValue(true) };
    const policy = { assertCanCreate: jest.fn().mockResolvedValue(meta), assertCanPatch: jest.fn().mockReturnValue(meta),
        assertCanPrepareReview: jest.fn().mockResolvedValue(meta) };
    const clients = { findByPhone: jest.fn().mockResolvedValue(null), findById: jest.fn().mockResolvedValue(null) };
    function coordinator(repository = tasks) {
        return new ActionCoordinatorService(db as never, { get: () => definition } as never,
            flags as never, {} as never,
            new AgentSessionService(sessions, new ConfigService(), { holdsLease: () => true } as never),
            new PrismaAgentActionRepository(db as never), { holdsLease: () => true } as never, repository);
    }
    async function create() {
        return service.create(principal, { sessionId, capabilityId: "clients.create", clientEventId: randomUUID(), operations: [
            { op: "set", field: "name", value: "SYN_PRIVATE_NAME" }, { op: "set", field: "phone", value: "01012345678" },
        ] });
    }
    async function prepared() {
        const created = await create();
        return service.command(principal, created.snapshot.taskId, { command: "prepare-review", expectedRevision: created.snapshot.revision, clientEventId: randomUUID() });
    }
    function patch(taskId: string, expectedRevision: number, value = "SYN_CORRECTED") {
        return service.patch(principal, taskId, { clientEventId: randomUUID(), expectedRevision, operations: [{ op: "set", field: "name", value }] });
    }
    async function state(taskId: string) { return db.agent_task.findUniqueOrThrow({ where: { id: taskId } }); }
    function automationFixture() {
        let policyVersion = 1;
        const evaluate = jest.fn(async (task: AgentTaskAutomationSource) => {
            const effects: AgentAutomationEffect[] = [{ kind: "client-rule", ruleId: "synthetic-rule", scheduleId: null,
                recipientType: "client", templateKey: "SERVICE_INFO", change: "create",
                recipientDigest: agentBindingHash(task.draft.confirmed.phone), sourceDigest: agentBindingHash(task.draft.confirmed.name),
                templateDigest: "c".repeat(64), policyDigest: agentBindingHash(policyVersion), recipeDigest: "e".repeat(64) }];
            return { version: 1 as const, effects, noSendAtPresentation: task.draft.constraints.noSend,
                question: createAgentAutomationQuestion({ effects, availability: "available", previous: task.draft.server.automation?.question }) };
        });
        const automation: AgentTaskAutomationPort = { evaluate };
        inspect.mockImplementation(async () => ({ title: "Synthetic customer review", summary: "Synthetic customer write" }));
        definition.planAutomationImpact = async (_context, input, taskId) => {
            const result = await tasks.findOwned(taskId, owner);
            if (result.status !== "found") throw new Error("Synthetic task missing");
            const impact = await evaluate(result.task);
            return { availability: impact.question.availability, effects: impact.effects,
                complete: true, clientIdentity: null, sourceGuard: agentBindingHash(input), affectedJobs: [] };
        };
        const instance = (repository = tasks) => new AgentTaskService(repository, policy as never, clients as never, actions, automation);
        service = instance();
        return { evaluate, instance, changePolicy: () => { policyVersion++; }, restorePolicy: () => { policyVersion = 1; } };
    }
    async function answer(taskId: string, expectedRevision: number, choice: "yes" | "no" = "yes") {
        return service.patch(principal, taskId, { clientEventId: randomUUID(), expectedRevision,
            operations: [{ op: "set", field: "automationChoice", value: choice }] });
    }
    async function automationPrepared() {
        const created = await create();
        const answered = await answer(created.snapshot.taskId, created.snapshot.revision);
        return service.command(principal, answered.snapshot.taskId,
            { command: "prepare-review", expectedRevision: answered.snapshot.revision, clientEventId: randomUUID() });
    }

    beforeAll(async () => {
        assertApprovedAgentTaskPersistenceDatabaseTarget();
        db = createApprovedAgentTaskPersistenceClient();
        await db.$connect();
        await db.agent_session.deleteMany({ where: { userId } });
        await db.user.upsert({ where: { id: userId }, update: {}, create: { id: userId, email: "phase6-action@example.invalid", role: "admin" } });
        await db.branch.upsert({ where: { id: branchId }, update: {}, create: { id: branchId, name: "phase6-target", slug: "phase6-action" } });
    });
    beforeEach(async () => {
        sessionId = randomUUID(); sessionIds.push(sessionId);
        await db.agent_session.create({ data: { id: sessionId, userId, branchId, locale: "ko", model: "synthetic", agentVersion: "phase6",
            expiresAt: new Date(Date.now() + 30 * DAY) } });
        await db.branch.update({ where: { id: branchId }, data: { name: "phase6-target" } });
        tasks = new PrismaAgentTaskRepository(db as never);
        sessions = new PrismaAgentSessionRepository(db as never);
        actions = coordinator();
        service = new AgentTaskService(tasks, policy as never, clients as never, actions);
        meta.approvalPolicy = "structured";
        definition.planAutomationImpact = undefined;
        flags.isCapabilityEnabled.mockReset().mockResolvedValue(true);
        inspect.mockReset().mockImplementation(async () => ({ targetVersion: (await db.branch.findUniqueOrThrow({ where: { id: branchId } })).name,
            targetSnapshot: { label: "SYN_PRIVATE_ADDRESS" }, title: "SYN_PRIVATE_NAME", summary: "SYN_PRIVATE_ADDRESS" }));
        revalidate.mockReset().mockResolvedValue({ valid: true, currentVersion: "phase6-target" });
        execute.mockReset().mockImplementation(async (_context, _input, version) => {
            const changed = await db.branch.updateMany({ where: { id: branchId, name: version }, data: { name: "phase6-changed" } });
            if (changed.count !== 1) throw new AgentActionCertainFailureError("Synthetic target changed");
            return { status: "saved", protectedName: "SYN_PRIVATE_NAME" };
        });
        reconcile.mockReset().mockResolvedValue({ status: "succeeded", result: { status: "saved", protectedName: "SYN_PRIVATE_NAME" } });
    });
    afterAll(async () => {
        if (!db) return;
        await db.agent_session.deleteMany({ where: { id: { in: sessionIds }, userId, branchId } });
        await db.branch.delete({ where: { id: branchId } });
        await db.user.delete({ where: { id: userId } });
        await db.$disconnect();
    });

    it("replays a real old Phase5 receipt without attaching, then attaches on a fresh event exactly once", async () => {
        const created = await create();
        const command = { command: "prepare-review" as const, expectedRevision: created.snapshot.revision, clientEventId: randomUUID() };
        const requestHash = createHash("sha256").update(JSON.stringify({ operation: "command", taskId: created.snapshot.taskId, sessionId,
            expectedRevision: command.expectedRevision, command: { command: "prepare-review" }, origin: "user" })).digest("hex");
        const old = await tasks.updateWithEvent({ sessionId, userId, branchId }, created.snapshot.taskId,
            { expectedRevision: created.snapshot.revision, status: "review_ready" },
            { clientEventId: command.clientEventId, operation: "command:prepare-review", requestHash, acceptedRevision: 2 });
        expect(old.status).toBe("updated");
        const replay = await service.command(principal, created.snapshot.taskId, command);
        expect(replay.snapshot.state).toBe("review_ready"); expect(inspect).not.toHaveBeenCalled();
        const fresh = { ...command, clientEventId: randomUUID(), expectedRevision: replay.snapshot.revision };
        const reviewed = await service.command(principal, created.snapshot.taskId, fresh);
        expect(reviewed.snapshot.state).toBe("awaiting_approval");
        const retry = await service.command(principal, created.snapshot.taskId, fresh);
        expect(retry.receipt).toEqual(reviewed.receipt);
        expect(await db.agent_action.count({ where: { sessionId } })).toBe(1);
        await expect(service.command(principal, created.snapshot.taskId, { ...fresh, expectedRevision: 99 })).rejects.toMatchObject({ status: 409 });
        expect(inspect).toHaveBeenCalledTimes(1);
    });

    it("refuses attachment when an edit commits while inspection is pending", async () => {
        const created = await create(); const entered = deferred(); const release = deferred();
        inspect.mockImplementationOnce(async () => { entered.resolve(); await release.promise; return { targetVersion: "phase6-target" }; });
        const preparation = service.command(principal, created.snapshot.taskId, { command: "prepare-review", expectedRevision: 1, clientEventId: randomUUID() });
        const assertion = expect(preparation).rejects.toMatchObject({ status: 409 });
        await entered.promise; await patch(created.snapshot.taskId, 1); release.resolve(); await assertion;
        expect(await db.agent_action.count({ where: { sessionId } })).toBe(0);
    });

    it("lets correction win during provider revalidation and refuses the stale claim", async () => {
        const review = await prepared(); const entered = deferred(); const release = deferred();
        revalidate.mockImplementationOnce(async () => { entered.resolve(); await release.promise; return { valid: true }; });
        const approval = actions.approve(review.snapshot.action!.actionId, principal, review.snapshot.action!.expectedRevision);
        const assertion = expect(approval).rejects.toMatchObject({ status: 409 });
        await entered.promise;
        const changed = await patch(review.snapshot.taskId, review.snapshot.revision);
        expect(changed.snapshot.action).toBeNull(); release.resolve(); await assertion;
        expect(execute).not.toHaveBeenCalled();
        expect((await actions.get(review.snapshot.action!.actionId, owner)).status).toBe("cancelled");
    });

    it("claims once with approval audit, refuses later edits, and keeps result transcript free of protected values", async () => {
        const review = await prepared(); const entered = deferred(); const release = deferred();
        execute.mockImplementationOnce(async () => { entered.resolve(); await release.promise; return { status: "saved", protectedName: "SYN_PRIVATE_NAME" }; });
        const approval = actions.approve(review.snapshot.action!.actionId, principal, review.snapshot.action!.expectedRevision);
        await entered.promise;
        const claimed = await actions.get(review.snapshot.action!.actionId, owner);
        expect(claimed).toMatchObject({ status: "executing", approvedBy: userId, executionAttemptCount: 1, taskRevision: review.snapshot.revision });
        expect(claimed.approvedAt).toBeInstanceOf(Date);
        const running = await state(review.snapshot.taskId);
        expect(running.status).toBe("executing");
        expect(running.lastAcceptedAt.toISOString()).toBe(review.snapshot.times.acceptedAt);
        await expect(patch(review.snapshot.taskId, running.revision)).rejects.toMatchObject({ status: 409 });
        const busyTurn = await new ConversationTaskOrchestratorService(service, policy as never).handleUserTurn({ principal, sessionId,
            message: { id: randomUUID(), role: "user", parts: [{ type: "text", text: "이름: 합성수정" }] }, capabilityId: "clients.create" });
        expect(busyTurn.mutationBlocked).toBe(true); expect(busyTurn.mutated).toBe(false);
        expect(await db.agent_task.count({ where: { sessionId } })).toBe(1);
        const duplicate = await actions.approve(claimed.id, principal, claimed.proposalRevision);
        expect(duplicate.action.status).toBe("executing");
        release.resolve(); const done = await approval;
        expect(done.action.status).toBe("succeeded"); expect(execute).toHaveBeenCalledTimes(1);
        expect(await db.agent_task_event.count({ where: { taskId: review.snapshot.taskId, operation: "action:claim" } })).toBe(1);
        const final = await state(review.snapshot.taskId);
        expect(final.status).toBe("completed"); expect(final.expiresAt.getTime() - final.terminalAt!.getTime()).toBe(7 * DAY);
        const messages = await db.agent_message.findMany({ where: { sessionId } });
        const serialized = JSON.stringify(messages);
        expect(serialized).toContain("data-action-result");
        expect(serialized).not.toContain("SYN_PRIVATE_NAME"); expect(serialized).not.toContain("SYN_PRIVATE_ADDRESS");
        await actions.approve(claimed.id, principal, claimed.proposalRevision);
        expect(await state(review.snapshot.taskId)).toEqual(final);
    });

    it("preserves a no-op review and distinguishes review rejection from task cancellation", async () => {
        const review = await prepared(); const original = await state(review.snapshot.taskId);
        const noOp = await patch(review.snapshot.taskId, review.snapshot.revision, "SYN_PRIVATE_NAME");
        expect(noOp.snapshot.action).toEqual(review.snapshot.action); expect(await state(review.snapshot.taskId)).toEqual(original);
        await actions.reject(review.snapshot.action!.actionId, principal);
        const rejected = await service.get(principal, review.snapshot.taskId);
        expect(rejected.state).toBe("review_ready"); expect(rejected.action).toBeNull(); expect(rejected.confirmed.name).toBe("SYN_PRIVATE_NAME");
        const renewed = await service.command(principal, rejected.taskId, { command: "prepare-review", expectedRevision: rejected.revision, clientEventId: randomUUID() });
        const cancelled = await service.command(principal, renewed.snapshot.taskId, { command: "cancel", expectedRevision: renewed.snapshot.revision, clientEventId: randomUUID() });
        expect(cancelled.snapshot.state).toBe("cancelled");
        expect((await actions.get(renewed.snapshot.action!.actionId, owner)).status).toBe("cancelled");
    });

    it.each([["agent_action", "updateMany"], ["agent_task", "updateMany"], ["agent_task_event", "create"]])(
        "rolls back every claim write after injected %s.%s failure", async (delegate, method) => {
            const review = await prepared(); const before = await state(review.snapshot.taskId);
            const originalAction = await actions.get(review.snapshot.action!.actionId, owner);
            const count = await db.agent_task_event.count({ where: { sessionId } });
            const faulty = coordinator(new PrismaAgentTaskRepository(failAfterWrite(db, delegate, method) as never));
            await expect(faulty.approve(originalAction.id, principal, originalAction.proposalRevision)).rejects.toMatchObject({ status: 409 });
            expect(await state(review.snapshot.taskId)).toEqual(before);
            expect(await actions.get(originalAction.id, owner)).toEqual(originalAction);
            expect(await db.agent_task_event.count({ where: { sessionId } })).toBe(count);
            expect(execute).not.toHaveBeenCalled();
        });

    it("recovers an inactive uncertain action without another effect and retains its terminal task for seven days", async () => {
        const review = await prepared();
        execute.mockImplementationOnce(async (context) => {
            await db.agent_action.update({ where: { id: context.actionId }, data: { result: { receipt: "synthetic-committed-effect" } } });
            throw new AgentActionUncertainError("Synthetic response lost after commit");
        });
        const uncertain = await actions.approve(review.snapshot.action!.actionId, principal, review.snapshot.action!.expectedRevision);
        expect(uncertain.action.status).toBe("uncertain");
        const inactiveAt = new Date(Date.now() - DAY);
        await db.agent_session.update({ where: { id: sessionId }, data: { expiresAt: inactiveAt } });
        reconcile.mockImplementationOnce(async (context) => {
            const row = await db.agent_action.findUniqueOrThrow({ where: { id: context.actionId } });
            expect(row.result).toEqual({ receipt: "synthetic-committed-effect" });
            return { status: "succeeded", result: { status: "saved" } };
        });
        await actions.reconcile(uncertain.action.id, principal);
        const terminal = await state(review.snapshot.taskId);
        expect(terminal.status).toBe("completed"); expect(execute).toHaveBeenCalledTimes(1);
        expect((await db.agent_session.findUniqueOrThrow({ where: { id: sessionId } })).expiresAt).toEqual(inactiveAt);
        await sessions.deleteExpired(new Date(terminal.expiresAt.getTime() - 1));
        expect(await db.agent_session.findUnique({ where: { id: sessionId } })).not.toBeNull();
        expect((await actions.get(uncertain.action.id, owner)).status).toBe("succeeded");
        await sessions.deleteExpired(terminal.expiresAt);
        expect(await db.agent_session.findUnique({ where: { id: sessionId } })).toBeNull();
    });

    it("applies authoritative target CAS after prevalidation and never reports stale writes as success", async () => {
        const review = await prepared();
        revalidate.mockImplementationOnce(async () => {
            await db.branch.update({ where: { id: branchId }, data: { name: "newer-target" } });
            return { valid: true, currentVersion: "phase6-target" };
        });
        await expect(actions.approve(review.snapshot.action!.actionId, principal, review.snapshot.action!.expectedRevision)).rejects.toMatchObject({ status: 409 });
        expect((await state(review.snapshot.taskId)).status).toBe("failed");
        expect((await db.branch.findUniqueOrThrow({ where: { id: branchId } })).name).toBe("newer-target");
    });

    it("refuses forged revisions, wrong owner, and missing strong acknowledgement", async () => {
        meta.approvalPolicy = "strong";
        const review = await prepared(); const action = await actions.get(review.snapshot.action!.actionId, owner);
        await expect(actions.approve(action.id, principal, "forged")).rejects.toMatchObject({ status: 409 });
        await expect(actions.approve(action.id, { ...principal, userId: randomUUID() }, action.proposalRevision)).rejects.toMatchObject({ status: 404 });
        await expect(actions.approve(action.id, principal, action.proposalRevision)).rejects.toMatchObject({ status: 409 });
        expect(execute).not.toHaveBeenCalled();
        const done = await actions.approve(action.id, principal, action.proposalRevision, actions.strongAcknowledgementToken(action));
        expect(done.action.status).toBe("succeeded");
        expect(action.inputHash).toBe(agentBindingHash(action.proposal["input"]));
    });
    it.each(["attach", "invalidate", "cancel"])("rolls back correlated %s writes and receipt on task write failure", async (operation) => {
        const initial = operation === "attach" ? await create() : await prepared();
        const before = await state(initial.snapshot.taskId);
        const beforeActions = await db.agent_action.findMany({ where: { sessionId } });
        const beforeEvents = await db.agent_task_event.findMany({ where: { sessionId } });
        const beforeSession = await db.agent_session.findUniqueOrThrow({ where: { id: sessionId } });
        const faulty = new AgentTaskService(new PrismaAgentTaskRepository(failAfterWrite(db, "agent_task", "updateMany") as never),
            policy as never, clients as never, actions);
        const request = operation === "invalidate"
            ? faulty.patch(principal, initial.snapshot.taskId, { clientEventId: randomUUID(), expectedRevision: initial.snapshot.revision,
                operations: [{ op: "set", field: "name", value: "SYN_EDIT" }] })
            : faulty.command(principal, initial.snapshot.taskId, { command: operation === "attach" ? "prepare-review" : "cancel",
                clientEventId: randomUUID(), expectedRevision: initial.snapshot.revision });
        await expect(request).rejects.toMatchObject({ status: 503 });
        expect(await state(initial.snapshot.taskId)).toEqual(before);
        expect(await db.agent_action.findMany({ where: { sessionId } })).toEqual(beforeActions);
        expect(await db.agent_task_event.findMany({ where: { sessionId } })).toEqual(beforeEvents);
        expect(await db.agent_session.findUniqueOrThrow({ where: { id: sessionId } })).toEqual(beforeSession);
    });

    it("expires an inactive review and releases its slot without reviving its draft", async () => {
        const review = await prepared();
        const inactiveAt = new Date(Date.now() - DAY);
        await db.agent_action.update({ where: { id: review.snapshot.action!.actionId }, data: { expiresAt: inactiveAt } });
        await db.agent_session.update({ where: { id: sessionId }, data: { expiresAt: inactiveAt } });
        const before = await state(review.snapshot.taskId);
        await actions.expire(review.snapshot.action!.actionId, owner);
        const after = await state(review.snapshot.taskId);
        expect(after).toMatchObject({ status: before.status, activeSlot: null, activeActionId: null,
            expiresAt: before.expiresAt, lastAcceptedAt: before.lastAcceptedAt, terminalAt: before.terminalAt, revision: before.revision + 1 });
        await expect(patch(after.id, after.revision)).rejects.toMatchObject({ status: 410 });
        await expect(service.command(principal, after.id, { command: "prepare-review", expectedRevision: after.revision, clientEventId: randomUUID() }))
            .rejects.toMatchObject({ status: 410 });
        expect((await db.agent_session.findUniqueOrThrow({ where: { id: sessionId } })).expiresAt).toEqual(inactiveAt);
    });

    it("moves a stranded inactive execution to reconciling without executing again", async () => {
        const review = await prepared(); const entered = deferred(); const release = deferred();
        execute.mockImplementationOnce(async () => { entered.resolve(); await release.promise; throw new AgentActionUncertainError("interrupted"); });
        const approval = actions.approve(review.snapshot.action!.actionId, principal, review.snapshot.action!.expectedRevision);
        await entered.promise;
        const staleAt = new Date(Date.now() - 31 * 60000);
        await db.agent_action.update({ where: { id: review.snapshot.action!.actionId }, data: { updatedAt: staleAt } });
        await db.agent_session.update({ where: { id: sessionId }, data: { expiresAt: staleAt } });
        await actions.expirePending(new Date());
        const recovering = await state(review.snapshot.taskId);
        expect(recovering.status).toBe("reconciling");
        const uncertain = await actions.approve(review.snapshot.action!.actionId, principal, review.snapshot.action!.expectedRevision);
        expect(uncertain.action.status).toBe("uncertain");
        release.resolve(); await approval;
        expect(await state(review.snapshot.taskId)).toEqual(recovering);
        expect(execute).toHaveBeenCalledTimes(1);
    });

    it("repairs historical results while preserving the current review and after payload purge", async () => {
        const original = await prepared();
        const changed = await patch(original.snapshot.taskId, original.snapshot.revision);
        const current = await service.command(principal, changed.snapshot.taskId, { command: "prepare-review",
            clientEventId: randomUUID(), expectedRevision: changed.snapshot.revision });
        const before = await state(current.snapshot.taskId);
        await actions.repairTerminalResultParts();
        expect(await state(current.snapshot.taskId)).toEqual(before);
        expect((await actions.get(original.snapshot.action!.actionId, owner)).resultPartPersistedAt).not.toBeNull();
        await service.command(principal, current.snapshot.taskId, { command: "cancel", expectedRevision: current.snapshot.revision, clientEventId: randomUUID() });
        await actions.repairTerminalResultParts();
        const cancelled = await state(current.snapshot.taskId);
        await tasks.purgeExpired(cancelled.expiresAt);
        const purged = await state(current.snapshot.taskId);
        expect(purged.purgedAt).not.toBeNull();
        await db.agent_action.update({ where: { id: original.snapshot.action!.actionId }, data: { resultPartPersistedAt: null } });
        await actions.repairTerminalResultParts();
        expect(await state(current.snapshot.taskId)).toEqual(purged);
    });

    it("rolls back a recovery task failure and refuses foreign or inconsistent reverse links", async () => {
        const review = await prepared(); const original = await actions.get(review.snapshot.action!.actionId, owner);
        const before = await state(review.snapshot.taskId);
        const scope = { ...owner, sessionId, taskId: review.snapshot.taskId, actionId: original.id };
        const faulty = new PrismaAgentTaskRepository(failAfterWrite(db, "agent_task", "updateMany") as never);
        expect((await faulty.withLinkedActionRecoveryTransaction(scope, (tx) => tx.applyOutcome({ kind: "review-rejected", transitionAt: new Date(), actorId: userId }))).status)
            .toBe("storage_failure");
        expect(await state(before.id)).toEqual(before); expect(await actions.get(original.id, owner)).toEqual(original);
        expect((await tasks.withLinkedActionRecoveryTransaction({ ...scope, branchId: randomUUID() }, async () => "should not run")).status).toBe("not_found");
        await db.agent_action.update({ where: { id: original.id }, data: { taskId: null } });
        expect((await tasks.withLinkedActionRecoveryTransaction(scope, async () => "should not run")).status).toBe("binding_mismatch");
    });

    it("reopens result repair after a stale uncertain message races with a settled result marker", async () => {
        const review = await prepared();
        await actions.approve(review.snapshot.action!.actionId, principal, review.snapshot.action!.expectedRevision);
        const before = await state(review.snapshot.taskId);
        const scope = { ...owner, sessionId, taskId: before.id, actionId: review.snapshot.action!.actionId };
        const marked = await tasks.withLinkedActionRecoveryTransaction(scope, (tx) => tx.markResultPartPersisted({ expectedStatus: "uncertain", persistedAt: new Date() }));
        expect(marked).toEqual({ status: "ok", value: false });
        expect((await actions.get(scope.actionId, owner)).resultPartPersistedAt).toBeNull();
        await actions.repairTerminalResultParts();
        expect((await actions.get(scope.actionId, owner)).resultPartPersistedAt).not.toBeNull();
        expect(await state(before.id)).toEqual(before);
    });


    it("rolls back a postwrite CAS refusal and returns a bounded service error", async () => {
        const review = await prepared();
        const before = await state(review.snapshot.taskId);
        const oldAction = await actions.get(review.snapshot.action!.actionId, owner);
        const count = await db.agent_task_event.count({ where: { sessionId } });
        const faulty = new AgentTaskService(new PrismaAgentTaskRepository(failAfterWrite(db, "agent_task", "updateMany", true) as never),
            policy as never, clients as never, actions);
        await expect(faulty.patch(principal, before.id, { clientEventId: randomUUID(), expectedRevision: before.revision,
            operations: [{ op: "set", field: "name", value: "SYN_POSTWRITE" }] })).rejects.toMatchObject({ status: 503 });
        expect(await state(before.id)).toEqual(before);
        expect(await actions.get(oldAction.id, owner)).toEqual(oldAction);
        expect(await db.agent_task_event.count({ where: { sessionId } })).toBe(count);
    });

    it("round-trips conversational preparation, correction and cancellation through committed operations", async () => {
        const created = await create();
        const orchestrator = new ConversationTaskOrchestratorService(service, policy as never);
        const message = (text: string, id = randomUUID()) => ({ id, role: "user" as const, parts: [{ type: "text", text }] });
        const oldMessage = message("검토안 준비해 줘");
        const identity = { userId, branchId, sessionId, messageId: oldMessage.id };
        await service.recordConversationIntake(principal, created.snapshot.taskId, conversationMessageEventId(identity),
            conversationMessageHash({ ...identity, text: "검토안 준비해 줘" }));
        const historical = await orchestrator.handleUserTurn({ principal, sessionId, message: oldMessage });
        expect(historical.replayed).toBe(true); expect(historical.commandAccepted).toBeUndefined();
        expect(await db.agent_action.count({ where: { sessionId } })).toBe(0);
        const reviewMessage = message("검토안 준비해주세요");
        const preparedTurn = await orchestrator.handleUserTurn({ principal, sessionId, message: reviewMessage });
        expect(preparedTurn.commandAccepted).toBe("prepare-review"); expect(preparedTurn.task!.state).toBe("awaiting_approval");
        const replay = await orchestrator.handleUserTurn({ principal, sessionId, message: reviewMessage });
        expect(replay.commandAccepted).toBe("prepare-review"); expect(replay.replayed).toBe(true);
        expect(await db.agent_action.count({ where: { sessionId } })).toBe(1); expect(execute).not.toHaveBeenCalled();
        await expect(orchestrator.handleUserTurn({ principal, sessionId, message: message("현재 작업 취소해 줘", reviewMessage.id) }))
            .rejects.toMatchObject({ status: 409 });
        const corrected = await orchestrator.handleUserTurn({ principal, sessionId, message: message("이름: 합성정정") });
        expect(corrected.task!.action).toBeNull(); expect(corrected.task!.confirmed.name).toBe("합성정정");
        expect((await actions.get(preparedTurn.task!.action!.actionId, owner)).status).toBe("cancelled");
        await orchestrator.handleUserTurn({ principal, sessionId, message: message("검토안 만들어 줘") });
        const cancelMessage = message("이 작업 취소해 주세요");
        const cancelled = await orchestrator.handleUserTurn({ principal, sessionId, message: cancelMessage });
        expect(cancelled.commandAccepted).toBe("cancel"); expect(cancelled.task!.state).toBe("cancelled");
        const cancelReplay = await orchestrator.handleUserTurn({ principal, sessionId, message: cancelMessage });
        expect(cancelReplay.commandAccepted).toBe("cancel"); expect(cancelReplay.replayed).toBe(true);
        expect(execute).not.toHaveBeenCalled();
        expect(await db.agent_task.count({ where: { sessionId } })).toBe(1);
    });

    it("persists stale-answer refusal, invalidates the old review and replays after restart without accepting accompanying edits or renewing retention", async () => {
        const automation = automationFixture();
        const review = await automationPrepared();
        const before = await state(review.snapshot.taskId);
        const sessionBefore = await db.agent_session.findUniqueOrThrow({ where: { id: sessionId } });
        automation.changePolicy();
        const request = { clientEventId: randomUUID(), expectedRevision: before.revision, operations: [
            { op: "set", field: "name", value: "SYN_MUST_NOT_ACCEPT" },
            { op: "set", field: "automationChoice", value: "yes" },
        ] };
        await expect(service.patch(principal, before.id, request)).rejects.toMatchObject({ status: 409,
            response: { reason: "consent_changed", snapshot: { revision: before.revision + 1, confirmed: { name: "SYN_PRIVATE_NAME" }, consent: { choice: "unanswered" } } } });
        const after = await state(before.id);
        expect(after).toMatchObject({ lastAcceptedAt: before.lastAcceptedAt, expiresAt: before.expiresAt, activeActionId: null, status: "collecting" });
        expect((after.draft as any).confirmed).toEqual((before.draft as any).confirmed);
        expect((after.draft as any).provenance).toEqual((before.draft as any).provenance);
        expect(await db.agent_session.findUniqueOrThrow({ where: { id: sessionId } })).toEqual(sessionBefore);
        expect((await actions.get(review.snapshot.action!.actionId, owner)).status).toBe("cancelled");
        const event = await db.agent_task_event.findFirstOrThrow({ where: { sessionId, clientEventId: request.clientEventId } });
        expect(event.operation).toBe("consent:question-refreshed");
        expect(JSON.stringify(event)).not.toMatch(/SYN_PRIVATE|01012345678|SYN_MUST_NOT_ACCEPT/);
        const count = await db.agent_task_event.count({ where: { sessionId } });
        await expect(automation.instance().patch(principal, before.id, request)).rejects.toMatchObject({ status: 409,
            response: { reason: "consent_changed", snapshot: { revision: after.revision } } });
        await expect(service.replayConversationIntake(principal, sessionId, request.clientEventId, event.requestHash))
            .rejects.toMatchObject({ response: { reason: "consent_changed" } });
        expect(await state(before.id)).toEqual(after);
        expect(await db.agent_task_event.count({ where: { sessionId } })).toBe(count);
        await expect(service.patch(principal, before.id, { ...request, expectedRevision: after.revision }))
            .rejects.toMatchObject({ response: { reason: "event_payload" } });
        await expect(actions.approve(review.snapshot.action!.actionId, principal, review.snapshot.action!.expectedRevision))
            .resolves.toMatchObject({ action: { status: "cancelled", executionAttemptCount: 0 } });
        expect(execute).not.toHaveBeenCalled();
        const accepted = await answer(before.id, after.revision);
        expect(accepted.snapshot.consent.choice).toBe("yes");
        expect(accepted.snapshot.consent.binding!.policyDigest).not.toBe(review.snapshot.consent.binding!.policyDigest);
    });

    it("refreshes a changed question before preparing any proposal, preserving draft and session deadlines", async () => {
        const automation = automationFixture();
        const created = await create();
        await expect(service.command(principal, created.snapshot.taskId, { command: "prepare-review", clientEventId: randomUUID(), expectedRevision: 1 }))
            .rejects.toMatchObject({ response: { reason: "consent_required" } });
        const before = await state(created.snapshot.taskId);
        automation.changePolicy();
        const request = { command: "prepare-review", expectedRevision: before.revision, clientEventId: randomUUID() };
        for (const instance of [service, automation.instance()]) {
            await expect(instance.command(principal, before.id, request)).rejects.toMatchObject({ response: { reason: "consent_changed" } });
        }
        expect(await state(before.id)).toMatchObject({ revision: before.revision + 1, expiresAt: before.expiresAt, lastAcceptedAt: before.lastAcceptedAt });
        expect(await db.agent_action.count({ where: { sessionId } })).toBe(0);
        expect(inspect).not.toHaveBeenCalled();
        const declined = await answer(before.id, before.revision + 1, "no");
        await expect(service.command(principal, before.id, { command: "prepare-review", expectedRevision: declined.snapshot.revision, clientEventId: randomUUID() }))
            .resolves.toMatchObject({ snapshot: { state: "awaiting_approval" } });
    });

    it.each([ ["agent_action", "updateMany"], ["agent_task", "updateMany"], ["agent_task_event", "create"] ])(
        "rolls back the complete stale-question refresh after %s.%s writes", async (delegate, method) => {
            const automation = automationFixture();
            const review = await automationPrepared();
            const before = await state(review.snapshot.taskId);
            const oldActions = await db.agent_action.findMany({ where: { sessionId } });
            const oldEvents = await db.agent_task_event.findMany({ where: { sessionId } });
            const oldSession = await db.agent_session.findUniqueOrThrow({ where: { id: sessionId } });
            automation.changePolicy();
            const faulty = automation.instance(new PrismaAgentTaskRepository(failAfterWrite(db, delegate!, method!) as never));
            await expect(faulty.patch(principal, before.id, { clientEventId: randomUUID(), expectedRevision: before.revision,
                operations: [{ op: "set", field: "automationChoice", value: "yes" }] })).rejects.toMatchObject({ status: 503 });
            expect(await state(before.id)).toEqual(before);
            expect(await db.agent_action.findMany({ where: { sessionId } })).toEqual(oldActions);
            expect(await db.agent_task_event.findMany({ where: { sessionId } })).toEqual(oldEvents);
            expect(await db.agent_session.findUniqueOrThrow({ where: { id: sessionId } })).toEqual(oldSession);
        });

    it("refuses a stale-question refresh after execution claims the task", async () => {
        const automation = automationFixture();
        const review = await automationPrepared();
        automation.changePolicy();
        const entered = deferred(); const release = deferred(); const executing = deferred(); const finish = deferred();
        const evaluate = automation.evaluate.getMockImplementation()!;
        automation.evaluate.mockImplementationOnce(async (task) => { const result = await evaluate(task); entered.resolve(); await release.promise; return result; });
        execute.mockImplementationOnce(async () => { executing.resolve(); await finish.promise; return { status: "saved" }; });
        const request = service.patch(principal, review.snapshot.taskId, { clientEventId: randomUUID(), expectedRevision: review.snapshot.revision,
            operations: [{ op: "set", field: "automationChoice", value: "yes" }] });
        const assertion = expect(request).rejects.toMatchObject({ status: 409 });
        await entered.promise;
        automation.restorePolicy();
        const approvedAction = await actions.get(review.snapshot.action!.actionId, owner);
        const approval = actions.approve(approvedAction.id, principal, approvedAction.proposalRevision,
            actions.strongAcknowledgementToken(approvedAction));
        await executing.promise;
        const claimed = await state(review.snapshot.taskId);
        release.resolve(); await assertion;
        expect(await state(claimed.id)).toEqual(claimed);
        finish.resolve(); await approval;
        expect(await db.agent_task_event.count({ where: { sessionId, operation: "consent:question-refreshed" } })).toBe(0);
    });

    it("grounds labelled original user answers and rejects model-only yes without a write", async () => {
        automationFixture();
        const created = await create();
        const orchestrator = new ConversationTaskOrchestratorService(service, policy as never);
        const original = await state(created.snapshot.taskId);
        await expect(orchestrator.applyModelMutation({ principal, sessionId, capabilityId: "clients.create", taskId: original.id,
            intakeEventId: randomUUID(), expectedRevision: original.revision, operations: [{ op: "set", field: "automationChoice", value: "yes" }] }))
            .rejects.toMatchObject({ status: 400, response: { message: "Unsupported task operation" } });
        expect(await state(original.id)).toEqual(original);
        const message = { id: randomUUID(), role: "user" as const, parts: [{ type: "text", text: "자동 문자 적용: 예" }] };
        const answered = await orchestrator.handleUserTurn({ principal, sessionId, message });
        expect(answered.task?.consent.choice).toBe("yes");
        expect((await orchestrator.handleUserTurn({ principal, sessionId, message })).replayed).toBe(true);
        expect(execute).not.toHaveBeenCalled();
        expect(await db.agent_action.count({ where: { sessionId } })).toBe(0);
    });

    it("binds positive automation to strong approval, both risk gates and the current impact before the real claim", async () => {
        const automation = automationFixture();
        const review = await automationPrepared();
        const action = await actions.get(review.snapshot.action!.actionId, owner);
        expect(action.risk).toBe("external-side-effect");
        expect(action.authorizationContext["approvalPolicy"]).toBe("strong");
        expect(action.proposal["_taskAutomation"]).toMatchObject({ taskId: review.snapshot.taskId,
            taskRevision: review.snapshot.revision, actionId: action.id, consent: { choice: "yes" } });
        const publicAction = actions.publicAction(action);
        expect(JSON.stringify(publicAction)).not.toMatch(/_taskAutomation|sourceGuard|affectedJobs|consentEventId/);
        const approve = () => actions.approve(action.id, principal, action.proposalRevision, publicAction.acknowledgementToken);
        await expect(actions.approve(action.id, principal, action.proposalRevision)).rejects.toMatchObject({ status: 409 });
        for (const blocked of ["reversible-write", "external-side-effect"]) {
            flags.isCapabilityEnabled.mockImplementation(async (capability: { risk: string }) => capability.risk !== blocked);
            await expect(approve()).rejects.toMatchObject({ status: 403 });
        }
        flags.isCapabilityEnabled.mockResolvedValue(true);
        automation.changePolicy();
        await expect(approve()).rejects.toMatchObject({ status: 409 });
        expect((await actions.get(action.id, owner)).executionAttemptCount).toBe(0);
        expect(execute).not.toHaveBeenCalled();
        automation.restorePolicy();
        expect((await approve()).action.status).toBe("succeeded");
        expect(execute).toHaveBeenCalledTimes(1);
        expect(execute.mock.calls[0]![0].taskAutomation).toEqual(action.proposal["_taskAutomation"]);
    });

    it.each(["no", "noSend"] as const)("keeps %s customer reviews on write approval with a bound suppression artifact", async (choice) => {
        automationFixture();
        const created = await create();
        const answered = await service.patch(principal, created.snapshot.taskId, { clientEventId: randomUUID(), expectedRevision: created.snapshot.revision,
            operations: [{ op: "set", field: choice === "no" ? "automationChoice" : "noSend", value: choice === "no" ? "no" : true }] });
        const review = await service.command(principal, answered.snapshot.taskId, { clientEventId: randomUUID(),
            expectedRevision: answered.snapshot.revision, command: "prepare-review" });
        const action = await actions.get(review.snapshot.action!.actionId, owner);
        expect(action).toMatchObject({ risk: "reversible-write", authorizationContext: { approvalPolicy: "structured" } });
        expect(action.proposal["_taskAutomation"]).toMatchObject({ consent: { choice: "no", binding: null }, noSend: choice === "noSend" });
        expect((await actions.approve(action.id, principal, action.proposalRevision)).action.status).toBe("succeeded");
        expect(execute.mock.calls[0]![0].taskAutomation.consent.choice).toBe("no");
    });

    it("retains read-only result recovery for historical task actions without minting an automation artifact", async () => {
        const review = await prepared();
        execute.mockRejectedValueOnce(new AgentActionUncertainError("Synthetic interruption"));
        const uncertain = await actions.approve(review.snapshot.action!.actionId, principal, review.snapshot.action!.expectedRevision);
        expect(uncertain.action.status).toBe("uncertain");
        definition.planAutomationImpact = jest.fn().mockRejectedValue(new Error("Must not replan committed effects"));
        const recovered = await actions.reconcile(uncertain.action.id, principal);
        expect(recovered.status).toBe("succeeded");
        expect(definition.planAutomationImpact).not.toHaveBeenCalled();
        expect(reconcile.mock.calls[0]![0]).not.toHaveProperty("taskAutomation");
        expect(execute).toHaveBeenCalledTimes(1);
    });

    it("recovers a reviewed automation action from its stored artifact without current-impact planning", async () => {
        automationFixture();
        const review = await automationPrepared();
        const action = await actions.get(review.snapshot.action!.actionId, owner);
        execute.mockRejectedValueOnce(new AgentActionUncertainError("Synthetic interruption"));
        const uncertain = await actions.approve(action.id, principal, action.proposalRevision, actions.strongAcknowledgementToken(action));
        expect(uncertain.action.status).toBe("uncertain");
        definition.planAutomationImpact = jest.fn().mockRejectedValue(new Error("Must not replan committed effects"));
        expect((await actions.reconcile(action.id, principal)).status).toBe("succeeded");
        expect(definition.planAutomationImpact).not.toHaveBeenCalled();
        expect(reconcile.mock.calls[0]![0].taskAutomation).toEqual(action.proposal["_taskAutomation"]);
        expect(execute).toHaveBeenCalledTimes(1);
    });

});
