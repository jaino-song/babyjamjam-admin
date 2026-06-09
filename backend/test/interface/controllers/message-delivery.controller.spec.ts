import { BadGatewayException, BadRequestException } from "@nestjs/common";
import { AligoService } from "application/services/aligo.service";
import { MessageSenderApprovalService } from "application/services/message-sender-approval.service";
import { PrismaService } from "infrastructure/database/prisma.service";
import { MessageDeliveryController } from "interface/controllers/message-delivery.controller";

describe("MessageDeliveryController", () => {
    let controller: MessageDeliveryController;
    let aligoService: jest.Mocked<Pick<AligoService, "sendSms">>;
    let messageSenderApprovalService: jest.Mocked<Pick<MessageSenderApprovalService, "ensureApproved">>;
    let prismaService: { alimtalk_log: { create: jest.Mock } };

    beforeEach(() => {
        aligoService = {
            sendSms: jest.fn(),
        };
        messageSenderApprovalService = {
            ensureApproved: jest.fn().mockResolvedValue(undefined),
        };
        prismaService = {
            alimtalk_log: {
                create: jest.fn().mockResolvedValue({}),
            },
        };
        controller = new MessageDeliveryController(
            aligoService as unknown as AligoService,
            messageSenderApprovalService as unknown as MessageSenderApprovalService,
            prismaService as unknown as PrismaService,
        );
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("should reject scheduled requests that are less than 10 minutes ahead in KST", async () => {
        jest.spyOn(Date, "now").mockReturnValue(new Date("2026-03-09T11:00:00.000Z").getTime());

        await expect(
            controller.sendSms(
                { branchId: "org-1" },
                {
                    receiver: "01012345678",
                    message: "테스트",
                    triggerType: "scheduled",
                    scheduledDate: "2026-03-09",
                    scheduledTime: "20:05",
                },
            ),
        ).rejects.toThrow(BadRequestException);

        expect(aligoService.sendSms).not.toHaveBeenCalled();
        expect(prismaService.alimtalk_log.create).not.toHaveBeenCalled();
    });

    it("should normalize scheduled fields for the Aligo request and response payload", async () => {
        jest.spyOn(Date, "now").mockReturnValue(new Date("2026-03-09T11:00:00.000Z").getTime());
        aligoService.sendSms.mockResolvedValue({
            request: {
                senderPhone: "0212345678",
                receiver: "01012345678",
                msgType: "LMS",
                scheduledDate: "20260309",
                scheduledTime: "2015",
                testModeYn: "Y",
            },
            response: {
                result_code: 1,
                message: "성공적으로 전송요청 하였습니다.",
                msg_id: 321,
                success_cnt: 1,
                error_cnt: 0,
                msg_type: "LMS",
            },
        });

        const result = await controller.sendSms(
            { branchId: "org-1" },
            {
                receiver: "010-1234-5678",
                message: "장문 테스트 메시지",
                title: "안내",
                triggerType: "scheduled",
                scheduledDate: "2026-03-09",
                scheduledTime: "20:15",
                testMode: true,
            },
        );

        expect(aligoService.sendSms).toHaveBeenCalledWith({
            receiver: "010-1234-5678",
            message: "장문 테스트 메시지",
            recipientName: undefined,
            title: "안내",
            msgType: undefined,
            scheduledDate: "20260309",
            scheduledTime: "2015",
            testMode: true,
        });
        expect(result).toEqual({
            provider: "aligo",
            triggerType: "scheduled",
            request: {
                senderPhone: "0212345678",
                receiver: "01012345678",
                msgType: "LMS",
                scheduledAt: "202603092015",
                testMode: true,
            },
            result: {
                resultCode: 1,
                message: "성공적으로 전송요청 하였습니다.",
                msgId: 321,
                successCount: 1,
                errorCount: 0,
                msgType: "LMS",
            },
        });
        expect(prismaService.alimtalk_log.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                branchId: "org-1",
                provider: "aligo_sms",
                templateKey: "안내",
                receiver: "01012345678",
                clientId: null,
                messageBody: "장문 테스트 메시지",
                status: "pending",
                aligoMid: "321",
                errorMessage: null,
                attempts: 1,
            }),
        });
    });

    it("should accept successful Aligo SMS responses when numeric fields arrive as strings", async () => {
        aligoService.sendSms.mockResolvedValue({
            request: {
                senderPhone: "0212345678",
                receiver: "01012345678",
                msgType: "SMS",
                testModeYn: "N",
            },
            response: {
                result_code: "1" as unknown as number,
                message: "success",
                msg_id: "123" as unknown as number,
                success_cnt: "1" as unknown as number,
                error_cnt: "0" as unknown as number,
                msg_type: "SMS",
            },
        });

        await expect(
            controller.sendSms(
                { branchId: "org-1" },
                {
                    receiver: "01012345678",
                    message: "테스트 발송 본문",
                    triggerType: "immediate",
                    msgType: "AUTO",
                },
            ),
        ).resolves.toMatchObject({
            provider: "aligo",
            triggerType: "immediate",
            result: {
                message: "success",
            },
        });

        expect(prismaService.alimtalk_log.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                status: "sent",
                errorMessage: null,
            }),
        });
    });

    it("should record failed logs and reject when Aligo does not accept the SMS request", async () => {
        aligoService.sendSms.mockResolvedValue({
            request: {
                senderPhone: "0212345678",
                receiver: "01012345678",
                msgType: "LMS",
                testModeYn: "N",
            },
            response: {
                result_code: -101,
                message: "수신번호 형식이 올바르지 않습니다.",
                error_cnt: 1,
                msg_type: "LMS",
            },
        });

        await expect(
            controller.sendSms(
                { branchId: "org-1" },
                {
                    receiver: "01012345678",
                    message: "테스트 발송 본문",
                    title: "안내",
                    triggerType: "immediate",
                    msgType: "AUTO",
                },
            ),
        ).rejects.toThrow(BadGatewayException);

        expect(prismaService.alimtalk_log.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                branchId: "org-1",
                provider: "aligo_sms",
                templateKey: "안내",
                receiver: "01012345678",
                messageBody: "테스트 발송 본문",
                status: "failed",
                errorMessage: "수신번호 형식이 올바르지 않습니다.",
                attempts: 1,
            }),
        });
    });

    it("should record a failed log and reject when Aligo rejects the SMS request before returning a result body", async () => {
        aligoService.sendSms.mockRejectedValue(
            new Error("Aligo SMS API error (403): 등록되지 않은 IP 입니다."),
        );

        await expect(
            controller.sendSms(
                { branchId: "org-1" },
                {
                    receiver: "01012345678",
                    message: "테스트 발송 본문",
                    title: "안내",
                    triggerType: "immediate",
                    msgType: "AUTO",
                },
            ),
        ).rejects.toThrow(BadGatewayException);

        expect(prismaService.alimtalk_log.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                branchId: "org-1",
                provider: "aligo_sms",
                templateKey: "안내",
                receiver: "01012345678",
                messageBody: "테스트 발송 본문",
                status: "failed",
                aligoMid: null,
                errorMessage: "Aligo SMS API error (403): 등록되지 않은 IP 입니다.",
                attempts: 1,
            }),
        });
    });
});
