import { AligoService } from "application/services/aligo.service";
import {
    SendAligoAlimtalkUsecase,
    SendAligoSmsUsecase,
} from "application/usecases/aligo";
import { ClientEntity } from "domain/entities/client.entity";

describe("AligoService", () => {
    const createMockSendAlimtalkUsecase = () => ({
        execute: jest.fn(),
    });
    const createMockSendSmsUsecase = () => ({
        execute: jest.fn(),
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

    let service: AligoService;
    let sendAlimtalkUsecase: ReturnType<typeof createMockSendAlimtalkUsecase>;
    let sendSmsUsecase: ReturnType<typeof createMockSendSmsUsecase>;

    beforeEach(() => {
        sendAlimtalkUsecase = createMockSendAlimtalkUsecase();
        sendSmsUsecase = createMockSendSmsUsecase();
        service = new AligoService(
            sendAlimtalkUsecase as unknown as SendAligoAlimtalkUsecase,
            sendSmsUsecase as unknown as SendAligoSmsUsecase,
        );
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe("sendClientCreatedAlimtalk", () => {
        it("should send CLIENT_CREATED template", async () => {
            sendAlimtalkUsecase.execute.mockResolvedValue({ code: 0, message: "success" });

            await service.sendClientCreatedAlimtalk(createMockClient());

            expect(sendAlimtalkUsecase.execute).toHaveBeenCalledWith(
                expect.objectContaining({
                    templateKey: "CLIENT_CREATED",
                    receiver: "01012345678",
                    variables: expect.objectContaining({
                        고객명: "홍길동",
                    }),
                })
            );
        });

        it("should handle null phone gracefully", async () => {
            sendAlimtalkUsecase.execute.mockResolvedValue({ code: 0, message: "success" });

            const client = createMockClient();
            (client as unknown as { phone: null }).phone = null;

            await service.sendClientCreatedAlimtalk(client);

            expect(sendAlimtalkUsecase.execute).not.toHaveBeenCalled();
        });
    });

    describe("sendContractSignedAlimtalk", () => {
        it("should send CONTRACT_SIGNED template scoped to the client's branch", async () => {
            sendAlimtalkUsecase.execute.mockResolvedValue({ code: 0, message: "success" });

            const client = createMockClient();
            client.branchId = "branch-1";

            await service.sendContractSignedAlimtalk(client, {
                contractType: "방문요양",
                signedDate: "2025-01-14",
                serviceStartDate: "2025-01-15",
                employeeName: "김직원",
            });

            expect(sendAlimtalkUsecase.execute).toHaveBeenCalledWith(
                expect.objectContaining({
                    templateKey: "CONTRACT_SIGNED",
                    // Regression: omitting branchId/clientId orphans the
                    // alimtalk_log row — invisible to the tenant-scoped
                    // GET /alimtalk-logs history.
                    branchId: "branch-1",
                    clientId: 1,
                    variables: expect.objectContaining({
                        계약유형: "방문요양",
                        담당자명: "김직원",
                    }),
                })
            );
        });
    });

    describe("sendContractReminder3DaysAlimtalk", () => {
        it("should send CONTRACT_REMINDER_3DAYS template", async () => {
            sendAlimtalkUsecase.execute.mockResolvedValue({ code: 0, message: "success" });

            await service.sendContractReminder3DaysAlimtalk(createMockClient(), "2025-01-18");

            expect(sendAlimtalkUsecase.execute).toHaveBeenCalledWith(
                expect.objectContaining({
                    templateKey: "CONTRACT_REMINDER_3DAYS",
                    variables: expect.objectContaining({
                        서비스시작일: "2025-01-18",
                    }),
                })
            );
        });
    });

    describe("sendContractReminder1DayAlimtalk", () => {
        it("should send CONTRACT_REMINDER_1DAY template", async () => {
            sendAlimtalkUsecase.execute.mockResolvedValue({ code: 0, message: "success" });

            await service.sendContractReminder1DayAlimtalk(createMockClient(), "2025-01-16");

            expect(sendAlimtalkUsecase.execute).toHaveBeenCalledWith(
                expect.objectContaining({
                    templateKey: "CONTRACT_REMINDER_1DAY",
                })
            );
        });
    });

    describe("sendPaymentConfirmedAlimtalk", () => {
        it("should send PAYMENT_CONFIRMED template", async () => {
            sendAlimtalkUsecase.execute.mockResolvedValue({ code: 0, message: "success" });

            await service.sendPaymentConfirmedAlimtalk(createMockClient(), {
                amount: 150000,
                date: "2025-01-14",
                method: "카드",
                serviceMonth: "2025년 1월",
            });

            expect(sendAlimtalkUsecase.execute).toHaveBeenCalledWith(
                expect.objectContaining({
                    templateKey: "PAYMENT_CONFIRMED",
                    variables: expect.objectContaining({
                        결제금액: "150,000원",
                    }),
                })
            );
        });
    });

    describe("sendSurveyRequestAlimtalk", () => {
        it("should send SURVEY_REQUEST template with button", async () => {
            sendAlimtalkUsecase.execute.mockResolvedValue({ code: 0, message: "success" });

            await service.sendSurveyRequestAlimtalk(
                createMockClient(),
                "2025-03-15",
                "김직원",
                "https://example.com/survey"
            );

            expect(sendAlimtalkUsecase.execute).toHaveBeenCalledWith(
                expect.objectContaining({
                    templateKey: "SURVEY_REQUEST",
                    buttonUrl: "https://example.com/survey",
                })
            );
        });
    });

    describe("sendPaymentReminderAlimtalk", () => {
        it("should send PAYMENT_REMINDER template", async () => {
            sendAlimtalkUsecase.execute.mockResolvedValue({ code: 0, message: "success" });

            await service.sendPaymentReminderAlimtalk(
                createMockClient(),
                "2025-01-01",
                14,
                "50,000원",
                "2025-01-20"
            );

            expect(sendAlimtalkUsecase.execute).toHaveBeenCalledWith(
                expect.objectContaining({
                    templateKey: "PAYMENT_REMINDER",
                    variables: expect.objectContaining({
                        예상금액: "50,000원",
                        결제기한: "2025-01-20",
                    }),
                })
            );
        });
    });

    describe("error handling", () => {
        it("should not throw when API fails", async () => {
            sendAlimtalkUsecase.execute.mockRejectedValue(new Error("API Error"));

            await expect(
                service.sendClientCreatedAlimtalk(createMockClient())
            ).resolves.not.toThrow();
        });

        it("should rethrow when sms API fails", async () => {
            sendSmsUsecase.execute.mockRejectedValue(new Error("API Error"));

            await expect(
                service.sendSms({
                    receiver: "01012345678",
                    message: "테스트",
                })
            ).rejects.toThrow("API Error");
        });
    });
});
