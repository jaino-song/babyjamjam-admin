import { PwaNotificationSchedulerService } from "application/services/pwa-notification-scheduler.service";
import { NotificationService } from "application/services/notification.service";
import { IBranchRepository } from "domain/repositories/branch.repository.interface";
import { IClientRepository } from "domain/repositories/client.repository.interface";

describe("PwaNotificationSchedulerService", () => {
    const emailTemplateContext = {
        ctaUrl: "https://admin.babyjamjam.com/login",
        ctaLabel: "로그인해서 확인하기",
    };
    const notificationService = {
        sendToRoles: jest.fn(),
    };
    const clientRepository = {
        findStartingWithinDays: jest.fn(),
        findEndingWithinDays: jest.fn(),
        findWithIncompleteContractsStartingWithinDays: jest.fn(),
        findWithoutContractSentStartingWithinDays: jest.fn(),
    };
    const branchRepository = {
        findAllActive: jest.fn(),
    };
    let service: PwaNotificationSchedulerService;

    beforeEach(() => {
        service = new PwaNotificationSchedulerService(
            notificationService as unknown as NotificationService,
            clientRepository as unknown as IClientRepository,
            branchRepository as unknown as IBranchRepository,
        );

        branchRepository.findAllActive.mockResolvedValue([{ id: "branch-1", name: "인천점" }]);
        clientRepository.findStartingWithinDays.mockResolvedValue(
            Array.from({ length: 6 }, (_, index) => ({ id: index + 1 })),
        );
        clientRepository.findEndingWithinDays.mockResolvedValue([
            { id: 10 },
            { id: 11 },
        ]);
        clientRepository.findWithIncompleteContractsStartingWithinDays.mockResolvedValue([
            { id: 20 },
            { id: 21 },
            { id: 22 },
        ]);
        clientRepository.findWithoutContractSentStartingWithinDays.mockResolvedValue([
            { id: 30, name: "김지혜" },
        ]);
        notificationService.sendToRoles.mockResolvedValue({ sent: 1, failed: 0 });
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it("should pass dynamic notification email context for each PWA summary kind", async () => {
        await service.sendDailySummaryNotifications();

        expect(notificationService.sendToRoles).toHaveBeenCalledTimes(4);
        expect(notificationService.sendToRoles.mock.calls).toEqual(expect.arrayContaining([
            [
                ["admin", "manager", "user"],
                "서비스 시작 예정",
                "현재 7일 내로 시작이 예정된 서비스가 6건 있어요. 로그인해서 확인해 보세요.",
                { url: "/clients/filtered?filter=starting-soon" },
                emailTemplateContext,
            ],
            [
                ["admin", "manager", "user"],
                "서비스 종료 예정",
                "현재 7일 내로 종료가 예정된 서비스가 2건 있어요. 필요한 후속 조치가 있는지 로그인해서 확인해 보세요.",
                { url: "/clients/filtered?filter=ending-soon" },
                emailTemplateContext,
            ],
            [
                ["admin", "manager", "user"],
                "⚠️ 계약서 미완료",
                "서비스 시작이 예정되어 있지만 아직 완료되지 않은 계약서가 3건 있어요. 고객 응대 전에 계약서 상태를 로그인해서 확인해 보세요.",
                { url: "/clients/filtered?filter=incomplete-contracts" },
                emailTemplateContext,
            ],
            [
                ["admin", "manager", "user"],
                "📄 계약서 미발송",
                "김지혜 님에게 아직 계약서가 발송되지 않았어요. 서비스 일정 전에 계약서를 발송할 수 있도록 로그인해서 확인해 보세요.",
                { url: "/clients?id=30" },
                emailTemplateContext,
            ],
        ]));
    });
});
