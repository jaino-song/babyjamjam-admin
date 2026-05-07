import { NotificationService } from "application/services/notification.service";
import { NotificationEntity } from "domain/entities/notification.entity";
import { UserEntity } from "domain/entities/user.entity";

describe("NotificationService", () => {
    const branchId = "branch-1";
    const createUser = (id: string): UserEntity =>
        UserEntity.reconstitute(
            id,
            null,
            null,
            `사용자 ${id}`,
            null,
            "user",
            new Date("2026-05-01T00:00:00.000Z"),
            null,
            true,
            new Date("2026-05-01T00:00:00.000Z"),
            "email",
        );

    const subscribePushUsecase = { execute: jest.fn() };
    const unsubscribePushUsecase = { execute: jest.fn() };
    const sendNotificationUsecase = { execute: jest.fn(), broadcast: jest.fn(), sendToUsers: jest.fn() };
    const getNotificationsUsecase = { execute: jest.fn(), getUnread: jest.fn(), countUnread: jest.fn() };
    const markNotificationReadUsecase = { execute: jest.fn(), markAllAsRead: jest.fn() };
    const getVapidKeyUsecase = { execute: jest.fn() };
    const userRepository = {
        findById: jest.fn(),
        findByKakaoId: jest.fn(),
        findByEmail: jest.fn(),
        findByRoles: jest.fn(),
        findNotificationRecipientsByBranchId: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
    };
    const emailPort = { send: jest.fn() };
    const systemSettingService = { getUserEmailNotificationsEnabled: jest.fn() };

    let service: NotificationService;

    beforeEach(() => {
        service = new NotificationService(
            subscribePushUsecase as never,
            unsubscribePushUsecase as never,
            sendNotificationUsecase as never,
            getNotificationsUsecase as never,
            markNotificationReadUsecase as never,
            getVapidKeyUsecase as never,
            userRepository as never,
            emailPort as never,
            systemSettingService as never,
        );

        userRepository.findById.mockResolvedValue(null);
        userRepository.findNotificationRecipientsByBranchId.mockResolvedValue([
            createUser("user-1"),
            createUser("user-2"),
            createUser("user-1"),
        ]);
        getNotificationsUsecase.execute.mockResolvedValue([]);
        sendNotificationUsecase.execute.mockImplementation((branchid: string, params: { userId: string }) =>
            Promise.resolve(NotificationEntity.create(params.userId, "title", "body", { branchid }))
        );
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it("should persist notifications for unique branch users", async () => {
        await expect(
            service.sendToBranchUsers(
                branchId,
                "전자문서 검토 필요",
                "검토가 필요합니다.",
                { type: "eformsign-review-required", documentId: "doc-1" },
            )
        ).resolves.toEqual({ sent: 2, failed: 0 });

        expect(sendNotificationUsecase.execute).toHaveBeenCalledTimes(2);
        expect(sendNotificationUsecase.execute).toHaveBeenCalledWith(
            branchId,
            expect.objectContaining({ userId: "user-1" }),
        );
        expect(sendNotificationUsecase.execute).toHaveBeenCalledWith(
            branchId,
            expect.objectContaining({ userId: "user-2" }),
        );
    });

    it("should skip deduped branch notifications for the same document", async () => {
        getNotificationsUsecase.execute.mockResolvedValueOnce([
            NotificationEntity.create("user-1", "old", "old", {
                type: "eformsign-review-required",
                documentId: "doc-1",
            }),
        ]);

        await expect(
            service.sendToBranchUsers(
                branchId,
                "전자문서 검토 필요",
                "검토가 필요합니다.",
                { type: "eformsign-review-required", documentId: "doc-1" },
                {
                    dedupe: {
                        type: "eformsign-review-required",
                        documentId: "doc-1",
                    },
                },
            )
        ).resolves.toEqual({ sent: 1, failed: 0 });

        expect(sendNotificationUsecase.execute).toHaveBeenCalledTimes(1);
        expect(sendNotificationUsecase.execute).toHaveBeenCalledWith(
            branchId,
            expect.objectContaining({ userId: "user-2" }),
        );
    });
});
