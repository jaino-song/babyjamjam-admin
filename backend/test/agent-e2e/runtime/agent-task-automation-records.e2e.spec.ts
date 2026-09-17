import { Prisma, type PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { AgentAutomationEffect, AgentAutomationScope } from "../../../domain/entities/agent-automation-consent";
import { AgentAutomationAuthorityService, type AgentAutomationCurrentTarget } from "../../../application/agent/agent-automation-authority.service";
import { agentAutomationScheduleIdentity } from "../../../application/agent/agent-automation-consent";
import { AgentAutomationRecordStoreService, type AgentAutomationCommittedBatch, type AgentAutomationTaskMutation } from "../../../application/agent/agent-automation-record-store.service";
import { MessageAutomationBranchLockService } from "../../../application/services/message-automation-branch-lock.service";
import { persistClientMessageAutomationIntent } from "../../../application/services/message-automation-intent-writer";
import { createAgentAutomationQuestion, answerAgentAutomationQuestion } from "../../../application/agent/agent-automation-question";
import { parseTaskAutomationArtifact, TASK_AUTOMATION_ARTIFACT_KEY, type AgentTaskAutomationArtifact } from "../../../application/agent/agent-task-automation-artifact";
import { decodeAgentAutomationTerminalRow, agentAutomationRecordKey, agentAutomationRecordPrefix } from "../../../application/agent/agent-automation-terminal-record";
import { agentAutomationCoverageRecordDigest, agentAutomationGrandfatheredFingerprint } from "../../../application/agent/agent-automation-coverage";
import { agentBindingHash } from "../../../domain/repositories/agent-linked-action.types";
import type { AgentContext } from "../../../application/agent/agent-context";
import { AGENT_AUTOMATION_RECORD_DEDUPE_PREFIX, AGENT_AUTOMATION_RECORD_PAYLOAD_KEY } from "../../../domain/constants/agent-automation-storage";
import { createApprovedAgentTaskPersistenceClient, assertApprovedAgentTaskPersistenceDatabaseTarget } from "./agent-task-persistence.helper";

const describeDb = process.env["AGENT_E2E"] === "1" ? describe : describe.skip;
const branchId = "b9100000-0000-4000-8000-000000000001";
const userId = "b9100000-0000-4000-8000-000000000002";
const clientId = 979000001;
const expiresAt = new Date("2099-01-01T00:00:00.000Z");
const hash = (value: string) => agentBindingHash(value);

/** Inject a crash after the actual target write, retaining PostgreSQL rollback semantics. */
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

describeDb("committed task automation terminal record transactions", () => {
    let db: PrismaClient;
    let store: AgentAutomationRecordStoreService;
    let artifact: AgentTaskAutomationArtifact;
    let context: AgentContext;
    let captured: AgentAutomationCommittedBatch;
    const prepare = jest.fn<Promise<AgentAutomationTaskMutation>, [Prisma.TransactionClient]>();
    const stage = jest.fn<Promise<void>, [Prisma.TransactionClient, AgentAutomationCommittedBatch]>();

    async function cleanup() {
        await db.message_trigger_job.deleteMany({ where: { branchId } });
        await db.agent_action.deleteMany({ where: { branchId } });
        await db.agent_task.deleteMany({ where: { branchId } });
        await db.agent_session.deleteMany({ where: { branchId } });
        await db.employee_schedule.deleteMany({ where: { branchId } });
        await db.client.deleteMany({ where: { branchId } });
        await db.employee.deleteMany({ where: { branchId } });
    }
    beforeAll(async () => {
        assertApprovedAgentTaskPersistenceDatabaseTarget();
        db = createApprovedAgentTaskPersistenceClient(); await db.$connect(); await cleanup();
        await db.user.upsert({ where: { id: userId }, update: {}, create: { id: userId, email: "terminal-records@example.invalid", role: "admin" } });
        await db.branch.upsert({ where: { id: branchId }, update: {}, create: { id: branchId, name: "합성 기록 검증", slug: "agent-task-records-proof" } });
    });
    beforeEach(async () => {
        await cleanup();
        store = new AgentAutomationRecordStoreService(new MessageAutomationBranchLockService(db as never));
        prepare.mockReset().mockImplementation(async (tx) => {
            const client = await tx.client.create({ data: { id: clientId, branchId, name: "SYNTHETIC_PRIVATE_NAME", phone: "01000000001", voucherClient: false, serviceStatus: "pre_booking" } });
            const clientIdentity = agentBindingHash({ version: 1, resource: "client", id: client.id, createdAt: client.createdAt!.toISOString() });
            return { clientId, result: { id: clientId, name: client.name, status: "saved" }, coverages: [{ scope: {
                branchId, clientId, clientIdentity, kind: "client-rule", recipientType: "client", scheduleId: null, scheduleIdentity: null,
            }, grandfatheredScopes: [] }] };
        });
        stage.mockReset().mockImplementation(async (tx, batch) => {
            captured = structuredClone(batch);
            await persistClientMessageAutomationIntent(tx, { branchId, clientId, includePast: false, suppressGreeting: false, intentAt: new Date() });
        });
    });
    afterAll(async () => { if (db) { await cleanup(); await db.branch.delete({ where: { id: branchId } }); await db.user.delete({ where: { id: userId } }); await db.$disconnect(); } });

    async function seed(choice: "yes" | "no" | "noSend" | "none" = "yes", options: {
        effects?: AgentAutomationEffect[]; existingClient?: { id: number; createdAt: Date | null };
    } = {}) {
        const impact = { availability: choice === "none" ? "none" as const : "available" as const,
            complete: true, clientIdentity: options.existingClient ? agentBindingHash({ version: 1, resource: "client", id: options.existingClient.id,
                createdAt: options.existingClient.createdAt!.toISOString() }) : null, sourceGuard: hash("source"), affectedJobs: [],
            effects: options.effects ?? (choice === "none" ? [] : [{ kind: "client-rule" as const, ruleId: "synthetic-rule", scheduleId: null,
                recipientType: "client" as const, templateKey: "CLIENT_GREETING" as const, change: "create" as const,
                recipientDigest: hash("recipient"), sourceDigest: hash("source"), templateDigest: hash("template"), policyDigest: hash("policy"), recipeDigest: hash("recipe") }]) };
        const question = createAgentAutomationQuestion(impact);
        const answer = answerAgentAutomationQuestion({ choice: choice === "yes" ? "yes" : choice === "none" ? "unanswered" : "no",
            presented: question, current: question, noSend: choice === "noSend", clientEventId: randomUUID() });
        if (answer.status !== "accepted") throw new Error("Invalid synthetic answer");
        const parsed = parseTaskAutomationArtifact({ version: 1, actionId: randomUUID(), taskId: randomUUID(), taskRevision: 2,
            sessionId: randomUUID(), userId, branchId, capability: options.existingClient ? "clients.update" : "clients.create", inputHash: hash("input"),
            targetClientId: options.existingClient?.id ?? null, targetVersion: options.existingClient ? hash("target") : null, question, consent: answer.consent, noSend: choice === "noSend", impact });
        if (!parsed) throw new Error("Invalid synthetic artifact");
        artifact = parsed;
        context = { actionId: artifact.actionId, sessionId: artifact.sessionId, principal: { userId, branchId, globalRole: "admin", branchRole: "admin" }, traceId: "synthetic-terminal-record", locale: "ko" };
        await db.agent_session.create({ data: { id: artifact.sessionId, userId, branchId, model: "synthetic", agentVersion: "phase7", expiresAt } });
        await db.agent_task.create({ data: { id: artifact.taskId, sessionId: artifact.sessionId, userId, branchId,
            capabilityId: artifact.capability, revision: artifact.taskRevision, status: "executing", draft: {}, expiresAt, activeActionId: artifact.actionId } });
        await db.agent_action.create({ data: { id: artifact.actionId, sessionId: artifact.sessionId, userId, branchId,
            taskId: artifact.taskId, taskRevision: artifact.taskRevision, capability: artifact.capability, capabilityVersion: "phase7",
            risk: choice === "yes" ? "external-side-effect" : "reversible-write", status: "executing", inputHash: artifact.inputHash,
            proposal: { [TASK_AUTOMATION_ARTIFACT_KEY]: artifact } as unknown as Prisma.InputJsonValue, proposalRevision: hash("proposal"),
            authorizationContext: {}, expiresAt, idempotencyKey: randomUUID(), requestDedupeKey: randomUUID(), dedupeExpiresAt: expiresAt } });
    }
    async function terminals() { return db.message_trigger_job.findMany({ where: { branchId, dedupeKey: { startsWith: AGENT_AUTOMATION_RECORD_DEDUPE_PREFIX } }, orderBy: { dedupeKey: "asc" } }); }

    it.each(["yes", "no", "noSend", "none"] as const)("commits %s records with the customer, intent and private receipt exactly once", async (choice) => {
        await seed(choice);
        const receipt = await store.runTaskMutation(context, artifact, prepare, stage);
        const rows = await terminals();
        expect(rows).toHaveLength(choice === "none" ? 1 : 2);
        expect(rows.every((row) => decodeAgentAutomationTerminalRow(row) !== null)).toBe(true);
        expect(captured.coverages[0]?.grandfatheredScopes).toEqual([]);
        expect(captured.authorities.map(({ decision }) => decision)).toEqual(choice === "none" ? [] : [choice === "yes" ? "allow" : "deny"]);
        expect(JSON.stringify(rows.map(({ payload }) => payload))).not.toMatch(/SYNTHETIC_PRIVATE_NAME|01000000001/);
        expect(receipt.metadata?.automation.authorities).toHaveLength(captured.authorities.length);
        expect(await db.client.count({ where: { branchId } })).toBe(1);
        expect(await db.message_trigger_job.count({ where: { branchId, status: "failed" } })).toBe(1);
        expect(await store.runTaskMutation(context, artifact, prepare, stage)).toEqual(receipt);
        expect(prepare).toHaveBeenCalledTimes(1); expect(stage).toHaveBeenCalledTimes(1);
        expect(await terminals()).toEqual(rows);
    });

    it.each([["client", "create"], ["message_trigger_job", "upsert"], ["agent_action", "updateMany"], ["message_trigger_job", "create"]])(
        "rolls back all effects after %s.%s is written", async (delegate, method) => {
            await seed();
            const failing = new AgentAutomationRecordStoreService(new MessageAutomationBranchLockService(failAfterWrite(db, delegate!, method!) as never));
            await expect(failing.runTaskMutation(context, artifact, prepare, stage)).rejects.toThrow("SYNTHETIC_POSTWRITE_INTERRUPTION");
            expect(await db.client.count({ where: { branchId } })).toBe(0);
            expect(await db.message_trigger_job.count({ where: { branchId } })).toBe(0);
            expect((await db.agent_action.findUniqueOrThrow({ where: { id: artifact.actionId } })).effectReceipt).toBeNull();
            await expect(store.runTaskMutation(context, artifact, prepare, stage)).resolves.toMatchObject({ resourceId: clientId });
        });

    it("serializes duplicate executions and recovers from a caller interruption after commit", async () => {
        await seed();
        let release!: () => void; let entered!: () => void;
        const barrier = new Promise<void>((done) => { release = done; }); const reached = new Promise<void>((done) => { entered = done; });
        const original = prepare.getMockImplementation()!;
        prepare.mockImplementation(async (tx) => { entered(); await barrier; return original(tx); });
        const first = store.runTaskMutation(context, artifact, prepare, stage);
        await reached;
        const second = store.runTaskMutation(context, artifact, prepare, stage);
        release();
        const [a, b] = await Promise.all([first, second]);
        expect(a).toEqual(b); expect(prepare).toHaveBeenCalledTimes(1); expect(stage).toHaveBeenCalledTimes(1);
        const restarted = new AgentAutomationRecordStoreService(new MessageAutomationBranchLockService(db as never));
        expect(await restarted.runTaskMutation(context, artifact, prepare, stage)).toEqual(a);
    });

    it("keeps physical evidence after task/session/action purge and permits client deletion without foreign-key blockers", async () => {
        await seed(); await store.runTaskMutation(context, artifact, prepare, stage);
        const scope = captured.authorities[0]!.scope;
        const before = await terminals();
        await db.agent_action.delete({ where: { id: artifact.actionId } });
        await db.agent_task.delete({ where: { id: artifact.taskId } });
        await db.agent_session.delete({ where: { id: artifact.sessionId } });
        const batch = await db.$transaction((tx) => store.readLineages(tx, scope));
        expect(batch).toEqual(captured);
        // Existing retry intent is transient and has its normal client relation; remove only it.
        await db.message_trigger_job.deleteMany({ where: { branchId, status: "failed" } });
        await db.client.delete({ where: { id: clientId } });
        expect(await terminals()).toEqual(before);
        await expect(db.$transaction((tx) => store.readLineages(tx, { ...scope, clientIdentity: hash("reused-resource") }))).rejects.toThrow("Automation record transaction refused");
    });

    it.each(["copied", "fork", "gap", "physical", "commit"])("fails closed on %s stored evidence", async (mode) => {
        await seed(); await store.runTaskMutation(context, artifact, prepare, stage);
        const row = (await terminals()).find((value) => value.dedupeKey.includes(":coverage:"))!;
        const terminal = decodeAgentAutomationTerminalRow(row)!;
        if (mode === "physical") await db.message_trigger_job.update({ where: { id: row.id }, data: { status: "pending" } });
        else if (mode === "commit") await db.message_trigger_job.update({ where: { id: row.id }, data: { payload: {
            [AGENT_AUTOMATION_RECORD_PAYLOAD_KEY]: { ...terminal, commit: { ...terminal.commit, taskRevision: 99 } },
        } as unknown as Prisma.InputJsonValue } });
        else if (mode === "copied") await db.message_trigger_job.create({ data: { ...row, id: randomUUID(), dedupeKey: `${row.dedupeKey}-copied`, payload: row.payload as Prisma.InputJsonValue } });
        else {
            const record = { ...captured.coverages[0]!, id: mode === "gap" ? row.id : randomUUID(), sequence: mode === "gap" ? 2 : 1 };
            record.recordDigest = agentAutomationCoverageRecordDigest(record);
            const changed = { ...terminal, record, commitDigest: agentBindingHash({ recordDigest: record.recordDigest, commit: terminal.commit }) };
            if (mode === "gap") await db.message_trigger_job.update({ where: { id: row.id }, data: { dedupeKey: agentAutomationRecordKey(record), payload: {
                [AGENT_AUTOMATION_RECORD_PAYLOAD_KEY]: changed,
            } as unknown as Prisma.InputJsonValue } });
            else await db.message_trigger_job.create({ data: { ...row, id: record.id, dedupeKey: `${row.dedupeKey}-fork`, payload: {
                [AGENT_AUTOMATION_RECORD_PAYLOAD_KEY]: changed,
            } as unknown as Prisma.InputJsonValue } });
        }
        await expect(db.$transaction((tx) => store.readLineages(tx, captured.authorities[0]!.scope))).rejects.toThrow("Automation record transaction refused");
    });

    it("refuses owner/artifact and receipt corruption before rerunning the customer mutation", async () => {
        await seed();
        await expect(store.runTaskMutation({ ...context, principal: { ...context.principal, branchId: randomUUID() } }, artifact, prepare, stage)).rejects.toThrow();
        await expect(store.runTaskMutation(context, { ...artifact, inputHash: hash("forged") }, prepare, stage)).rejects.toThrow();
        expect(prepare).not.toHaveBeenCalled();
        await store.runTaskMutation(context, artifact, prepare, stage);
        await db.agent_action.update({ where: { id: artifact.actionId }, data: { effectReceipt: { corrupted: true } } });
        await expect(store.runTaskMutation(context, artifact, prepare, stage)).rejects.toThrow();
        expect(prepare).toHaveBeenCalledTimes(1);
    });
    function resolverTarget(scope: AgentAutomationScope = captured.authorities[0]!.scope): AgentAutomationCurrentTarget {
        return { branchId: scope.branchId, clientId: scope.clientId, kind: scope.kind, ruleId: scope.ruleId,
            scheduleId: scope.scheduleId, recipientType: scope.recipientType };
    }
    const locks = () => new MessageAutomationBranchLockService(db as never);

    it.each(["missing", "corrupted"])("refuses replay with a %s receipt-referenced record without rerunning callbacks", async (mode) => {
        await seed(); await store.runTaskMutation(context, artifact, prepare, stage);
        const beforeReceipt = (await db.agent_action.findUniqueOrThrow({ where: { id: artifact.actionId } })).effectReceipt;
        const id = captured.authorities[0]!.id;
        if (mode === "missing") await db.message_trigger_job.delete({ where: { id } });
        else await db.message_trigger_job.update({ where: { id }, data: { cancelReason: "synthetic-corruption" } });
        await expect(store.runTaskMutation(context, artifact, prepare, stage)).rejects.toThrow();
        expect(prepare).toHaveBeenCalledTimes(1); expect(stage).toHaveBeenCalledTimes(1);
        expect((await db.agent_action.findUniqueOrThrow({ where: { id: artifact.actionId } })).effectReceipt).toEqual(beforeReceipt);
    });

    it("derives a materialized seal from committed creation provenance and requires the same seal at dispatch", async () => {
        await seed(); await store.runTaskMutation(context, artifact, prepare, stage);
        const resolver = new AgentAutomationAuthorityService(store);
        const target = resolverTarget();
        const describe = jest.fn(async () => artifact.impact.effects[0]!);
        const allowed = await locks().runExclusive(branchId, (tx) => resolver.check(tx, { target, mode: "materialize" }, describe));
        expect(allowed.status).toBe("allowed"); if (allowed.status !== "allowed") throw new Error("Missing synthetic seal");
        expect(describe).toHaveBeenCalledWith({ scope: captured.authorities[0]!.scope,
            subject: { kind: "task-client", taskId: artifact.taskId }, change: "create" });
        expect(await locks().runExclusive(branchId, (tx) => resolver.check(tx, { target, mode: "dispatch" }, describe))).toMatchObject({ status: "refused" });
        expect(await locks().runExclusive(branchId, (tx) => resolver.check(tx, { target, mode: "dispatch", seal: allowed.seal }, describe))).toEqual(allowed);
        await db.agent_action.delete({ where: { id: artifact.actionId } });
        await db.agent_task.delete({ where: { id: artifact.taskId } });
        await db.agent_session.delete({ where: { id: artifact.sessionId } });
        expect(await locks().runExclusive(branchId, (tx) => resolver.check(tx, { target, mode: "dispatch", seal: allowed.seal }, describe))).toEqual(allowed);
        const sources = ["recipientDigest", "sourceDigest", "templateDigest", "policyDigest", "recipeDigest"] as const;
        for (const field of sources) {
            expect(await locks().runExclusive(branchId, (tx) => resolver.check(tx, { target, mode: "dispatch", seal: allowed.seal },
                async () => ({ ...artifact.impact.effects[0]!, [field]: hash(`changed-${field}`) })))).toMatchObject({ status: "refused", reason: "automation-consent-changed" });
        }
        expect(await locks().runExclusive(branchId, (tx) => resolver.check(tx, { target, mode: "dispatch", seal: { ...allowed.seal, authorityId: randomUUID() } }, describe))).toMatchObject({ status: "refused" });
        expect(await locks().runExclusive(branchId, (tx) => resolver.check(tx, { target, mode: "materialize", seal: null }, describe))).toMatchObject({ status: "refused" });
        expect(await locks().runExclusive(branchId, (tx) => resolver.check(tx, { target: { ...target, branchId: randomUUID() }, mode: "materialize" }, describe))).toMatchObject({ status: "refused" });
        await db.message_trigger_job.deleteMany({ where: { branchId, status: "failed" } });
        await db.client.delete({ where: { id: clientId } });
        expect(await locks().runExclusive(branchId, (tx) => resolver.check(tx, { target, mode: "dispatch", seal: allowed.seal }, describe))).toMatchObject({ status: "refused" });
        await db.client.create({ data: { id: clientId, branchId, name: "합성 재생성", voucherClient: false, phone: "01000000001", createdAt: new Date("2090-01-01") } });
        expect(await locks().runExclusive(branchId, (tx) => resolver.check(tx, { target, mode: "materialize" }, describe))).toMatchObject({ status: "refused" });
    });

    it.each(["no", "noSend", "none"] as const)("keeps %s covered scopes closed to new rules and never describes denied exact work", async (choice) => {
        await seed(choice); await store.runTaskMutation(context, artifact, prepare, stage);
        const resolver = new AgentAutomationAuthorityService(store);
        const target: AgentAutomationCurrentTarget = { branchId, clientId, kind: "client-rule", ruleId: "synthetic-rule", scheduleId: null, recipientType: "client" };
        const describe = jest.fn(async () => artifact.impact.effects[0] ?? null);
        expect(await locks().runExclusive(branchId, (tx) => resolver.check(tx, { target, mode: "materialize" }, describe))).toMatchObject({ status: "refused" });
        if (choice !== "none") expect(describe).not.toHaveBeenCalled();
        expect(await locks().runExclusive(branchId, (tx) => resolver.check(tx, { target: { ...target, ruleId: "new-rule" }, mode: "materialize" }, describe))).toMatchObject({ status: "refused" });
    });

    it("refuses missing coverage or exact evidence rather than reopening legacy behavior", async () => {
        await seed(); await store.runTaskMutation(context, artifact, prepare, stage);
        const resolver = new AgentAutomationAuthorityService(store);
        const target = resolverTarget(); const describe = async () => artifact.impact.effects[0]!;
        const allowed = await locks().runExclusive(branchId, (tx) => resolver.check(tx, { target, mode: "materialize" }, describe));
        if (allowed.status !== "allowed") throw new Error("Missing synthetic seal");
        await db.message_trigger_job.delete({ where: { id: captured.authorities[0]!.id } });
        expect(await locks().runExclusive(branchId, (tx) => resolver.check(tx, { target, mode: "dispatch", seal: allowed.seal }, describe))).toMatchObject({ status: "refused" });
        expect(await locks().runExclusive(branchId, (tx) => resolver.check(tx, { target, mode: "materialize" }, describe))).toMatchObject({ status: "refused" });
        await cleanup(); await seed(); await store.runTaskMutation(context, artifact, prepare, stage);
        await db.message_trigger_job.delete({ where: { id: captured.coverages[0]!.id } });
        expect(await locks().runExclusive(branchId, (tx) => resolver.check(tx, { target: resolverTarget(), mode: "materialize" }, async () => artifact.impact.effects[0]!))).toMatchObject({ status: "refused" });
    });

    it("keeps genuinely absent provenance legacy but refuses a copied seal", async () => {
        await seed(); await store.runTaskMutation(context, artifact, prepare, stage);
        const resolver = new AgentAutomationAuthorityService(store);
        const first = await locks().runExclusive(branchId, (tx) => resolver.check(tx, { target: resolverTarget(), mode: "materialize" }, async () => artifact.impact.effects[0]!));
        if (first.status !== "allowed") throw new Error("Missing synthetic seal");
        const other = await db.client.create({ data: { branchId, name: "합성 독립 고객", voucherClient: false, phone: "01000000002" } });
        const target = { ...resolverTarget(), clientId: other.id };
        const describe = jest.fn(async () => null);
        expect(await locks().runExclusive(branchId, (tx) => resolver.check(tx, { target, mode: "dispatch" }, describe))).toEqual({ status: "legacy" });
        expect(describe).not.toHaveBeenCalled();
        expect(await locks().runExclusive(branchId, (tx) => resolver.check(tx, { target, mode: "dispatch", seal: first.seal }, describe))).toMatchObject({ status: "refused" });
    });

    it("persists multiple schedule/client scopes in deterministic coverage-before-exact order and refuses recreated schedules", async () => {
        const client = await db.client.create({ data: { id: clientId, branchId, name: "합성 일정 고객", voucherClient: false, phone: "01000000001" } });
        await db.employee.createMany({ data: [97901, 97902].map((id) => ({ id, branchId, name: "합성 담당자", phone: "01000000002", workArea: [], grade: "test" })) });
        const scheduleInput = { id: clientId + 1, branchId, clientId, primaryEmployeeId: 97901, secondaryEmployeeId: 97902,
            workAddress: "합성 일정 주소", startDate: new Date("2030-01-01"), endDate: new Date("2030-01-10") };
        const schedule = await db.employee_schedule.create({ data: scheduleInput });
        const base: AgentAutomationEffect = { kind: "client-rule", ruleId: "rule-z", scheduleId: null, recipientType: "client", templateKey: "CLIENT_GREETING",
            change: "refresh", recipientDigest: hash("recipient"), sourceDigest: hash("source"), templateDigest: hash("template"), policyDigest: hash("policy"), recipeDigest: hash("recipe") };
        await seed("yes", { existingClient: client, effects: [base, { ...base, ruleId: "rule-a" },
            ...(["secondary-employee", "primary-employee"] as const).map((recipientType) => ({ ...base, kind: "employee-assignment" as const,
                scheduleId: schedule.id, ruleId: "schedule-rule", recipientType, templateKey: "EMPLOYEE_ASSIGNED" as const }))] });
        const identity = artifact.impact.clientIdentity!;
        prepare.mockImplementation(async (tx) => {
            await tx.client.update({ where: { id: clientId }, data: { name: "합성 정정" } });
            return { clientId, result: { id: clientId, status: "updated" }, coverages: [
                ...(["secondary-employee", "primary-employee"] as const).map((recipientType) => ({ scope: { branchId, clientId, clientIdentity: identity,
                    kind: "employee-assignment" as const, scheduleId: schedule.id, scheduleIdentity: agentAutomationScheduleIdentity(schedule.incarnationId), recipientType }, grandfatheredScopes: [] })),
                { scope: { branchId, clientId, clientIdentity: identity, kind: "client-rule", scheduleId: null, scheduleIdentity: null, recipientType: "client" }, grandfatheredScopes: [] },
            ] };
        });
        const written: string[] = [];
        const observed = new Proxy(db, { get(target, key, receiver) {
            if (key !== "$transaction") return Reflect.get(target, key, receiver);
            return (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => db.$transaction(async (tx) => callback(new Proxy(tx, {
                get(transaction, table, proxy) {
                    const value = Reflect.get(transaction, table, proxy);
                    if (table !== "message_trigger_job") return value;
                    return new Proxy(value, { get(model, method) {
                        const fn = Reflect.get(model, method);
                        if (method !== "create") return typeof fn === "function" ? fn.bind(model) : fn;
                        return async (args: Prisma.message_trigger_jobCreateArgs) => { written.push(args.data.dedupeKey); return model.create(args); };
                    } });
                },
            })));
        } });
        store = new AgentAutomationRecordStoreService(new MessageAutomationBranchLockService(observed as never));
        await store.runTaskMutation(context, artifact, prepare, stage);
        expect(captured.coverages).toHaveLength(3); expect(captured.authorities).toHaveLength(4);
        const coverageKeys = captured.coverages.map(({ scope }) => agentAutomationRecordPrefix("coverage", scope));
        expect(coverageKeys).toEqual([...coverageKeys].sort((a, b) => a.localeCompare(b)));
        expect(written).toEqual([...captured.coverages, ...captured.authorities].map(agentAutomationRecordKey));
        const resolver = new AgentAutomationAuthorityService(store);
        const authority = captured.authorities.find(({ scope }) => scope.recipientType === "primary-employee")!;
        const target = resolverTarget(authority.scope);
        const describe = jest.fn(async () => authority.effects[0]!);
        const allowed = await locks().runExclusive(branchId, (tx) => resolver.check(tx, { target, mode: "materialize" }, describe));
        expect(allowed.status).toBe("allowed");
        expect(describe).toHaveBeenCalledWith({ scope: authority.scope, subject: { kind: "client", clientId, clientIdentity: identity }, change: "refresh" });
        // Terminal storage has no FK that prevents ordinary schedule deletion.
        await db.employee_schedule.delete({ where: { id: schedule.id } });
        const recreated = await db.employee_schedule.create({ data: scheduleInput });
        expect(recreated.incarnationId).not.toBe(schedule.incarnationId);
        expect(await locks().runExclusive(branchId, (tx) => resolver.check(tx, { target, mode: "materialize" }, describe))).toMatchObject({ status: "refused" });
        expect(prepare).toHaveBeenCalledTimes(1);
    });

    it("preserves only the exact unchanged independently authorized grandfathered fingerprint", async () => {
        const client = await db.client.create({ data: { id: clientId, branchId, name: "합성 기존 고객", voucherClient: false, phone: "01000000001" } });
        await seed("yes", { existingClient: client });
        const identity = artifact.impact.clientIdentity!;
        const prior = { ...artifact.impact.effects[0]!, ruleId: "independent-rule" };
        const scope = { branchId, clientId, clientIdentity: identity, kind: "client-rule" as const, recipientType: "client" as const, scheduleId: null, scheduleIdentity: null };
        prepare.mockImplementation(async (tx) => {
            await tx.client.update({ where: { id: clientId }, data: { name: "합성 정정" } });
            return { clientId, result: { id: clientId, status: "updated" }, coverages: [{ scope, grandfatheredScopes: [{
                scope: { ...scope, ruleId: prior.ruleId }, fingerprint: agentAutomationGrandfatheredFingerprint(prior),
            }] }] };
        });
        await store.runTaskMutation(context, artifact, prepare, stage);
        const resolver = new AgentAutomationAuthorityService(store);
        const target = { ...resolverTarget(), ruleId: prior.ruleId };
        expect(await locks().runExclusive(branchId, (tx) => resolver.check(tx, { target, mode: "materialize" }, async () => prior))).toEqual({ status: "legacy" });
        expect(await locks().runExclusive(branchId, (tx) => resolver.check(tx, { target, mode: "dispatch" }, async () => ({ ...prior, change: "refresh" })))).toEqual({ status: "legacy" });
        expect(await locks().runExclusive(branchId, (tx) => resolver.check(tx, { target, mode: "dispatch" }, async () => ({ ...prior, sourceDigest: hash("new-source") })))).toMatchObject({ status: "refused" });
        expect(await locks().runExclusive(branchId, (tx) => resolver.check(tx, { target: { ...target, ruleId: "new-rule" }, mode: "materialize" }, async () => ({ ...prior, ruleId: "new-rule" })))).toMatchObject({ status: "refused" });
        expect(await locks().runExclusive(branchId, (tx) => resolver.check(tx, { target, mode: "dispatch" }, async () => { throw new Error("SYNTHETIC_PRIVATE_EXCEPTION"); }))).toEqual({ status: "refused", reason: "automation-authority-unavailable" });
    });

});
