import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import { MessageTriggerRecipientType, MessageTriggerTemplateKey } from "domain/constants/message-trigger-catalog";
import { AgentAutomationDispatchUncertainError } from "domain/errors/agent-automation-dispatch-uncertain.error";
import { AgentAutomationDeliveryGateService } from "./agent-automation-delivery-gate.service";
import { SmsTriggerDeliveryService, type SmsTriggerDeliveryPreparation } from "./sms-trigger-delivery.service";

function fixture() {
    const now = new Date("2026-09-17T12:00:00.000Z");
    const job = MessageTriggerJobEntity.reconstitute(randomUUID(), randomUUID(), "synthetic-rule", "processing", now,
        null, null, null, 1, null, MessageTriggerRecipientType.CLIENT, "01000000001", MessageTriggerTemplateKey.CLIENT_GREETING,
        "synthetic-dedupe", { memberId: "1", recipientName: "합성", recipientPhone: "01000000001", templateVariables: { name: "합성" } }, now, now, 0, null, randomUUID());
    let row = structuredClone(job);
    const database = { message_trigger_job: {
        findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
            Object.entries(where).every(([key, value]) => (row as unknown as Record<string, unknown>)[key] === value) ? structuredClone(row) : null),
        updateMany: jest.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
            if (!Object.entries(where).every(([key, value]) => (row as unknown as Record<string, unknown>)[key] === value)) return { count: 0 };
            Object.assign(row, data); return { count: 1 };
        }),
    } };
    let rollback = false;
    const lock = { runExclusive: jest.fn(async (_branch: string, callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
        const prior = structuredClone(row);
        try { const result = await callback(database as never); if (rollback) throw new Error("synthetic rollback"); return result; }
        catch (error) { row = prior; throw error; }
    }) };
    const authority = { checkAutomaticJob: jest.fn(async () => ({ status: "legacy" })) };
    const gate = new AgentAutomationDeliveryGateService(database as never, lock as never, authority as never);
    const render = jest.fn(async () => preparation.snapshot);
    const preparation: SmsTriggerDeliveryPreparation = {
        snapshot: { snapshotHash: "a".repeat(64), message: "합성" } as SmsTriggerDeliveryPreparation["snapshot"], serializedSnapshot: "synthetic snapshot",
    };
    const prepare = async () => {
        expect(await gate.authorizePreparation(job, render, async () => ({ kind: "allow" }))).toEqual({ kind: "allow" });
        expect(await gate.consumePreparation(job)).toBe(true);
        job.payload.templateVariables["__smsDeliverySnapshot"] = preparation.serializedSnapshot;
        row.payload = structuredClone(job.payload);
    };
    const cas = async () => { row.status = "dispatching"; return { kind: "allow" as const }; };
    const dispatch = async () => { await prepare(); expect(await gate.authorizeDispatch(job, preparation, render, cas)).toEqual({ kind: "allow" }); job.markDispatchAuthorized(); };
    return { job, gate, preparation, render, authority, database, lock, prepare, cas, dispatch,
        row: () => row, rollback: () => { rollback = true; }, newOwner: () => new AgentAutomationDeliveryGateService(database as never, lock as never, authority as never) };
}

