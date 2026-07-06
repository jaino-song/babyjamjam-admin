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
    let messageSenderApprovalService: jest.Mocked<MessageSenderApprovalService>;

    beforeEach(async () => {
        const mockSystemSettingService = {
            getAlimtalkProvider: jest.fn(),
            getAlimtalkProviderSetting: jest.fn(),
            setAlimtalkProvider: jest.fn(),
            isAlimtalkEnabled: jest.fn(),
        };
        const mockMessageSenderApprovalService = {
            approvePendingRequest: jest.fn(),
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
                    useValue: mockMessageSenderApprovalService,
                },
            ],
        })
            .overrideGuard(JwtGuard)
            .useValue({
                canActivate: (context: {
                    switchToHttp: () => {
                        getRequest: () => { user?: { userId: string; role: string } };
                    };
                }) => {
                    const req = context.switchToHttp().getRequest();
                    req.user = { userId: "owner-user-id", role: "owner" };
                    return true;
                },
            })
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
        messageSenderApprovalService = moduleFixture.get(MessageSenderApprovalService);
    });

    afterEach(async () => {
        await app?.close();
    });

    describe("GET /settings/alimtalk-provider", () => {
        it("should return current provider setting", async () => {
            const updatedAt = new Date("2026-05-28T12:00:00.000Z");
            systemSettingService.getAlimtalkProviderSetting.mockResolvedValue(
                new SystemSettingEntity("alimtalk_provider", "aligo_alimtalk", updatedAt)
            );

            const response = await request(app.getHttpServer())
                .get("/settings/alimtalk-provider");

            expect(response.status).toBe(200);
            expect(response.body).toEqual({
                provider: "aligo_alimtalk",
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
            systemSettingService.getAlimtalkProvider.mockResolvedValue("aligo_alimtalk");

            const response = await request(app.getHttpServer())
                .get("/settings/alimtalk-provider");

            expect(response.status).toBe(200);
            expect(response.body).toEqual({
                provider: "aligo_alimtalk",
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

        it("should update provider to aligo_alimtalk", async () => {
            const entity = new SystemSettingEntity(
                "alimtalk_provider",
                "aligo_alimtalk",
                new Date()
            );
            systemSettingService.setAlimtalkProvider.mockResolvedValue(entity);

            const response = await request(app.getHttpServer())
                .put("/settings/alimtalk-provider")
                .send({ provider: "aligo_alimtalk" });

            expect(response.status).toBe(200);
            expect(response.body.provider).toBe("aligo_alimtalk");
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

    describe("POST /settings/message-sender-approval/:branchId/approve", () => {
        it("should approve a pending message sender request as owner", async () => {
            const approvedAt = new Date("2026-06-05T00:00:00.000Z");
            messageSenderApprovalService.approvePendingRequest.mockResolvedValue({
                approvalStatus: "approved",
                requestedAt: new Date("2026-06-04T09:00:00.000Z"),
                approvedAt,
            });

            const response = await request(app.getHttpServer())
                .post("/settings/message-sender-approval/branch-1/approve");

            expect(response.status).toBe(201);
            expect(messageSenderApprovalService.approvePendingRequest).toHaveBeenCalledWith({
                branchId: "branch-1",
                userId: expect.any(String),
            });
            expect(response.body).toMatchObject({
                approvalStatus: "approved",
                isApproved: true,
                approvedAt: approvedAt.toISOString(),
            });
        });

        it("should require owner privileges", () => {
            const guards = Reflect.getMetadata(
                GUARDS_METADATA,
                SystemSettingController.prototype.approveMessageSenderApproval,
            ) ?? [];

            expect(guards).toContain(OwnerGuard);
        });
    });
});
