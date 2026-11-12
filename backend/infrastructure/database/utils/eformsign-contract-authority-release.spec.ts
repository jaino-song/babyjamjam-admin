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
