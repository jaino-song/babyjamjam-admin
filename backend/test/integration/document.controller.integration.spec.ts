import { ExecutionContext, INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { DocumentService } from "application/services/document.service";
import { FILE_STORAGE_PORT, FileStoragePort } from "domain/ports/file-storage.port";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { TenantGuard } from "infrastructure/tenant";
import { DocumentController } from "interface/controllers/document.controller";
import request from "supertest";

describe("DocumentController (Integration)", () => {
    let app: INestApplication;
    let documentService: jest.Mocked<DocumentService>;
    let fileStorage: jest.Mocked<FileStoragePort>;

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
            controllers: [DocumentController],
            providers: [
                {
                    provide: DocumentService,
                    useValue: {
                        create: jest.fn(),
                        findById: jest.fn(),
                        findByOrgId: jest.fn(),
                        findByCategoryId: jest.fn(),
                        findAll: jest.fn(),
                        update: jest.fn(),
                        delete: jest.fn(),
                    },
                },
                {
                    provide: FILE_STORAGE_PORT,
                    useValue: {
                        upload: jest.fn(),
                        download: jest.fn(),
                        delete: jest.fn(),
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

        documentService = moduleFixture.get(DocumentService);
        fileStorage = moduleFixture.get(FILE_STORAGE_PORT);
    });

    afterEach(async () => {
        await app.close();
    });

    it("should reject malformed upload tags before storage or persistence", async () => {
        const response = await request(app.getHttpServer())
            .post("/documents/upload")
            .field("name", "Contract")
            .field("categoryId", "contract")
            .field("tags", "not-json")
            .attach("file", Buffer.from("fake-file"), "contract.pdf");

        expect(response.status).toBe(400);
        expect(response.body.message).toBe("tags must be a valid JSON array");
        expect(fileStorage.upload).not.toHaveBeenCalled();
        expect(documentService.create).not.toHaveBeenCalled();
    });
});
