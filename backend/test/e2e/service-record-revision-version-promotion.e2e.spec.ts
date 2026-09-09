import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { sha256CanonicalJson } from "application/services/eformsign-document-job.service";
import { PrismaService } from "infrastructure/database/prisma.service";
import { ServiceRecordEditRepository } from "infrastructure/database/repositories/service-record-edit.repository";
import {
    assertApprovedServiceRecordConfirmDatabaseTarget,
    createApprovedServiceRecordConfirmClient,
    createServiceRecordConfirmFixture,
} from "./helpers/service-record-confirm.helper";

const describeE2E = process.env["SERVICE_RECORD_CONFIRM_E2E"] === "1" ? describe : describe.skip;

describeE2E("revision document version allocation and all-chunk promotion (disposable PostgreSQL)", () => {
    let prisma: PrismaClient;
    let repository: ServiceRecordEditRepository;
    beforeAll(async () => {
        assertApprovedServiceRecordConfirmDatabaseTarget();
        prisma = createApprovedServiceRecordConfirmClient();
        await prisma.$connect();
        repository = new ServiceRecordEditRepository(prisma as unknown as PrismaService);
    });
    afterAll(async () => { await prisma?.$disconnect(); });

    async function fixtureWithRevision() {
        const fixture = await createServiceRecordConfirmFixture(prisma);
        const revision = await repository.appendRevision({ branchId: fixture.branch.id,
            serviceRecordCaseId: fixture.record.id, actorUserId: fixture.actorUserId,
            payload: { synthetic: true }, plannedSessions: [], provenance: { synthetic: true }, formVersionAtConfirm: 2 });
        await prisma.service_record_case.update({ where: { id: fixture.record.id }, data: {
            currentRevisionId: revision.id, status: "COMPLETED", formVersion: 2,
        } });
        const immutableInput = { synthetic: true, revisionId: revision.id };
        const state = await repository.createRevisionDocumentState({ branchId: fixture.branch.id,
            clientId: fixture.client.id, serviceRecordCaseId: fixture.record.id, revisionId: revision.id,
            operation: "record_snapshot", generation: randomUUID(), immutableInput,
            inputFingerprint: sha256CanonicalJson(immutableInput), status: "processing", step: "preparing" });
        const scope = { branchId: fixture.branch.id, clientId: fixture.client.id,
            serviceRecordCaseId: fixture.record.id, revisionId: revision.id,
            documentStateId: state.id, generation: state.generation };
        return { fixture, revision, state, scope };
    }

    async function document(
        data: Awaited<ReturnType<typeof fixtureWithRevision>>, version: number, index: number,
        revisionId: string | null, statusType = "003",
    ) {
        return prisma.eformsign_doc.create({ data: {
            documentId: `synthetic-record:${randomUUID()}`, branchId: data.scope.branchId,
            clientId: data.scope.clientId, serviceRecordCaseId: data.scope.serviceRecordCaseId,
            documentKind: "service_record_snapshot", snapshotVersion: version, snapshotChunkIndex: index, revisionId,
            createdDate: new Date(), updatedDate: new Date(), expiredDate: new Date("2027-12-31T00:00:00Z"),
            statusType, statusDetail: "synthetic", stepType: "03", stepIndex: "3", stepName: "synthetic",
            stepRecipientType: "", stepRecipientName: "", stepRecipientSms: "", syncStatus: "synced",
        } });
    }

    async function chunk(data: Awaited<ReturnType<typeof fixtureWithRevision>>, version: number, index: number,
        documentId: string, count = 2) {
        return prisma.service_record_snapshot_chunk.create({ data: {
            branchId: data.scope.branchId, serviceRecordCaseId: data.scope.serviceRecordCaseId,
            revisionId: data.revision.id, snapshotVersion: version, chunkIndex: index, chunkCount: count,
            firstSessionIndex: index, lastSessionIndex: index, employeeNameSnapshot: "synthetic",
            sourceHash: data.state.inputFingerprint, status: "CREATED", eformsignDocumentId: documentId,
        } });
    }

    it("enforces revision owner links while retaining nullable legacy documents", async () => {
        const data = await fixtureWithRevision();
        const other = await fixtureWithRevision();
        const linked = await document(data, 3, 1, data.revision.id);
        await expect(prisma.eformsign_doc.update({ where: { id: linked.id },
            data: { revisionId: other.revision.id } })).rejects.toThrow();
        await expect(prisma.eformsign_doc.update({ where: { id: linked.id },
            data: { branchId: null } })).rejects.toThrow();
        expect(await prisma.eformsign_doc.findUniqueOrThrow({ where: { id: linked.id } }))
            .toMatchObject({ revisionId: data.revision.id, branchId: data.scope.branchId });
        const legacy = await document(data, 2, 1, null);
        expect(legacy.revisionId).toBeNull();
    });

    it("allocates after legacy version two once under concurrent requests", async () => {
        const data = await fixtureWithRevision();
        const legacy = await document(data, 2, 1, null);
        const request = { ...data.scope, expectedDocumentVersion: null };
        const versions = await Promise.all([
            repository.allocateServiceRecordRevisionDocumentVersion(request),
            repository.allocateServiceRecordRevisionDocumentVersion(request),
        ]);
        expect(versions).toEqual([3, 3]);
        expect(await repository.allocateServiceRecordRevisionDocumentVersion({ ...data.scope, expectedDocumentVersion: 3 })).toBe(3);
        expect((await prisma.eformsign_doc.findUniqueOrThrow({ where: { id: legacy.id } })).revisionId).toBeNull();
        const state = await repository.findRevisionDocumentState(data.scope.branchId, data.scope.clientId, data.revision.id, data.state.id);
        expect(state).toMatchObject({ documentVersion: 3, immutableInput: data.state.immutableInput,
            inputFingerprint: data.state.inputFingerprint });
        expect((await prisma.service_record_case.findUniqueOrThrow({ where: { id: data.fixture.record.id } })).formVersion).toBe(2);
    });

    it("promotes only after all exact chunks complete and retains the contract pointer", async () => {
        const data = await fixtureWithRevision();
        const legacy = await document(data, 2, 1, null);
        const contract = await prisma.eformsign_doc.create({ data: { ...legacy, id: undefined, detailPayload: Prisma.DbNull,
            documentId: `synthetic-contract:${randomUUID()}`, serviceRecordCaseId: null,
            snapshotVersion: null, snapshotChunkIndex: null, revisionId: null, documentKind: "contract" } });
        await prisma.client.update({ where: { id: data.scope.clientId }, data: { eDocId: contract.documentId } });
        const version = await repository.allocateServiceRecordRevisionDocumentVersion({ ...data.scope, expectedDocumentVersion: null });
        const first = await document(data, version, 1, data.revision.id);
        const second = await document(data, version, 2, data.revision.id, "070");
        await chunk(data, version, 1, first.documentId);
        await chunk(data, version, 2, second.documentId);
        const request = { ...data.scope, revisionNumber: data.revision.revisionNumber,
            documentVersion: version, chunkCount: 2, documentIds: [first.documentId, second.documentId] };
        expect(await repository.promoteServiceRecordRevisionSnapshot(request)).toBe(false);
        expect((await prisma.service_record_case.findUniqueOrThrow({ where: { id: data.fixture.record.id } })).currentUsableRevisionId).toBeNull();
        await prisma.eformsign_doc.update({ where: { id: second.id }, data: { statusType: "003" } });
        expect(await repository.promoteServiceRecordRevisionSnapshot(request)).toBe(true);
        expect(await prisma.service_record_case.findUniqueOrThrow({ where: { id: data.fixture.record.id } }))
            .toMatchObject({ currentUsableRevisionId: data.revision.id, currentUsableDocumentVersion: version,
                status: "COMPLETED", formVersion: 2 });
        expect((await prisma.client.findUniqueOrThrow({ where: { id: data.scope.clientId } })).eDocId).toBe(contract.documentId);
        expect((await repository.findRevisionDocumentState(data.scope.branchId, data.scope.clientId, data.revision.id, data.state.id))?.status).toBe("completed");
        expect(await prisma.eformsign_doc.count({ where: { serviceRecordCaseId: data.fixture.record.id } })).toBe(3);
    });

    it("replaces a prior usable revision only after the next version is fully verified", async () => {
        const first = await fixtureWithRevision();
        const firstVersion = await repository.allocateServiceRecordRevisionDocumentVersion({ ...first.scope, expectedDocumentVersion: null });
        const firstDoc = await document(first, firstVersion, 1, first.revision.id);
        await chunk(first, firstVersion, 1, firstDoc.documentId, 1);
        expect(await repository.promoteServiceRecordRevisionSnapshot({ ...first.scope,
            revisionNumber: first.revision.revisionNumber, documentVersion: firstVersion,
            chunkCount: 1, documentIds: [firstDoc.documentId] })).toBe(true);
        const revision = await repository.appendRevision({ branchId: first.scope.branchId,
            serviceRecordCaseId: first.fixture.record.id, actorUserId: first.fixture.actorUserId,
            payload: { next: true }, plannedSessions: [], provenance: { synthetic: true }, formVersionAtConfirm: 2 });
        await prisma.service_record_case.update({ where: { id: first.fixture.record.id }, data: { currentRevisionId: revision.id } });
        const immutableInput = { synthetic: true, revisionId: revision.id };
        const state = await repository.createRevisionDocumentState({ ...first.scope,
            revisionId: revision.id, operation: "record_snapshot", generation: randomUUID(), immutableInput,
            inputFingerprint: sha256CanonicalJson(immutableInput), status: "processing", step: "preparing" });
        const next = { ...first, revision, state, scope: { ...first.scope,
            revisionId: revision.id, documentStateId: state.id, generation: state.generation } };
        const version = await repository.allocateServiceRecordRevisionDocumentVersion({ ...next.scope, expectedDocumentVersion: null });
        expect(version).toBe(firstVersion + 1);
        const nextDoc = await document(next, version, 1, revision.id, "070");
        await chunk(next, version, 1, nextDoc.documentId, 1);
        const request = { ...next.scope, revisionNumber: revision.revisionNumber,
            documentVersion: version, chunkCount: 1, documentIds: [nextDoc.documentId] };
        expect(await repository.promoteServiceRecordRevisionSnapshot(request)).toBe(false);
        expect(await prisma.service_record_case.findUniqueOrThrow({ where: { id: first.fixture.record.id } }))
            .toMatchObject({ currentRevisionId: revision.id, currentUsableRevisionId: first.revision.id,
                currentUsableDocumentVersion: firstVersion });
        await prisma.eformsign_doc.update({ where: { id: nextDoc.id }, data: { statusType: "003" } });
        expect(await repository.promoteServiceRecordRevisionSnapshot(request)).toBe(true);
        expect(await prisma.service_record_case.findUniqueOrThrow({ where: { id: first.fixture.record.id } }))
            .toMatchObject({ currentRevisionId: revision.id, currentUsableRevisionId: revision.id,
                currentUsableDocumentVersion: version });
        expect(await prisma.eformsign_doc.findUniqueOrThrow({ where: { id: firstDoc.id } }))
            .toMatchObject({ revisionId: first.revision.id, snapshotVersion: firstVersion });
    });

    it("refuses an older completed generation after a newer revision becomes current", async () => {
        const data = await fixtureWithRevision();
        const version = await repository.allocateServiceRecordRevisionDocumentVersion({ ...data.scope, expectedDocumentVersion: null });
        const oldDoc = await document(data, version, 1, data.revision.id);
        await chunk(data, version, 1, oldDoc.documentId, 1);
        const next = await repository.appendRevision({ branchId: data.scope.branchId,
            serviceRecordCaseId: data.fixture.record.id, actorUserId: data.fixture.actorUserId,
            payload: { next: true }, plannedSessions: [], provenance: { synthetic: true }, formVersionAtConfirm: 2 });
        await prisma.service_record_case.update({ where: { id: data.fixture.record.id }, data: { currentRevisionId: next.id } });
        expect(await repository.promoteServiceRecordRevisionSnapshot({ ...data.scope,
            revisionNumber: data.revision.revisionNumber, documentVersion: version, chunkCount: 1,
            documentIds: [oldDoc.documentId] })).toBe(false);
        expect(await prisma.service_record_case.findUniqueOrThrow({ where: { id: data.fixture.record.id } }))
            .toMatchObject({ currentRevisionId: next.id, currentUsableRevisionId: null });
        expect((await prisma.eformsign_doc.findUniqueOrThrow({ where: { id: oldDoc.id } })).revisionId).toBe(data.revision.id);
    });
});
