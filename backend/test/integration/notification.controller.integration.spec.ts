import { ExecutionContext, ForbiddenException, INestApplication, ValidationPipe } from "@nestjs/common";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import request from "supertest";
import { NotificationService } from "application/services/notification.service";
import { BranchManagerGuard } from "infrastructure/auth/branch-manager.guard";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { OwnerOrAdminGuard } from "infrastructure/auth/owner-or-admin.guard";
import { TenantGuard } from "infrastructure/tenant";
import { NotificationController } from "interface/controllers/notification.controller";

describe("NotificationController", () => {
    const getMethodGuards = (
        methodName: "sendNotification" | "broadcastNotification" | "testBroadcast" | "listRecipients",
    ) => {
        return Reflect.getMetadata(
            GUARDS_METADATA,
            NotificationController.prototype[methodName],
        ) ?? [];
    };

    it("should protect the development test broadcast endpoint with auth and admin guards", () => {
        const guards = getMethodGuards("testBroadcast");

        expect(guards).toContain(JwtGuard);
        expect(guards).toContain(TenantGuard);
        expect(guards).toContain(OwnerOrAdminGuard);
    });

    it.each(["sendNotification", "broadcastNotification", "listRecipients"] as const)(
        "protects %s with tenant branch-manager authority",
        (methodName) => {
            const guards = getMethodGuards(methodName);

            expect(guards).toContain(JwtGuard);
            expect(guards).toContain(TenantGuard);
            expect(guards).toContain(BranchManagerGuard);
            expect(guards).not.toContain(OwnerOrAdminGuard);
        },
    );

    it("should block the test broadcast endpoint in production before broadcasting", async () => {
        const notificationService = {
            broadcastNotification: jest.fn(),
        };
        const configService = {
            get: jest.fn().mockReturnValue("production"),
        };
        const controller = new NotificationController(
            notificationService as unknown as NotificationService,
            configService as unknown as ConfigService,
        );

        await expect(controller.testBroadcast({ branchId: "branch-a" })).rejects.toBeInstanceOf(ForbiddenException);
        expect(notificationService.broadcastNotification).not.toHaveBeenCalled();
    });

    it("binds unsubscribe to the authenticated request user", async () => {
        const notificationService = {
            unsubscribePush: jest.fn().mockResolvedValue(undefined),
        };
        const controller = new NotificationController(
            notificationService as unknown as NotificationService,
            { get: jest.fn() } as unknown as ConfigService,
        );

        await expect(controller.unsubscribe(
            { branchId: "branch-a" },
            { user: { userId: "user-b", role: "user" } },
            { endpoint: "https://push.example/shared-endpoint" },
        )).resolves.toEqual({ success: true });
        expect(notificationService.unsubscribePush).toHaveBeenCalledWith(
            "branch-a",
            "user-b",
            "https://push.example/shared-endpoint",
        );
    });

    it("reconciles subscribe through the authenticated request user", async () => {
        const notificationService = {
            subscribePush: jest.fn().mockResolvedValue(undefined),
        };
        const controller = new NotificationController(
            notificationService as unknown as NotificationService,
            { get: jest.fn() } as unknown as ConfigService,
        );

        await expect(controller.subscribe(
            { branchId: "branch-a" },
            { user: { userId: "user-b", role: "user" } },
            {
                endpoint: "https://push.example/shared-endpoint",
                p256dh: "p256dh-b",
                auth: "auth-b",
                userAgent: "test-agent",
            },
        )).resolves.toEqual({ success: true });
        expect(notificationService.subscribePush).toHaveBeenCalledWith(
            "branch-a",
            "user-b",
            "https://push.example/shared-endpoint",
            "p256dh-b",
            "auth-b",
            "test-agent",
        );
    });

    it("sends a manual notification with background delivery mode (BJJ-356)", async () => {
        const notification = { id: 1, title: "t", body: "b", data: null, sentAt: new Date(), readAt: null, isRead: () => false };
        const notificationService = {
            sendNotification: jest.fn().mockResolvedValue(notification),
        };
        const controller = new NotificationController(
            notificationService as unknown as NotificationService,
            { get: jest.fn() } as unknown as ConfigService,
        );

        await controller.sendNotification(
            { branchId: "branch-a" },
            { userId: "user-b", title: "t", body: "b" },
        );

        expect(notificationService.sendNotification).toHaveBeenCalledWith(
            "branch-a",
            "user-b",
            "t",
            "b",
            undefined,
            { deliveryMode: "background" },
        );
    });

    it("broadcasts a manual notification with background delivery mode (BJJ-356)", async () => {
        const notificationService = {
            broadcastNotification: jest.fn().mockResolvedValue({ sent: 2, failed: 0 }),
        };
        const controller = new NotificationController(
            notificationService as unknown as NotificationService,
            { get: jest.fn() } as unknown as ConfigService,
        );

        await expect(controller.broadcastNotification(
            { branchId: "branch-a" },
            { title: "t", body: "b" },
        )).resolves.toEqual({ sent: 2, failed: 0 });

        expect(notificationService.broadcastNotification).toHaveBeenCalledWith(
            "branch-a",
            "t",
            "b",
            undefined,
            { deliveryMode: "background" },
        );
    });

    it("keeps the development test-broadcast endpoint on the default awaited delivery mode", async () => {
        const notificationService = {
            broadcastNotification: jest.fn().mockResolvedValue({ sent: 0, failed: 0 }),
        };
        const configService = {
            get: jest.fn().mockReturnValue("development"),
        };
        const controller = new NotificationController(
            notificationService as unknown as NotificationService,
            configService as unknown as ConfigService,
        );

        await controller.testBroadcast({ branchId: "branch-a" });

        const [, , , , options] = notificationService.broadcastNotification.mock.calls[0] as unknown as [
            string, string, string, Record<string, unknown> | undefined, unknown,
        ];
        expect(options).toBeUndefined();
    });
});

