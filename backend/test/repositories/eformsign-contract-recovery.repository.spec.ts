import { ContractRecoveryError } from "domain/repositories/eformsign-contract-recovery.repository.interface";
import { classifyRecovery } from "domain/entities/eformsign-document-job.entity";
import { SbEformsignDocumentJobRepository } from "infrastructure/database/repositories/sb.eformsign-document-job.repository";
import { runtimeFixture, B, J, G, I, U, F, data, worker, intentInput, intentFingerprint, workflowPlan } from "../utils/eformsign-contract-recovery.fixture";
const enqueue = { branchId: B, clientId: 2, jobType: "create_document" as const, source: "staff" as const, requestKey: "new-request", activeKey: "new-active", payload: { clientId: 2, contractData: data }, payloadFingerprint: F };
describe("authority-bound runtime repository (explicit Prisma stubs, no PostgreSQL concurrency proof)", () => {
    it.each(["missing", "lease", "generation", "payload", "fingerprint"])("refuses %s before STARTED or authority mutation", async defect => {
        const f = runtimeFixture();
        if (defect === "missing") f.state.jobs = [];
        if (defect === "lease") f.state.jobs[0].leaseToken = J;
        if (defect === "generation") f.state.jobs[0].contractGeneration = J;
        if (defect === "payload") f.state.jobs[0].payload.contractData.customerName = "Changed";
        if (defect === "fingerprint") f.state.jobs[0].payloadFingerprint = "b".repeat(64);
        await expect(f.repository.claimCreation(intentInput, worker, { contractData: data, workflow: workflowPlan })).rejects.toBeInstanceOf(ContractRecoveryError);
        expect(f.events).toEqual([]);
    });
    it("atomically associates creation intent and STARTED, retaining the old undefined-template fingerprint and key", async () => {
        const f = runtimeFixture(), result = await f.repository.claimCreation(intentInput, worker, { contractData: data, workflow: workflowPlan });
        expect(result.disposition).toBe("claimed"); expect(result.intent.fingerprint).toBe(intentFingerprint); expect(result.intent.businessKey).toBe(intentInput.businessKey);
        expect(f.state.intents[0]).toMatchObject({ status: "started", attemptCount: 1 });
        expect(f.state.authorities[0]).toMatchObject({ creationIntentId: I, phase: "creation_pending" });
        expect(f.state.jobs[0].payload.contractDispatch).toMatchObject({ templateId: null, effectiveTemplateId: "template_ABC", generation: "prior-doc" });
        const locks = f.sql.filter(query => query.text.includes("FOR UPDATE")).map(query => query.text);
        expect(locks[0]).toMatch(/FROM client[\s\S]*ORDER BY id FOR UPDATE/); expect(locks[1]).toContain("FROM eformsign_contract_authority");
        expect(locks[2]).toContain("FROM eformsign_document_job");
    });
    it.each(["template", "assignment", "local", "fingerprint", "contractData"])("does not accept an echoed but wrong dispatch %s", async field => {
        const f = runtimeFixture(), proposed = { ...intentInput }, effect = { contractData: data, workflow: workflowPlan };
        if (field === "template") proposed.templateId = "other" as never;
        if (field === "assignment") proposed.assignmentId = 100;
        if (field === "local") proposed.localDocumentId = 100;
        if (field === "fingerprint") proposed.fingerprint = "b".repeat(64);
        if (field === "contractData") effect.contractData = { ...data, customerName: "Caller" };
        await expect(f.repository.claimCreation(proposed, worker, effect)).rejects.toBeInstanceOf(ContractRecoveryError); expect(f.events).toEqual([]);
    });
    it.each(["started", "uncertain", "accepted"])("existing %s keeps the same intent and cannot start another attempt", async status => {
        const f = runtimeFixture(); Object.assign(f.state.intents[0], { status, attemptCount: 1, providerDocumentId: status === "accepted" ? "bound-doc" : null });
        const result = await f.repository.claimCreation(intentInput, worker, { contractData: data, workflow: workflowPlan });
        expect(result.disposition).toBe(status === "accepted" ? "already_accepted" : "uncertain"); expect(f.state.intents).toHaveLength(1); expect(f.state.intents[0].attemptCount).toBe(1);
    });
    it("a stale authority CAS rolls back STARTED and does not touch any pointer", async () => {
        const f = runtimeFixture(); f.flags.casZero = true;
        await expect(f.repository.claimCreation(intentInput, worker, { contractData: data, workflow: workflowPlan })).rejects.toBeInstanceOf(ContractRecoveryError);
        expect(f.state.intents[0].status).toBe("prepared"); expect(f.state.clients[0].eDocId).toBe("prior-doc");
        expect(f.tx.client.updateMany).not.toHaveBeenCalled();
    });
    it.each(["reserved", "human_exposed", "verified"])("direct legacy contracts cannot bypass unresolved %s", async phase => {
        const f = runtimeFixture(); f.state.authorities[0].phase = phase;
        await expect(f.repository.claimLegacyCreation(intentInput)).rejects.toBeInstanceOf(ContractRecoveryError); expect(f.events).toEqual([]);
    });
    it("new staff create inserts its durable job and reservation in one transaction", async () => {
        const f = runtimeFixture(); f.state.jobs = []; f.state.authorities = [];
        const result = await new SbEformsignDocumentJobRepository(f.prisma).enqueue(enqueue);
        expect(result.existing).toBe(false); expect(result.job.contractGeneration).toMatch(/^[a-f0-9-]{36}$/);
        expect(f.state.authorities[0]).toMatchObject({ creationJobId: result.job.id, generation: result.job.contractGeneration, phase: "reserved", priorDocumentId: "prior-doc" });
        expect(f.prisma.$transaction).toHaveBeenCalledTimes(1);
    });
    it("legacy request replay remains NULL and is never adopted", async () => {
        const f = runtimeFixture(); f.state.authorities = []; f.state.jobs[0].contractGeneration = null; f.state.intents[0].status = "started";
        const result = await new SbEformsignDocumentJobRepository(f.prisma).enqueue({ ...enqueue, requestKey: "request", activeKey: "active" });
        expect(result.existing).toBe(true); expect(result.job.contractGeneration).toBeNull(); expect(f.events).toEqual([]);
    });
    it.each(["reserved", "creation_uncertain", "human_exposed", "verified"])("released activeKey cannot bypass authority %s", async phase => {
        const f = runtimeFixture(); f.state.authorities[0].phase = phase; f.state.jobs[0].activeKey = null;
        await expect(new SbEformsignDocumentJobRepository(f.prisma).enqueue(enqueue)).rejects.toThrow(); expect(f.state.jobs).toHaveLength(1);
    });
    it("closed authority rotates without rewriting the previous job generation", async () => {
        const f = runtimeFixture(); f.state.authorities[0].phase = "closed"; f.state.jobs[0].activeKey = null;
        const result = await new SbEformsignDocumentJobRepository(f.prisma).enqueue(enqueue);
        expect(result.job.contractGeneration).not.toBe(G); expect(f.state.jobs[0].contractGeneration).toBe(G);
        expect(f.state.authorities[0].generation).toBe(result.job.contractGeneration);
    });
    it("terminal payload cleanup includes new failed generations, preserving legacy failed cleanup semantics", async () => {
        const execute = jest.fn().mockResolvedValue(0), repo = new SbEformsignDocumentJobRepository({ $executeRaw: execute } as never);
        await expect(repo.purgeExpiredAttentionPayloads(new Date())).resolves.toBe(0);
        const query = execute.mock.calls[0]![0];
        expect(query.text).toContain("status = 'requires_attention' OR (status = 'failed' AND contract_generation IS NOT NULL)");
        expect(query.text).toContain("completed_at <"); expect(query.values).toHaveLength(1);
    });
});

