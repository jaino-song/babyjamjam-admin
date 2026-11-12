import { ContractRecoveryError } from "domain/repositories/eformsign-contract-recovery.repository.interface";
import { SbEformsignDocumentJobRepository } from "infrastructure/database/repositories/sb.eformsign-document-job.repository";
import { runtimeFixture, B, J, G, I, F, data, worker, principal, intentInput, workflowPlan } from "../utils/eformsign-contract-recovery.fixture";

describe("manual recovery connected service with real authority adapter", () => {
    it("saves exactly one verified draft, persists exposure before editable, and returns only public IDs", async () => {
        const f = runtimeFixture(); f.manual();
        const result = await f.service.open(J, principal);
        expect(result).toEqual({ kind: "editable", jobId: J, claimEpoch: "1", claimExpiresAt: expect.any(String), document: { companyId: "company-abc", templateId: "template_ABC", documentId: "bound-doc" } });
        expect(f.draft.dispatchDraft).toHaveBeenCalledTimes(1); expect(f.provider.getDocument).toHaveBeenCalledWith("PRIVATE_ACCESS", "bound-doc");
        expect(f.state.authorities[0]).toMatchObject({ phase: "human_exposed", providerDocumentId: "bound-doc", humanIntentId: expect.any(String) });
        expect(f.state.jobs[0].status).toBe("failed"); expect(f.state.clients[0].eDocId).toBe("prior-doc"); expect(f.state.docs.find((row: any) => row.documentId === "bound-doc").clientId).toBeNull();
        expect(f.events.indexOf("intents.create")).toBeLessThan(f.events.indexOf("draft.beforeOpen"));
        expect(JSON.stringify(result)).not.toMatch(/PRIVATE_|contractData|generation|leaseToken|creatorId/);
    });
    it.each(["started", "uncertain", "prepared", "no-reference"])("does not create a draft from %s or a failed error label", async status => {
        const f = runtimeFixture(); f.manual(); f.state.intents[0].status = status;
        if (status === "no-reference") Object.assign(f.state.authorities[0], { creationIntentId: null, phase: "creation_pending" });
        await expect(f.service.open(J, principal)).rejects.toBeInstanceOf(ContractRecoveryError); expect(f.draft.dispatchDraft).not.toHaveBeenCalled();
        expect(f.state.clients[0].eDocId).toBe("prior-doc");
    });
    it("reopening an exposed draft, including after expiry by another user, is editable with no second SDK", async () => {
        const f = runtimeFixture(); f.manual(); await f.service.open(J, principal);
        const id = f.state.authorities[0].humanIntentId;
        const humanIntent = () => f.state.intents.find((row: { id: string }) => row.id === f.state.authorities[0].humanIntentId);
        expect(humanIntent()).toMatchObject({ id, attemptCount: 1 });
        const second = await f.service.open(J, principal); expect(second).toMatchObject({ kind: "editable", document: { documentId: "bound-doc" } });
        expect(humanIntent()).toMatchObject({ id, attemptCount: 2 });
        f.state.authorities[0].claimExpiresAt = new Date(Date.now() - 1);
        const third = await f.service.open(J, { ...principal, userId: I }); expect(third).toMatchObject({ kind: "editable", document: { documentId: "bound-doc" } });
        expect(humanIntent()).toMatchObject({ id, attemptCount: 3 });
        expect(f.state.intents.filter((row: { action: string }) => row.action === "manual_process")).toHaveLength(1);
        expect(f.draft.dispatchDraft).toHaveBeenCalledTimes(1);
    });
    it("rejects a reopen when the claim epoch advances during the provider read", async () => {
        const f = runtimeFixture(); f.manual(); await f.service.open(J, principal);
        const before = structuredClone(f.state.intents);
        const epoch = f.state.authorities[0].claimEpoch;
        f.provider.getDocument.mockImplementationOnce(async () => {
            await f.repository.open(J, principal.branchId, principal.userId);
            return structuredClone(f.remote);
        });
        await expect(f.service.open(J, principal)).rejects.toMatchObject({ code: "RECOVERY_STALE" });
        expect(f.state.authorities[0].claimEpoch).toBe(epoch + 2n);
        expect(f.state.intents).toEqual(before);
        expect(f.draft.dispatchDraft).toHaveBeenCalledTimes(1);
    });
    it.each(["participant", "reviewer", "complete"])("reopening sent %s evidence completes and returns verify-only", async step => {
        const f = runtimeFixture(); f.manual(); await f.service.open(J, principal);
        const id = f.state.authorities[0].humanIntentId;
        if (step === "participant") f.forward();
        if (step === "reviewer") Object.assign(f.remote.current_status, { status_type: "070", step_type: "06", step_index: "3", step_group: 2 });
        if (step === "complete") Object.assign(f.remote.current_status, { status_type: "003", step_type: "01", step_index: "4", step_group: 3 });
        const bind = jest.spyOn(f.repository, "bindDocument"), expose = jest.spyOn(f.repository, "expose"), reexpose = jest.spyOn(f.repository, "reexposeHuman");
        await expect(f.service.open(J, principal)).resolves.toMatchObject({ kind: "verify_only" });
        expect(f.state.jobs[0].status).toBe("completed"); expect(f.state.authorities[0]).toMatchObject({ phase: "closed", humanIntentId: id });
        expect(bind).not.toHaveBeenCalled(); expect(expose).not.toHaveBeenCalled(); expect(reexpose).not.toHaveBeenCalled();
        expect(f.draft.dispatchDraft).toHaveBeenCalledTimes(1); expect(f.state.intents).toHaveLength(3);
        f.provider.getDocument.mockClear(); f.provider.getTemplateWorkflowConfig.mockClear(); f.credentials.withCredentials.mockClear();
        await expect(f.service.verify(J, principal, f.state.authorities[0].claimEpoch)).resolves.toMatchObject({ kind: "verified" });
        await expect(f.service.open(J, principal)).resolves.toMatchObject({ kind: "verify_only" });
        expect(f.draft.dispatchDraft).toHaveBeenCalledTimes(1);
        expect(f.provider.getDocument).not.toHaveBeenCalled(); expect(f.provider.getTemplateWorkflowConfig).not.toHaveBeenCalled(); expect(f.credentials.withCredentials).not.toHaveBeenCalled();
    });
    it.each(["unknown", "expired", "id", "template", "creator", "other-step", "missing-id", "read", "workflow-read"])("reopening refuses untrusted %s without bind/expose/complete", async defect => {
        const f = runtimeFixture(); f.manual(); await f.service.open(J, principal);
        const before = structuredClone(f.state.authorities[0]);
        const bind = jest.spyOn(f.repository, "bindDocument"), expose = jest.spyOn(f.repository, "expose"), reexpose = jest.spyOn(f.repository, "reexposeHuman"), complete = jest.spyOn(f.repository, "completeManual");
        if (defect === "unknown") f.remote.current_status.status_type = "002";
        if (defect === "expired") f.remote.current_status._expired = true;
        if (defect === "id") f.remote.id = "another";
        if (defect === "template") f.remote.template.id = "another";
        if (defect === "creator") f.remote.creator.id = "another";
        if (defect === "other-step") f.remote.current_status.step_type = "05";
        if (defect === "missing-id") f.state.authorities[0].providerDocumentId = null;
        if (defect === "read") f.provider.getDocument.mockRejectedValue(new Error("provider offline"));
        if (defect === "workflow-read") f.provider.getTemplateWorkflowConfig.mockRejectedValue(new Error("provider offline"));
        await expect(f.service.open(J, principal)).rejects.toMatchObject({ code: ["read", "workflow-read"].includes(defect) ? "RECOVERY_UNAVAILABLE" : "PROVIDER_STATE_UNAVAILABLE", status: 503 });
        expect(bind).not.toHaveBeenCalled(); expect(expose).not.toHaveBeenCalled(); expect(reexpose).not.toHaveBeenCalled(); expect(complete).not.toHaveBeenCalled();
        expect(f.state.authorities[0].claimEpoch).toBe(before.claimEpoch + 1n); expect(f.state.authorities[0].phase).toBe("human_exposed");
        expect(f.state.jobs[0].status).toBe("failed"); expect(f.draft.dispatchDraft).toHaveBeenCalledTimes(1); expect(f.state.intents).toHaveLength(3);
    });
    it("another user's live exposed claim conflicts before any provider read", async () => {
        const f = runtimeFixture(); f.manual(); await f.service.open(J, principal);
        f.provider.getDocument.mockClear(); f.provider.getTemplateWorkflowConfig.mockClear();
        await expect(f.service.open(J, { ...principal, userId: I })).rejects.toMatchObject({ code: "MANUAL_RECOVERY_CLAIMED", status: 409 });
        expect(f.provider.getDocument).not.toHaveBeenCalled(); expect(f.provider.getTemplateWorkflowConfig).not.toHaveBeenCalled(); expect(f.draft.dispatchDraft).toHaveBeenCalledTimes(1);
    });
    it("a live other claimant conflicts before credentials or SDK calls", async () => {
        const f = runtimeFixture(); f.manual(); Object.assign(f.state.authorities[0], { claimUserId: I, claimEpoch: 42n, claimExpiresAt: new Date(Date.now() + 60000) });
        await expect(f.service.open(J, principal)).rejects.toMatchObject({ code: "MANUAL_RECOVERY_CLAIMED" });
        expect(f.credentials.withCredentials).not.toHaveBeenCalled(); expect(f.events).toEqual([]); expect(f.snapshots.bumpVersion).not.toHaveBeenCalled();
    });
    it.each(["id", "template", "creator", "unknown-state", "missing-date"])("refuses mismatched or missing provider %s without exposure or completion", async field => {
        const f = runtimeFixture(); f.manual();
        if (field === "id") f.remote.id = "caller-document";
        if (field === "template") f.remote.template.id = "other";
        if (field === "creator") f.remote.creator.id = "other@example.test";
        if (field === "unknown-state") f.remote.current_status.status_type = "002";
        if (field === "missing-date") delete f.remote.created_date;
        await expect(f.service.open(J, principal)).rejects.toBeInstanceOf(ContractRecoveryError);
        expect(f.state.authorities[0].humanIntentId).toBeNull(); expect(f.state.clients[0].eDocId).toBe("prior-doc"); expect(f.state.jobs[0].status).toBe("failed");
    });
    it("an unavailable advertised draft action remains uncertain and is never resent", async () => {
        const f = runtimeFixture(); f.manual(); f.draft.dispatchDraft.mockResolvedValue({ ok: false, reason: "unsupported-action", uncertain: true, durationMs: 0 });
        await expect(f.service.open(J, principal)).rejects.toMatchObject({ reason: "draft_unavailable" });
        await expect(f.service.open(J, principal)).rejects.toBeInstanceOf(ContractRecoveryError);
        expect(f.draft.dispatchDraft).toHaveBeenCalledTimes(1); expect(f.state.authorities[0].phase).toBe("creation_uncertain");
        expect(f.state.intents[1].status).toBe("uncertain");
    });
    it("a lost exact GET retains the callback ID in the intent and only retries that GET", async () => {
        const f = runtimeFixture(); f.manual(); f.provider.getDocument.mockRejectedValueOnce(new Error("PRIVATE_PROVIDER_DETAIL"));
        await expect(f.service.open(J, principal)).rejects.toMatchObject({ code: "RECOVERY_UNAVAILABLE" });
        expect(f.state.intents[1]).toMatchObject({ status: "accepted", providerDocumentId: "bound-doc" });
        await expect(f.service.open(J, principal)).resolves.toMatchObject({ kind: "editable" });
        expect(f.draft.dispatchDraft).toHaveBeenCalledTimes(1); expect(f.provider.getDocument).toHaveBeenCalledTimes(2);
    });
    it("callback verification is pending for a draft, then only exact confirmed forward state completes atomically", async () => {
        const f = runtimeFixture(); f.manual(); const opened = await f.service.open(J, principal);
        expect(await f.service.verify(J, principal, BigInt(opened.claimEpoch))).toMatchObject({ kind: "pending" });
        expect(f.state.clients[0].eDocId).toBe("prior-doc"); expect(f.state.jobs[0].status).toBe("failed");
        f.forward(); await expect(f.service.verify(J, principal, BigInt(opened.claimEpoch))).resolves.toMatchObject({ kind: "verified" });
        expect(f.state.clients[0].eDocId).toBe("bound-doc"); expect(f.state.jobs[0].status).toBe("completed"); expect(f.state.jobs[0].payload).toBeNull();
        expect(f.state.authorities[0].phase).toBe("closed"); expect(f.state.docs.find((row: any) => row.documentId === "bound-doc").clientId).toBe(2);
        await expect(f.service.verify(J, principal, BigInt(opened.claimEpoch))).resolves.toMatchObject({ kind: "verified" });
        await expect(f.service.open(J, principal)).resolves.toMatchObject({ kind: "verify_only" });
        await expect(new SbEformsignDocumentJobRepository(f.prisma).enqueue({ branchId: B, clientId: 2, jobType: "create_document", source: "staff", requestKey: "next", activeKey: "next", payload: { clientId: 2, contractData: data }, payloadFingerprint: F })).resolves.toMatchObject({ existing: false });
    });
    it("completed closed reopen renews a fenced claim without credentials, provider context or another draft", async () => {
        const f = runtimeFixture(); f.manual(); const opened = await f.service.open(J, principal); f.forward();
        await f.service.verify(J, principal, BigInt(opened.claimEpoch));
        const before = structuredClone({ jobs: f.state.jobs, docs: f.state.docs, intents: f.state.intents, clients: f.state.clients });
        f.credentials.withCredentials.mockClear(); f.credentials.withCredentials.mockRejectedValue(new Error("credentials unavailable"));
        f.provider.getDocument.mockClear(); f.provider.getTemplateWorkflowConfig.mockClear(); f.options.generateDocumentOptions.mockClear(); f.draft.dispatchDraft.mockClear();
        const reopened = await f.service.open(J, principal);
        expect(reopened).toEqual({ kind: "verify_only", jobId: J, claimEpoch: "2", claimExpiresAt: expect.any(String) });
        await expect(f.service.verify(J, principal, BigInt(opened.claimEpoch))).rejects.toMatchObject({ code: "RECOVERY_STALE" });
        await expect(f.service.verify(J, principal, BigInt(reopened.claimEpoch))).resolves.toMatchObject({ kind: "verified" });
        await expect(f.service.open(J, { ...principal, userId: I })).rejects.toMatchObject({ code: "MANUAL_RECOVERY_CLAIMED" });
        f.state.authorities[0].claimExpiresAt = new Date(Date.now() - 1);
        await expect(f.service.verify(J, principal, BigInt(reopened.claimEpoch))).rejects.toMatchObject({ code: "RECOVERY_STALE" });
        await expect(f.service.open(J, { ...principal, userId: I })).resolves.toMatchObject({ kind: "verify_only", claimEpoch: "3" });
        expect(f.state.authorities[0]).toMatchObject({ phase: "closed", claimUserId: I, claimEpoch: 3n });
        expect({ jobs: f.state.jobs, docs: f.state.docs, intents: f.state.intents, clients: f.state.clients }).toEqual(before);
        expect(f.credentials.withCredentials).not.toHaveBeenCalled(); expect(f.provider.getDocument).not.toHaveBeenCalled();
        expect(f.provider.getTemplateWorkflowConfig).not.toHaveBeenCalled(); expect(f.options.generateDocumentOptions).not.toHaveBeenCalled(); expect(f.draft.dispatchDraft).not.toHaveBeenCalled();
    });
    it.each(["failed", "requires_attention", "processing", "blocked", "missing-document", "job-document", "pointer", "generation", "fingerprint", "job", "branch", "cas"])("completed reopen refuses %s without provider effects or claim writes", async defect => {
        const f = runtimeFixture(); f.manual(); const opened = await f.service.open(J, principal); f.forward();
        await f.service.verify(J, principal, BigInt(opened.claimEpoch));
        if (["failed", "requires_attention", "processing"].includes(defect)) f.state.jobs[0].status = defect;
        if (defect === "blocked") f.state.authorities[0].phase = "blocked";
        if (defect === "missing-document") f.state.authorities[0].providerDocumentId = null;
        if (defect === "job-document") f.state.jobs[0].documentId = "another";
        if (defect === "pointer") f.state.clients[0].eDocId = "prior-doc";
        if (defect === "generation") f.state.jobs[0].contractGeneration = I;
        if (defect === "fingerprint") f.state.jobs[0].payloadFingerprint = "wrong";
        if (defect === "job") f.state.authorities[0].creationJobId = I;
        if (defect === "branch") f.state.clients[0].branchId = I;
        if (defect === "cas") f.flags.casZero = true;
        const before = structuredClone(f.state);
        f.credentials.withCredentials.mockClear(); f.provider.getDocument.mockClear(); f.provider.getTemplateWorkflowConfig.mockClear(); f.draft.dispatchDraft.mockClear();
        await expect(f.service.open(J, principal)).rejects.toBeInstanceOf(ContractRecoveryError);
        expect(f.state).toEqual(before); expect(f.credentials.withCredentials).not.toHaveBeenCalled(); expect(f.provider.getDocument).not.toHaveBeenCalled();
        expect(f.provider.getTemplateWorkflowConfig).not.toHaveBeenCalled(); expect(f.draft.dispatchDraft).not.toHaveBeenCalled();
    });
    it("new enqueue fences completed generation reopen and verify before provider access", async () => {
        const f = runtimeFixture(); f.manual(); const opened = await f.service.open(J, principal); f.forward();
        await f.service.verify(J, principal, BigInt(opened.claimEpoch));
        const next = await new SbEformsignDocumentJobRepository(f.prisma).enqueue({ branchId: B, clientId: 2, jobType: "create_document", source: "staff", requestKey: "next", activeKey: "next", payload: { clientId: 2, contractData: data }, payloadFingerprint: F });
        expect(next.job.contractGeneration).not.toBe(G);
        const before = structuredClone(f.state);
        f.credentials.withCredentials.mockClear(); f.provider.getDocument.mockClear(); f.provider.getTemplateWorkflowConfig.mockClear(); f.draft.dispatchDraft.mockClear();
        await expect(f.service.open(J, principal)).rejects.toMatchObject({ code: "RECOVERY_STALE" });
        await expect(f.service.verify(J, principal, BigInt(opened.claimEpoch))).rejects.toMatchObject({ code: "RECOVERY_STALE" });
        expect(f.state).toEqual(before); expect(f.credentials.withCredentials).not.toHaveBeenCalled(); expect(f.provider.getDocument).not.toHaveBeenCalled();
        expect(f.provider.getTemplateWorkflowConfig).not.toHaveBeenCalled(); expect(f.draft.dispatchDraft).not.toHaveBeenCalled();
    });
    it.each(["generation", "epoch", "user", "branch", "expiry", "pointer"])("wrong %s causes zero verify writes", async field => {
        const f = runtimeFixture(); f.manual(); await f.service.open(J, principal); f.forward(); f.events.length = 0;
        let actor = principal, epoch = 1n;
        if (field === "generation") f.state.jobs[0].contractGeneration = I;
        if (field === "epoch") epoch = 2n;
        if (field === "user") actor = { ...principal, userId: I };
        if (field === "branch") actor = { ...principal, branchId: I };
        if (field === "expiry") f.state.authorities[0].claimExpiresAt = new Date(Date.now() - 1);
        if (field === "pointer") f.state.clients[0].eDocId = "other";
        await expect(f.service.verify(J, actor, epoch)).rejects.toBeInstanceOf(ContractRecoveryError); expect(f.events).toEqual([]);
    });
    it.each(["authority-cas", "job-cas", "tombstone"])("%s prevents partial completion", async defect => {
        const f = runtimeFixture(); f.manual(); await f.service.open(J, principal); f.forward();
        if (defect === "authority-cas") f.flags.casZero = true;
        if (defect === "job-cas") f.flags.jobZero = true;
        if (defect === "tombstone") f.state.docs.find((row: any) => row.documentId === "bound-doc").permanentPurgeRequestedAt = new Date();
        await expect(f.service.verify(J, principal, 1n)).rejects.toBeInstanceOf(ContractRecoveryError);
        expect(f.state.clients[0].eDocId).toBe("prior-doc"); expect(f.state.jobs[0].status).toBe("failed"); expect(f.state.authorities[0].phase).toBe("human_exposed"); expect(f.snapshots.bumpVersion).not.toHaveBeenCalled();
    });
    it("settled automatic success closes only its unexposed generation and permits the next one", async () => {
        const f = runtimeFixture(); await f.repository.claimCreation(intentInput, worker, { contractData: data, workflow: workflowPlan });
        Object.assign(f.state.intents[0], { status: "accepted", providerDocumentId: "bound-doc" }); f.forward();
        await f.service.completeAutomatic(worker, "bound-doc", { branchId: B, source: "worker" });
        expect(f.state.authorities[0].phase).toBe("closed"); expect(f.state.clients[0].eDocId).toBe("bound-doc");
        const next = await new SbEformsignDocumentJobRepository(f.prisma).enqueue({ branchId: B, clientId: 2, jobType: "create_document", source: "staff", requestKey: "next", activeKey: "next", payload: { clientId: 2, contractData: data }, payloadFingerprint: F });
        expect(next.job.contractGeneration).not.toBe(G); expect(f.state.jobs[0].contractGeneration).toBe(G);
    });
    it("a known uncertain automatic ID permits exact verification only, never another editable frame", async () => {
        const f = runtimeFixture(); f.manual(); Object.assign(f.state.intents[0], { status: "uncertain", providerDocumentId: "bound-doc" });
        const opened = await f.service.open(J, principal); expect(opened.kind).toBe("verify_only"); expect(opened).not.toHaveProperty("document");
        expect(f.draft.dispatchDraft).not.toHaveBeenCalled(); expect(f.state.authorities[0].phase).toBe("creation_uncertain");
        expect(await f.service.verify(J, principal, BigInt(opened.claimEpoch))).toMatchObject({ kind: "pending" });
        f.forward(); expect(await f.service.verify(J, principal, BigInt(opened.claimEpoch))).toMatchObject({ kind: "verified" });
        expect(f.state.authorities[0].phase).toBe("closed");
    });
    it("a draft callback that is already forwarded cannot be adopted as an initial draft", async () => {
        const f = runtimeFixture(); f.manual(); f.forward();
        await expect(f.service.open(J, principal)).rejects.toMatchObject({ reason: "document_mismatch" });
        expect(f.state.authorities[0].providerDocumentId).toBeNull(); expect(f.state.clients[0].eDocId).toBe("prior-doc");
    });
    it("legacy NULL and expired payloads never acquire an editable session", async () => {
        const f = runtimeFixture(); f.manual(); f.state.jobs[0].contractGeneration = null;
        await expect(f.service.open(J, principal)).rejects.toMatchObject({ reason: "legacy_unbound" });
        f.state.jobs[0].contractGeneration = G; f.state.jobs[0].completedAt = new Date(Date.now() - 8 * 86400000);
        await expect(f.service.open(J, principal)).rejects.toMatchObject({ code: "RECOVERY_PAYLOAD_EXPIRED" }); expect(f.draft.dispatchDraft).not.toHaveBeenCalled();
    });
});

