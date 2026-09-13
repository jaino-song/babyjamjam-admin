import { Test, TestingModule } from "@nestjs/testing";
import {
    ForbiddenException,
    INestApplication,
    UnauthorizedException,
    ValidationPipe,
} from "@nestjs/common";
import request from "supertest";
import { BranchSystemTemplateController } from "interface/controllers/branch-system-template.controller";
import { SystemTemplateService } from "application/services/system-template.service";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { TenantGuard } from "infrastructure/tenant/tenant.guard";
import { SystemTemplateKey } from "domain/constants/system-template-registry";
import { SystemTemplateEntity } from "domain/entities/system-template.entity";

describe("BranchSystemTemplateController (Integration)", () => {
    let app: INestApplication;
    let service: jest.Mocked<SystemTemplateService>;

    const branchId = "branch-a";
    const userId = "user-a";
    const currentTenant = {
        userId,
        branchId,
        globalRole: "admin",
        branchRole: "user",
    };

    const currentUser = {
        userId,
        branchId,
        role: "admin",
    };

    const mockJwtGuard = {
        canActivate: jest.fn((context) => {
            context.switchToHttp().getRequest().user = currentUser;
            return true;
        }),
    };

    const mockTenantGuard = {
        canActivate: jest.fn((context) => {
            context.switchToHttp().getRequest().tenant = currentTenant;
            return true;
        }),
    };

    const createTemplate = (content = "Hello {{name}}") => new SystemTemplateEntity(
        "template-greeting",
        SystemTemplateKey.GREETING,
        content,
        new Date("2026-09-10T00:00:00.000Z"),
        new Date("2026-09-10T00:00:00.000Z"),
    );

    beforeEach(async () => {
        const mockService = {
            getAllForBranch: jest.fn(),
            getByKeyForBranch: jest.fn(),
            updateForBranch: jest.fn(),
        };

        const moduleFixture: TestingModule = await Test.createTestingModule({
            controllers: [BranchSystemTemplateController],
            providers: [
                {
                    provide: SystemTemplateService,
                    useValue: mockService,
                },
            ],
        })
            .overrideGuard(JwtGuard)
            .useValue(mockJwtGuard)
            .overrideGuard(TenantGuard)
            .useValue(mockTenantGuard)
            .compile();

        app = moduleFixture.createNestApplication();
        app.useGlobalPipes(new ValidationPipe({ transform: true }));
        await app.init();
        service = moduleFixture.get(SystemTemplateService);
    });

    afterEach(async () => {
        await app.close();
        jest.clearAllMocks();
    });

    it("lists templates for the verified active branch", async () => {
        service.getAllForBranch.mockResolvedValue([createTemplate()] as never);

        const response = await request(app.getHttpServer())
            .get("/branch-system-templates")
            .query({ expectedBranchId: branchId });

        expect(response.status).toBe(200);
        expect(service.getAllForBranch).toHaveBeenCalledWith(branchId);
    });

    it("reads one template for the verified active branch", async () => {
        service.getByKeyForBranch.mockResolvedValue({
            ...createTemplate(),
            templateKey: SystemTemplateKey.GREETING,
        } as never);

        const response = await request(app.getHttpServer())
            .get(`/branch-system-templates/${SystemTemplateKey.GREETING}`);

        expect(response.status).toBe(200);
        expect(service.getByKeyForBranch).toHaveBeenCalledWith(branchId, SystemTemplateKey.GREETING);
    });

    it("allows an ordinary active branch member to edit only the verified branch", async () => {
        service.updateForBranch.mockResolvedValue(createTemplate("Updated {{name}}"));

        const response = await request(app.getHttpServer())
            .put(`/branch-system-templates/${SystemTemplateKey.GREETING}?expectedBranchId=${branchId}`)
            .send({
                branchId: "attacker-branch",
                content: "Updated {{name}}",
                customVariables: [{ key: "name", label: "이름", required: true }],
            });

        expect(response.status).toBe(200);
        expect(service.updateForBranch).toHaveBeenCalledWith(
            branchId,
            SystemTemplateKey.GREETING,
            "Updated {{name}}",
            userId,
            [{ key: "name", label: "이름", required: true }],
        );
    });

    it.each([
        ["GET", "/branch-system-templates", "getAllForBranch"],
        ["GET", `/branch-system-templates/${SystemTemplateKey.GREETING}`, "getByKeyForBranch"],
        ["PUT", `/branch-system-templates/${SystemTemplateKey.GREETING}`, "updateForBranch"],
    ])("rejects a stale expected branch context for %s %s", async (method, path, serviceMethod) => {
        const response = method === "PUT"
            ? await request(app.getHttpServer())
                .put(`${path}?expectedBranchId=branch-b`)
                .send({ content: "Updated {{name}}" })
            : await request(app.getHttpServer())
                .get(`${path}?expectedBranchId=branch-b`);

        expect(response.status).toBe(409);
        expect((service as unknown as Record<string, jest.Mock>)[serviceMethod]).not.toHaveBeenCalled();
    });

    it("rejects requests without a verified active branch", async () => {
        mockTenantGuard.canActivate.mockImplementationOnce((context) => {
            context.switchToHttp().getRequest().tenant = undefined;
            return true;
        });

        const response = await request(app.getHttpServer())
            .get("/branch-system-templates");

        expect(response.status).toBe(403);
        expect(service.getAllForBranch).not.toHaveBeenCalled();
    });

    it("rejects a user whose active branch membership is missing", async () => {
        mockTenantGuard.canActivate.mockImplementationOnce(() => {
            throw new ForbiddenException("Access denied to this branch");
        });

        const response = await request(app.getHttpServer())
            .get("/branch-system-templates");

        expect(response.status).toBe(403);
        expect(service.getAllForBranch).not.toHaveBeenCalled();
    });

    it("does not let a captured branch id select another verified branch", async () => {
        mockTenantGuard.canActivate.mockImplementationOnce((context) => {
            context.switchToHttp().getRequest().tenant = {
                ...currentTenant,
                branchId: "branch-b",
            };
            return true;
        });

        const response = await request(app.getHttpServer())
            .get("/branch-system-templates")
            .query({ expectedBranchId: branchId });

        expect(response.status).toBe(409);
        expect(service.getAllForBranch).not.toHaveBeenCalled();
    });

    it("preserves the existing authentication guard boundary", async () => {
        mockJwtGuard.canActivate.mockImplementationOnce(() => {
            throw new UnauthorizedException();
        });

        const response = await request(app.getHttpServer())
            .get("/branch-system-templates");

        expect(response.status).toBe(401);
    });
});
