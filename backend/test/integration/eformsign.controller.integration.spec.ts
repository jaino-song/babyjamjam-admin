import { ExecutionContext, INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { AreaTemplateService } from "application/services/area-template.service";
import { EformsignDocService } from "application/services/eformsign-doc.service";
import { EformsignService } from "application/services/eformsign.service";
import { PrismaService } from "infrastructure/database/prisma.service";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { TenantGuard } from "infrastructure/tenant";
import { EformsignController } from "interface/controllers/eformsign.controller";
import request from "supertest";

// Known transport-level flake (~1/8 full-suite runs under parallel-worker
// load, observed locally 2026-06-06 and once in CI): a supertest request
// intermittently dies with "socket hang up" on the early-400 validation
// paths. Retry masks only the transport race — a deterministic failure
// still fails on the retry.
jest.retryTimes(1, { logErrorsBeforeRetry: true });

describe("EformsignController (Integration)", () => {
    let app: INestApplication;
    let eformsignService: jest.Mocked<Pick<
        EformsignService,
        | "generateSignature"
        | "getAccessToken"
        | "refreshAccessToken"
        | "generateDocumentOptions"
        | "deleteDocuments"
        | "downloadDocumentFile"
        | "getAllDocuments"
        | "getInProgressDocuments"
    >>;
    let areaTemplateService: jest.Mocked<Pick<AreaTemplateService, "findByArea">>;
    let eformsignDocService: jest.Mocked<Pick<EformsignDocService, "findAll">>;
    let branchFindUnique: jest.Mock;

    const authGuard = {
        canActivate: (context: ExecutionContext) => {
            const requestContext = context.switchToHttp().getRequest();
            requestContext.user = {
                userId: "user-1",
                branchId: "branch-1",
                role: "owner",
                branchRole: "owner",
            };
            return true;
        },
    };

    beforeEach(async () => {
        const moduleFixture: TestingModule = await Test.createTestingModule({
            controllers: [EformsignController],
            providers: [
                {
                    provide: EformsignService,
                    useValue: {
                        generateSignature: jest.fn(),
                        getAccessToken: jest.fn(),
                        refreshAccessToken: jest.fn(),
                        generateDocumentOptions: jest.fn(),
                        deleteDocuments: jest.fn(),
                        downloadDocumentFile: jest.fn(),
                        getAllDocuments: jest.fn(),
                        getInProgressDocuments: jest.fn(),
                    },
                },
                {
                    provide: AreaTemplateService,
                    useValue: {
                        findByArea: jest.fn(),
                    },
                },
                {
                    provide: EformsignDocService,
                    useValue: {
                        findAll: jest.fn(),
                    },
                },
                {
                    provide: PrismaService,
                    useValue: {
                        branch: { findUnique: jest.fn() },
                    },
                },
            ],
        })
            .overrideGuard(JwtGuard)
            .useValue(authGuard)
            .overrideGuard(TenantGuard)
            .useValue(authGuard)
            .compile();

        app = moduleFixture.createNestApplication();
        app.useGlobalPipes(new ValidationPipe({ transform: true }));
        await app.init();

        eformsignService = moduleFixture.get(EformsignService);
        areaTemplateService = moduleFixture.get(AreaTemplateService);
        eformsignDocService = moduleFixture.get(EformsignDocService);
        branchFindUnique = (moduleFixture.get(PrismaService) as unknown as { branch: { findUnique: jest.Mock } }).branch.findUnique;
        // default: a non-incheon branch, so per-branch filtering applies
        branchFindUnique.mockResolvedValue({ slug: "gimpo" });
    });

    afterEach(async () => {
        await app.close();
    });

    it("rejects non-numeric signature execution time before service execution", async () => {
        const response = await request(app.getHttpServer())
            .post("/api/generate-signature")
            .send({ executionTime: "abc" });

        expect(response.status).toBe(400);
        expect(eformsignService.generateSignature).not.toHaveBeenCalled();
    });

    it("rejects missing refresh token before service execution", async () => {
        const response = await request(app.getHttpServer())
            .post("/api/refresh-token")
            .send({ executionTime: 1780000000000 });

        expect(response.status).toBe(400);
        expect(eformsignService.refreshAccessToken).not.toHaveBeenCalled();
    });

    it("rejects malformed contract data before generating document options", async () => {
        const response = await request(app.getHttpServer())
            .post("/api/generate-document")
            .send({
                contractData: {
                    customerName: "산모",
                },
                accessToken: "access-token",
                refreshToken: "refresh-token",
            });

        expect(response.status).toBe(400);
        expect(areaTemplateService.findByArea).not.toHaveBeenCalled();
        expect(eformsignService.generateDocumentOptions).not.toHaveBeenCalled();
    });

    it("rejects invalid delete permanence query before service execution", async () => {
        const response = await request(app.getHttpServer())
            .delete("/api/documents?accessToken=access-token&is_permanent=maybe")
            .send({ document_ids: ["doc-1"] });

        expect(response.status).toBe(400);
        expect(eformsignService.deleteDocuments).not.toHaveBeenCalled();
    });

    it("rejects invalid download file type before service execution", async () => {
        const response = await request(app.getHttpServer())
            .get("/api/documents/doc-1/download_files?accessToken=access-token&fileType=zip");

        expect(response.status).toBe(400);
        expect(eformsignService.downloadDocumentFile).not.toHaveBeenCalled();
    });

    it("returns only documents created by the current branch (getAllDocuments)", async () => {
        eformsignService.getAllDocuments.mockResolvedValue({
            documents: [
                { id: "branch-1-doc" },
                { id: "other-branch-doc" },
                { id: "unmapped-doc" },
            ],
            total_rows: 3,
            limit: 100,
            skip: 0,
        });
        eformsignDocService.findAll.mockResolvedValue([
            { documentId: "branch-1-doc" },
        ] as any);

        const response = await request(app.getHttpServer())
            .get("/api/documents?accessToken=access-token");

        expect(response.status).toBe(200);
        expect(response.body.documents).toEqual([{ id: "branch-1-doc" }]);
        expect(response.body.total_rows).toBe(1);
        expect(eformsignDocService.findAll).toHaveBeenCalledWith("branch-1");
    });

    it("filters per-type document lists to the current branch (no bypass)", async () => {
        eformsignService.getInProgressDocuments.mockResolvedValue({
            documents: [
                { id: "branch-1-doc" },
                { id: "other-branch-doc" },
            ],
        });
        eformsignDocService.findAll.mockResolvedValue([
            { documentId: "branch-1-doc" },
        ] as any);

        const response = await request(app.getHttpServer())
            .get("/api/documents/in-progress?accessToken=access-token");

        expect(response.status).toBe(200);
        expect(response.body.documents).toEqual([{ id: "branch-1-doc" }]);
        expect(eformsignDocService.findAll).toHaveBeenCalledWith("branch-1");
    });

    it("lets the incheon (HQ) branch see every document, including unmapped ones", async () => {
        branchFindUnique.mockResolvedValue({ slug: "incheon" });
        eformsignService.getAllDocuments.mockResolvedValue({
            documents: [
                { id: "branch-1-doc" },
                { id: "other-branch-doc" },
                { id: "unmapped-doc" },
            ],
            total_rows: 3,
            limit: 100,
            skip: 0,
        });
        // local mapping has only one doc, but incheon must bypass and see all
        eformsignDocService.findAll.mockResolvedValue([
            { documentId: "branch-1-doc" },
        ] as any);

        const response = await request(app.getHttpServer())
            .get("/api/documents?accessToken=access-token");

        expect(response.status).toBe(200);
        expect(response.body.documents).toEqual([
            { id: "branch-1-doc" },
            { id: "other-branch-doc" },
            { id: "unmapped-doc" },
        ]);
        expect(response.body.total_rows).toBe(3);
        expect(eformsignDocService.findAll).not.toHaveBeenCalled();
    });
});
