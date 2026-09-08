import { randomUUID } from "node:crypto";
import { ConfigService } from "@nestjs/config";
import { PrismaClient } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { sha256CanonicalJson } from "application/services/eformsign-document-job.service";
import {
    EformsignDocumentJobWorkerService,
    type ServiceRecordRevisionOperationsJobPayload,
} from "application/services/eformsign-document-job-worker.service";
import { EformsignDocumentJobEntity } from "domain/entities/eformsign-document-job.entity";
import { ServiceRecordEditRepository } from "infrastructure/database/repositories/service-record-edit.repository";
import { SbEformsignDocumentJobRepository } from "infrastructure/database/repositories/sb.eformsign-document-job.repository";
import type { ServiceRecordRevisionDispatchContext } from "@babyjamjam/shared/types/service-record";
import {
    assertApprovedServiceRecordConfirmDatabaseTarget,
    createApprovedServiceRecordConfirmClient,
    createServiceRecordConfirmFixture,
    ORIGINAL_THIRTEEN_DATES,
} from "./helpers/service-record-confirm.helper";

const describeE2E = process.env["SERVICE_RECORD_CONFIRM_E2E"] === "1" ? describe : describe.skip;

type RevisionOperationContext = ServiceRecordRevisionDispatchContext & { revisionId: string };

