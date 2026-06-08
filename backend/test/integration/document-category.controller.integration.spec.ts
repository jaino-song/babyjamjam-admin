import { ExecutionContext, INestApplication, ValidationPipe } from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { Test, TestingModule } from "@nestjs/testing";
import { DocumentCategoryService } from "application/services/document-category.service";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { OwnerOrAdminGuard } from "infrastructure/auth/owner-or-admin.guard";
import { TenantGuard } from "infrastructure/tenant";
import { DocumentCategoryController } from "interface/controllers/document-category.controller";
import request from "supertest";

describe("DocumentCategoryController (Integration)", () => {
    let app: INestApplication;
    let documentCategoryService: jest.Mocked<DocumentCategoryService>;

    const createMockCategory = () => ({
        id: "category-1",
        value: "contract",
        label: "계약서",
        color: "primary",
        isCustom: false,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
    });

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
            controllers: [DocumentCategoryController],
            providers: [
                {
                    provide: DocumentCategoryService,
                    useValue: {
                        findAll: jest.fn(),
                        create: jest.fn(),
                        delete: jest.fn(),
                    },
                },
            ],
        })
            .overrideGuard(JwtGuard)
            .useValue(authGuard)
            .overrideGuard(TenantGuard)
            .useValue(authGuard)
            .overrideGuard(OwnerOrAdminGuard)
            .useValue({ canActivate: () => true })
            .compile();

        app = moduleFixture.createNestApplication();
        app.useGlobalPipes(new ValidationPipe({ transform: true }));
        await app.init();

        documentCategoryService = moduleFixture.get(DocumentCategoryService);
    });

    afterEach(async () => {
        await app.close();
    });

    it("should require JWT and tenant guards at the controller boundary", () => {
        const guards = Reflect.getMetadata(GUARDS_METADATA, DocumentCategoryController) ?? [];

        expect(guards).toContain(JwtGuard);
        expect(guards).toContain(TenantGuard);
    });

    it.each([
        ["create"],
        ["delete"],
    ] as const)("should require owner/admin privileges for %s", (methodName) => {
        const guards = Reflect.getMetadata(
            GUARDS_METADATA,
            DocumentCategoryController.prototype[methodName],
        ) ?? [];

        expect(guards).toContain(OwnerOrAdminGuard);
    });

    it("should list categories scoped to the selected branch", async () => {
        const category = createMockCategory();
        documentCategoryService.findAll.mockResolvedValue([category]);

        const response = await request(app.getHttpServer()).get("/document-categories");

        expect(response.status).toBe(200);
        expect(documentCategoryService.findAll).toHaveBeenCalledWith("branch-1");
    });

    it("should create custom categories in the selected branch", async () => {
        const category = createMockCategory();
        documentCategoryService.create.mockResolvedValue({ ...category, isCustom: true });

        const response = await request(app.getHttpServer())
            .post("/document-categories")
            .send({ value: "branch-contract", label: "Branch Contract", color: "primary" });

        expect(response.status).toBe(201);
        expect(documentCategoryService.create).toHaveBeenCalledWith({
            branchId: "branch-1",
            value: "branch-contract",
            label: "Branch Contract",
            color: "primary",
        });
    });

    it("should delete custom categories only in the selected branch", async () => {
        documentCategoryService.delete.mockResolvedValue(undefined);

        const response = await request(app.getHttpServer()).delete("/document-categories/category-1");

        expect(response.status).toBe(200);
        expect(documentCategoryService.delete).toHaveBeenCalledWith("branch-1", "category-1");
    });
});
