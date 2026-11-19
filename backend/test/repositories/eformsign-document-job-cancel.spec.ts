import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { ContractRecoveryError } from "domain/repositories/eformsign-contract-recovery.repository.interface";
import { SbEformsignDocumentJobRepository } from "infrastructure/database/repositories/sb.eformsign-document-job.repository";
import { AuthorityConflictError } from "infrastructure/database/utils/eformsign-contract-authority";
import { runtimeFixture, B, J, G, I, U } from "../utils/eformsign-contract-recovery.fixture";

const input = { jobId: J, branchId: B, userId: U, now: new Date() };
function ready() {
    const f = runtimeFixture(); f.manual();
    Object.assign(f.state.jobs[0], { progressStep: "info-inserted", lastErrorCode: "KEEP_AUDIT" });
    Object.assign(f.state.authorities[0], { claimUserId: U, claimExpiresAt: new Date(0) });
    return { ...f, repo: new SbEformsignDocumentJobRepository(f.prisma) };
}

describe("document job cancellation", () => {
    it.each(["failed", "requires_attention"])("cancels %s and clears the claim pair, key and payload while preserving audit", async status => {
        const f = ready(); f.state.jobs[0].status = status;
        const before = structuredClone(f.state);
        expect(await f.repo.cancel(input)).toEqual({ kind: "cancelled" });
        expect(f.state.jobs[0]).toMatchObject({ status: "failed", progressStep: "cancelled", activeKey: null, payload: null, leaseToken: null,
            completedAt: before.jobs[0].completedAt, lastErrorCode: "KEEP_AUDIT" });
        expect(f.state.authorities[0]).toMatchObject({ phase: "closed", claimUserId: null, claimExpiresAt: null });
        expect(f.state.clients).toEqual(before.clients); expect(f.state.intents).toEqual(before.intents);
        expect(f.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 20000 });
        const after = structuredClone(f.state);
        expect(await f.repo.cancel(input)).toEqual({ kind: "already_cancelled" }); expect(f.state).toEqual(after);
        const locks = f.sql.filter((sql: Prisma.Sql) => sql.text.includes("FOR UPDATE")).map((sql: Prisma.Sql) => sql.text);
        expect(locks[0]).toContain("FROM client"); expect(locks[1]).toContain("FROM eformsign_contract_authority");
        expect(locks[2]).toContain("FROM eformsign_document_job"); expect(locks.findIndex(sql => sql.includes("FROM eformsign_dispatch_intent") && sql.includes("ORDER BY id FOR UPDATE"))).toBeGreaterThan(2);
    });
    it.each(["missing", "foreign"])("returns not_found for %s jobs without writes", async defect => {
        const f = ready(); if (defect === "missing") f.state.jobs = []; else f.state.jobs[0].branchId = G;
        const before = structuredClone(f.state);
        expect(await f.repo.cancel(input)).toEqual({ kind: "not_found" }); expect(f.state).toEqual(before);
    });
    it("rejects a generation mismatch at the cancel binding check", async () => {
        const f = ready(); f.state.authorities[0].generation = I;
        const before = structuredClone(f.state);
        // Retire also rejects this fixture, but with proof_conflict rather than ineligible_job.
        expect(await f.repo.cancel(input)).toEqual({ kind: "not_cancellable", reason: "ineligible_job" });
        expect(f.state).toEqual(before);
        expect(f.events).toEqual([]);
    });
    it.each([G, I])("refuses to cancel a different retirable authority job with generation %s", async generation => {
        const f = ready();
        const currentJob = { ...structuredClone(f.state.jobs[0]), id: I, contractGeneration: generation,
            requestKey: "current-request", activeKey: "current-active" };
        f.state.jobs.push(currentJob);
        Object.assign(f.state.authorities[0], { creationJobId: currentJob.id, generation });
        const before = structuredClone(f.state);

        expect(await f.repo.cancel(input)).toEqual({ kind: "not_cancellable", reason: "ineligible_job" });
        expect(f.state).toEqual(before);
        expect(f.events).toEqual([]);

        // The authority's actual job can be retired: no downstream veto masks the binding check.
        expect(await f.repo.cancel({ ...input, jobId: currentJob.id })).toEqual({ kind: "cancelled" });
        expect(f.state.jobs[0]).toEqual(before.jobs[0]);
        expect(f.state.jobs[1]).toMatchObject({ id: currentJob.id, progressStep: "cancelled", activeKey: null, payload: null });
        expect(f.state.authorities[0]).toMatchObject({ phase: "closed", claimUserId: null, claimExpiresAt: null });
    });
    it.each(["lease", "queued", "processing", "reconciling", "completed", "finalize", "service-record", "payload-kind", "live-claim", "legacy", "auto_finalize", "document", "creating", "sent", "detail-creating", "detail-sent", "superseded", "no-authority", "fingerprint", "pointer", "provider", "human-ref", "hidden-human", "blocked", "verified", "document-ready", "pending-zero", "uncertain", "draft-uncertain", "accepted-empty", "job-cas", "authority-cas"])("refuses %s without partial effects", async defect => {
        const f = ready(), job = f.state.jobs[0], a = f.state.authorities[0];
        if (defect === "lease") job.leaseToken = I;
        if (["queued", "processing", "reconciling", "completed"].includes(defect)) job.status = defect;
        if (defect === "live-claim") a.claimExpiresAt = new Date(Date.now() + 60000);
        if (defect === "legacy") job.contractGeneration = null;
        if (defect === "auto_finalize") job.source = "auto_finalize";
        if (defect === "finalize") job.jobType = "finalize_document";
        if (defect === "service-record") job.requestKey = "service-record-creation";
        if (defect === "payload-kind") job.payload.kind = "service_record_revision";
        if (defect === "document") job.documentId = "provider-document";
        if (["creating", "sent", "superseded"].includes(defect)) job.progressStep = defect;
        if (defect.startsWith("detail-")) job.progressDetail = defect.slice(7);
        if (defect === "no-authority") f.state.authorities = [];
        if (defect === "fingerprint") a.fingerprint = "wrong";
        if (defect === "pointer") f.state.clients[0].eDocId = "drift";
        if (defect === "provider") a.providerDocumentId = "provider-document";
        if (defect === "human-ref") a.humanIntentId = I;
        if (defect === "blocked" || defect === "verified") a.phase = defect;
        if (defect === "document-ready") a.phase = "document_ready";
        if (defect === "hidden-human") f.state.intents.push({ ...f.state.intents[0], id: G, action: "manual_process",
            businessKey: createHash("sha256").update(`contract-human:${a.generation}`).digest("hex") });
        if (defect === "pending-zero") { a.creationIntentId = null; a.phase = "creation_pending"; }
        if (defect === "uncertain") f.state.intents[0].status = "uncertain";
        if (defect === "draft-uncertain" || defect === "accepted-empty") f.state.intents.push({ ...f.state.intents[0], id: G, businessKey: "unrelated", action: "create_draft", status: defect === "draft-uncertain" ? "uncertain" : "accepted", providerDocumentId: "" });
        if (defect === "job-cas") f.flags.jobZero = true;
        if (defect === "authority-cas") f.flags.casZero = true;
        const before = structuredClone(f.state);
        expect(await f.repo.cancel(input)).toMatchObject({ kind: "not_cancellable" }); expect(f.state).toEqual(before);
    });
    it.each([new ContractRecoveryError("REQUEST_CONFLICT"), new AuthorityConflictError()])("maps proof conflict to not_cancellable", async error => {
        const f = ready(), before = structuredClone(f.state); f.tx.eformsign_dispatch_intent.findUnique.mockRejectedValueOnce(error);
        expect(await f.repo.cancel(input)).toMatchObject({ kind: "not_cancellable" }); expect(f.state).toEqual(before);
    });
    it("re-reads vetoes after acquiring the job lock", async () => {
        const f = ready(), query = f.tx.$queryRaw.getMockImplementation()!;
        f.tx.$queryRaw.mockImplementation(async (sql: Prisma.Sql) => {
            if (sql.text.includes("FROM eformsign_document_job") && sql.text.includes("FOR UPDATE")) f.state.jobs[0].progressDetail = "creating";
            return query(sql);
        });
        expect(await f.repo.cancel(input)).toMatchObject({ kind: "not_cancellable" });
        expect(f.events).not.toContain("jobs.updateMany");
    });
    it("keeps unexpected internal errors visible and rolls back", async () => {
        const f = ready(), error = new Error("internal failure"), before = structuredClone(f.state);
        f.tx.eformsign_dispatch_intent.findUnique.mockRejectedValueOnce(error);
        await expect(f.repo.cancel(input)).rejects.toBe(error); expect(f.state).toEqual(before);
    });
    it("a fresh request starts a new generation without rewriting the cancelled row", async () => {
        const f = ready(); await f.repo.cancel(input);
        const old = structuredClone(f.state.jobs[0]);
        const next = { branchId: B, clientId: 2, jobType: "create_document" as const, source: "staff" as const,
            requestKey: "fresh-request", activeKey: "active", payload: { clientId: 2 }, payloadFingerprint: old.payloadFingerprint };
        expect(await f.repo.enqueue(next)).toMatchObject({ existing: false });
        expect(f.state.jobs[0]).toEqual(old);
        expect(f.state.authorities[0].generation).not.toBe(G);
        expect(await f.repo.enqueue({ ...next, requestKey: "request" })).toMatchObject({ existing: true, job: { id: J, progressStep: "cancelled" } });
        const after = structuredClone(f.state);
        expect(await f.repo.cancel(input)).toEqual({ kind: "already_cancelled" });
        expect(f.state).toEqual(after);
    });

});