describe("GET /notifications/recipients (HTTP integration)", () => {
    const branchId = "branch-a";
    let app: INestApplication;
    let notificationService: { listRecipients: jest.Mock };
    let authRole: string;

    beforeEach(async () => {
        authRole = "manager";
        notificationService = {
            listRecipients: jest.fn(),
        };

        const mockAuthGuard = {
            canActivate: (context: ExecutionContext) => {
                const requestContext = context.switchToHttp().getRequest();
                requestContext.tenant = {
                    userId: "user-1",
                    branchId,
                    globalRole: authRole,
                    branchRole: authRole,
                };
                return true;
            },
        };

        const moduleFixture: TestingModule = await Test.createTestingModule({
            controllers: [NotificationController],
            providers: [
                BranchManagerGuard,
                {
                    provide: NotificationService,
                    useValue: notificationService,
                },
                {
                    provide: ConfigService,
                    useValue: { get: jest.fn() },
                },
            ],
        })
            .overrideGuard(JwtGuard)
            .useValue(mockAuthGuard)
            .overrideGuard(TenantGuard)
            .useValue(mockAuthGuard)
            .compile();

        app = moduleFixture.createNestApplication();
        app.useGlobalPipes(new ValidationPipe({ transform: true }));
        await app.init();
    });

    afterEach(async () => {
        await app.close();
    });

    it("returns 200 with the requesting branch's recipients for a branch manager", async () => {
        notificationService.listRecipients.mockResolvedValue([
            { id: "user-1", name: "김철수" },
            { id: "user-2", name: "나영희" },
        ]);

        const response = await request(app.getHttpServer()).get("/notifications/recipients");

        expect(response.status).toBe(200);
        expect(response.body).toEqual([
            { id: "user-1", name: "김철수" },
            { id: "user-2", name: "나영희" },
        ]);
        expect(notificationService.listRecipients).toHaveBeenCalledWith(branchId);
        for (const item of response.body as Array<Record<string, unknown>>) {
            expect(Object.keys(item).sort()).toEqual(["id", "name"]);
        }
    });

    it("denies a plain branch member (not manager) with 403", async () => {
        notificationService.listRecipients.mockResolvedValue([{ id: "user-1", name: "김철수" }]);
        authRole = "user";

        const response = await request(app.getHttpServer()).get("/notifications/recipients");

        expect(response.status).toBe(403);
        expect(notificationService.listRecipients).not.toHaveBeenCalled();
    });

    it.each(["owner", "admin", "manager"] as const)("allows global role/branch role %s", async (role) => {
        notificationService.listRecipients.mockResolvedValue([]);
        authRole = role;

        const response = await request(app.getHttpServer()).get("/notifications/recipients");

        expect(response.status).toBe(200);
    });
});
