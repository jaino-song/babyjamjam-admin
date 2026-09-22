import { ExecutionContext, INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import { ConfigService } from "@nestjs/config";
import { EformsignDocService } from "application/services/eformsign-doc.service";
import { EformsignDocsEventBus } from "application/services/eformsign-docs-event-bus.service";
import { EformsignHeadlessProgressService } from "application/services/eformsign-headless-progress.service";
import { EformsignDocumentJobService } from "application/services/eformsign-document-job.service";
import { EformsignDispatchBoundaryService } from "application/services/eformsign-dispatch-boundary.service";
import { DispatchDocumentHeadlessUsecase } from "application/usecases/eformsign-doc/dispatch-document-headless.usecase";
import { FinalizeDocumentHeadlessUsecase } from "application/usecases/eformsign-doc/finalize-document-headless.usecase";
import { AdoptEformsignDocUsecase } from "application/usecases/eformsign-doc/adopt-eformsign-doc.usecase";
import { ListClientNamesByBranchUsecase } from "application/usecases/eformsign-doc/list-client-names-by-branch.usecase";
import { ListReviewStageContractsUsecase } from "application/usecases/eformsign-doc/list-review-stage-contracts.usecase";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { TenantGuard } from "infrastructure/tenant";
import { EformsignDocController } from "interface/controllers/eformsign-doc.controller";

/**
 * BJJ-319 phase 5-4a: the dispatch envelope contract is additive.
 *
 * Every pre-existing field (`ok`/`reason`/`fallbackHint`/document ids) stays
 * byte-identical; the response additionally carries the registered problem
 * `code`, the business `outcome`, and the `recovery` guidance. Ambiguous or
 * partial outcomes are business results (EM-STATE-01), not HTTP errors, so the
 * endpoint keeps answering 201 with `{ ok: false, ... }`.
 */
describe("POST /eformsign-docs/dispatch-headless (additive envelope)", () => {
    let app: INestApplication;
    let dispatchHeadlessUsecase: { execute: jest.Mock };

    const authGuard = {
        canActivate: (context: ExecutionContext) => {
            const req = context.switchToHttp().getRequest();
            req.user = { userId: "user-a", branchId: "branch-a", role: "admin", branchRole: "admin" };
            req.tenant = {
                userId: "user-a",
                branchId: "branch-a",
                globalRole: "admin",
                branchRole: "admin",
            };
            return true;
        },
    };

    const contractData = {
        customerName: "김고객",
        customerContact: "010-0000-0000",
        caretaker1Contact: "010-1111-2222",
    };

    beforeEach(async () => {
        dispatchHeadlessUsecase = { execute: jest.fn() };

        const moduleFixture: TestingModule = await Test.createTestingModule({
            controllers: [EformsignDocController],
            providers: [
                { provide: EformsignDocService, useValue: {} },
                { provide: ListClientNamesByBranchUsecase, useValue: {} },
                { provide: ListReviewStageContractsUsecase, useValue: {} },
                { provide: DispatchDocumentHeadlessUsecase, useValue: dispatchHeadlessUsecase },
                { provide: FinalizeDocumentHeadlessUsecase, useValue: {} },
                { provide: AdoptEformsignDocUsecase, useValue: {} },
                { provide: EformsignDocsEventBus, useValue: {} },
                { provide: EformsignHeadlessProgressService, useValue: {} },
                { provide: ConfigService, useValue: { get: jest.fn(() => undefined) } },
                { provide: EformsignDocumentJobService, useValue: {} },
                { provide: EformsignDispatchBoundaryService, useValue: {} },
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
        await app.init();
    });

    afterEach(async () => {
        await app.close();
    });

    it("forwards the additive code/outcome/recovery fields on an ambiguous failure", async () => {
        dispatchHeadlessUsecase.execute.mockResolvedValue({
            ok: false,
            reason: "remote_unconfirmed",
            fallbackHint: "manual_check",
            durationMs: 12,
            failedStep: "creating",
            code: "REMOTE_DOCUMENT_UNCONFIRMED",
            outcome: "UNKNOWN",
            recovery: { action: "CHECK_STATUS", retry: { mode: "NEVER" } },
        });

        const response = await request(app.getHttpServer())
            .post("/eformsign-docs/dispatch-headless")
            .send({ clientId: 7, contractData });

        // Still a business result (201 + ok:false), with the legacy fields
        // intact and the additive contract fields forwarded untouched.
        expect(response.status).toBe(201);
        expect(response.body).toEqual(expect.objectContaining({
            ok: false,
            durationMs: 12,
            reason: "remote_unconfirmed",
            failedStep: "creating",
            fallbackHint: "manual_check",
            code: "REMOTE_DOCUMENT_UNCONFIRMED",
            outcome: "UNKNOWN",
            recovery: { action: "CHECK_STATUS", retry: { mode: "NEVER" } },
        }));
    });

    it("keeps the success envelope unchanged, without additive failure fields", async () => {
        dispatchHeadlessUsecase.execute.mockResolvedValue({
            ok: true,
            documentId: "doc-1",
            durationMs: 30,
        });

        const response = await request(app.getHttpServer())
            .post("/eformsign-docs/dispatch-headless")
            .send({ clientId: 7, contractData });

        expect(response.status).toBe(201);
        expect(response.body).toEqual({ ok: true, documentId: "doc-1", durationMs: 30 });
    });
});
