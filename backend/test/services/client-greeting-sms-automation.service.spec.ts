import { AligoService } from "application/services/aligo.service";
import { ClientGreetingSmsAutomationService } from "application/services/client-greeting-sms-automation.service";
import { MessageSenderApprovalService } from "application/services/message-sender-approval.service";
import { SystemTemplateService } from "application/services/system-template.service";
import { SystemTemplateKey } from "domain/constants/system-template-registry";
import { ClientEntity } from "domain/entities/client.entity";
import { PrismaService } from "infrastructure/database/prisma.service";

describe("ClientGreetingSmsAutomationService", () => {
    const branchId = "org-1";

    const createClient = (phone: string | null = "010-1234-5678") =>
        new ClientEntity(
            7,
            "김지니",
            "인천",
            phone,
            "A형",
            15,
            "100000",
            "50000",
            "50000",
            null,
            null,
            false,
            true,
            "900101",
            "pending",
            false,
            null,
        );

    let service: ClientGreetingSmsAutomationService;
    let aligoService: jest.Mocked<Pick<AligoService, "sendSms">>;
    let messageSenderApprovalService: jest.Mocked<Pick<MessageSenderApprovalService, "ensureApproved">>;
    let systemTemplateService: jest.Mocked<Pick<SystemTemplateService, "getByKey">>;
    let prismaService: { alimtalk_log: { create: jest.Mock } };

    beforeEach(() => {
        aligoService = {
            sendSms: jest.fn().mockResolvedValue({
                request: {
                    senderPhone: "01099998888",
                    receiver: "01012345678",
                    msgType: "LMS",
                    testModeYn: "N",
                },
                response: {
                    result_code: 1,
                    message: "성공적으로 전송요청 하였습니다.",
                    msg_id: 123,
                    success_cnt: 1,
                    error_cnt: 0,
                    msg_type: "LMS",
                },
            }),
        };
        messageSenderApprovalService = {
            ensureApproved: jest.fn().mockResolvedValue(undefined),
        };
        systemTemplateService = {
            getByKey: jest.fn().mockResolvedValue({
                templateKey: SystemTemplateKey.GREETING,
                name: "인사 메시지",
                content: "안녕하세요 {{name}} 산모님",
            }),
        };
        prismaService = {
            alimtalk_log: {
                create: jest.fn().mockResolvedValue({}),
            },
        };

        service = new ClientGreetingSmsAutomationService(
            aligoService as unknown as AligoService,
            messageSenderApprovalService as unknown as MessageSenderApprovalService,
            systemTemplateService as unknown as SystemTemplateService,
            prismaService as unknown as PrismaService,
        );
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it("should send the greeting system template to the new client's phone number", async () => {
        const client = createClient();

        await service.sendClientGreetingSms(branchId, client);

        expect(messageSenderApprovalService.ensureApproved).toHaveBeenCalledWith(branchId);
        expect(systemTemplateService.getByKey).toHaveBeenCalledWith(SystemTemplateKey.GREETING);
        expect(aligoService.sendSms).toHaveBeenCalledWith({
            receiver: "01012345678",
            message: "안녕하세요 김지니 산모님",
            recipientName: "김지니",
            title: "인사 메시지",
            msgType: "AUTO",
        });
        expect(prismaService.alimtalk_log.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                branchId,
                provider: "aligo_sms",
                templateKey: "client_greeting_sms",
                receiver: "01012345678",
                clientId: 7,
                messageBody: "안녕하세요 김지니 산모님",
                status: "sent",
                aligoMid: "123",
                attempts: 1,
            }),
        });
    });

    it("should skip sending when the new client has no valid phone number", async () => {
        const client = createClient(null);

        await service.sendClientGreetingSms(branchId, client);

        expect(messageSenderApprovalService.ensureApproved).not.toHaveBeenCalled();
        expect(aligoService.sendSms).not.toHaveBeenCalled();
        expect(prismaService.alimtalk_log.create).not.toHaveBeenCalled();
    });

    it("should record a failed log when Aligo rejects the SMS request before returning a result body", async () => {
        jest.spyOn(Date, "now").mockReturnValue(new Date("2026-06-05T09:20:00.000Z").getTime());
        const client = createClient();
        aligoService.sendSms.mockRejectedValue(
            new Error("Aligo SMS API error (403): 등록되지 않은 IP 입니다."),
        );

        await expect(service.sendClientGreetingSms(branchId, client)).rejects.toThrow(
            "Aligo SMS API error (403): 등록되지 않은 IP 입니다.",
        );

        expect(prismaService.alimtalk_log.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                branchId,
                provider: "aligo_sms",
                templateKey: "client_greeting_sms",
                receiver: "01012345678",
                clientId: 7,
                messageBody: "안녕하세요 김지니 산모님",
                status: "failed",
                aligoMid: null,
                errorMessage: "Aligo SMS API error (403): 등록되지 않은 IP 입니다.",
                attempts: 1,
                nextRetryAt: new Date("2026-06-05T09:25:00.000Z"),
            }),
        });
    });
});