describe("AgentAutomationDeliveryGateService", () => {
    it("requires admission before preparation and consumes it once", async () => {
        const f = fixture();
        expect(await f.gate.consumePreparation(f.job)).toBe(false);
        expect(await f.gate.authorizePreparation(f.job, f.render, async () => ({ kind: "allow" }))).toEqual({ kind: "allow" });
        const clone = Object.assign(Object.create(Object.getPrototypeOf(f.job)), structuredClone(f.job)) as MessageTriggerJobEntity;
        expect(await f.gate.consumePreparation(clone)).toBe(false);
        expect(await f.gate.consumePreparation(f.job)).toBe(true);
        expect(await f.gate.consumePreparation(f.job)).toBe(false);
    });

    it("cancels a denied current processing claim before any preparation", async () => {
        const f = fixture(); f.authority.checkAutomaticJob.mockResolvedValue({ status: "refused" });
        expect(await f.gate.authorizePreparation(f.job, f.render, async () => ({ kind: "allow" }))).toMatchObject({ kind: "stale" });
        expect(f.row()).toMatchObject({ status: "canceled", claimToken: null });
        expect(await f.gate.consumePreparation(f.job)).toBe(false);
    });

    it("cannot publish a preparation permit from a rolled-back transaction", async () => {
        const f = fixture(); f.rollback();
        await expect(f.gate.authorizePreparation(f.job, f.render, async () => ({ kind: "allow" }))).rejects.toThrow("synthetic rollback");
        expect(await f.gate.consumePreparation(f.job)).toBe(false);
        expect(f.row().status).toBe("processing");
    });

    it("does not issue a final permit when the final CAS rolls back or is missing", async () => {
        const f = fixture(); await f.prepare(); f.rollback();
        await expect(f.gate.authorizeDispatch(f.job, f.preparation, f.render, f.cas)).rejects.toThrow("synthetic rollback");
        expect(f.row().status).toBe("processing");
        await expect(f.gate.consumeDispatch(f.job, f.preparation)).rejects.toBeInstanceOf(AgentAutomationDispatchUncertainError);
        const missing = fixture(); await missing.prepare();
        await expect(missing.gate.authorizeDispatch(missing.job, missing.preparation, missing.render, async () => ({ kind: "allow" })))
            .rejects.toBeInstanceOf(AgentAutomationDispatchUncertainError);
        expect(missing.row().status).toBe("processing");
    });

    it("atomically consumes a final permit once when two callers pass the async row read", async () => {
        const f = fixture(); await f.dispatch(); const provider = jest.fn();
        const outcomes = await Promise.allSettled([1, 2].map(async () => { await f.gate.consumeDispatch(f.job, f.preparation); provider(); }));
        expect(outcomes.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
        expect(provider).toHaveBeenCalledTimes(1);
        await expect(f.gate.consumeDispatch(f.job, f.preparation)).rejects.toBeInstanceOf(AgentAutomationDispatchUncertainError);
    });

    it("rejects a cloned preparation and a new process without changing dispatching", async () => {
        const f = fixture(); await f.dispatch();
        await expect(f.gate.consumeDispatch(f.job, { ...f.preparation })).rejects.toBeInstanceOf(AgentAutomationDispatchUncertainError);
        await expect(f.newOwner().consumeDispatch(f.job, f.preparation)).rejects.toBeInstanceOf(AgentAutomationDispatchUncertainError);
        expect(f.row().status).toBe("dispatching");
        await expect(f.gate.consumeDispatch(f.job, f.preparation)).resolves.toBeUndefined();
    });

    it.each(["claim", "schedule", "seal", "snapshot", "status", "source"])("rejects persisted %s changes after dispatch authorization", async (field) => {
        const f = fixture(); await f.dispatch();
        if (field === "claim") f.row().claimToken = randomUUID();
        if (field === "schedule") f.row().scheduledFor = new Date("2027-01-01");
        if (field === "seal") (f.row().payload as unknown as Record<string, unknown>)["agentAutomationSeal"] = {};
        if (field === "snapshot") f.row().payload.templateVariables["__smsDeliverySnapshot"] = "changed";
        if (field === "status") f.row().status = "pending";
        if (field === "source") f.row().payload.templateVariables["unused"] = "changed";
        const before = structuredClone(f.row());
        await expect(f.gate.consumeDispatch(f.job, f.preparation)).rejects.toBeInstanceOf(AgentAutomationDispatchUncertainError);
        expect(f.row()).toEqual(before);
    });

    it("rejects mutated preparation and job objects at the synchronous take", async () => {
        const f = fixture(); await f.dispatch();
        (f.preparation.snapshot as { message: string }).message = "changed";
        await expect(f.gate.consumeDispatch(f.job, f.preparation)).rejects.toBeInstanceOf(AgentAutomationDispatchUncertainError);
        const other = fixture(); await other.dispatch(); other.job.claimToken = randomUUID();
        await expect(other.gate.consumeDispatch(other.job, other.preparation)).rejects.toBeInstanceOf(AgentAutomationDispatchUncertainError);
    });

    it("cannot relabel an automatic row as manual or copy a task seal onto a manual row", async () => {
        const f = fixture(); f.job.ruleId = "agent-sms:synthetic"; f.job.markDispatchAuthorized();
        expect(await f.gate.permitsDirectManualJob(f.job)).toBe(false);
        f.row().ruleId = f.job.ruleId; f.row().status = "dispatching";
        expect(await f.gate.permitsDirectManualJob(f.job)).toBe(true);
        (f.job.payload as unknown as Record<string, unknown>)["agentAutomationSeal"] = null;
        expect(await f.gate.permitsDirectManualJob(f.job)).toBe(false);
    });

    it("refuses direct SMS and preparation entrypoints before enrichment, logs or provider calls", async () => {
        const f = fixture(); const aligo = { sendSms: jest.fn() }; const templates = { resolveEffective: jest.fn() };
        const logs = { create: jest.fn() }; const enrichers = { get: jest.fn() };
        const sms = new SmsTriggerDeliveryService(aligo as never, templates as never, logs as never, undefined, enrichers as never, f.gate);
        expect(await sms.prepareJob(f.job)).toBeNull();
        expect(await sms.sendJob(f.job)).toBe(false);
        await expect(sms.sendPreparedJob(f.job, f.preparation)).rejects.toBeInstanceOf(AgentAutomationDispatchUncertainError);
        expect(enrichers.get).not.toHaveBeenCalled(); expect(templates.resolveEffective).not.toHaveBeenCalled();
        expect(logs.create).not.toHaveBeenCalled(); expect(aligo.sendSms).not.toHaveBeenCalled();
    });
});
