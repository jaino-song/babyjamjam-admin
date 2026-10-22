import { ExecutionContext, INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import { ConfigService } from "@nestjs/config";
import { EformsignDocService } from "application/services/eformsign-doc.service";
import { EformsignDocsEventBus } from "application/services/eformsign-docs-event-bus.service";
import { EformsignHeadlessProgressService } from "application/services/eformsign-headless-progress.service";
import { EformsignDocumentJobService } from "application/services/eformsign-document-job.service";
import { DispatchDocumentHeadlessUsecase } from "application/usecases/eformsign-doc/dispatch-document-headless.usecase";
import { FinalizeDocumentHeadlessUsecase } from "application/usecases/eformsign-doc/finalize-document-headless.usecase";
import { AdoptEformsignDocUsecase } from "application/usecases/eformsign-doc/adopt-eformsign-doc.usecase";
import { ListClientNamesByBranchUsecase } from "application/usecases/eformsign-doc/list-client-names-by-branch.usecase";
import { ListReviewStageContractsUsecase } from "application/usecases/eformsign-doc/list-review-stage-contracts.usecase";
import { ListEformsignLinkConfirmationsUsecase } from "application/usecases/eformsign-doc/list-eformsign-link-confirmations.usecase";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { TenantGuard } from "infrastructure/tenant";
import { EformsignDocController } from "interface/controllers/eformsign-doc.controller";
import type { EformsignDocumentJobEntity } from "domain/entities/eformsign-document-job.entity";
import { EformsignDispatchBoundaryService } from "application/services/eformsign-dispatch-boundary.service";
import { ContractSupersedeService } from "application/services/contract-supersede.service";

const validContractData = {
    customerName: "산모",
    customerContact: "010-1111-2222",
    customerDOB: "900101",
    customerAddress: "인천",
    caretaker1Name: "관리사",
    caretaker1Contact: "010-9999-8888",
    type: "A형",
    days: "10",
    area: "namdong",
    contractDuration: "2026-07-01 ~ 2026-07-14",
    startYear: "26",
    startMonth: "07",
    startDay: "01",
    startDate: "2026-07-01",
    endYear: "26",
    endMonth: "07",
    endDay: "14",
    endDate: "2026-07-14",
    paymentYear: "26",
    paymentMonth: "07",
    paymentDay: "01",
    fullPrice: "1000000",
    grant: "800000",
    actualPrice: "200000",
};

const job = (overrides: Partial<EformsignDocumentJobEntity> = {}): EformsignDocumentJobEntity => ({
    id: "job-1",
    branchId: "branch-a",
    clientId: 42,
    documentId: "document-1",
    jobType: "create_document",
    source: "staff",
    status: "processing",
    requestKey: "request-1",
    activeKey: "active-1",
    payload: { accessToken: "provider-secret", customerName: "산모" },
    payloadFingerprint: "fingerprint-secret",
    progressStep: "provider_submit",
    attempts: 1,
    nextAttemptAt: new Date("2026-08-13T00:00:00.000Z"),
    heartbeatAt: new Date("2026-08-13T00:00:00.000Z"),
    leaseToken: "00000000-0000-0000-0000-000000000099",
    autoFinalizeOutcomeRecordedAt: null,
    autoFinalizeOutcomeAttempts: null,
    startedAt: new Date("2026-08-13T00:00:00.000Z"),
    completedAt: null,
    lastErrorCode: "PROVIDER_RAW_ERROR_SHOULD_NOT_LEAK",
    createdByUserId: "user-a",
    createdAt: new Date("2026-08-13T00:00:00.000Z"),
    updatedAt: new Date("2026-08-13T00:00:00.000Z"),
    ...overrides,
});

const JOB_ID = "22222222-2222-4222-8222-222222222222";
const CLAIM_EXPIRES_MS = Date.parse("2026-08-13T00:10:00.000Z");
const claimStep = (userId = "user-a") => `manual_in_progress:${userId}:${CLAIM_EXPIRES_MS}`;
const failedJob = (overrides: Partial<EformsignDocumentJobEntity> = {}) =>
    job({
        id: JOB_ID,
        status: "failed",
        progressStep: claimStep(),
        lastErrorCode: "SEND_FAILED",
        clientName: "산모",
        ...overrides,
    });

let authRole = "admin";
let authUserId: string | undefined = "user-a";
let acceptingEnabled = "true";

describe("EformsignDocumentJobController (Integration)", () => {
    let app: INestApplication;
    let documentJobService: {
        enqueueCreateDocument: jest.Mock;
        enqueueFinalizeDocument: jest.Mock;
        getSummary: jest.Mock;
        listForBranch: jest.Mock;
        claimRecovery: jest.Mock;
        resolveManually: jest.Mock;
    };
    let supersedeService: { isDocumentVisibleToBranch: jest.Mock } | undefined;
    let dispatchBoundary: { reconcile: jest.Mock; findById?: jest.Mock };

    const authGuard = {
        canActivate: (context: ExecutionContext) => {
            const req = context.switchToHttp().getRequest();
            req.user = { userId: authUserId, branchId: "branch-a", role: authRole, branchRole: authRole };
            req.tenant = {
                userId: authUserId,
                branchId: "branch-a",
                globalRole: authRole,
                branchRole: authRole,
            };
            return true;
        },
    };

    beforeEach(async () => {
        authRole = "admin";
        authUserId = "user-a";
        acceptingEnabled = "true";
        supersedeService = { isDocumentVisibleToBranch: jest.fn().mockResolvedValue(true) };
        documentJobService = {
            enqueueCreateDocument: jest.fn(),
            enqueueFinalizeDocument: jest.fn(),
            getSummary: jest.fn(),
            listForBranch: jest.fn(),
            claimRecovery: jest.fn(),
            resolveManually: jest.fn(),
        };
        dispatchBoundary = {
            reconcile: jest.fn().mockResolvedValue({
                id: "11111111-1111-4111-8111-111111111111",
                status: "reconciled_not_delivered",
                reconciledOutcome: "not_delivered",
                providerDocumentId: null,
            }),
        };

        await buildApp();
    });

    const buildApp = async (): Promise<void> => {
        const moduleFixture: TestingModule = await Test.createTestingModule({
            controllers: [EformsignDocController],
            providers: [
                { provide: EformsignDocService, useValue: {} },
                { provide: ListClientNamesByBranchUsecase, useValue: {} },
                { provide: ListReviewStageContractsUsecase, useValue: {} },
                { provide: ListEformsignLinkConfirmationsUsecase, useValue: {} },
                { provide: DispatchDocumentHeadlessUsecase, useValue: {} },
                { provide: FinalizeDocumentHeadlessUsecase, useValue: {} },
                { provide: AdoptEformsignDocUsecase, useValue: {} },
                { provide: EformsignDocsEventBus, useValue: {} },
                { provide: EformsignHeadlessProgressService, useValue: {} },
                {
                    provide: ConfigService,
                    useValue: {
                        get: jest.fn((key: string) =>
                            key === "EFORMSIGN_DOCUMENT_JOBS_ACCEPTING_ENABLED" ? acceptingEnabled : undefined,
                        ),
                    },
                },
                { provide: EformsignDocumentJobService, useValue: documentJobService },
                { provide: EformsignDispatchBoundaryService, useValue: dispatchBoundary },
                ...(supersedeService
                    ? [{ provide: ContractSupersedeService, useValue: supersedeService }]
                    : []),
            ],
        })
            .overrideGuard(JwtGuard)
            .useValue(authGuard)
            .overrideGuard(TenantGuard)
            .useValue(authGuard)
            .compile();

        app = moduleFixture.createNestApplication();
        app.useGlobalPipes(new ValidationPipe({
            transform: true,
            whitelist: true,
            forbidNonWhitelisted: true,
        }));
        await app.listen(0, "127.0.0.1");
    };

    afterEach(async () => {
        await app.close();
    });

    it("queues creation with authenticated branch/user context and returns 202 without sensitive fields", async () => {
        documentJobService.enqueueCreateDocument.mockResolvedValue({
            job: job({ status: "queued", documentId: null }),
            existing: false,
        });

        const response = await request(app.getHttpServer())
            .post("/eformsign-docs/jobs/creation")
            .send({ requestKey: "request-creation-1", clientId: 42, contractData: validContractData });

        expect(response.status).toBe(202);
        expect(response.body).toEqual({ jobId: "job-1", status: "queued", existing: false });
        expect(response.body).not.toHaveProperty("payload");
        expect(response.body).not.toHaveProperty("payloadFingerprint");
        expect(documentJobService.enqueueCreateDocument).toHaveBeenCalledWith({
            branchId: "branch-a",
            createdByUserId: "user-a",
            requestKey: "request-creation-1",
            clientId: 42,
            contractData: validContractData,
        });
    });

    it("forwards an active duplicate as an idempotent 202 response", async () => {
        documentJobService.enqueueCreateDocument.mockResolvedValue({
            job: job({ status: "processing" }),
            existing: true,
        });

        const response = await request(app.getHttpServer())
            .post("/eformsign-docs/jobs/creation")
            .send({ requestKey: "request-creation-1", clientId: 42, contractData: validContractData });

        expect(response.status).toBe(202);
        expect(response.body).toEqual({ jobId: "job-1", status: "processing", existing: true });
        expect(documentJobService.enqueueCreateDocument).toHaveBeenCalledTimes(1);
    });

    it("queues finalization with the authenticated branch and staff source", async () => {
        documentJobService.enqueueFinalizeDocument.mockResolvedValue({
            job: job({ jobType: "finalize_document", documentId: "document-99", status: "queued" }),
            existing: false,
        });

        const response = await request(app.getHttpServer())
            .post("/eformsign-docs/jobs/finalization")
            .send({
                requestKey: "request-finalization-1",
                documentId: "document-99",
                prefillEndDate: "2026-08-31",
            });

        expect(response.status).toBe(202);
        expect(documentJobService.enqueueFinalizeDocument).toHaveBeenCalledWith({
            branchId: "branch-a",
            createdByUserId: "user-a",
            requestKey: "request-finalization-1",
            documentId: "document-99",
            prefillEndDate: "2026-08-31",
            source: "staff",
        });
    });

    it("rejects blank/oversized request keys and undeclared sensitive fields before enqueue", async () => {
        const blank = await request(app.getHttpServer())
            .post("/eformsign-docs/jobs/creation")
            .send({ requestKey: " ", clientId: 42, contractData: validContractData });
        const oversized = await request(app.getHttpServer())
            .post("/eformsign-docs/jobs/creation")
            .send({ requestKey: "a".repeat(256), clientId: 42, contractData: validContractData });
        const sensitive = await request(app.getHttpServer())
            .post("/eformsign-docs/jobs/creation")
            .send({
                requestKey: "request-sensitive-field",
                clientId: 42,
                branchId: "branch-attacker",
                contractData: { ...validContractData, accessToken: "provider-secret" },
            });

        expect(blank.status).toBe(400);
        expect(oversized.status).toBe(400);
        expect(sensitive.status).toBe(400);
        expect(documentJobService.enqueueCreateDocument).not.toHaveBeenCalled();
    });

    it("rejects invalid finalization input before enqueue", async () => {
        const response = await request(app.getHttpServer())
            .post("/eformsign-docs/jobs/finalization")
            .send({ requestKey: "request-finalization-2", documentId: "document-2", prefillEndDate: "08/31/2026" });

        expect(response.status).toBe(400);
        expect(documentJobService.enqueueFinalizeDocument).not.toHaveBeenCalled();
    });

    it("reconciles a dispatch intent with the authenticated branch operator", async () => {
        const intentId = "11111111-1111-4111-8111-111111111111";
        const response = await request(app.getHttpServer())
            .post(`/eformsign-docs/dispatch-intents/${intentId}/reconcile`)
            .send({
                outcome: "not_delivered",
                reason: "provider receipt lookup confirms no delivery",
            });

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            intentId,
            status: "reconciled_not_delivered",
            outcome: "not_delivered",
            providerDocumentId: null,
        });
        expect(dispatchBoundary.reconcile).toHaveBeenCalledWith({
            branchId: "branch-a",
            intentId,
            outcome: "not_delivered",
            actorUserId: "user-a",
            reason: "provider receipt lookup confirms no delivery",
            providerDocumentId: undefined,
        });
    });

    it("reads only the current branch's dispatch intent summary", async () => {
        const intentId = "11111111-1111-4111-8111-111111111111";
        dispatchBoundary.reconcile.mockReset();
        dispatchBoundary.findById = jest.fn().mockResolvedValue({
            id: intentId,
            status: "uncertain",
            reconciledOutcome: null,
            providerDocumentId: null,
        });

        const response = await request(app.getHttpServer())
            .get(`/eformsign-docs/dispatch-intents/${intentId}`);

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
            intentId,
            status: "uncertain",
            outcome: null,
            providerDocumentId: null,
        });
        expect(dispatchBoundary.findById).toHaveBeenCalledWith(
            "branch-a",
            intentId,
        );
    });

    it("validates reconciliation reasons before reaching the repository", async () => {
        const response = await request(app.getHttpServer())
            .post("/eformsign-docs/dispatch-intents/11111111-1111-4111-8111-111111111111/reconcile")
            .send({ outcome: "delivered", reason: " ".repeat(501) });

        expect(response.status).toBe(400);
        expect(dispatchBoundary.reconcile).not.toHaveBeenCalled();
    });

    it("denies intent reconciliation to branch staff", async () => {
        authRole = "user";
        const response = await request(app.getHttpServer())
            .post("/eformsign-docs/dispatch-intents/11111111-1111-4111-8111-111111111111/reconcile")
            .send({ outcome: "delivered", reason: "provider receipt verified" });

        expect(response.status).toBe(403);
        expect(dispatchBoundary.reconcile).not.toHaveBeenCalled();
    });

    it("allows a branch manager to reconcile the branch-scoped intent", async () => {
        authRole = "manager";
        const response = await request(app.getHttpServer())
            .post("/eformsign-docs/dispatch-intents/11111111-1111-4111-8111-111111111111/reconcile")
            .send({ outcome: "delivered", reason: "provider receipt verified" });

        expect(response.status).toBe(200);
        expect(dispatchBoundary.reconcile).toHaveBeenCalledWith(expect.objectContaining({
            branchId: "branch-a",
            actorUserId: "user-a",
        }));
    });

    it("returns branch-scoped summary and list with a 24-hour/50 terminal bound", async () => {
        documentJobService.getSummary.mockResolvedValue({
            activeCount: 2,
            requiresAttentionCount: 1,
            failedCount: 3,
            unresolvedCount: 4,
            unresolvedJobIds: ["job-a", "job-b"],
        });
        documentJobService.listForBranch.mockResolvedValue({
            active: [job()],
            requiresAttention: [job({ status: "requires_attention", lastErrorCode: "RAW_ERROR" })],
            recent: [job({ status: "completed", completedAt: new Date("2026-08-13T01:00:00.000Z") })],
        });

        const summary = await request(app.getHttpServer()).get("/eformsign-docs/jobs/summary");
        const list = await request(app.getHttpServer()).get("/eformsign-docs/jobs");

        expect(summary.status).toBe(200);
        expect(summary.body).toEqual({
            activeCount: 2,
            requiresAttentionCount: 1,
            failedCount: 3,
            unresolvedCount: 4,
            unresolvedJobIds: ["job-a", "job-b"],
        });
        expect(documentJobService.getSummary).toHaveBeenCalledWith("branch-a");
        expect(list.status).toBe(200);
        expect(list.body.active[0]).toEqual(expect.objectContaining({
            jobId: "job-1",
            status: "processing",
            documentId: "document-1",
        }));
        expect(list.body.active[0]).not.toHaveProperty("payload");
        expect(list.body.active[0]).not.toHaveProperty("payloadFingerprint");
        // A staff contract job exposes its error code and recovery kind; internals stay hidden.
        expect(list.body.requiresAttention[0]).toEqual(expect.objectContaining({
            lastErrorCode: "RAW_ERROR",
            recoveryKind: "verify_result",
        }));
        expect(list.body.active[0]).not.toHaveProperty("requestKey");
        expect(documentJobService.listForBranch).toHaveBeenCalledWith(
            "branch-a",
            expect.any(Date),
            50,
        );
        const terminalSince = documentJobService.listForBranch.mock.calls[0][1] as Date;
        expect(Date.now() - terminalSince.getTime()).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000 - 1000);
        expect(Date.now() - terminalSince.getTime()).toBeLessThan(24 * 60 * 60 * 1000 + 1000);
    });
    describe("creation reissue (supersedeDocumentId)", () => {
        const post = (extra: Record<string, unknown> = {}) =>
            request(app.getHttpServer())
                .post("/eformsign-docs/jobs/creation")
                .send({ requestKey: "request-reissue-1", clientId: 42, contractData: validContractData, ...extra });

        beforeEach(() => {
            documentJobService.enqueueCreateDocument.mockResolvedValue({
                job: job({ status: "queued", documentId: null }),
                existing: false,
            });
        });

        it("passes a branch-visible document on to the job service", async () => {
            const response = await post({ supersedeDocumentId: "doc-old-1" });

            expect(response.status).toBe(202);
            expect(supersedeService!.isDocumentVisibleToBranch).toHaveBeenCalledWith("branch-a", "doc-old-1");
            expect(documentJobService.enqueueCreateDocument).toHaveBeenCalledWith(
                expect.objectContaining({ supersedeDocumentId: "doc-old-1", branchId: "branch-a" }),
            );
        });

        it("returns 403 and does not enqueue when the document is not visible to the branch", async () => {
            supersedeService!.isDocumentVisibleToBranch.mockResolvedValue(false);

            const response = await post({ supersedeDocumentId: "doc-other-branch" });

            expect(response.status).toBe(403);
            expect(response.body.code).toBe("ACCESS_DENIED");
            expect(documentJobService.enqueueCreateDocument).not.toHaveBeenCalled();
        });

        it("returns 403 and does not enqueue when the supersede service is not available", async () => {
            await app.close();
            supersedeService = undefined;
            await buildApp();

            const response = await post({ supersedeDocumentId: "doc-old-1" });

            expect(response.status).toBe(403);
            expect(documentJobService.enqueueCreateDocument).not.toHaveBeenCalled();
        });

        it.each([
            ["whitespace", "doc old"],
            ["blank", ""],
            ["oversized", "d".repeat(256)],
            ["non-string", 42],
        ])("rejects a malformed id (%s) with 400 before any lookup", async (_label, value) => {
            const response = await post({ supersedeDocumentId: value });

            expect(response.status).toBe(400);
            expect(supersedeService!.isDocumentVisibleToBranch).not.toHaveBeenCalled();
            expect(documentJobService.enqueueCreateDocument).not.toHaveBeenCalled();
        });

        it("leaves the enqueue payload unchanged and skips the check when the id is absent", async () => {
            const response = await post();

            expect(response.status).toBe(202);
            expect(supersedeService!.isDocumentVisibleToBranch).not.toHaveBeenCalled();
            const params = documentJobService.enqueueCreateDocument.mock.calls[0][0];
            expect(params).not.toHaveProperty("supersedeDocumentId");
        });
    });

    describe("job response mapping", () => {
        it("maps clientName, recoveryKind and lastErrorCode, and hides the claimer behind manual_in_progress", async () => {
            documentJobService.listForBranch.mockResolvedValue({
                active: [],
                requiresAttention: [
                    failedJob({ id: "job-failed", status: "failed", progressStep: "provider_submit" }),
                    failedJob({
                        id: "job-attn",
                        status: "requires_attention",
                        lastErrorCode: "OUTCOME_UNKNOWN",
                        progressStep: claimStep("claimer-uuid-1234"),
                    }),
                ],
                recent: [
                    job({ id: "job-done", status: "completed", lastErrorCode: null, clientName: null }),
                    job({
                        id: "job-revision",
                        status: "failed",
                        requestKey: "service-record-abc",
                        lastErrorCode: "free-text coordinator reason",
                    }),
                ],
            });

            const response = await request(app.getHttpServer()).get("/eformsign-docs/jobs");

            expect(response.status).toBe(200);
            const [failed, attention] = response.body.requiresAttention;
            const [done, revision] = response.body.recent;
            expect(failed).toEqual(expect.objectContaining({
                clientName: "산모",
                recoveryKind: "manual_send",
                lastErrorCode: "SEND_FAILED",
                progressStep: "provider_submit",
            }));
            expect(attention).toEqual(expect.objectContaining({
                recoveryKind: "verify_result",
                lastErrorCode: "OUTCOME_UNKNOWN",
                progressStep: "manual_in_progress",
            }));
            expect(done).toEqual(expect.objectContaining({
                clientName: null,
                recoveryKind: null,
                lastErrorCode: null,
            }));
            expect(revision).toEqual(expect.objectContaining({ recoveryKind: null, lastErrorCode: null }));
            const raw = JSON.stringify(response.body);
            expect(raw).not.toContain("claimer-uuid-1234");
            expect(raw).not.toContain("user-a");
            expect(raw).not.toContain(String(CLAIM_EXPIRES_MS));
        });
    });

    describe("POST /eformsign-docs/jobs/:jobId/recovery", () => {
        const claim = () => request(app.getHttpServer()).post(`/eformsign-docs/jobs/${JOB_ID}/recovery`);
        const originalPayload = { clientId: 42, contractData: validContractData };

        it("returns the prefill payload and claim expiry for a failed (manual_send) job", async () => {
            documentJobService.claimRecovery.mockResolvedValue({
                kind: "claimed",
                job: failedJob({ status: "failed", payload: originalPayload }),
            });

            const response = await claim();

            expect(response.status).toBe(200);
            expect(response.body.recoveryKind).toBe("manual_send");
            expect(response.body.payload).toEqual(originalPayload);
            expect(response.body.claimExpiresAt).toBe(new Date(CLAIM_EXPIRES_MS).toISOString());
            expect(response.body.job).toEqual(expect.objectContaining({
                jobId: JOB_ID,
                progressStep: "manual_in_progress",
                clientName: "산모",
            }));
            expect(response.body.job).not.toHaveProperty("payload");
            expect(JSON.stringify(response.body)).not.toContain(claimStep());
            const input = documentJobService.claimRecovery.mock.calls[0][0];
            expect(input).toEqual({
                jobId: JOB_ID,
                branchId: "branch-a",
                userId: "user-a",
                now: expect.any(Date),
            });
            expect(documentJobService.resolveManually).not.toHaveBeenCalled();
        });

        it("returns 410 with the claim expiry when a manual_send job has lost its payload", async () => {
            documentJobService.claimRecovery.mockResolvedValue({
                kind: "claimed",
                job: failedJob({ status: "failed", payload: null }),
            });

            const response = await claim();

            expect(response.status).toBe(410);
            expect(response.body).toEqual(expect.objectContaining({
                code: "RECOVERY_PAYLOAD_EXPIRED",
                claimExpiresAt: new Date(CLAIM_EXPIRES_MS).toISOString(),
            }));
        });

        it("never returns the payload for a verify_result job", async () => {
            documentJobService.claimRecovery.mockResolvedValue({
                kind: "claimed",
                job: failedJob({ status: "requires_attention", payload: originalPayload }),
            });

            const response = await claim();

            expect(response.status).toBe(200);
            expect(response.body.recoveryKind).toBe("verify_result");
            expect(response.body.payload).toBeNull();
        });

        it("hides provider error text of a non-contract (revision) job", async () => {
            documentJobService.claimRecovery.mockResolvedValue({
                kind: "claimed",
                job: failedJob({
                    status: "failed",
                    requestKey: "service-record-abc",
                    lastErrorCode: "free-text coordinator reason",
                }),
            });

            const response = await claim();

            expect(response.status).toBe(200);
            expect(response.body.recoveryKind).toBeNull();
            expect(response.body.payload).toBeNull();
            expect(response.body.job.lastErrorCode).toBeNull();
        });

        it("maps not_found to 404", async () => {
            documentJobService.claimRecovery.mockResolvedValue({ kind: "not_found" });

            const response = await claim();

            expect(response.status).toBe(404);
            expect(response.body.code).toBe("RESOURCE_NOT_FOUND");
        });

        it("maps claimed_by_other to 409 with the expiry", async () => {
            documentJobService.claimRecovery.mockResolvedValue({
                kind: "claimed_by_other",
                expiresAt: new Date(CLAIM_EXPIRES_MS),
            });

            const response = await claim();

            expect(response.status).toBe(409);
            expect(response.body).toEqual(expect.objectContaining({
                code: "MANUAL_RECOVERY_CLAIMED",
                expiresAt: new Date(CLAIM_EXPIRES_MS).toISOString(),
            }));
        });

        it("maps invalid_state to 409 with the job status", async () => {
            documentJobService.claimRecovery.mockResolvedValue({ kind: "invalid_state", status: "processing" });

            const response = await claim();

            expect(response.status).toBe(409);
            expect(response.body).toEqual(expect.objectContaining({
                code: "JOB_NOT_RECOVERABLE",
                status: "processing",
            }));
        });

        it("returns 401 without a user id and never reaches the service", async () => {
            authUserId = undefined;

            const response = await claim();

            expect(response.status).toBe(401);
            expect(documentJobService.claimRecovery).not.toHaveBeenCalled();
        });

        it("returns 401 (not 500) when the service rejects the user id", async () => {
            documentJobService.claimRecovery.mockRejectedValue(new Error("INVALID_MANUAL_CLAIM_USER"));

            const response = await claim();

            expect(response.status).toBe(401);
        });

        it("rejects a non-UUID job id with 400", async () => {
            const response = await request(app.getHttpServer()).post("/eformsign-docs/jobs/not-a-uuid/recovery");

            expect(response.status).toBe(400);
            expect(documentJobService.claimRecovery).not.toHaveBeenCalled();
        });

        it("denies branch staff without the dispatch capability", async () => {
            authRole = "user";

            const response = await claim();

            expect(response.status).toBe(403);
            expect(documentJobService.claimRecovery).not.toHaveBeenCalled();
        });

        it("works while new enqueues are paused", async () => {
            await app.close();
            acceptingEnabled = "false";
            await buildApp();
            documentJobService.claimRecovery.mockResolvedValue({
                kind: "claimed",
                job: failedJob({ status: "failed", payload: originalPayload }),
            });

            const response = await claim();

            expect(response.status).toBe(200);
        });
    });

    describe("POST /eformsign-docs/jobs/:jobId/resolve", () => {
        const resolve = () => request(app.getHttpServer()).post(`/eformsign-docs/jobs/${JOB_ID}/resolve`);

        it("returns alreadyResolved false for a fresh resolution", async () => {
            documentJobService.resolveManually.mockResolvedValue({
                kind: "resolved",
                job: failedJob({ status: "completed", progressStep: "manual_resolved", lastErrorCode: null }),
            });

            const response = await resolve();

            expect(response.status).toBe(200);
            expect(response.body.alreadyResolved).toBe(false);
            expect(response.body.job).toEqual(expect.objectContaining({
                jobId: JOB_ID,
                progressStep: "manual_resolved",
                recoveryKind: null,
            }));
            expect(documentJobService.resolveManually.mock.calls[0][0]).toEqual({
                jobId: JOB_ID,
                branchId: "branch-a",
                userId: "user-a",
                now: expect.any(Date),
            });
            expect(documentJobService.claimRecovery).not.toHaveBeenCalled();
        });

        it("returns alreadyResolved true when the job was resolved before", async () => {
            documentJobService.resolveManually.mockResolvedValue({
                kind: "already_resolved",
                job: failedJob({ status: "completed", progressStep: "manual_resolved", lastErrorCode: null }),
            });

            const response = await resolve();

            expect(response.status).toBe(200);
            expect(response.body.alreadyResolved).toBe(true);
        });

        it.each([
            [{ kind: "not_found" }, 404, "RESOURCE_NOT_FOUND"],
            [{ kind: "claimed_by_other", expiresAt: new Date(CLAIM_EXPIRES_MS) }, 409, "MANUAL_RECOVERY_CLAIMED"],
            [{ kind: "invalid_state", status: "queued" }, 409, "JOB_NOT_RECOVERABLE"],
        ])("maps %j to %i", async (result, status, code) => {
            documentJobService.resolveManually.mockResolvedValue(result);

            const response = await resolve();

            expect(response.status).toBe(status);
            expect(response.body.code).toBe(code);
        });

        it("returns 401 without a user id and when the service rejects the user id", async () => {
            authUserId = undefined;
            const missing = await resolve();
            authUserId = "user-a";
            documentJobService.resolveManually.mockRejectedValue(new Error("INVALID_MANUAL_CLAIM_USER"));
            const invalid = await resolve();

            expect(missing.status).toBe(401);
            expect(invalid.status).toBe(401);
        });

        it("denies branch staff without the dispatch capability", async () => {
            authRole = "user";
            documentJobService.resolveManually.mockResolvedValue({
                kind: "resolved",
                job: failedJob({ status: "completed", progressStep: "manual_resolved", lastErrorCode: null }),
            });

            const response = await resolve();

            expect(response.status).toBe(403);
            expect(documentJobService.resolveManually).not.toHaveBeenCalled();
        });

        it("works while new enqueues are paused", async () => {
            await app.close();
            acceptingEnabled = "false";
            await buildApp();
            documentJobService.resolveManually.mockResolvedValue({
                kind: "resolved",
                job: failedJob({ status: "completed", progressStep: "manual_resolved" }),
            });

            const response = await resolve();

            expect(response.status).toBe(200);
        });
    });
});
