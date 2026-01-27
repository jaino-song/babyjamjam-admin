import { Test, TestingModule } from "@nestjs/testing";
import {
    BadRequestException,
    INestApplication,
    NotFoundException,
    UnauthorizedException,
    ValidationPipe,
} from "@nestjs/common";
import request from "supertest";
import { SystemTemplateController } from "interface/controllers/system-template.controller";
import { SystemTemplateService } from "application/services/system-template.service";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { SystemTemplateEntity, VariableValidationResult } from "domain/entities/system-template.entity";
import { SystemTemplateVersionEntity } from "domain/entities/system-template-version.entity";
import { SystemTemplateKey, SYSTEM_TEMPLATE_REGISTRY } from "domain/constants/system-template-registry";
import { SystemTemplateWithRegistryDto } from "application/dto/system-template-with-registry.dto";

describe("SystemTemplateController (Integration)", () => {
    let app: INestApplication;
    let service: jest.Mocked<SystemTemplateService>;

    const mockUserId = "test-user-id";

    const mockJwtGuard = {
        canActivate: jest.fn((context) => {
            const req = context.switchToHttp().getRequest();
            req.user = { userId: mockUserId, role: "admin" };
            return true;
        }),
    };

    type TemplateOverrides = Partial<{
        id: string;
        templateKey: SystemTemplateKey;
        content: string;
        createdAt: Date;
        updatedAt: Date;
    }>;

    const createMockTemplate = (overrides: TemplateOverrides = {}): SystemTemplateEntity => {
        return new SystemTemplateEntity(
            overrides.id ?? "template-id-1",
            overrides.templateKey ?? SystemTemplateKey.GREETING,
            overrides.content ?? "Hello {{name}}",
            overrides.createdAt ?? new Date("2025-01-01T00:00:00.000Z"),
            overrides.updatedAt ?? new Date("2025-01-02T00:00:00.000Z"),
        );
    };

    const createMockTemplateWithRegistry = (overrides: TemplateOverrides = {}): SystemTemplateWithRegistryDto => {
        const templateKey = overrides.templateKey ?? SystemTemplateKey.GREETING;
        const registry = SYSTEM_TEMPLATE_REGISTRY[templateKey];
        
        return {
            id: overrides.id ?? "template-id-1",
            templateKey,
            name: registry.name,
            description: registry.description,
            content: overrides.content ?? "Hello {{name}}",
            requiredVariables: registry.requiredVariables,
            customVariables: [],
            createdAt: overrides.createdAt ?? new Date("2025-01-01T00:00:00.000Z"),
            updatedAt: overrides.updatedAt ?? new Date("2025-01-02T00:00:00.000Z"),
        };
    };

    type VersionOverrides = Partial<{
        id: string;
        templateId: string;
        content: string;
        versionNumber: number;
        createdBy: string | null;
        createdAt: Date;
    }>;

    const createMockVersion = (overrides: VersionOverrides = {}): SystemTemplateVersionEntity => {
        return new SystemTemplateVersionEntity(
            overrides.id ?? "version-id-1",
            overrides.templateId ?? "template-id-1",
            overrides.content ?? "Hello {{name}}",
            overrides.versionNumber ?? 1,
            overrides.createdBy ?? mockUserId,
            overrides.createdAt ?? new Date("2025-01-03T00:00:00.000Z"),
        );
    };

    beforeEach(async () => {
        const mockService = {
            getAll: jest.fn(),
            getByKey: jest.fn(),
            update: jest.fn(),
            validate: jest.fn(),
            preview: jest.fn(),
            getVersionHistory: jest.fn(),
            getVersionContent: jest.fn(),
            rollback: jest.fn(),
            resetToDefault: jest.fn(),
        };

        const moduleFixture: TestingModule = await Test.createTestingModule({
            controllers: [SystemTemplateController],
            providers: [
                {
                    provide: SystemTemplateService,
                    useValue: mockService,
                },
            ],
        })
            .overrideGuard(JwtGuard)
            .useValue(mockJwtGuard)
            .compile();

        app = moduleFixture.createNestApplication();
        app.useGlobalPipes(new ValidationPipe({ transform: true }));
        await app.init();

        service = moduleFixture.get(SystemTemplateService);
    });

    afterEach(async () => {
        await app.close();
    });

    describe("GET /system-templates", () => {
        it("returns 7 templates", async () => {
            const templates = (Object.values(SystemTemplateKey) as SystemTemplateKey[]).map((key, idx) =>
                createMockTemplateWithRegistry({
                    id: `template-${idx + 1}`,
                    templateKey: key,
                    content: `Content for ${key}`,
                }),
            );
            service.getAll.mockResolvedValue(templates);

            const response = await request(app.getHttpServer())
                .get("/system-templates");

            expect(response.status).toBe(200);
            expect(response.body).toHaveLength(7);
            expect(service.getAll).toHaveBeenCalled();
        });

        it("returns 401 without auth", async () => {
            mockJwtGuard.canActivate.mockImplementationOnce(() => {
                throw new UnauthorizedException();
            });

            const response = await request(app.getHttpServer())
                .get("/system-templates");

            expect(response.status).toBe(401);
        });
    });

    describe("GET /system-templates/:key", () => {
        it("returns template with content", async () => {
            const template = createMockTemplateWithRegistry({
                id: "template-price-info",
                templateKey: SystemTemplateKey.PRICE_INFO,
                content: "Price info: {{name}}",
            });
            service.getByKey.mockResolvedValue(template);

            const response = await request(app.getHttpServer())
                .get(`/system-templates/${SystemTemplateKey.PRICE_INFO}`);

            expect(response.status).toBe(200);
            expect(response.body.templateKey).toBe(SystemTemplateKey.PRICE_INFO);
            expect(response.body.content).toBe("Price info: {{name}}");
            expect(service.getByKey).toHaveBeenCalledWith(SystemTemplateKey.PRICE_INFO);
        });

        it("returns 404 for invalid key", async () => {
            service.getByKey.mockRejectedValue(new NotFoundException("Template not found"));

            const response = await request(app.getHttpServer())
                .get("/system-templates/INVALID_KEY");

            expect(response.status).toBe(404);
        });
    });

    describe("PUT /system-templates/:key", () => {
        it("updates content successfully", async () => {
            const updated = createMockTemplate({
                id: "template-reminder",
                templateKey: SystemTemplateKey.REMINDER,
                content: "Updated content {{name}}",
            });
            service.update.mockResolvedValue(updated);

            const response = await request(app.getHttpServer())
                .put(`/system-templates/${SystemTemplateKey.REMINDER}`)
                .send({ content: "Updated content {{name}}" });

            expect(response.status).toBe(200);
            expect(response.body.content).toBe("Updated content {{name}}");
            expect(service.update).toHaveBeenCalledWith(
                SystemTemplateKey.REMINDER,
                "Updated content {{name}}",
                mockUserId,
                undefined,
            );
        });

        it("returns 400 for missing variables", async () => {
            service.update.mockRejectedValue(new BadRequestException("Missing required variables"));

            const response = await request(app.getHttpServer())
                .put(`/system-templates/${SystemTemplateKey.PRICE_INFO}`)
                .send({ content: "Hello" });

            expect(response.status).toBe(400);
        });
    });

    describe("POST /system-templates/:key/validate", () => {
        it("returns valid for correct content", async () => {
            const validation: VariableValidationResult = {
                valid: true,
                missingVariables: [],
                unknownVariables: [],
                syntaxErrors: [],
            };
            service.validate.mockResolvedValue(validation);

            const response = await request(app.getHttpServer())
                .post(`/system-templates/${SystemTemplateKey.THANKS}/validate`)
                .send({ content: "Hello {{name}}" });

            expect(response.status).toBe(201);
            expect(response.body).toEqual(validation);
            expect(service.validate).toHaveBeenCalledWith(SystemTemplateKey.THANKS, "Hello {{name}}");
        });

        it("returns errors for invalid content", async () => {
            const validation: VariableValidationResult = {
                valid: false,
                missingVariables: ["name"],
                unknownVariables: ["unknown"],
                syntaxErrors: ["템플릿에 닫히지 않은 {{ 가 있습니다"],
            };
            service.validate.mockResolvedValue(validation);

            const response = await request(app.getHttpServer())
                .post(`/system-templates/${SystemTemplateKey.THANKS}/validate`)
                .send({ content: "Hello {{unknown}} {{" });

            expect(response.status).toBe(201);
            expect(response.body.valid).toBe(false);
            expect(response.body.missingVariables).toContain("name");
        });
    });

    describe("POST /system-templates/:key/preview", () => {
        it("renders with provided data", async () => {
            service.preview.mockResolvedValue("Hello Kim");

            const response = await request(app.getHttpServer())
                .post(`/system-templates/${SystemTemplateKey.THANKS}/preview`)
                .send({ data: { name: "Kim" } });

            expect(response.status).toBe(201);
            expect(response.text).toBe("Hello Kim");
            expect(service.preview).toHaveBeenCalledWith(SystemTemplateKey.THANKS, { name: "Kim" }, undefined);
        });

        it("uses custom content when provided", async () => {
            service.preview.mockResolvedValue("Custom: Kim");

            const response = await request(app.getHttpServer())
                .post(`/system-templates/${SystemTemplateKey.THANKS}/preview`)
                .send({
                    content: "Custom: {{name}}",
                    data: { name: "Kim" },
                });

            expect(response.status).toBe(201);
            expect(response.text).toBe("Custom: Kim");
            expect(service.preview).toHaveBeenCalledWith(
                SystemTemplateKey.THANKS,
                { name: "Kim" },
                "Custom: {{name}}",
            );
        });
    });

    describe("GET /system-templates/:key/versions", () => {
        it("returns versions without content", async () => {
            const versions = [
                createMockVersion({ versionNumber: 1, content: "v1" }),
                createMockVersion({ versionNumber: 2, content: "v2" }),
            ];
            service.getVersionHistory.mockResolvedValue(versions);

            const response = await request(app.getHttpServer())
                .get(`/system-templates/${SystemTemplateKey.SURVEY}/versions`);

            expect(response.status).toBe(200);
            expect(response.body).toHaveLength(2);
            expect(response.body[0]).not.toHaveProperty("content");
            expect(service.getVersionHistory).toHaveBeenCalledWith(SystemTemplateKey.SURVEY);
        });
    });

    describe("GET /system-templates/:key/versions/:versionNumber", () => {
        it("returns version with content", async () => {
            const version = createMockVersion({ versionNumber: 3, content: "Version 3 content" });
            service.getVersionContent.mockResolvedValue(version);

            const response = await request(app.getHttpServer())
                .get(`/system-templates/${SystemTemplateKey.SERVICE_INFO}/versions/3`);

            expect(response.status).toBe(200);
            expect(response.body.versionNumber).toBe(3);
            expect(response.body.content).toBe("Version 3 content");
            expect(service.getVersionContent).toHaveBeenCalledWith(SystemTemplateKey.SERVICE_INFO, 3);
        });

        it("returns 404 for non-existent", async () => {
            service.getVersionContent.mockRejectedValue(new NotFoundException("Version not found"));

            const response = await request(app.getHttpServer())
                .get(`/system-templates/${SystemTemplateKey.SERVICE_INFO}/versions/999`);

            expect(response.status).toBe(404);
        });
    });

    describe("POST /system-templates/:key/rollback/:versionNumber", () => {
        it("rollbacks to version", async () => {
            const rolledBack = createMockTemplate({
                id: "rolled-back",
                templateKey: SystemTemplateKey.INFO,
                content: "Rolled back content",
            });
            service.rollback.mockResolvedValue(rolledBack);

            const response = await request(app.getHttpServer())
                .post(`/system-templates/${SystemTemplateKey.INFO}/rollback/2`);

            expect(response.status).toBe(201);
            expect(response.body.content).toBe("Rolled back content");
            expect(service.rollback).toHaveBeenCalledWith(SystemTemplateKey.INFO, 2, mockUserId);
        });

        it("returns 404 for non-existent", async () => {
            service.rollback.mockRejectedValue(new NotFoundException("Version not found"));

            const response = await request(app.getHttpServer())
                .post(`/system-templates/${SystemTemplateKey.INFO}/rollback/999`);

            expect(response.status).toBe(404);
        });
    });

    describe("POST /system-templates/:key/reset", () => {
        it("resets to default content", async () => {
            const reset = createMockTemplate({
                id: "reset-id",
                templateKey: SystemTemplateKey.GREETING,
                content: "Default greeting",
            });
            service.resetToDefault.mockResolvedValue(reset);

            const response = await request(app.getHttpServer())
                .post(`/system-templates/${SystemTemplateKey.GREETING}/reset`);

            expect(response.status).toBe(201);
            expect(response.body.content).toBe("Default greeting");
            expect(service.resetToDefault).toHaveBeenCalledWith(SystemTemplateKey.GREETING, mockUserId);
        });
    });
});
