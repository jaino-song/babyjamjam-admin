import { AligoService } from "application/services/aligo.service";
import { AlimtalkTriggerDeliveryService } from "application/services/alimtalk-trigger-delivery.service";
import { MessageSenderApprovalService } from "application/services/message-sender-approval.service";
import { SystemSettingService } from "application/services/system-setting.service";
import { SystemTemplateService } from "application/services/system-template.service";
import { SystemTemplateKey } from "domain/constants/system-template-registry";
import {
    AlimtalkTriggerRecipientType,
    AlimtalkTriggerTemplateKey,
} from "domain/constants/alimtalk-trigger-catalog";
import { AlimtalkTriggerJobEntity } from "domain/entities/alimtalk-trigger-job.entity";
import { AlimtalkLogEntity } from "domain/entities/alimtalk-log.entity";
import { IAlimtalkLogRepository } from "domain/repositories/alimtalk-log.repository.interface";

describe("AlimtalkTriggerDeliveryService", () => {
    const branchId = "branch-1";

    const createServiceInfoJob = () =>
        AlimtalkTriggerJobEntity.reconstitute(
            "job-service-info",
            branchId,
            "rule-service-info",
            "pending",
            new Date("2026-06-12T00:00:00.000Z"),
            null,
            null,
            null,
            7,
            null,
            AlimtalkTriggerRecipientType.CLIENT,
            "010-1234-5678",
            AlimtalkTriggerTemplateKey.SERVICE_INFO,
            "rule-service-info:7",
            {
                clientId: 7,
                clientName: "김지니",
                memberId: "7",
                recipientName: "김지니",
                recipientPhone: "010-1234-5678",
                templateVariables: {
                    name: "김지니",
                    clientName: "김지니",
                },
            },
            new Date("2026-06-05T00:00:00.000Z"),
            new Date("2026-06-05T00:00:00.000Z"),
        );

    it("sends the service information trigger through SMS instead of alimtalk", async () => {
        const systemSettingService = {
            getAlimtalkProvider: jest.fn(),
        };
        const messageSenderApprovalService = {
            ensureApproved: jest.fn().mockResolvedValue(undefined),
        };
        const aligoService = {
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
                    msg_id: 321,
                    success_cnt: 1,
                    error_cnt: 0,
                    msg_type: "LMS",
                },
            }),
        };
        const systemTemplateService = {
            getByKey: jest.fn().mockResolvedValue({
                content: "{{name}} 산모님 서비스 안내",
            }),
        };
        const sendAligoAlimtalkUsecase = {
            execute: jest.fn(),
        };
        const sendChannelTalkAlimtalkUsecase = {
            execute: jest.fn(),
        };
        const logRepository = {
            save: jest.fn().mockImplementation(async (log: AlimtalkLogEntity) => log),
        };
        const service = new AlimtalkTriggerDeliveryService(
            systemSettingService as unknown as SystemSettingService,
            messageSenderApprovalService as unknown as MessageSenderApprovalService,
            aligoService as unknown as AligoService,
            systemTemplateService as unknown as SystemTemplateService,
            sendAligoAlimtalkUsecase as never,
            sendChannelTalkAlimtalkUsecase as never,
            logRepository as unknown as IAlimtalkLogRepository,
        );

        await expect(service.sendJob(createServiceInfoJob())).resolves.toBe(true);

        expect(messageSenderApprovalService.ensureApproved).toHaveBeenCalledWith(branchId);
        expect(systemSettingService.getAlimtalkProvider).not.toHaveBeenCalled();
        expect(systemTemplateService.getByKey).toHaveBeenCalledWith(SystemTemplateKey.SERVICE_INFO);
        expect(aligoService.sendSms).toHaveBeenCalledWith({
            receiver: "010-1234-5678",
            message: "김지니 산모님 서비스 안내",
            recipientName: "김지니",
            title: "서비스 안내",
            msgType: "AUTO",
        });
        expect(sendAligoAlimtalkUsecase.execute).not.toHaveBeenCalled();
        expect(sendChannelTalkAlimtalkUsecase.execute).not.toHaveBeenCalled();

        const savedLog = logRepository.save.mock.calls[0]?.[0] as AlimtalkLogEntity;
        expect(savedLog.provider).toBe("aligo_sms");
        expect(savedLog.templateKey).toBe("service_info_sms");
        expect(savedLog.triggerJobId).toBe("job-service-info");
        expect(savedLog.receiver).toBe("01012345678");
        expect(savedLog.messageBody).toBe("김지니 산모님 서비스 안내");
        expect(savedLog.status).toBe("sent");
        expect(savedLog.aligoMid).toBe("321");
        expect(savedLog.variables).toEqual(expect.objectContaining({
            automationKey: "SERVICE_INFO_SMS",
            systemTemplateKey: SystemTemplateKey.SERVICE_INFO,
            name: "김지니",
            recipientName: "김지니",
        }));
    });

    it("sends the CLIENT_GREETING trigger through SMS with the same log contract as the retired sender", async () => {
        const greetingJob = AlimtalkTriggerJobEntity.reconstitute(
            "job-greeting-1",
            branchId,
            "rule-greeting-1",
            "pending",
            new Date("2026-06-27T00:00:00.000Z"),
            null,
            null,
            null,
            0,
            42,
            AlimtalkTriggerRecipientType.CLIENT,
            "010-5678-1234",
            AlimtalkTriggerTemplateKey.CLIENT_GREETING,
            "rule-greeting-1:client:42",
            {
                clientId: 42,
                clientName: "김산모",
                memberId: "42",
                recipientName: "김산모",
                recipientPhone: "010-5678-1234",
                templateVariables: {
                    name: "김산모",
                    clientName: "김산모",
                    phone: "010-5678-1234",
                },
            },
            new Date("2026-06-27T00:00:00.000Z"),
            new Date("2026-06-27T00:00:00.000Z"),
        );

        const messageSenderApprovalService = {
            ensureApproved: jest.fn().mockResolvedValue(undefined),
        };
        const aligoService = {
            sendSms: jest.fn().mockResolvedValue({
                request: {
                    senderPhone: "01099998888",
                    receiver: "01056781234",
                    msgType: "LMS",
                    testModeYn: "N",
                },
                response: {
                    result_code: 1,
                    message: "성공적으로 전송요청 하였습니다.",
                    msg_id: 999,
                    success_cnt: 1,
                    error_cnt: 0,
                    msg_type: "LMS",
                },
            }),
        };
        const systemTemplateService = {
            getByKey: jest.fn().mockResolvedValue({
                content: "{{name}}님 안녕하세요! 아이미래입니다.",
            }),
        };
        const logRepository = {
            save: jest.fn().mockImplementation(async (log: AlimtalkLogEntity) => log),
        };
        const systemSettingService = { getAlimtalkProvider: jest.fn() };
        const service = new AlimtalkTriggerDeliveryService(
            systemSettingService as unknown as SystemSettingService,
            messageSenderApprovalService as unknown as MessageSenderApprovalService,
            aligoService as unknown as AligoService,
            systemTemplateService as unknown as SystemTemplateService,
            { execute: jest.fn() } as never,
            { execute: jest.fn() } as never,
            logRepository as unknown as IAlimtalkLogRepository,
        );

        await expect(service.sendJob(greetingJob)).resolves.toBe(true);

        expect(messageSenderApprovalService.ensureApproved).toHaveBeenCalledWith(branchId);
        expect(systemSettingService.getAlimtalkProvider).not.toHaveBeenCalled();
        expect(systemTemplateService.getByKey).toHaveBeenCalledWith(SystemTemplateKey.GREETING);
        expect(aligoService.sendSms).toHaveBeenCalledWith({
            receiver: "010-5678-1234",
            message: "김산모님 안녕하세요! 아이미래입니다.",
            recipientName: "김산모",
            title: "인사 메시지",
            msgType: "AUTO",
        });

        // Verify the log matches the retired ClientGreetingSmsAutomationService byte-for-byte
        const savedLog = logRepository.save.mock.calls[0]?.[0] as AlimtalkLogEntity;
        expect(savedLog.provider).toBe("aligo_sms");
        expect(savedLog.templateKey).toBe("client_greeting_sms");
        expect(savedLog.triggerJobId).toBe("job-greeting-1");
        expect(savedLog.status).toBe("sent");
        expect(savedLog.aligoMid).toBe("999");
        expect(savedLog.variables).toEqual(expect.objectContaining({
            automationKey: "CLIENT_GREETING_SMS",
            systemTemplateKey: SystemTemplateKey.GREETING,
            triggerType: "client_created",
            title: "인사 메시지",
            recipientName: "김산모",
        }));
    });
});
