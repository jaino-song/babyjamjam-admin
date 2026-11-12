import { createHash } from "node:crypto";
import { SbEformsignDocumentJobRepository } from "../repositories/sb.eformsign-document-job.repository";
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
