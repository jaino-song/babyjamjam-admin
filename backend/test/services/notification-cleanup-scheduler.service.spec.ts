import { NotificationCleanupSchedulerService } from "application/services/notification-cleanup-scheduler.service";
import { CleanupNotificationsUsecase } from "application/usecases/notification/cleanup-notifications.usecase";

describe("NotificationCleanupSchedulerService", () => {
    const createMockCleanupUsecase = () => ({
        execute: jest.fn(),
    });

    let scheduler: NotificationCleanupSchedulerService;
    let cleanupUsecase: ReturnType<typeof createMockCleanupUsecase>;

    beforeEach(() => {
        cleanupUsecase = createMockCleanupUsecase();
        scheduler = new NotificationCleanupSchedulerService(
            cleanupUsecase as unknown as CleanupNotificationsUsecase
        );
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe("cleanupOldNotifications", () => {
        describe("given cleanup succeeds", () => {
            it("should call cleanup usecase with 30 days retention", async () => {
                cleanupUsecase.execute.mockResolvedValue(15);

                await scheduler.cleanupOldNotifications();

                expect(cleanupUsecase.execute).toHaveBeenCalledWith(expect.any(String), 30);
                expect(cleanupUsecase.execute).toHaveBeenCalledTimes(1);
            });
        });

        describe("given cleanup deletes notifications", () => {
            it("should complete without throwing", async () => {
                cleanupUsecase.execute.mockResolvedValue(100);

                await expect(scheduler.cleanupOldNotifications()).resolves.not.toThrow();
            });
        });

        describe("given no notifications to delete", () => {
            it("should complete without throwing", async () => {
                cleanupUsecase.execute.mockResolvedValue(0);

                await expect(scheduler.cleanupOldNotifications()).resolves.not.toThrow();
            });
        });

        describe("given cleanup usecase throws error", () => {
            it("should not throw and handle error gracefully", async () => {
                cleanupUsecase.execute.mockRejectedValue(new Error("DB Connection Failed"));

                await expect(scheduler.cleanupOldNotifications()).resolves.not.toThrow();
            });
        });
    });
});
