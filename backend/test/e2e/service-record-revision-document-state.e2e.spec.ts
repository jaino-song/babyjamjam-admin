import { randomUUID } from "node:crypto";
import { sha256CanonicalJson } from "application/services/eformsign-document-job.service";
import { PrismaClient } from "@prisma/client";
import { PrismaService } from "infrastructure/database/prisma.service";
import { ServiceRecordEditRepository } from "infrastructure/database/repositories/service-record-edit.repository";
import {
    assertApprovedServiceRecordConfirmDatabaseTarget,
    createApprovedServiceRecordConfirmClient,
    createServiceRecordConfirmFixture,
} from "./helpers/service-record-confirm.helper";

const describeE2E = process.env["SERVICE_RECORD_CONFIRM_E2E"] === "1" ? describe : describe.skip;

describeE2E("revision document state ownership and generation CAS (disposable PostgreSQL)", () => {
    let prisma: PrismaClient;
    let repository: ServiceRecordEditRepository;
    beforeAll(async () => {
        assertApprovedServiceRecordConfirmDatabaseTarget();
        prisma = createApprovedServiceRecordConfirmClient();
        await prisma.$connect();
        repository = new ServiceRecordEditRepository(prisma as unknown as PrismaService);
    });
    afterAll(async () => { await prisma?.$disconnect(); });

    async function operationFixture() {
        const fixture = await createServiceRecordConfirmFixture(prisma);
        const revision = await repository.appendRevision({
            branchId: fixture.branch.id, serviceRecordCaseId: fixture.record.id,
            actorUserId: fixture.actorUserId, payload: { synthetic: true },
            plannedSessions: [], provenance: { synthetic: true }, formVersionAtConfirm: 2,
        });
        const immutableInput = { synthetic: true, serviceStartDate: "2026-09-07",
            serviceEndDate: "2026-09-29", receivedDate: "2026-08-31", receivedAmount: "600000" };
        const input = {
            branchId: fixture.branch.id, clientId: fixture.client.id,
            serviceRecordCaseId: fixture.record.id, revisionId: revision.id,
            operation: "record_snapshot" as const, generation: randomUUID(), immutableInput,
            inputFingerprint: sha256CanonicalJson(immutableInput),
            status: "waiting_for_completion" as const, step: "waiting_for_completion",
        };
        return { fixture, revision, input };
    }

    it("appends a complete generation without rewriting the earlier immutable operation", async () => {
        const { input } = await operationFixture();
        const partial = await repository.createRevisionDocumentState(input);
        const completeInput = { ...input.immutableInput, complete: true };
        const complete = await repository.createRevisionDocumentState({ ...input,
            generation: randomUUID(), immutableInput: completeInput,
            inputFingerprint: sha256CanonicalJson(completeInput),
            status: "capability_unverified", step: "capability_unverified", documentVersion: 3,
        });
        expect(complete.id).not.toBe(partial.id);
        expect(complete.generation).not.toBe(partial.generation);
        const retained = await repository.findRevisionDocumentState(input.branchId, input.clientId, input.revisionId, partial.id);
        expect(retained?.immutableInput).toEqual(input.immutableInput);
        expect(retained?.inputFingerprint).toBe(input.inputFingerprint);
        expect(await prisma.service_record_revision_document_state.count({ where: { revisionId: input.revisionId } })).toBe(2);
    });

    it("allows only one transition for a shared generation and version", async () => {
        const { input } = await operationFixture();
        const state = await repository.createRevisionDocumentState(input);
        const transition = { branchId: input.branchId, clientId: input.clientId, stateId: state.id,
            expectedGeneration: state.generation, expectedVersion: state.version,
            status: "capability_unverified" as const, step: "capability_unverified" };
        const outcomes = await Promise.all([
            repository.advanceRevisionDocumentState(transition),
            repository.advanceRevisionDocumentState(transition),
        ]);
        expect(outcomes.filter(Boolean)).toHaveLength(1);
        const current = await repository.findRevisionDocumentState(input.branchId, input.clientId, input.revisionId, state.id);
        expect(current?.version).toBe(state.version + 1);
        expect(current?.immutableInput).toEqual(input.immutableInput);
        expect(await repository.advanceRevisionDocumentState({ ...transition,
            expectedVersion: current!.version, expectedGeneration: randomUUID() })).toBeNull();
    });

    it("hides operation state and history from a different branch or client", async () => {
        const { input } = await operationFixture();
        const other = await createServiceRecordConfirmFixture(prisma);
        const state = await repository.createRevisionDocumentState(input);
        expect(await repository.findRevisionDocumentState(other.branch.id, input.clientId, input.revisionId, state.id)).toBeNull();
        expect(await repository.findRevisionDocumentState(input.branchId, other.client.id, input.revisionId, state.id)).toBeNull();
        expect(await repository.listRevisionHistory(other.branch.id, input.clientId)).toBeNull();
        expect(await repository.advanceRevisionDocumentState({ branchId: other.branch.id,
            clientId: input.clientId, stateId: state.id, expectedGeneration: state.generation,
            expectedVersion: state.version, step: "completed", status: "completed" })).toBeNull();
        expect(await repository.findRevisionDocumentStateForBranch(input.branchId, input.revisionId, state.id))
            .toMatchObject({ id: state.id, clientId: input.clientId });
        expect(await repository.findRevisionDocumentStateForBranch(other.branch.id, input.revisionId, state.id)).toBeNull();
        expect(await repository.findRevisionDocumentStateForBranch(input.branchId, randomUUID(), state.id)).toBeNull();
        const retained = await repository.findRevisionDocumentState(input.branchId, input.clientId, input.revisionId, state.id);
        expect(retained?.version).toBe(state.version);
    });

    it("rejects a forged client owner at the database constraint boundary", async () => {
        const { input } = await operationFixture();
        const other = await createServiceRecordConfirmFixture(prisma);
        await expect(prisma.service_record_revision_document_state.create({ data: {
            ...input, clientId: other.client.id,
        } })).rejects.toMatchObject({ code: "P2003" });
        expect(await prisma.service_record_revision_document_state.count({ where: { revisionId: input.revisionId } })).toBe(0);
    });

    it("retries a failed operation once without allocating another generation", async () => {
        const { input } = await operationFixture();
        const state = await repository.createRevisionDocumentState({ ...input, status: "failed", step: "preflight_failed" });
        const request = { branchId: input.branchId, clientId: input.clientId, revisionId: input.revisionId,
            stateId: state.id, expectedGeneration: state.generation };
        const first = await repository.retryRevisionDocumentState(request);
        const replay = await repository.retryRevisionDocumentState(request);
        expect(first).toMatchObject({ id: state.id, generation: state.generation, status: "pending" });
        expect(replay).toEqual(first);
        expect(first?.immutableInput).toEqual(input.immutableInput);
        expect(await prisma.service_record_revision_document_state.count({ where: { revisionId: input.revisionId } })).toBe(1);
    });

    it.each(["unknown", "manual_review", "failed"] as const)("keeps a %s creating outcome blocked rather than resetting its mutation step", async (status) => {
        const { input } = await operationFixture();
        const state = await repository.createRevisionDocumentState({ ...input, status, step: "creating" });
        const jobsBefore = await prisma.eformsign_document_job.count({ where: { clientId: input.clientId } });
        const result = await repository.retryRevisionDocumentState({ branchId: input.branchId,
            clientId: input.clientId, revisionId: input.revisionId, stateId: state.id,
            expectedGeneration: state.generation });
        expect(result).toEqual(state);
        expect(await prisma.eformsign_document_job.count({ where: { clientId: input.clientId } })).toBe(jobsBefore);
    });

    it("rejects an input fingerprint mismatch without inserting state", async () => {
        const { input } = await operationFixture();
        await expect(repository.createRevisionDocumentState({ ...input, inputFingerprint: "0".repeat(64) }))
            .rejects.toThrow();
        expect(await prisma.service_record_revision_document_state.count({ where: { revisionId: input.revisionId } })).toBe(0);
    });

    it("persists one proof and rejects a different proof without changing state", async () => {
        const { input } = await operationFixture();
        const state = await repository.createRevisionDocumentState(input);
        const proof = { generation: state.generation, pdfHash: "a".repeat(64) };
        const saved = await repository.advanceRevisionDocumentState({ branchId: input.branchId,
            clientId: input.clientId, stateId: state.id, expectedGeneration: state.generation,
            expectedVersion: state.version, status: "processing", step: "proof_ready", outputProof: proof });
        expect(saved?.outputProof).toEqual(proof);
        await expect(repository.advanceRevisionDocumentState({ branchId: input.branchId,
            clientId: input.clientId, stateId: state.id, expectedGeneration: state.generation,
            expectedVersion: saved!.version, status: "processing", step: "proof_ready",
            outputProof: { ...proof, pdfHash: "b".repeat(64) } })).rejects.toThrow("immutable");
        expect(await repository.findRevisionDocumentState(input.branchId, input.clientId, input.revisionId, state.id)).toEqual(saved);
    });

    it("cannot replace the source identity during a mutable progress transition", async () => {
        const { input } = await operationFixture();
        const state = await repository.createRevisionDocumentState({ ...input,
            sourceDocumentId: "synthetic-original", templateId: "synthetic-template", templateVersion: "1" });
        await expect(repository.advanceRevisionDocumentState({ branchId: input.branchId,
            clientId: input.clientId, stateId: state.id, expectedGeneration: state.generation,
            expectedVersion: state.version, status: "processing", step: "preflight",
            sourceDocumentId: "synthetic-replacement" })).rejects.toThrow("immutable");
        expect(await repository.findRevisionDocumentState(input.branchId, input.clientId, input.revisionId, state.id)).toEqual(state);
    });

    it("returns safe history without immutable financial or document input", async () => {
        const { input } = await operationFixture();
        const state = await repository.createRevisionDocumentState(input);
        const history = await repository.listRevisionHistory(input.branchId, input.clientId);
        expect(history?.revisions.find((row) => row.id === input.revisionId)?.documents)
            .toEqual(expect.arrayContaining([expect.objectContaining({ id: state.id, generation: state.generation })]));
        const serialized = JSON.stringify(history);
        expect(serialized).not.toContain("immutableInput");
        expect(serialized).not.toContain("receivedAmount");
        expect(serialized).not.toContain("600000");
    });
});
