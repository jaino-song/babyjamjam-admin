import { ConfigService } from "@nestjs/config";
import { PrismaClient, Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { AgentTaskService } from "application/agent/agent-task.service";
import { AgentSessionService } from "application/agent/agent-session.service";
import { ActionCoordinatorService, AgentActionCertainFailureError, AgentActionUncertainError } from "application/agent/action-coordinator.service";
import { PrismaAgentTaskRepository } from "infrastructure/database/repositories/prisma-agent-task.repository";
import { PrismaAgentActionRepository } from "infrastructure/database/repositories/prisma-agent-action.repository";
import { PrismaAgentSessionRepository } from "infrastructure/database/repositories/prisma-agent-session.repository";
import type { VerifiedTenantPrincipal } from "infrastructure/tenant/tenant.context";
import { agentBindingHash } from "domain/repositories/agent-linked-action.types";
import { assertApprovedAgentTaskPersistenceDatabaseTarget, createApprovedAgentTaskPersistenceClient } from "./agent-task-persistence.helper";

const describeDb = process.env["AGENT_E2E"] === "1" ? describe : describe.skip;
const userId = "b6100000-0000-4000-8000-000000000001";
const branchId = "b6200000-0000-4000-8000-000000000001";
const principal: VerifiedTenantPrincipal = { userId, branchId, globalRole: "admin", branchRole: "manager" };
const DAY = 86400000;
function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    return { promise, resolve };
}

/** Injection happens after a real DB write; rollback assertions use an independent read. */
function failAfterWrite(base: PrismaClient, delegate: string, method: string): PrismaClient {
    return new Proxy(base, { get(target, key, receiver) {
        if (key !== "$transaction") return Reflect.get(target, key, receiver);
        return (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => base.$transaction(async (tx) => callback(new Proxy(tx, {
            get(transaction, table, proxy) {
                const value = Reflect.get(transaction, table, proxy);
                if (table !== delegate) return value;
                return new Proxy(value, { get(model, operation) {
                    const fn = Reflect.get(model, operation);
                    if (operation !== method) return typeof fn === "function" ? fn.bind(model) : fn;
                    return async (...args: unknown[]) => { await fn.apply(model, args); throw new Error("SYNTHETIC_POSTWRITE_INTERRUPTION"); };
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
        execute, executeApprovedTarget: execute, reconcile };
    const policy = { assertCanCreate: jest.fn().mockResolvedValue(meta), assertCanPatch: jest.fn().mockReturnValue(meta),
        assertCanPrepareReview: jest.fn().mockResolvedValue(meta) };
    const clients = { findByPhone: jest.fn().mockResolvedValue(null), findById: jest.fn().mockResolvedValue(null) };
    function coordinator(repository = tasks) {
        return new ActionCoordinatorService(db as never, { get: () => definition } as never,
            { isCapabilityEnabled: async () => true } as never, {} as never,
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
        expect((await actions.get(review.snapshot.action!.actionId, principal)).status).toBe("cancelled");
    });

    it("claims once with approval audit, refuses later edits, and keeps result transcript free of protected values", async () => {
        const review = await prepared(); const entered = deferred(); const release = deferred();
        execute.mockImplementationOnce(async () => { entered.resolve(); await release.promise; return { status: "saved", protectedName: "SYN_PRIVATE_NAME" }; });
        const approval = actions.approve(review.snapshot.action!.actionId, principal, review.snapshot.action!.expectedRevision);
        await entered.promise;
        const claimed = await actions.get(review.snapshot.action!.actionId, principal);
        expect(claimed).toMatchObject({ status: "executing", approvedBy: userId, executionAttemptCount: 1, taskRevision: review.snapshot.revision });
        expect(claimed.approvedAt).toBeInstanceOf(Date);
        const running = await state(review.snapshot.taskId);
        expect(running.status).toBe("executing");
        expect(running.lastAcceptedAt.toISOString()).toBe(review.snapshot.times.acceptedAt);
        await expect(patch(review.snapshot.taskId, running.revision)).rejects.toMatchObject({ status: 409 });
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
        expect((await actions.get(renewed.snapshot.action!.actionId, principal)).status).toBe("cancelled");
    });

    it.each([["agent_action", "updateMany"], ["agent_task", "updateMany"], ["agent_task_event", "create"]])(
        "rolls back every claim write after injected %s.%s failure", async (delegate, method) => {
            const review = await prepared(); const before = await state(review.snapshot.taskId);
            const originalAction = await actions.get(review.snapshot.action!.actionId, principal);
            const count = await db.agent_task_event.count({ where: { sessionId } });
            const faulty = coordinator(new PrismaAgentTaskRepository(failAfterWrite(db, delegate, method) as never));
            await expect(faulty.approve(originalAction.id, principal, originalAction.proposalRevision)).rejects.toMatchObject({ status: 409 });
            expect(await state(review.snapshot.taskId)).toEqual(before);
            expect(await actions.get(originalAction.id, principal)).toEqual(originalAction);
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
        expect((await actions.get(uncertain.action.id, principal)).status).toBe("succeeded");
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
        const review = await prepared(); const action = await actions.get(review.snapshot.action!.actionId, principal);
        await expect(actions.approve(action.id, principal, "forged")).rejects.toMatchObject({ status: 409 });
        await expect(actions.approve(action.id, { ...principal, userId: randomUUID() }, action.proposalRevision)).rejects.toMatchObject({ status: 404 });
        await expect(actions.approve(action.id, principal, action.proposalRevision)).rejects.toMatchObject({ status: 409 });
        expect(execute).not.toHaveBeenCalled();
        const done = await actions.approve(action.id, principal, action.proposalRevision, actions.strongAcknowledgementToken(action));
        expect(done.action.status).toBe("succeeded");
        expect(action.inputHash).toBe(agentBindingHash(action.proposal["input"]));
    });
});
