import { createHash } from "node:crypto";
import { ConflictException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { SbEformsignDocumentJobRepository } from "../repositories/sb.eformsign-document-job.repository";
import { normalizeVerifiedAuthority, retireProvenNoEffect } from "./eformsign-contract-authority-release";
import { runtimeFixture, B, J, G, I, U, F, data, worker, intentInput, workflowPlan } from "../../../test/utils/eformsign-contract-recovery.fixture";
const next = { branchId: B, clientId: 2, jobType: "create_document" as const, source: "staff" as const,
    requestKey: "next", activeKey: "next-active", payload: { clientId: 2, contractData: data }, payloadFingerprint: F };
async function historical(status = "064") {
    const f = runtimeFixture(); await f.repository.claimCreation(intentInput, worker, { contractData: data, workflow: workflowPlan });
    Object.assign(f.state.intents[0], { status: "accepted", providerDocumentId: "bound-doc" }); f.forward();
    await f.service.completeAutomatic(worker, "bound-doc", { branchId: B, source: "worker" });
    Object.assign(f.state.authorities[0], { phase: "verified", claimUserId: U, claimExpiresAt: new Date(Date.now() + 60000) });
    Object.assign(f.state.intents[0], { status: "uncertain", reconciledAt: null, reconciledByUserId: null, reconciledOutcome: null });
    f.state.docs.find((row: { documentId: string }) => row.documentId === "bound-doc").statusType = status;
    return f;
}
// The first replay/active reads see no collision. A same-branch, same-fingerprint
// row appears only at INSERT, so the ordinary fallback would return existing:true.
function collideAtInsert(f: ReturnType<typeof runtimeFixture>) {
    const query = f.tx.$queryRaw.getMockImplementation()!;
    f.tx.$queryRaw.mockImplementation(async (sql: Prisma.Sql) => {
        if (/INSERT INTO "eformsign_document_job"/.test(sql.text)) {
            expect(f.state.jobs.some((row: { requestKey: string }) => row.requestKey === next.requestKey)).toBe(false);
            f.state.jobs.push({ ...structuredClone(f.state.jobs[0]), id: I, branchId: next.branchId, clientId: next.clientId,
                requestKey: next.requestKey, activeKey: next.activeKey, payloadFingerprint: next.payloadFingerprint, contractGeneration: null });
            f.flags.insertZero = true;
        }
        return query(sql);
    });
}
async function collisionFixture(site: "normalization" | "retirement") {
    const f = site === "normalization" ? await historical() : runtimeFixture();
    if (site === "retirement") {
        await f.repository.claimCreation(intentInput, worker, { contractData: data, workflow: workflowPlan }); f.manual();
    }
    return f;
}
describe("post-mutation INSERT same-branch collision rollback", () => {
    it.each(["normalization", "retirement"] as const)("rolls back %s even when same-branch same-fingerprint fallback would succeed", async site => {
        const f = await collisionFixture(site), before = structuredClone(f.state);
        collideAtInsert(f); f.events.length = 0;
        const error = await new SbEformsignDocumentJobRepository(f.prisma).enqueue(next).catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(ConflictException);
        expect((error as ConflictException).getResponse()).toEqual({ code: "REQUEST_CONFLICT" });
        expect(f.events).toContain("authority.cas");
        expect(f.events).toContain(site === "normalization" ? "intents.updateMany" : "jobs.updateMany");
        expect(f.tx.$queryRaw.mock.calls.some(([sql]: [Prisma.Sql]) => /INSERT INTO "eformsign_document_job"/.test(sql.text))).toBe(true);
        expect(f.state).toEqual(before); // Includes all authority/job/key/intent/pointer/mirror/payload fields.
        expect(f.state.jobs.every((row: { branchId: string }) => row.branchId === B)).toBe(true);
    });
    it.each(["normalization", "retirement"] as const)("positive control: the %s collision qualifies for ordinary fallback without mutation", async site => {
        const f = await collisionFixture(site);
        const closed = site === "normalization"
            ? await normalizeVerifiedAuthority(f.tx, f.state.authorities[0])
            : await retireProvenNoEffect(f.tx, f.state.authorities[0], f.state.clients[0].eDocId);
        expect(closed).toBe(true);
        const authority = structuredClone(f.state.authorities), intents = structuredClone(f.state.intents);
        collideAtInsert(f);
        await expect(new SbEformsignDocumentJobRepository(f.prisma).enqueue(next)).resolves.toMatchObject({ existing: true,
            job: { id: I, branchId: B, requestKey: next.requestKey, payloadFingerprint: F } });
        expect(f.state.authorities).toEqual(authority); expect(f.state.intents).toEqual(intents);
        expect(f.state.jobs).toHaveLength(2);
    });
});
describe("historical atomic completion normalization at hold enforcement", () => {
    it.each(["064", "061", "080"])("enqueue settles exact old create before unresolved check despite mutable mirror %s", async status => {
        const f = await historical(status), repo = new SbEformsignDocumentJobRepository(f.prisma), before = structuredClone(f.state);
        await expect(repo.enqueue({ ...next, requestKey: "request" })).resolves.toMatchObject({ existing: true });
        expect(f.state).toEqual(before);
        await expect(repo.enqueue(next)).resolves.toMatchObject({ existing: false });
        expect(f.state.authorities[0].generation).not.toBe(G);
        expect(f.state.intents[0]).toMatchObject({ status: "reconciled_delivered", attemptCount: 1, providerDocumentId: "bound-doc", reconciledByUserId: U,
            reconciliationReason: "Historical atomic verified completion confirmed same-document provider delivery" });
        expect(f.state.clients[0].eDocId).toBe("bound-doc");
    });
    it.each(["provider", "legacy"])("normalizes at %s admission without UI open", async site => {
        const f = await historical();
        const input = { ...intentInput, businessKey: "next-intent", providerDocumentId: "bound-doc", action: "finalize" as const, generation: "new-finalize" };
        await (site === "provider" ? f.repository.claimProvider(input) : f.repository.claimLegacyCreation(input));
        expect(f.state.authorities[0].phase).toBe("closed"); expect(f.state.intents[0].status).toBe("reconciled_delivered");
    });
    it.each(["actor", "generation", "fingerprint", "job-doc", "pointer", "lease", "active-key", "draft", "write-step", "purge", "void", "foreign", "template", "service", "intent-cas", "authority-cas", "insert", "unrelated", "unrelated-active"])("refuses/rolls back historical normalization on %s", async defect => {
        const f = await historical(), a = f.state.authorities[0], job = f.state.jobs[0], doc = f.state.docs.find((row: { documentId: string }) => row.documentId === "bound-doc");
        if (defect === "actor") a.claimUserId = null;
        if (defect === "generation") job.contractGeneration = I;
        if (defect === "fingerprint") job.payloadFingerprint = "b".repeat(64);
        if (defect === "job-doc") job.documentId = "wrong";
        if (defect === "pointer") f.state.clients[0].eDocId = "wrong";
        if (defect === "lease") job.leaseToken = J;
        if (defect === "active-key") job.activeKey = "held";
        if (defect === "draft") doc.statusType = "001";
        if (defect === "write-step") doc.stepType = "00";
        if (defect === "purge") doc.permanentPurgeRequestedAt = new Date();
        if (defect === "void") doc.voidedAt = new Date();
        if (defect === "foreign") doc.clientId = 3;
        if (defect === "template") f.state.intents[0].templateId = "wrong";
        if (defect === "service") doc.documentKind = "service_record";
        if (defect === "intent-cas") f.tx.eformsign_dispatch_intent.updateMany.mockResolvedValueOnce({ count: 0 });
        if (defect === "authority-cas") f.flags.casZero = true;
        if (defect === "insert") f.flags.insertZero = true;
        if (defect === "unrelated") f.state.intents.push({ ...f.state.intents[0], id: J, businessKey: "unrelated" });
        if (defect === "unrelated-active") f.state.jobs.push({ ...job, id: I, activeKey: next.activeKey, requestKey: "unrelated" });
        const before = structuredClone(f.state);
        await expect(new SbEformsignDocumentJobRepository(f.prisma).enqueue(next)).rejects.toThrow(); expect(f.state).toEqual(before);
    });
    it("retains a positively disproved predecessor beside a genuine human/draft effect", async () => {
        const f = runtimeFixture(); f.manual(); const opened = await f.service.open(J, { branchId: B, userId: U, branchRole: "manager" }); f.forward();
        await f.service.verify(J, { branchId: B, userId: U, branchRole: "manager" }, BigInt(opened.claimEpoch));
        f.state.authorities[0].phase = "verified"; const old = structuredClone(f.state.intents[0]);
        await new SbEformsignDocumentJobRepository(f.prisma).enqueue(next);
        expect(f.state.intents[0]).toEqual(old);
    });
    it.each([0, 1])("prepared attempt %s is no-effect only with durable before-open release", async attempts => {
        const f = runtimeFixture(); f.manual(); const a = f.state.authorities[0]; a.phase = "creation_pending"; a.creationIntentId = null;
        const key = createHash("sha256").update(`contract-draft:${G}`).digest("hex");
        Object.assign(f.state.intents[0], { action: "create_draft", generation: G, fingerprint: F, localDocumentId: null, assignmentId: null,
            templateId: "template_ABC", businessKey: key, status: "prepared", attemptCount: attempts, startedAt: null,
            reconciliationReason: attempts ? "draft_released_before_open" : null }); a.draftIntentId = I;
        await expect(new SbEformsignDocumentJobRepository(f.prisma).enqueue(next)).resolves.toMatchObject({ existing: false });
    });
});

describe("PLAN5 bounded no-effect exits", () => {
    async function held(path: "released" | "zero" | "legacy-zero") {
        const f = runtimeFixture();
        if (path === "released") {
            await f.repository.claimCreation(intentInput, worker, { contractData: data, workflow: workflowPlan }); f.manual();
            const opened = await f.repository.open(J, B, U), claim = { jobId: J, branchId: B, userId: U, claimEpoch: opened.claimEpoch };
            const draft = await f.repository.beginDraft(claim, "template_ABC", { companyId: "company-abc", creatorId: "service@example.test", workflow: workflowPlan });
            await f.repository.releaseDraftBeforeOpen(claim, draft.id);
            expect(f.state.authorities[0]).toMatchObject({ phase: "reserved", draftIntentId: null, creationIntentId: I });
        } else {
            // Worker heartbeat/reconcile before claimCreation: no STARTED intent was ever linked.
            f.state.jobs[0].progressStep = "processing"; f.state.jobs[0].status = "reconciling";
            await f.repository.markAutomaticUncertain(worker);
            if (path === "legacy-zero") f.state.authorities[0].phase = "creation_uncertain";
            Object.assign(f.state.jobs[0], { status: "requires_attention", leaseToken: null, completedAt: new Date(), lastErrorCode: "RECOVERY_PENDING" });
        }
        if (f.state.authorities[0].claimUserId) f.state.authorities[0].claimExpiresAt = new Date(0);
        return f;
    }
    const ages = ["fresh", "day8-retained", "day8-purged"] as const;
    const paths = ["released", "zero", "legacy-zero"] as const;
    it.each(paths.flatMap(path => ages.map(age => ({ path, age }))))("$path $age replay is immutable; new key retires once without changing audit or pointer", async ({ path, age }) => {
        const f = await held(path);
        if (age !== "fresh") f.state.jobs[0].completedAt = new Date(Date.now() - 8 * 86400000);
        if (age === "day8-purged") f.state.jobs[0].payload = null;
        const before = structuredClone(f.state), repo = new SbEformsignDocumentJobRepository(f.prisma);
        await expect(repo.enqueue({ ...next, requestKey: "request" })).resolves.toMatchObject({ existing: true, job: { id: J, contractGeneration: G } });
        expect(f.state).toEqual(before);
        const result = await repo.enqueue({ ...next, activeKey: "active" });
        expect(result).toMatchObject({ existing: false }); expect(result.job.contractGeneration).not.toBe(G);
        expect(f.state.jobs).toHaveLength(2); expect(f.state.jobs[0]).toEqual({ ...before.jobs[0], status: "failed", progressStep: "superseded", activeKey: null, payload: null, leaseToken: null, heartbeatAt: null });
        expect(f.state.intents).toEqual(before.intents); expect(f.state.clients).toEqual(before.clients); expect(f.state.docs).toEqual(before.docs);
        expect(f.state.authorities[0]).toMatchObject({ phase: "reserved", generation: result.job.contractGeneration, creationJobId: result.job.id, priorDocumentId: "prior-doc" });
        const after = structuredClone(f.state);
        await expect(repo.enqueue({ ...next, activeKey: "active" })).resolves.toMatchObject({ existing: true, job: { id: result.job.id } });
        expect(f.state).toEqual(after);
        if (path === "released") {
            const lock = f.sql.filter(query => /FROM eformsign_dispatch_intent.*ORDER BY id FOR UPDATE/.test(query.text)).at(-1)!;
            expect(lock.values).toEqual([...before.intents.map((row: { id: string }) => row.id)].sort());
        }
    });
    const defects = ["same-claim", "other-claim", "lease", "processing", "queued", "document", "human-ref", "hidden-human", "pointer", "job-generation", "job-fingerprint", "job-client", "job-source", "job-type", "job-request", "superseded", "authority-cas", "job-cas"] as const;
    it.each(paths.flatMap(path => defects.map(defect => ({ path, defect }))))("$path refuses $defect with no state changes", async ({ path, defect }) => {
        const f = await held(path), a = f.state.authorities[0], job = f.state.jobs[0];
        if (defect === "same-claim" || defect === "other-claim") Object.assign(a, { claimUserId: defect === "same-claim" ? U : J, claimExpiresAt: new Date(Date.now() + 60000) });
        if (defect === "lease") job.leaseToken = J;
        if (defect === "processing" || defect === "queued") job.status = defect;
        if (defect === "document") job.documentId = "candidate";
        if (defect === "human-ref") a.humanIntentId = I;
        if (defect === "hidden-human") f.state.intents.push({ ...f.state.intents[0], id: J, action: "manual_process", generation: G, fingerprint: F, businessKey: createHash("sha256").update(`contract-human:${G}`).digest("hex") });
        if (defect === "pointer") f.state.clients[0].eDocId = "foreign";
        if (defect === "job-generation") job.contractGeneration = I;
        if (defect === "job-fingerprint") job.payloadFingerprint = "b".repeat(64);
        if (defect === "job-client") job.clientId = 3;
        if (defect === "job-source") job.source = "service_record";
        if (defect === "job-type") job.jobType = "finalize_document";
        if (defect === "job-request") job.requestKey = "service-record-foreign";
        if (defect === "superseded") job.progressStep = "superseded";
        if (defect === "authority-cas") f.flags.casZero = true;
        if (defect === "job-cas") f.flags.jobZero = true;
        const before = structuredClone(f.state);
        const retired = await f.prisma.$transaction((tx: Prisma.TransactionClient) => retireProvenNoEffect(tx, a, f.state.clients[0].eDocId)).catch(() => false);
        expect(retired).toBe(false); expect(f.state).toEqual(before);
    });
    it.each(["reason", "startedAt", "started", "uncertain", "accepted", "provider", "branch", "client", "generation", "fingerprint", "local", "assignment", "template", "action"])("unlinked draft refuses %s even when its create was not delivered", async defect => {
        const f = await held("released"), draft = f.state.intents[1];
        if (defect === "reason") { draft.reconciliationReason = null; draft.attemptCount = 0; }
        if (defect === "startedAt") draft.startedAt = new Date();
        if (["started", "uncertain", "accepted"].includes(defect)) draft.status = defect;
        if (defect === "accepted") draft.providerDocumentId = "candidate";
        if (defect === "provider") draft.providerDocumentId = "candidate";
        if (defect === "branch") draft.branchId = J;
        if (defect === "client") draft.clientId = 3;
        if (defect === "generation") draft.generation = J;
        if (defect === "fingerprint") draft.fingerprint = "b".repeat(64);
        if (defect === "local") draft.localDocumentId = 11;
        if (defect === "assignment") draft.assignmentId = 9;
        if (defect === "template") draft.templateId = "wrong-template";
        if (defect === "action") draft.action = "manual_process";
        const before = structuredClone(f.state);
        await expect(new SbEformsignDocumentJobRepository(f.prisma).enqueue(next)).rejects.toThrow(); expect(f.state).toEqual(before);
    });
    it.each(paths.flatMap(path => ["create", "create_draft"].flatMap(action => ["started", "uncertain", "accepted"].map(status => ({ path, action, status })))))("$path vetoes unrelated $action $status before any retirement", async ({ path, action, status }) => {
        const f = await held(path);
        f.state.intents.push({ ...f.state.intents[0], id: J, businessKey: "unrelated", action, status, attemptCount: 1, providerDocumentId: status === "accepted" ? "candidate" : null });
        const before = structuredClone(f.state); f.events.length = 0;
        const retired = await retireProvenNoEffect(f.tx, f.state.authorities[0], "prior-doc");
        expect(retired).toBe(false); expect(f.state).toEqual(before); expect(f.events).toEqual([]);
    });
    it("after the unrelated unknown create is legitimately reconciled no-effect, zero refs can retire", async () => {
        const f = await held("legacy-zero");
        Object.assign(f.state.intents[0], { status: "uncertain", attemptCount: 1 });
        const before = structuredClone(f.state);
        expect(await retireProvenNoEffect(f.tx, f.state.authorities[0], "prior-doc")).toBe(false); expect(f.state).toEqual(before);
        const { SbEformsignDispatchIntentRepository } = await import("../repositories/sb.eformsign-dispatch-intent.repository");
        await new SbEformsignDispatchIntentRepository(f.prisma).reconcile({ intentId: I, branchId: B, outcome: "not_delivered", actorUserId: U, reason: "Provider console confirms absence", attemptCount: 1 });
        await expect(new SbEformsignDocumentJobRepository(f.prisma).enqueue(next)).resolves.toMatchObject({ existing: false });
        expect(f.state.intents[0]).toMatchObject({ status: "reconciled_not_delivered", reconciledByUserId: U, attemptCount: 1 });
    });
    it("re-reads the discovered draft under its union lock and refuses a concurrent reconcile", async () => {
        const f = await held("released"), query = f.tx.$queryRaw.getMockImplementation()!;
        f.tx.$queryRaw.mockImplementation(async (sql: Prisma.Sql) => {
            if (/FROM eformsign_dispatch_intent.*ORDER BY id FOR UPDATE/.test(sql.text)) Object.assign(f.state.intents[1], { status: "reconciled_delivered", providerDocumentId: "late-document" });
            return query(sql);
        });
        expect(await retireProvenNoEffect(f.tx, f.state.authorities[0], "prior-doc")).toBe(false);
        expect(f.events).not.toContain("authority.rotate"); expect(f.state.jobs[0].progressStep).not.toBe("superseded");
    });
});
