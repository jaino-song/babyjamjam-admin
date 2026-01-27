import { AlimtalkService } from "application/services/alimtalk.service";
import { SystemSettingService } from "application/services/system-setting.service";
import { ChannelTalkService } from "application/services/channeltalk.service";
import { AligoService } from "application/services/aligo.service";
import { ClientEntity } from "domain/entities/client.entity";

describe("AlimtalkService", () => {
    const createMockSystemSettingService = () => ({
        getAlimtalkProvider: jest.fn(),
        isAlimtalkEnabled: jest.fn(),
    });

    const createMockChannelTalkService = () => ({
        sendClientCreatedAlimtalk: jest.fn(),
        sendContractSignedAlimtalk: jest.fn(),
        sendContractReminder3DaysAlimtalk: jest.fn(),
        sendContractReminder1DayAlimtalk: jest.fn(),
        sendPaymentConfirmedAlimtalk: jest.fn(),
        sendSurveyRequestAlimtalk: jest.fn(),
        sendPaymentReminderAlimtalk: jest.fn(),
    });

    const createMockAligoService = () => ({
        sendClientCreatedAlimtalk: jest.fn(),
        sendContractSignedAlimtalk: jest.fn(),
        sendContractReminder3DaysAlimtalk: jest.fn(),
        sendContractReminder1DayAlimtalk: jest.fn(),
        sendPaymentConfirmedAlimtalk: jest.fn(),
        sendSurveyRequestAlimtalk: jest.fn(),
        sendPaymentReminderAlimtalk: jest.fn(),
    });

    const createMockClient = (): ClientEntity =>
        new ClientEntity(
            1,
            "홍길동",
            "서울시 강남구",
            "010-1234-5678",
            "A가-1형",
            15,
            "100000",
            "50000",
            "50000",
            new Date("2025-01-15"),
            new Date("2025-03-15"),
            false,
            true,
            "900101",
            "active",
            false,
            null
        );

    let service: AlimtalkService;
    let systemSettingService: ReturnType<typeof createMockSystemSettingService>;
    let channelTalkService: ReturnType<typeof createMockChannelTalkService>;
    let aligoService: ReturnType<typeof createMockAligoService>;

    beforeEach(() => {
        systemSettingService = createMockSystemSettingService();
        channelTalkService = createMockChannelTalkService();
        aligoService = createMockAligoService();

        service = new AlimtalkService(
            systemSettingService as unknown as SystemSettingService,
            channelTalkService as unknown as ChannelTalkService,
            aligoService as unknown as AligoService
        );
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe("sendClientCreatedAlimtalk", () => {
        describe("given provider is aligo", () => {
            it("should call AligoService", async () => {
                systemSettingService.getAlimtalkProvider.mockResolvedValue("aligo");

                await service.sendClientCreatedAlimtalk(createMockClient());

                expect(aligoService.sendClientCreatedAlimtalk).toHaveBeenCalledWith(
                    expect.objectContaining({ name: "홍길동" })
                );
                expect(channelTalkService.sendClientCreatedAlimtalk).not.toHaveBeenCalled();
            });
        });

        describe("given provider is channeltalk", () => {
            it("should call ChannelTalkService", async () => {
                systemSettingService.getAlimtalkProvider.mockResolvedValue("channeltalk");

                await service.sendClientCreatedAlimtalk(createMockClient());

                expect(channelTalkService.sendClientCreatedAlimtalk).toHaveBeenCalledWith(
                    expect.objectContaining({ name: "홍길동" })
                );
                expect(aligoService.sendClientCreatedAlimtalk).not.toHaveBeenCalled();
            });
        });

        describe("given provider is none", () => {
            it("should not call any service", async () => {
                systemSettingService.getAlimtalkProvider.mockResolvedValue("none");

                await service.sendClientCreatedAlimtalk(createMockClient());

                expect(channelTalkService.sendClientCreatedAlimtalk).not.toHaveBeenCalled();
                expect(aligoService.sendClientCreatedAlimtalk).not.toHaveBeenCalled();
            });
        });
    });

    describe("sendContractSignedAlimtalk", () => {
        const contractInfo = {
            contractType: "방문요양",
            signedDate: "2025-01-14",
            serviceStartDate: "2025-01-15",
            employeeName: "김직원",
        };

        it("should route to Aligo when provider is aligo", async () => {
            systemSettingService.getAlimtalkProvider.mockResolvedValue("aligo");

            await service.sendContractSignedAlimtalk(createMockClient(), contractInfo);

            expect(aligoService.sendContractSignedAlimtalk).toHaveBeenCalled();
        });

        it("should route to ChannelTalk when provider is channeltalk", async () => {
            systemSettingService.getAlimtalkProvider.mockResolvedValue("channeltalk");

            await service.sendContractSignedAlimtalk(createMockClient(), contractInfo);

            expect(channelTalkService.sendContractSignedAlimtalk).toHaveBeenCalled();
        });
    });

    describe("sendContractReminder3DaysAlimtalk", () => {
        it("should route based on provider setting", async () => {
            systemSettingService.getAlimtalkProvider.mockResolvedValue("aligo");

            await service.sendContractReminder3DaysAlimtalk(createMockClient(), "2025-01-18");

            expect(aligoService.sendContractReminder3DaysAlimtalk).toHaveBeenCalled();
        });
    });

    describe("sendContractReminder1DayAlimtalk", () => {
        it("should route based on provider setting", async () => {
            systemSettingService.getAlimtalkProvider.mockResolvedValue("channeltalk");

            await service.sendContractReminder1DayAlimtalk(createMockClient(), "2025-01-16");

            expect(channelTalkService.sendContractReminder1DayAlimtalk).toHaveBeenCalled();
        });
    });

    describe("sendPaymentConfirmedAlimtalk", () => {
        const paymentInfo = {
            amount: 150000,
            date: "2025-01-14",
            method: "카드",
            serviceMonth: "2025년 1월",
        };

        it("should route based on provider setting", async () => {
            systemSettingService.getAlimtalkProvider.mockResolvedValue("aligo");

            await service.sendPaymentConfirmedAlimtalk(createMockClient(), paymentInfo);

            expect(aligoService.sendPaymentConfirmedAlimtalk).toHaveBeenCalled();
        });
    });

    describe("sendSurveyRequestAlimtalk", () => {
        it("should route based on provider setting", async () => {
            systemSettingService.getAlimtalkProvider.mockResolvedValue("aligo");

            await service.sendSurveyRequestAlimtalk(
                createMockClient(),
                "2025-03-15",
                "김직원",
                "https://survey.example.com"
            );

            expect(aligoService.sendSurveyRequestAlimtalk).toHaveBeenCalled();
        });
    });

    describe("sendPaymentReminderAlimtalk", () => {
        it("should route based on provider setting", async () => {
            systemSettingService.getAlimtalkProvider.mockResolvedValue("channeltalk");

            await service.sendPaymentReminderAlimtalk(
                createMockClient(),
                "2025-01-01",
                14,
                "50,000원",
                "2025-01-20"
            );

            expect(channelTalkService.sendPaymentReminderAlimtalk).toHaveBeenCalled();
        });
    });

    describe("getProvider", () => {
        it("should return current provider", async () => {
            systemSettingService.getAlimtalkProvider.mockResolvedValue("aligo");

            const result = await service.getProvider();

            expect(result).toBe("aligo");
        });
    });

    describe("error handling", () => {
        it("should not throw when underlying service fails", async () => {
            systemSettingService.getAlimtalkProvider.mockResolvedValue("aligo");
            aligoService.sendClientCreatedAlimtalk.mockRejectedValue(new Error("API Error"));

            await expect(
                service.sendClientCreatedAlimtalk(createMockClient())
            ).resolves.not.toThrow();
        });
    });
});
