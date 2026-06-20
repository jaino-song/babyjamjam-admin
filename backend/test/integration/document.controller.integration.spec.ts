import { ExecutionContext, ForbiddenException, INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { DocumentService } from "application/services/document.service";
import { DocumentEntity } from "domain/entities/document.entity";
import {
    FILE_STORAGE_PORT,
    FileStorageObjectNotFoundError,
    FileStoragePort,
} from "domain/ports/file-storage.port";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { TenantGuard } from "infrastructure/tenant";
import { DocumentController } from "interface/controllers/document.controller";
import request from "supertest";

describe("DocumentController (Integration)", () => {
    let app: INestApplication;
    let documentService: jest.Mocked<DocumentService>;
    let fileStorage: jest.Mocked<FileStoragePort>;

    function createDocumentEntity(
        orgId: string,
        storageUrl: string | null = "https://example.test/contract.pdf",
    ): DocumentEntity {
        return DocumentEntity.reconstitute(
            "doc-1",
            "Contract",
            null,
            "contract",
            ["signed"],
            "application/pdf",
            100,
            "documents/contract.pdf",
            storageUrl,
            orgId,
            "user-1",
            new Date("2026-01-01T00:00:00.000Z"),
            new Date("2026-01-01T00:00:00.000Z"),
        );
    }

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
                        createSignedUrl: jest.fn(),
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

    it("should use tenant branch as document metadata branch when creating documents", async () => {
        fileStorage.createSignedUrl.mockResolvedValue("https://example.test/signed-contract.pdf");
        documentService.create.mockResolvedValue(createDocumentEntity("branch-1", null));

        const response = await request(app.getHttpServer())
            .post("/documents")
            .send({
                name: "Contract",
                categoryId: "contract",
                tags: ["signed"],
                mimetype: "application/pdf",
                filesize: 100,
                storagepath: "documents/contract.pdf",
                storageurl: "https://example.test/contract.pdf",
                branchid: "branch-2",
                uploadedby: "user-1",
            });

        expect(response.status).toBe(201);
        expect(response.body.orgId).toBe("branch-1");
        expect(response.body.storageUrl).toBe("https://example.test/signed-contract.pdf");
        expect(documentService.create).toHaveBeenCalledWith(
            "branch-1",
            expect.objectContaining({
                branchid: "branch-1",
            }),
        );
        expect(documentService.create.mock.calls[0]?.[1]).not.toHaveProperty("storageurl");
        expect(fileStorage.createSignedUrl).toHaveBeenCalledWith("documents/contract.pdf");
    });

    it("should reject unavailable storage paths before signing a URL", async () => {
        documentService.create.mockRejectedValue(new ForbiddenException("storage path unavailable"));

        const response = await request(app.getHttpServer())
            .post("/documents")
            .send({
                name: "Contract",
                categoryId: "contract",
                tags: ["signed"],
                mimetype: "application/pdf",
                filesize: 100,
                storagepath: "documents/shared.pdf",
                uploadedby: "user-1",
            });

        expect(response.status).toBe(403);
        expect(response.body.message).toBe("storage path unavailable");
        expect(fileStorage.createSignedUrl).not.toHaveBeenCalled();
    });

    it("should use tenant branch as document metadata branch when uploading documents", async () => {
        fileStorage.upload.mockResolvedValue("https://example.test/signed-contract.pdf");
        documentService.create.mockResolvedValue(createDocumentEntity("branch-1", null));

        const response = await request(app.getHttpServer())
            .post("/documents/upload")
            .field("name", "Contract")
            .field("categoryId", "contract")
            .field("tags", JSON.stringify(["signed"]))
            .field("branchid", "branch-2")
            .attach("file", Buffer.from("fake-file"), "contract.pdf");

        expect(response.status).toBe(201);
        expect(response.body.orgId).toBe("branch-1");
        expect(response.body.storageUrl).toBe("https://example.test/signed-contract.pdf");
        expect(documentService.create).toHaveBeenCalledWith(
            "branch-1",
            expect.objectContaining({
                branchid: "branch-1",
            }),
        );
        expect(documentService.create.mock.calls[0]?.[1]).not.toHaveProperty("storageurl");
        expect(fileStorage.createSignedUrl).not.toHaveBeenCalled();
    });

    it("should use tenant user as document uploader when uploading documents", async () => {
        fileStorage.upload.mockResolvedValue("https://example.test/signed-contract.pdf");
        documentService.create.mockResolvedValue(createDocumentEntity("branch-1", null));

        const response = await request(app.getHttpServer())
            .post("/documents/upload")
            .field("name", "Contract")
            .field("categoryId", "contract")
            .field("tags", JSON.stringify(["signed"]))
            .field("uploadedby", "attacker-user")
            .field("uploadedBy", "camel-attacker-user")
            .attach("file", Buffer.from("fake-file"), "contract.pdf");

        expect(response.status).toBe(201);
        expect(documentService.create).toHaveBeenCalledWith(
            "branch-1",
            expect.objectContaining({
                uploadedby: "user-1",
            }),
        );
    });

    it("should return document list metadata without signing storage URLs", async () => {
        documentService.findAll.mockResolvedValue([
            createDocumentEntity("branch-1", null),
        ]);
        fileStorage.createSignedUrl.mockRejectedValue(new Error("storage unavailable"));

        const response = await request(app.getHttpServer()).get("/documents");

        expect(response.status).toBe(200);
        expect(response.body).toEqual([
            expect.objectContaining({
                id: "doc-1",
                storagePath: "documents/contract.pdf",
                storageUrl: null,
            }),
        ]);
        expect(documentService.findAll).toHaveBeenCalledWith("branch-1");
        expect(fileStorage.createSignedUrl).not.toHaveBeenCalled();
    });

    it("should sign stored document paths when returning a document detail", async () => {
        documentService.findById.mockResolvedValue(
            createDocumentEntity("branch-1", "https://public.example.test/contract.pdf"),
        );
        fileStorage.createSignedUrl.mockResolvedValue("https://example.test/signed-contract.pdf");

        const response = await request(app.getHttpServer()).get("/documents/doc-1");

        expect(response.status).toBe(200);
        expect(response.body.storageUrl).toBe("https://example.test/signed-contract.pdf");
        expect(fileStorage.createSignedUrl).toHaveBeenCalledWith("documents/contract.pdf");
    });

    it("should return not found when a document detail file is missing from storage", async () => {
        documentService.findById.mockResolvedValue(createDocumentEntity("branch-1", null));
        fileStorage.createSignedUrl.mockRejectedValue(
            new FileStorageObjectNotFoundError("documents/contract.pdf", "signed-url"),
        );

        const response = await request(app.getHttpServer()).get("/documents/doc-1");

        expect(response.status).toBe(404);
        expect(response.body.message).toBe("Document file not found");
    });

    it("should return not found when a document file is missing from storage", async () => {
        documentService.findById.mockResolvedValue(createDocumentEntity("branch-1", null));
        fileStorage.download.mockRejectedValue(new Error("Failed to download: Object not found"));

        const response = await request(app.getHttpServer()).get("/documents/doc-1/download");

        expect(response.status).toBe(404);
        expect(response.body.message).toBe("Document file not found");
    });
});