import { EformsignDispatchBoundaryService } from "application/services/eformsign-dispatch-boundary.service";
it("missing authority binding refuses provider-changing and contract dispatch before any legacy write", async () => {
    const legacy = { prepare: jest.fn(), claim: jest.fn() }, boundary = new EformsignDispatchBoundaryService(legacy as never);
    await expect(boundary.claim({ ...intentInput, action: "finalize", providerDocumentId: "bound-doc" })).rejects.toMatchObject({ code: "RECOVERY_UNAVAILABLE" });
    await expect(boundary.claimContract(intentInput)).rejects.toMatchObject({ code: "RECOVERY_UNAVAILABLE" });
    expect(legacy.prepare).not.toHaveBeenCalled(); expect(legacy.claim).not.toHaveBeenCalled();
});
it("the real same-provider guard allows absent authority but rejects human exposure before intent writes", async () => {
    const f = runtimeFixture(), input = { ...intentInput, action: "finalize" as const, providerDocumentId: "bound-doc", businessKey: "independent-finalize" };
    f.state.authorities = []; await expect(f.repository.claimProvider(input)).resolves.toMatchObject({ disposition: "claimed" });
    const exposed = runtimeFixture(); exposed.manual(); await exposed.service.open(J, { branchId: B, userId: U, branchRole: "manager" }); exposed.events.length = 0;
    await expect(exposed.repository.claimProvider(input)).rejects.toMatchObject({ code: "REQUEST_CONFLICT" }); expect(exposed.events).toEqual([]);
});
it("a replay cannot rewrite the workflow frozen at STARTED", async () => {
    const f = runtimeFixture(); await f.repository.claimCreation(intentInput, worker, { contractData: data, workflow: workflowPlan });
    const frozen = structuredClone(f.state.jobs[0].payload.contractDispatch);
    await expect(f.repository.claimCreation(intentInput, worker, { contractData: data, workflow: { ...workflowPlan, steps: workflowPlan.steps.map(step => ({ ...step, seq: "99" })) } })).rejects.toBeInstanceOf(ContractRecoveryError);
    expect(f.state.jobs[0].payload.contractDispatch).toEqual(frozen); expect(f.state.intents[0].attemptCount).toBe(1);
});
import { SbEformsignDispatchIntentRepository } from "infrastructure/database/repositories/sb.eformsign-dispatch-intent.repository";
it("an unrelated service-record create keeps its original key under another document's human exposure", async () => {
    const f = runtimeFixture(); f.manual(); await f.service.open(J, { branchId: B, userId: U, branchRole: "manager" });
    const boundary = new EformsignDispatchBoundaryService(new SbEformsignDispatchIntentRepository(f.prisma), f.repository);
    await expect(boundary.claim({ ...intentInput, businessKey: "original-service-record-key", generation: "record-1", localDocumentId: null })).resolves.toMatchObject({ disposition: "claimed", intent: { businessKey: "original-service-record-key" } });
    expect(f.state.authorities[0].phase).toBe("human_exposed");
});
it("the actual bare resolve method's guarded SQL cannot complete a new generation", async () => {
    const row: any = { id: J, branch_id: B, contract_generation: G, status: "failed", progress_step: null };
    const query = jest.fn(async (sql: { text: string }) => {
        if (sql.text.includes("WITH resolved")) { if (sql.text.includes("j.contract_generation IS NULL")) return []; row.status = "completed"; return [row]; }
        return [row];
    });
    await expect(new SbEformsignDocumentJobRepository({ $queryRaw: query } as never).resolveManually({ jobId: J, branchId: B, userId: U, now: new Date() })).resolves.toMatchObject({ kind: "invalid_state" });
    expect(row.status).toBe("failed");
});
it.each([
    ["create_draft", "7f3732dc4bdd2f1fefcf3bdcde89799a8a4751de293c1b348fc78c72ffb5ed9d"],
    ["manual_process", "a59fa6736f0ec7621a2c9121a2bb8ed40f9267472dfc6452c2abaf86d5573efc"],
])("%s uses a distinct stable generation key satisfying the literal database64hex constraint", async (action, expected) => {
    const f = runtimeFixture(); f.manual(); await f.service.open(J, { branchId: B, userId: U, branchRole: "manager" });
    const key = f.state.intents.find((intent: { action: string }) => intent.action === action).businessKey;
    expect(key).toMatch(/^[0-9a-f]{64}$/); expect(key).toBe(expected);
    expect(new Set(f.state.intents.slice(1).map((intent: { businessKey: string }) => intent.businessKey)).size).toBe(2);
    await f.service.open(J, { branchId: B, userId: U, branchRole: "manager" });
    expect(f.state.intents).toHaveLength(3); expect(f.state.intents.find((intent: { action: string }) => intent.action === action).businessKey).toBe(key);
    const sameGeneration = runtimeFixture(); sameGeneration.manual(); await sameGeneration.service.open(J, { branchId: B, userId: U, branchRole: "manager" });
    expect(sameGeneration.state.intents.find((intent: { action: string }) => intent.action === action).businessKey).toBe(key);
});
it("ignores a newer purged mirror when deriving the original legacy identity", async () => {
    const f = runtimeFixture(); f.state.docs.push({ ...f.state.docs[0], id: 12, documentId: "purged", createdDate: new Date(Date.now() + 1), permanentPurgeRequestedAt: new Date() });
    await expect(f.repository.claimCreation(intentInput, worker, { contractData: data, workflow: workflowPlan })).resolves.toMatchObject({ disposition: "claimed", intent: { businessKey: intentInput.businessKey } });
});
it("binding rechecks client pointers after the document lifecycle lock", async () => {
    const f = runtimeFixture(); f.manual(); const opened = await f.repository.open(J, B, U), claim = { jobId: J, branchId: B, userId: U, claimEpoch: opened.claimEpoch };
    const intent = await f.repository.beginDraft(claim, "template_ABC", { companyId: "company-abc", creatorId: "service@example.test", workflow: workflowPlan });
    await f.repository.recordDraftCandidate(claim, intent.id, "bound-doc");
    const upsert = f.tx.eformsign_doc.upsert.getMockImplementation()!;
    f.tx.eformsign_doc.upsert.mockImplementation(async (args: unknown) => { f.state.clients.push({ id: 3, branchId: B, eDocId: "bound-doc" }); return upsert(args); });
    await expect(f.repository.bindDocument(claim, { documentId: "bound-doc", templateId: "template_ABC", companyId: "company-abc", creatorId: "service@example.test", statusType: "001", stepType: "00", stepIndex: "1", stepName: "write", confirmed: false, createdAt: new Date(), updatedAt: new Date(), expiresAt: new Date() }, intent.id)).rejects.toMatchObject({ code: "REQUEST_CONFLICT" });
    expect(f.state.authorities[0].providerDocumentId).toBeNull(); expect(f.state.clients[0].eDocId).toBe("prior-doc");
});
it.each(["closed", "human_exposed"])("a transferred prior pointer distinguishes historical vs unresolved authority: %s", async phase => {
    const f = runtimeFixture(); f.state.authorities.push({ ...f.state.authorities[0], clientId: 8, generation: I, creationJobId: I, providerDocumentId: "prior-doc", phase });
    const result = f.repository.claimCreation(intentInput, worker, { contractData: data, workflow: workflowPlan });
    if (phase !== "closed") { await expect(result).rejects.toMatchObject({ code: "REQUEST_CONFLICT" }); expect(f.events).toEqual([]); return; }
    await expect(result).resolves.toMatchObject({ disposition: "claimed" }); Object.assign(f.state.intents[0], { status: "accepted", providerDocumentId: "bound-doc" }); f.forward();
    await f.service.completeAutomatic(worker, "bound-doc", { branchId: B, source: "worker" });
    expect(f.state.clients[0].eDocId).toBe("bound-doc"); expect(f.state.authorities[1].providerDocumentId).toBe("prior-doc");
});
it.each(["started", "uncertain"])("unresolved legacy contract %s prevents issuing any new generation", async status => {
    const f = runtimeFixture(); f.state.jobs = []; f.state.authorities = []; f.state.intents[0].status = status;
    await expect(new SbEformsignDocumentJobRepository(f.prisma).enqueue(enqueue)).rejects.toThrow(); expect(f.state.jobs).toEqual([]); expect(f.state.authorities).toEqual([]);
});
it.each(["finalize", "service-record"])("legacy-intent generation guard preserves %s independence", async kind => {
    const f = runtimeFixture(); f.state.jobs = []; f.state.authorities = []; f.state.intents[0].status = "started";
    if (kind === "finalize") f.state.intents[0].action = "finalize";
    const input = kind === "service-record" ? { ...enqueue, requestKey: "service-record-create", payload: { ...enqueue.payload, kind: "service_record_revision" } } : enqueue;
    await expect(new SbEformsignDocumentJobRepository(f.prisma).enqueue(input)).resolves.toMatchObject({ existing: false });
    expect(f.state.jobs[0].contractGeneration === null).toBe(kind === "service-record");
});