describeE2E("service-record revision operation dispatch authorization (actual PostgreSQL)", () => {
    let prisma: PrismaClient;
    let jobRepository: SbEformsignDocumentJobRepository;
    let editRepository: ServiceRecordEditRepository;

    beforeAll(async () => {
        assertApprovedServiceRecordConfirmDatabaseTarget();
        prisma = createApprovedServiceRecordConfirmClient();
        await prisma.$connect();
        jobRepository = new SbEformsignDocumentJobRepository(prisma as never);
        editRepository = new ServiceRecordEditRepository(prisma as never);
    });

    afterAll(async () => {
        await prisma?.$disconnect();
    });

    async function operationFixture() {
        const fixture = await createServiceRecordConfirmFixture(prisma);
        const revision = await editRepository.appendRevision({
            branchId: fixture.branch.id,
            serviceRecordCaseId: fixture.record.id,
            actorUserId: fixture.actorUserId,
            payload: { synthetic: "partial-confirmed-revision" },
            plannedSessions: ORIGINAL_THIRTEEN_DATES.map((serviceDate, index) => ({
                sessionIndex: index + 1,
                serviceDate,
            })),
            provenance: { source: "dispatch-proof" },
            formVersionAtConfirm: fixture.record.formVersion,
        });
        await prisma.service_record_case.update({
            where: { id: fixture.record.id },
            data: { currentRevisionId: revision.id },
        });

        const contractInput = {
            operation: "contract_period" as const,
            synthetic: "contract-operation",
            revisionId: revision.id,
        };
        const receiptInput = {
            operation: "receipt_refresh" as const,
            synthetic: "receipt-operation",
            revisionId: revision.id,
        };
        const contractState = await editRepository.createRevisionDocumentState({
            branchId: fixture.branch.id,
            clientId: fixture.client.id,
            serviceRecordCaseId: fixture.record.id,
            revisionId: revision.id,
            operation: "contract_period",
            generation: randomUUID(),
            immutableInput: contractInput,
            inputFingerprint: sha256CanonicalJson(contractInput),
            status: "waiting_for_completion",
            step: "waiting_for_completion",
        });
        const receiptState = await editRepository.createRevisionDocumentState({
            branchId: fixture.branch.id,
            clientId: fixture.client.id,
            serviceRecordCaseId: fixture.record.id,
            revisionId: revision.id,
            operation: "receipt_refresh",
            generation: randomUUID(),
            immutableInput: receiptInput,
            inputFingerprint: sha256CanonicalJson(receiptInput),
            status: "waiting_for_completion",
            step: "waiting_for_completion",
        });

        const context: RevisionOperationContext = {
            branchId: fixture.branch.id,
            clientId: fixture.client.id,
            serviceRecordCaseId: fixture.record.id,
            revisionId: revision.id,
            revisionNumber: revision.revisionNumber,
            businessFingerprint: sha256CanonicalJson(revision.payload),
            plannedSessionCount: ORIGINAL_THIRTEEN_DATES.length,
            plannedSessionDates: ORIGINAL_THIRTEEN_DATES.map((serviceDate, index) => ({
                sessionIndex: index + 1,
                serviceDate,
            })),
            documentSyncStatus: "waiting_for_completion",
            lifecycleStatus: "IN_PROGRESS",
            formVersion: fixture.record.formVersion,
        };
        const payload: ServiceRecordRevisionOperationsJobPayload = {
            kind: "service_record_revision_operations",
            context,
            operations: {
                contract: {
                    documentStateId: contractState.id,
                    generation: contractState.generation,
                },
                receipt: {
                    documentStateId: receiptState.id,
                    expectedGeneration: receiptState.generation,
                },
            },
        };
        return { fixture, revision, context, payload };
    }

    async function createProcessingJob(
        data: Awaited<ReturnType<typeof operationFixture>>,
        payload: Record<string, unknown> = data.payload as unknown as Record<string, unknown>,
    ) {
        const leaseToken = randomUUID();
        const row = await prisma.eformsign_document_job.create({
            data: {
                branchId: data.fixture.branch.id,
                clientId: data.fixture.client.id,
                jobType: "create_document",
                source: "staff",
                status: "processing",
                requestKey: `service-record-revision-operations:${data.revision.id}:${randomUUID()}`,
                activeKey: `service-record-revision-operations:${data.fixture.record.id}:${randomUUID()}`,
                payload: payload as unknown as Prisma.InputJsonValue,
                payloadFingerprint: sha256CanonicalJson(payload),
                progressStep: null,
                leaseToken,
                startedAt: new Date(),
                heartbeatAt: new Date(),
                createdByUserId: data.fixture.actorUserId,
            },
        });
        const job = new EformsignDocumentJobEntity({
            ...row,
            jobType: "create_document",
            source: "staff",
            status: "processing",
            payload: payload as Record<string, unknown>,
            autoFinalizeOutcomeAttempts: null,
        });
        return { row, job, leaseToken };
    }

    function createWorker(
        coordinator: { process: jest.Mock },
        repository: SbEformsignDocumentJobRepository = jobRepository,
    ) {
        const dispatch = { execute: jest.fn() };
        const finalize = { execute: jest.fn() };
        const reconciliation = { reconcile: jest.fn() };
        const autoFinalizeScheduler = { recordTerminalFailure: jest.fn() };
        const eformsignDocRepository = { findByDocumentId: jest.fn() };
        const clientRepository = { findById: jest.fn().mockResolvedValue({ id: 1 }) };
        const schedulerLease = { holdsLease: jest.fn(() => true) };
        const worker = new EformsignDocumentJobWorkerService(
            new ConfigService({ EFORMSIGN_DOCUMENT_JOBS_WORKER_ENABLED: "true" }),
            repository as never,
            dispatch as never,
            finalize as never,
            reconciliation as never,
            autoFinalizeScheduler as never,
            eformsignDocRepository as never,
            clientRepository as never,
            schedulerLease as never,
            undefined,
            coordinator as never,
        );
        return { worker, dispatch, finalize, reconciliation, coordinator };
    }

    async function processClaimedJob(
        worker: EformsignDocumentJobWorkerService,
        job: EformsignDocumentJobEntity,
    ): Promise<void> {
        await (worker as unknown as {
            processClaimedJob(claimed: EformsignDocumentJobEntity): Promise<void>;
        }).processClaimedJob(job);
    }

    it("fails closed at the real repository boundary for a partial revised operation job", async () => {
        const data = await operationFixture();
        const { row, job, leaseToken } = await createProcessingJob(data);

        const authorization = await jobRepository.authorizeForDispatch({
            jobId: job.id,
            leaseToken,
            expectedContext: data.context,
        });

        expect(authorization).toEqual({
            kind: "stale",
            reason: "SERVICE_RECORD_REVISION_CAPABILITY_UNVERIFIED",
        });
        expect(await prisma.eformsign_document_job.findUniqueOrThrow({ where: { id: row.id } }))
            .toMatchObject({ status: "processing", progressStep: null, leaseToken });
    });

    it("keeps a revised operation claim out of every renderer when the worker uses the real repository", async () => {
        const data = await operationFixture();
        const { row, job, leaseToken } = await createProcessingJob(data);
        const coordinator = { process: jest.fn() };
        const { worker, dispatch, finalize } = createWorker(coordinator);

        await processClaimedJob(worker, job);

        expect(coordinator.process).not.toHaveBeenCalled();
        expect(dispatch.execute).not.toHaveBeenCalled();
        expect(finalize.execute).not.toHaveBeenCalled();
        expect(await prisma.eformsign_document_job.findUniqueOrThrow({ where: { id: row.id } }))
            .toMatchObject({
                status: "requires_attention",
                lastErrorCode: "SERVICE_RECORD_REVISION_CAPABILITY_UNVERIFIED",
                progressStep: null,
                leaseToken: null,
            });
        expect(leaseToken).toMatch(/^[0-9a-f-]{36}$/i);
    });

    const contextMutations: Array<[string, (context: RevisionOperationContext) => RevisionOperationContext]> = [
        ["foreign branch context", (context) => ({
            ...context,
            branchId: randomUUID(),
        })],
        ["stale revision context", (context) => ({
            ...context,
            revisionId: randomUUID(),
        })],
    ];

    it.each(contextMutations)("does not route a %s operation context to the coordinator", async (_label, mutateContext) => {
        const data = await operationFixture();
        const payload: ServiceRecordRevisionOperationsJobPayload = {
            ...data.payload,
            context: mutateContext(data.context),
        };
        const { row, job } = await createProcessingJob(data, payload as unknown as Record<string, unknown>);
        const coordinator = { process: jest.fn() };
        const { worker, dispatch, finalize } = createWorker(coordinator);

        await processClaimedJob(worker, job);

        expect(coordinator.process).not.toHaveBeenCalled();
        expect(dispatch.execute).not.toHaveBeenCalled();
        expect(finalize.execute).not.toHaveBeenCalled();
        expect(await prisma.eformsign_document_job.findUniqueOrThrow({ where: { id: row.id } }))
            .toMatchObject({
                status: "requires_attention",
                progressStep: null,
                leaseToken: null,
                lastErrorCode: "SERVICE_RECORD_REVISION_CAPABILITY_UNVERIFIED",
            });
    });

    it("does not route a redacted operation payload to the coordinator or legacy renderer", async () => {
        const data = await operationFixture();
        const malformedPayload: Record<string, unknown> = {
            kind: "service_record_revision_operations",
            context: data.context,
            operations: {
                contract: {
                    documentStateId: data.payload.operations.contract!.documentStateId,
                },
            },
        };
        const { row, job } = await createProcessingJob(data, malformedPayload);
        const coordinator = { process: jest.fn() };
        const { worker, dispatch, finalize } = createWorker(coordinator);

        await processClaimedJob(worker, job);

        expect(coordinator.process).not.toHaveBeenCalled();
        expect(dispatch.execute).not.toHaveBeenCalled();
        expect(finalize.execute).not.toHaveBeenCalled();
        expect(await prisma.eformsign_document_job.findUniqueOrThrow({ where: { id: row.id } }))
            .toMatchObject({
                status: "requires_attention",
                progressStep: null,
                leaseToken: null,
                lastErrorCode: "INVALID_SERVICE_RECORD_REVISION_OPERATION_JOB_PAYLOAD",
            });
    });
});
