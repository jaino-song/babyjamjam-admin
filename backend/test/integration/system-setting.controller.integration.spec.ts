import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import request from "supertest";
import { SystemSettingController } from "interface/controllers/system-setting.controller";
import { SystemSettingService } from "application/services/system-setting.service";
import { MessageSenderApprovalService } from "application/services/message-sender-approval.service";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { OwnerGuard } from "infrastructure/auth/owner.guard";
import { OwnerOrAdminGuard } from "infrastructure/auth/owner-or-admin.guard";
import { TenantGuard } from "infrastructure/tenant";
import { SystemSettingEntity, AlimtalkProvider } from "domain/entities/system-setting.entity";

describe("SystemSettingController (Integration)", () => {
    let app: INestApplication;
    let systemSettingService: jest.Mocked<SystemSettingService>;

    beforeEach(async () => {
        const mockSystemSettingService = {
            getAlimtalkProvider: jest.fn(),
            getAlimtalkProviderSetting: jest.fn(),
            setAlimtalkProvider: jest.fn(),
            isAlimtalkEnabled: jest.fn(),
        };

        const moduleFixture: TestingModule = await Test.createTestingModule({
            controllers: [SystemSettingController],
            providers: [
                {
                    provide: SystemSettingService,
                    useValue: mockSystemSettingService,
                },
                {
                    provide: MessageSenderApprovalService,
                    useValue: {},
                },
            ],
        })
            .overrideGuard(JwtGuard)
            .useValue({ canActivate: () => true })
            .overrideGuard(TenantGuard)
            .useValue({ canActivate: () => true })
            .overrideGuard(OwnerGuard)
            .useValue({ canActivate: () => true })
            .overrideGuard(OwnerOrAdminGuard)
            .useValue({ canActivate: () => true })
            .compile();

        app = moduleFixture.createNestApplication();
        app.useGlobalPipes(new ValidationPipe({ transform: true }));
        await app.init();

        systemSettingService = moduleFixture.get(SystemSettingService);
    });

    afterEach(async () => {
        await app?.close();
    });

    describe("GET /settings/alimtalk-provider", () => {
        it("should return current provider setting", async () => {
            const updatedAt = new Date("2026-05-28T12:00:00.000Z");
            systemSettingService.getAlimtalkProviderSetting.mockResolvedValue(
                new SystemSettingEntity("alimtalk_provider", "aligo", updatedAt)
            );

            const response = await request(app.getHttpServer())
                .get("/settings/alimtalk-provider");

            expect(response.status).toBe(200);
            expect(response.body).toEqual({
                provider: "aligo",
                enabled: true,
                updatedAt: updatedAt.toISOString(),
            });
        });

        it("should return disabled state when provider is none", async () => {
            systemSettingService.getAlimtalkProviderSetting.mockResolvedValue(
                new SystemSettingEntity(
                    "alimtalk_provider",
                    "none",
                    new Date("2026-05-28T12:00:00.000Z")
                )
            );

            const response = await request(app.getHttpServer())
                .get("/settings/alimtalk-provider");

            expect(response.status).toBe(200);
            expect(response.body).toEqual({
                provider: "none",
                enabled: false,
                updatedAt: "2026-05-28T12:00:00.000Z",
            });
        });

        it("should return default provider without updatedAt when setting is not stored", async () => {
            systemSettingService.getAlimtalkProviderSetting.mockResolvedValue(null);
            systemSettingService.getAlimtalkProvider.mockResolvedValue("aligo");

            const response = await request(app.getHttpServer())
                .get("/settings/alimtalk-provider");

            expect(response.status).toBe(200);
            expect(response.body).toEqual({
                provider: "aligo",
                enabled: true,
            });
        });
    });

    describe("PUT /settings/alimtalk-provider", () => {
        it("should require owner/admin privileges", () => {
            const guards = Reflect.getMetadata(
                GUARDS_METADATA,
                SystemSettingController.prototype.updateAlimtalkProvider,
            ) ?? [];

            expect(guards).toContain(OwnerOrAdminGuard);
        });

        it("should update provider to channeltalk", async () => {
            const entity = new SystemSettingEntity(
                "alimtalk_provider",
                "channeltalk",
                new Date("2025-01-14T00:00:00Z")
            );
            systemSettingService.setAlimtalkProvider.mockResolvedValue(entity);

            const response = await request(app.getHttpServer())
                .put("/settings/alimtalk-provider")
                .send({ provider: "channeltalk" });

            expect(response.status).toBe(200);
            expect(response.body.provider).toBe("channeltalk");
            expect(response.body.enabled).toBe(true);
            expect(systemSettingService.setAlimtalkProvider).toHaveBeenCalledWith("channeltalk");
        });

        it("should update provider to aligo", async () => {
            const entity = new SystemSettingEntity(
                "alimtalk_provider",
                "aligo",
                new Date()
            );
            systemSettingService.setAlimtalkProvider.mockResolvedValue(entity);

            const response = await request(app.getHttpServer())
                .put("/settings/alimtalk-provider")
                .send({ provider: "aligo" });

            expect(response.status).toBe(200);
            expect(response.body.provider).toBe("aligo");
            expect(response.body.enabled).toBe(true);
        });

        it("should update provider to none (disabled)", async () => {
            const entity = new SystemSettingEntity(
                "alimtalk_provider",
                "none",
                new Date()
            );
            systemSettingService.setAlimtalkProvider.mockResolvedValue(entity);

            const response = await request(app.getHttpServer())
                .put("/settings/alimtalk-provider")
                .send({ provider: "none" });

            expect(response.status).toBe(200);
            expect(response.body.provider).toBe("none");
            expect(response.body.enabled).toBe(false);
        });

        it("should return 400 for invalid provider", async () => {
            const response = await request(app.getHttpServer())
                .put("/settings/alimtalk-provider")
                .send({ provider: "invalid_provider" });

            expect(response.status).toBe(400);
        });

        it("should return 400 for missing provider", async () => {
            const response = await request(app.getHttpServer())
                .put("/settings/alimtalk-provider")
                .send({});

            expect(response.status).toBe(400);
        });

        it("should return 400 for empty provider", async () => {
            const response = await request(app.getHttpServer())
                .put("/settings/alimtalk-provider")
                .send({ provider: "" });

            expect(response.status).toBe(400);
        });
    });
});
