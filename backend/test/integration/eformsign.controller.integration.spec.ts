import { ExecutionContext, INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { AreaTemplateService } from "application/services/area-template.service";
import { EformsignService } from "application/services/eformsign.service";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { TenantGuard } from "infrastructure/tenant";
import { EformsignController } from "interface/controllers/eformsign.controller";
import request from "supertest";

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
    >>;
    let areaTemplateService: jest.Mocked<Pick<AreaTemplateService, "findByArea">>;

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
                    },
                },
                {
                    provide: AreaTemplateService,
                    useValue: {
                        findByArea: jest.fn(),
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
});