const draftEvidence = () => ({ documentId: "bound-doc", templateId: "template_ABC", companyId: "company-abc", creatorId: "service@example.test", statusType: "001", stepType: "00", stepIndex: "1", stepName: "write", confirmed: false, createdAt: new Date(), updatedAt: new Date(), expiresAt: new Date() });
describe("terminal generation release regressions", () => {
    async function exhausted() {
        const f = runtimeFixture(); f.state.jobs[0].attempts = 4;
        await f.repository.recoverBeforeCreation(worker, null, "PRE_SEND_RETRY_EXHAUSTED");
        return f;
    }
    const principal = { branchId: B, userId: U, branchRole: "manager" };
    it.each([false, true])("replaces proven pre-send exhaustion with purged payload=%s and keeps history without recovery", async purged => {
        const f = await exhausted();
        if (purged) { f.state.jobs[0].payload = null; f.state.jobs[0].completedAt = new Date(0); }
        const next = await new SbEformsignDocumentJobRepository(f.prisma).enqueue(enqueue);
        expect(next.existing).toBe(false); expect(next.job.contractGeneration).not.toBe(G);
        expect(f.state.jobs[0]).toMatchObject({ status: "failed", lastErrorCode: "PRE_SEND_RETRY_EXHAUSTED", progressStep: "superseded", contractGeneration: G });
        expect(classifyRecovery(f.state.jobs[0])).toBeNull();
        await expect(f.repository.open(J, B, U)).rejects.toMatchObject({ code: "RECOVERY_STALE" });
        await expect(f.repository.readClaim({ jobId: J, branchId: B, userId: U, claimEpoch: 0n })).rejects.toMatchObject({ code: "RECOVERY_STALE" });
    });
    it("preserves idempotent exhausted request replay", async () => {
        const f = await exhausted(), before = structuredClone(f.state);
        const result = await new SbEformsignDocumentJobRepository(f.prisma).enqueue({ ...enqueue, requestKey: "request" });
        expect(result.existing).toBe(true); expect(result.job.contractGeneration).toBe(G); expect(f.state).toEqual(before);
    });
    it("keeps queued pre-send retry held", async () => {
        const f = runtimeFixture(); f.state.jobs[0].attempts = 1;
        await f.repository.recoverBeforeCreation(worker, new Date(), "offline"); f.state.jobs[0].activeKey = null;
        await expect(new SbEformsignDocumentJobRepository(f.prisma).enqueue(enqueue)).rejects.toThrow();
        expect(f.state.jobs).toHaveLength(1); expect(f.state.authorities[0].generation).toBe(G);
    });
    it("keeps exhaustion manually recoverable before new enqueue", async () => {
        const f = await exhausted(); await expect(f.service.open(J, principal)).resolves.toMatchObject({ kind: "editable" });
    });
    it.each(["claim", "creationIntentId", "draftIntentId", "humanIntentId", "providerDocumentId", "started", "uncertain", "wrong-generation", "wrong-fingerprint", "wrong-error", "job-cas", "authority-cas"])("refuses replacement with %s", async defect => {
        const f = await exhausted(), a = f.state.authorities[0];
        if (defect === "claim") Object.assign(a, { claimUserId: U, claimExpiresAt: new Date(Date.now() + 60000) });
        if (["creationIntentId", "draftIntentId", "humanIntentId"].includes(defect)) a[defect] = I;
        if (defect === "providerDocumentId") a.providerDocumentId = "bound-doc";
        if (["started", "uncertain"].includes(defect)) f.state.intents[0].status = defect;
        if (defect === "wrong-generation") f.state.jobs[0].contractGeneration = I;
        if (defect === "wrong-fingerprint") f.state.jobs[0].payloadFingerprint = "b".repeat(64);
        if (defect === "wrong-error") f.state.jobs[0].lastErrorCode = "OTHER";
        if (defect === "job-cas") f.flags.jobZero = true;
        if (defect === "authority-cas") f.flags.casZero = true;
        const before = structuredClone(f.state);
        await expect(new SbEformsignDocumentJobRepository(f.prisma).enqueue(enqueue)).rejects.toThrow(); expect(f.state).toEqual(before);
    });
    it("an expired claim permits proven no-effect replacement", async () => {
        const f = await exhausted(); Object.assign(f.state.authorities[0], { claimUserId: U, claimExpiresAt: new Date(0), claimEpoch: 1n });
        await expect(new SbEformsignDocumentJobRepository(f.prisma).enqueue(enqueue)).resolves.toMatchObject({ existing: false });
    });
    it("confirmed manual draft completion settles human intent and permits reissue", async () => {
        const f = await exhausted(), opened = await f.service.open(J, principal); f.forward();
        const humanId = f.state.authorities[0].humanIntentId;
        await f.service.verify(J, principal, BigInt(opened.claimEpoch));
        expect(f.state.authorities[0].phase).toBe("closed");
        expect(f.state.intents.find((row: { id: string }) => row.id === humanId)).toMatchObject({ status: "reconciled_delivered", reconciledOutcome: "delivered", reconciledByUserId: U, reconciledAt: expect.any(Date), reconciliationReason: expect.any(String) });
        await expect(new SbEformsignDocumentJobRepository(f.prisma).enqueue(enqueue)).resolves.toMatchObject({ existing: false });
    });
    it.each(["started", "uncertain"])("confirmed bound %s create is reconciled before generation release", async status => {
        const f = runtimeFixture(); await f.repository.claimCreation(intentInput, worker, { contractData: data, workflow: workflowPlan });
        Object.assign(f.state.jobs[0], { status: "requires_attention", leaseToken: null, activeKey: null });
        Object.assign(f.state.authorities[0], { phase: "creation_uncertain" });
        Object.assign(f.state.intents[0], { status, providerDocumentId: "bound-doc" });
        const opened = await f.service.open(J, principal); f.forward();
        await f.service.verify(J, principal, BigInt(opened.claimEpoch));
        expect(f.state.intents[0]).toMatchObject({ status: "reconciled_delivered", attemptCount: 1, providerDocumentId: "bound-doc", reconciledOutcome: "delivered", reconciledByUserId: U });
        expect(f.state.authorities[0].phase).toBe("closed");
        await expect(new SbEformsignDocumentJobRepository(f.prisma).enqueue(enqueue)).resolves.toMatchObject({ existing: false });
    });
    it("never settles an unrelated create intent while completing the bound document", async () => {
        const f = runtimeFixture(); await f.repository.claimCreation(intentInput, worker, { contractData: data, workflow: workflowPlan });
        Object.assign(f.state.jobs[0], { status: "requires_attention", leaseToken: null, activeKey: null });
        Object.assign(f.state.authorities[0], { phase: "creation_uncertain" });
        Object.assign(f.state.intents[0], { status: "uncertain", providerDocumentId: "bound-doc" });
        f.state.intents.push({ ...f.state.intents[0], id: J, businessKey: "other-key", providerDocumentId: "other-doc" });
        const unrelated = structuredClone(f.state.intents[1]);
        const opened = await f.service.open(J, principal); f.forward(); await f.service.verify(J, principal, BigInt(opened.claimEpoch));
        expect(f.state.intents[1]).toEqual(unrelated);
        await expect(new SbEformsignDocumentJobRepository(f.prisma).enqueue(enqueue)).rejects.toThrow();
    });
    it.each(["intent-cas", "pointer-cas", "job-cas", "authority-cas", "document", "generation", "fingerprint", "branch", "client", "action", "attempt-race", "unconfirmed"])("completion rolls back on %s", async defect => {
        const f = runtimeFixture(); await f.repository.claimCreation(intentInput, worker, { contractData: data, workflow: workflowPlan });
        Object.assign(f.state.jobs[0], { status: "requires_attention", leaseToken: null, activeKey: null });
        Object.assign(f.state.authorities[0], { phase: "creation_uncertain", providerDocumentId: "bound-doc" });
        Object.assign(f.state.intents[0], { status: "uncertain", providerDocumentId: "bound-doc" });
        const opened = await f.repository.open(J, B, U);
        if (defect === "intent-cas") f.tx.eformsign_dispatch_intent.updateMany.mockResolvedValueOnce({ count: 0 });
        if (defect === "pointer-cas") f.tx.client.updateMany.mockResolvedValueOnce({ count: 0 });
        if (defect === "job-cas") f.flags.jobZero = true;
        if (defect === "authority-cas") f.flags.casZero = true;
        if (defect === "document") f.state.intents[0].providerDocumentId = "other";
        if (defect === "generation") f.state.intents[0].generation = "other";
        if (defect === "fingerprint") f.state.intents[0].fingerprint = "b".repeat(64);
        if (defect === "branch") f.state.intents[0].branchId = J;
        if (defect === "client") f.state.intents[0].clientId = 3;
        if (defect === "action") f.state.intents[0].action = "finalize";
        if (defect === "attempt-race") {
            const update = f.tx.eformsign_dispatch_intent.updateMany.getMockImplementation()!;
            f.tx.eformsign_dispatch_intent.updateMany.mockImplementationOnce(async (args: unknown) => { f.state.intents[0].attemptCount += 1; return update(args); });
        }
        const before = structuredClone(f.state);
        await expect(f.repository.completeManual({ jobId: J, branchId: B, userId: U, claimEpoch: opened.claimEpoch }, { ...draftEvidence(), confirmed: defect !== "unconfirmed", statusType: "060", stepType: "05" })).rejects.toBeInstanceOf(ContractRecoveryError);
        expect(f.state).toEqual(before);
    });
});
describe("reexposeHuman", () => {
    const principal = { branchId: B, userId: U, branchRole: "manager" };
    it.each(["started", "uncertain"])("refuses a pending %s finalize without any writes", async status => {
        const f = runtimeFixture(); f.manual(); await f.service.open(J, principal);
        const a = f.state.authorities[0];
        const intent = f.state.intents.find((row: { id: string }) => row.id === a.humanIntentId);
        f.state.intents.push({ ...intent, id: J, businessKey: "pending-finalize", action: "finalize", status });
        const before = structuredClone(f.state), attemptCount = intent.attemptCount; f.events.length = 0;
        await expect(f.repository.reexposeHuman({ jobId: J, branchId: B, userId: U, claimEpoch: a.claimEpoch }, draftEvidence())).rejects.toMatchObject({ code: "REQUEST_CONFLICT" });
        expect(f.state.intents.find((row: { id: string }) => row.id === a.humanIntentId).attemptCount).toBe(attemptCount);
        expect(f.state).toEqual(before); expect(f.events).toEqual([]);
    });
    it("refuses a tombstoned mirrored document without any writes", async () => {
        const f = runtimeFixture(); f.manual(); await f.service.open(J, principal);
        const a = f.state.authorities[0];
        f.state.docs.find((row: { documentId: string }) => row.documentId === "bound-doc").permanentPurgeRequestedAt = new Date();
        const before = structuredClone(f.state); f.events.length = 0;
        await expect(f.repository.reexposeHuman({ jobId: J, branchId: B, userId: U, claimEpoch: a.claimEpoch }, draftEvidence())).rejects.toMatchObject({ code: "REQUEST_CONFLICT", reason: "document_mismatch" });
        expect(f.state).toEqual(before); expect(f.events).toEqual([]);
    });
    it("reuses the same started intent, bumping only attemptCount and startedAt", async () => {
        const f = runtimeFixture(); f.manual(); await f.service.open(J, principal);
        const authority = structuredClone(f.state.authorities[0]);
        const intent = f.state.intents.find((row: { id: string }) => row.id === authority.humanIntentId);
        intent.startedAt = new Date(0); const before = structuredClone(intent);
        f.tx.eformsign_dispatch_intent.create.mockClear(); f.events.length = 0;
        await f.repository.reexposeHuman({ jobId: J, branchId: B, userId: U, claimEpoch: authority.claimEpoch }, draftEvidence());
        expect(f.state.authorities[0]).toEqual(authority);
        expect(intent).toEqual({ ...before, attemptCount: before.attemptCount + 1, startedAt: expect.any(Date) });
        expect(intent.startedAt.getTime()).toBeGreaterThan(before.startedAt.getTime());
        expect(f.events).toEqual(["intents.updateMany"]); expect(f.tx.eformsign_dispatch_intent.create).not.toHaveBeenCalled(); expect(f.draft.dispatchDraft).toHaveBeenCalledTimes(1);
    });
    it.each(["epoch", "user", "expiry", "phase", "missing-intent", "action", "status", "document", "generation", "template", "branch", "client", "cas", "confirmed-evidence", "non-draft-status", "non-write-step"])("refuses %s without any intent mutation", async defect => {
        const f = runtimeFixture(); f.manual(); const opened = await f.service.open(J, principal);
        const evidence = draftEvidence();
        const claim = { jobId: J, branchId: B, userId: U, claimEpoch: BigInt(opened.claimEpoch) };
        const a = f.state.authorities[0], intent = f.state.intents.find((row: { id: string }) => row.id === a.humanIntentId);
        if (defect === "epoch") await f.repository.open(J, B, U);
        if (defect === "user") claim.userId = I;
        if (defect === "expiry") a.claimExpiresAt = new Date(0);
        if (defect === "phase") a.phase = "document_ready";
        if (defect === "missing-intent") a.humanIntentId = null;
        if (defect === "action") intent.action = "create_draft";
        if (defect === "status") intent.status = "uncertain";
        if (defect === "document") intent.providerDocumentId = "other";
        if (defect === "generation") intent.generation = I;
        if (defect === "template") intent.templateId = "other";
        if (defect === "branch") intent.branchId = I;
        if (defect === "client") intent.clientId = 9;
        if (defect === "cas") f.tx.eformsign_dispatch_intent.updateMany.mockResolvedValueOnce({ count: 0 });
        if (defect === "confirmed-evidence") evidence.confirmed = true;
        if (defect === "non-draft-status") evidence.statusType = "003";
        if (defect === "non-write-step") evidence.stepType = "05";
        const before = structuredClone(f.state); f.events.length = 0;
        await expect(f.repository.reexposeHuman(claim, evidence)).rejects.toMatchObject({ code: "RECOVERY_STALE" });
        expect(f.state).toEqual(before); expect(f.events).toEqual([]); expect(f.state.intents).toHaveLength(3);
    });
});

