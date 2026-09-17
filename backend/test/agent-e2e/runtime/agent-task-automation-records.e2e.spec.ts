import { Prisma, type PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { AgentAutomationRecordStoreService, type AgentAutomationCommittedBatch, type AgentAutomationTaskMutation } from "../../../application/agent/agent-automation-record-store.service";
import { MessageAutomationBranchLockService } from "../../../application/services/message-automation-branch-lock.service";
import { persistClientMessageAutomationIntent } from "../../../application/services/message-automation-intent-writer";
import { createAgentAutomationQuestion, answerAgentAutomationQuestion } from "../../../application/agent/agent-automation-question";
import { parseTaskAutomationArtifact, TASK_AUTOMATION_ARTIFACT_KEY, type AgentTaskAutomationArtifact } from "../../../application/agent/agent-task-automation-artifact";
import { decodeAgentAutomationTerminalRow, agentAutomationRecordKey } from "../../../application/agent/agent-automation-terminal-record";
import { agentAutomationCoverageRecordDigest } from "../../../application/agent/agent-automation-coverage";
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
        await db.client.deleteMany({ where: { branchId } });
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

    async function seed(choice: "yes" | "no" | "noSend" | "none" = "yes") {
        const impact = { availability: choice === "none" ? "none" as const : "available" as const,
            complete: true, clientIdentity: null, sourceGuard: hash("source"), affectedJobs: [],
            effects: choice === "none" ? [] : [{ kind: "client-rule" as const, ruleId: "synthetic-rule", scheduleId: null,
                recipientType: "client" as const, templateKey: "CLIENT_GREETING" as const, change: "create" as const,
                recipientDigest: hash("recipient"), sourceDigest: hash("source"), templateDigest: hash("template"), policyDigest: hash("policy"), recipeDigest: hash("recipe") }] };
        const question = createAgentAutomationQuestion(impact);
        const answer = answerAgentAutomationQuestion({ choice: choice === "yes" ? "yes" : choice === "none" ? "unanswered" : "no",
            presented: question, current: question, noSend: choice === "noSend", clientEventId: randomUUID() });
        if (answer.status !== "accepted") throw new Error("Invalid synthetic answer");
        const parsed = parseTaskAutomationArtifact({ version: 1, actionId: randomUUID(), taskId: randomUUID(), taskRevision: 2,
            sessionId: randomUUID(), userId, branchId, capability: "clients.create", inputHash: hash("input"),
            targetClientId: null, targetVersion: null, question, consent: answer.consent, noSend: choice === "noSend", impact });
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
});