import { DispatchDocumentHeadlessUsecase } from "application/usecases/eformsign-doc/dispatch-document-headless.usecase";
import { EformsignDispatchBoundaryService } from "application/services/eformsign-dispatch-boundary.service";
import { EformsignDocumentJobWorkerService } from "application/services/eformsign-document-job-worker.service";
import { ContractClientAssignmentGuardService } from "application/services/contract-client-assignment-guard.service";
import { SbEformsignDispatchIntentRepository } from "infrastructure/database/repositories/sb.eformsign-dispatch-intent.repository";
function connectedWorker(f: ReturnType<typeof runtimeFixture>, result: any) {
    const sdk = { dispatchCreation: jest.fn().mockResolvedValue(result) }, generic = { execute: jest.fn() }, search = { execute: jest.fn() };
    const boundary = new EformsignDispatchBoundaryService(new SbEformsignDispatchIntentRepository(f.prisma), f.repository);
    const usecase = new DispatchDocumentHeadlessUsecase(f.options, sdk as never, { findByArea: jest.fn().mockResolvedValue(null) } as never, f.credentials,
        generic as never, { execute: jest.fn() } as never, { emit: jest.fn() } as never, { findById: jest.fn().mockResolvedValue(f.state.clients[0]) } as never,
        new ContractClientAssignmentGuardService(f.prisma), { findByClientId: jest.fn(async () => f.state.docs) } as never, search as never, f.provider, undefined, boundary);
    const oldReconciliation = { reconcile: jest.fn() };
    const service: any = Object.assign(Object.create(EformsignDocumentJobWorkerService.prototype), { dispatchUsecase: usecase,
        repository: new SbEformsignDocumentJobRepository(f.prisma), manualRecovery: f.service, contractRecovery: f.repository,
        reconciliationService: oldReconciliation, supersedeAfterReissue: jest.fn(), notifyTransition: jest.fn(), recordProgress: jest.fn() });
    return { usecase, service, sdk, generic, search, oldReconciliation };
}
describe("new-generation worker connection", () => {
    it("passes the fourth DB context and completes client/mirror/job/authority atomically without generic persistence", async () => {
        const f = runtimeFixture(); f.forward(); const connected = connectedWorker(f, { ok: true, documentId: "bound-doc", durationMs: 1 });
        const execute = jest.spyOn(connected.usecase, "execute");
        await connected.service.processCreation({ ...f.state.jobs[0] }, {});
        expect(execute.mock.calls[0]![3]).toEqual(worker); expect(connected.sdk.dispatchCreation).toHaveBeenCalledTimes(1);
        expect(connected.generic.execute).not.toHaveBeenCalled(); expect(connected.search.execute).not.toHaveBeenCalled();
        expect(f.state.jobs[0].status).toBe("completed"); expect(f.state.clients[0].eDocId).toBe("bound-doc"); expect(f.state.authorities[0].phase).toBe("closed");
    });
    it("unknown ambiguous creation never searches/adopts/retries and leaves authority held", async () => {
        const f = runtimeFixture(), connected = connectedWorker(f, { ok: false, reason: "timeout", durationMs: 1 });
        await connected.service.processCreation({ ...f.state.jobs[0] }, {});
        expect(connected.sdk.dispatchCreation).toHaveBeenCalledTimes(1); expect(connected.search.execute).not.toHaveBeenCalled();
        expect(connected.oldReconciliation.reconcile).not.toHaveBeenCalled(); expect(connected.generic.execute).not.toHaveBeenCalled();
        expect(f.state.jobs[0].status).toBe("requires_attention"); expect(f.state.authorities[0].phase).toBe("creation_uncertain"); expect(f.state.clients[0].eDocId).toBe("prior-doc");
    });
    it("an exact accepted receipt replays only GET/atomic completion, with zero second SDK calls", async () => {
        const f = runtimeFixture(); await f.repository.claimCreation(intentInput, worker, { contractData: data, workflow: workflowPlan }); f.forward();
        Object.assign(f.state.intents[0], { status: "accepted", providerDocumentId: "bound-doc" });
        const connected = connectedWorker(f, { ok: true, documentId: "not-used", durationMs: 1 });
        await connected.service.processCreation({ ...f.state.jobs[0] }, {});
        expect(connected.sdk.dispatchCreation).not.toHaveBeenCalled(); expect(connected.oldReconciliation.reconcile).not.toHaveBeenCalled();
        expect(f.provider.getDocument).toHaveBeenCalledWith("PRIVATE_ACCESS", "bound-doc"); expect(f.state.jobs[0].status).toBe("completed");
    });
    it("the160second response budget marks a started draft uncertain and does not issue another SDK", async () => {
        jest.useFakeTimers();
        try {
            const f = runtimeFixture(); f.manual(); f.draft.dispatchDraft.mockImplementation(async (params: { beforeOpen: () => Promise<boolean> }) => { await params.beforeOpen(); return new Promise(() => undefined); });
            const refusal = expect(f.service.open(J, principal)).rejects.toMatchObject({ code: "RECOVERY_UNAVAILABLE" });
            await jest.advanceTimersByTimeAsync(160000); await refusal;
            expect(f.state.intents[1].status).toBe("uncertain"); expect(f.state.authorities[0].phase).toBe("creation_uncertain");
            await expect(f.service.open(J, principal)).rejects.toBeInstanceOf(ContractRecoveryError); expect(f.draft.dispatchDraft).toHaveBeenCalledTimes(1);
        } finally { jest.useRealTimers(); }
    });
});
import { EformsignOperationLockUnavailableError } from "infrastructure/locking/eformsign-operation-lock.service";
it("a durable reserved/no-intent pre-effect failure retries, then exhausted failure remains manually recoverable", async () => {
    const f = runtimeFixture(), connected = connectedWorker(f, { ok: true, documentId: "unused", durationMs: 1 });
    (connected.usecase as any).operationLock = { runExclusive: jest.fn().mockRejectedValue(new EformsignOperationLockUnavailableError("offline")) };
    f.state.jobs[0].attempts = 1; await connected.service.processCreation({ ...f.state.jobs[0] }, {});
    expect(connected.sdk.dispatchCreation).not.toHaveBeenCalled(); expect(f.state.jobs[0].status).toBe("queued"); expect(f.state.authorities[0]).toMatchObject({ phase: "reserved", creationIntentId: null });
    Object.assign(f.state.jobs[0], { status: "processing", leaseToken: worker.leaseToken, attempts: 4 }); await connected.service.processCreation({ ...f.state.jobs[0] }, {});
    expect(f.state.jobs[0].status).toBe("failed"); expect(f.state.authorities[0].phase).toBe("reserved");
    await expect(f.service.open(J, principal)).resolves.toMatchObject({ kind: "editable" }); expect(f.events.filter(event => event === "draft.sdk")).toHaveLength(1);
});
it.each(["terminated", "missing", "changed", "beforeOpen"])("manual draft enforces current assignment: %s", async defect => {
    const f = runtimeFixture(); f.manual();
    if (defect === "terminated") f.state.clients[0].serviceStatus = "terminated";
    if (defect === "missing") f.tx.employee_schedule.findFirst.mockResolvedValue(null);
    if (defect === "changed") f.tx.employee_schedule.findFirst.mockResolvedValue({ id: 9, terminatedAt: null, primaryEmployee: { phone: "01011112222" } });
    if (defect === "beforeOpen") f.draft.dispatchDraft.mockImplementation(async (params: { beforeOpen: () => Promise<boolean> }) => { f.state.clients[0].serviceStatus = "terminated"; expect(await params.beforeOpen()).toBe(false); return { ok: false, uncertain: false, reason: "open-denied" }; });
    await expect(f.service.open(J, principal)).rejects.toBeInstanceOf(ContractRecoveryError); expect(f.events).not.toContain("draft.sdk"); expect(f.state.authorities[0].humanIntentId).toBeNull();
    if (defect === "beforeOpen") {
        expect(f.state.authorities[0].phase).toBe("reserved"); expect(f.state.intents[1].status).toBe("prepared"); f.state.clients[0].serviceStatus = "active";
        f.draft.dispatchDraft.mockImplementation(async (params: { beforeOpen: () => Promise<boolean> }) => { expect(await params.beforeOpen()).toBe(true); return { ok: true, candidateDocumentId: "bound-doc", durationMs: 0 }; });
        await expect(f.service.open(J, principal)).resolves.toMatchObject({ kind: "editable" }); expect(f.state.intents[1].attemptCount).toBe(2);
    }
    else expect(f.draft.dispatchDraft).not.toHaveBeenCalled();
});
it("atomic verification preserves saved customer and trusted GET projection", async () => {
    const f = runtimeFixture(); f.manual(); f.remote.document_name = "Trusted title"; f.remote.template.name = "Template name"; f.remote.document_number = "DOCUMENT-1";
    f.remote.creator.name = "Service creator"; f.remote.last_editor = { name: "Last editor" }; f.remote.current_status.step_recipients = [{ recipient_type: "01" }, { recipient_type: "02" }];
    const opened = await f.service.open(J, principal); f.forward(); await f.service.verify(J, principal, BigInt(opened.claimEpoch));
    expect(f.snapshots.bumpVersion).toHaveBeenCalledTimes(1); expect(f.snapshots.bumpVersion).toHaveBeenCalledWith(B);
    expect(f.state.docs.find((row: { documentId: string }) => row.documentId === "bound-doc")).toMatchObject({ documentName: "Trusted title", documentNumber: "DOCUMENT-1", templateName: "Template name", creatorName: "Service creator", lastEditorName: "Last editor", stepRecipientTypes: "01,02", createdDate: new Date(f.remote.created_date), updatedDate: new Date(f.remote.updated_date), customerName: data.customerName, statusType: "060", statusDetail: "060", stepRecipientName: data.customerName, stepRecipientSms: data.customerContact, documentKind: "contract" });
});
it("snapshot failure cannot undo committed verification or issue another SDK", async () => {
    const f = runtimeFixture(); f.manual(); const opened = await f.service.open(J, principal); f.forward(); f.snapshots.bumpVersion.mockRejectedValue(new Error("PRIVATE_CACHE"));
    await expect(f.service.verify(J, principal, BigInt(opened.claimEpoch))).resolves.toMatchObject({ kind: "verified" });
    expect(f.state.jobs[0].status).toBe("completed"); expect(f.state.clients[0].eDocId).toBe("bound-doc"); expect(f.draft.dispatchDraft).toHaveBeenCalledTimes(1);
});
it("a stale lease cannot transition a no-effect generation", async () => {
    const f = runtimeFixture(); f.state.jobs[0].leaseToken = I;
    await expect(f.repository.recoverBeforeCreation(worker, new Date(), "failure")).rejects.toBeInstanceOf(ContractRecoveryError); expect(f.events).toEqual([]);
});
it.each(["started", "uncertain"])("reserved own-ref absence cannot override a legacy %s contract effect", async status => {
    const f = runtimeFixture(); f.state.jobs[0].status = "failed"; f.state.jobs[0].leaseToken = null; f.state.intents[0].status = status;
    await expect(f.service.open(J, principal)).rejects.toMatchObject({ reason: "unverified_creation" }); expect(f.draft.dispatchDraft).not.toHaveBeenCalled();
});