describe("contract recovery preserves the last attempt's display detail", () => {
    const assertWrites = (f: ReturnType<typeof runtimeFixture>) => {
        expect(f.tx.eformsign_document_job.updateMany).toHaveBeenCalled();
        for (const [{ data }] of [...f.tx.eformsign_document_job.updateMany.mock.calls, ...f.tx.eformsign_document_job.update.mock.calls]) expect(data).not.toHaveProperty("progressDetail");
        for (const sql of f.sql) expect(sql.text).not.toContain("progress_detail");
        expect(f.state.jobs[0].progressDetail).toBe("info-inserted");
    };
    it.each([true, false])("recoverBeforeCreation preserves detail (retry=%s)", async retry => {
        const f = runtimeFixture(); f.state.jobs[0].progressDetail = "info-inserted"; f.state.jobs[0].attempts = retry ? 1 : 4;
        await f.repository.recoverBeforeCreation(worker, retry ? new Date() : null, "PRE_SEND_RETRY_EXHAUSTED"); assertWrites(f);
    });
    it.each([true, false])("completion preserves detail (automatic=%s)", async automatic => {
        const f = runtimeFixture(); f.state.jobs[0].progressDetail = "info-inserted";
        if (automatic) {
            await f.repository.claimCreation(intentInput, worker, { contractData: data, workflow: workflowPlan });
            Object.assign(f.state.intents[0], { status: "accepted", providerDocumentId: "bound-doc" }); f.forward();
            await f.service.completeAutomatic(worker, "bound-doc", { branchId: B, source: "worker" });
        } else {
            f.manual(); const opened = await f.service.open(J, { branchId: B, userId: U, branchRole: "manager" }); f.forward();
            await f.service.verify(J, { branchId: B, userId: U, branchRole: "manager" }, BigInt(opened.claimEpoch));
        }
        assertWrites(f);
    });
});
