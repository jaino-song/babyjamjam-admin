import { AligoService } from "application/services/aligo.service";
import {
    SmsTriggerDeliveryService,
    SMS_TEMPLATE_DELIVERY,
} from "application/services/sms-trigger-delivery.service";
import { MessageSenderApprovalService } from "application/services/message-sender-approval.service";
import { SystemTemplateService } from "application/services/system-template.service";
import { SystemTemplateKey } from "domain/constants/system-template-registry";
import {
    AlimtalkTriggerRecipientType,
    AlimtalkTriggerTemplateKey,
} from "domain/constants/alimtalk-trigger-catalog";
import { AlimtalkTriggerJobEntity } from "domain/entities/alimtalk-trigger-job.entity";
import { AlimtalkLogEntity } from "domain/entities/alimtalk-log.entity";
import { IAlimtalkLogRepository } from "domain/repositories/alimtalk-log.repository.interface";
// Canonical SMS template set lives in the shared package (frontend/mobile source of truth).
// The backend duplicates the trigger enums by design, so this drift guard is the only place
// that ties the backend SMS delivery routing back to that single source.
import { SMS_TRIGGER_TEMPLATE_KEYS } from "../../../packages/shared/src/types/alimtalk";

describe("SmsTriggerDeliveryService", () => {
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
        const logRepository = {
            save: jest.fn().mockImplementation(async (log: AlimtalkLogEntity) => log),
        };
        const service = new SmsTriggerDeliveryService(
            messageSenderApprovalService as unknown as MessageSenderApprovalService,
            aligoService as unknown as AligoService,
            systemTemplateService as unknown as SystemTemplateService,
            logRepository as unknown as IAlimtalkLogRepository,
        );

        await expect(service.sendJob(createServiceInfoJob())).resolves.toBe(true);

        expect(messageSenderApprovalService.ensureApproved).toHaveBeenCalledWith(branchId);
        expect(systemTemplateService.getByKey).toHaveBeenCalledWith(SystemTemplateKey.SERVICE_INFO);
        expect(aligoService.sendSms).toHaveBeenCalledWith({
            receiver: "010-1234-5678",
            message: "김지니 산모님 서비스 안내",
            recipientName: "김지니",
            title: "서비스 안내",
            msgType: "AUTO",
        });
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
        const service = new SmsTriggerDeliveryService(
            messageSenderApprovalService as unknown as MessageSenderApprovalService,
            aligoService as unknown as AligoService,
            systemTemplateService as unknown as SystemTemplateService,
            logRepository as unknown as IAlimtalkLogRepository,
        );

        await expect(service.sendJob(greetingJob)).resolves.toBe(true);

        expect(messageSenderApprovalService.ensureApproved).toHaveBeenCalledWith(branchId);
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

describe("SMS delivery routing drift guard", () => {
    it("routes exactly the shared SMS template set through SMS delivery", () => {
        // If someone adds a template to SMS_TRIGGER_TEMPLATE_KEYS (shared) but forgets to add a
        // delivery config here (or vice versa), the SMS form would offer a template the backend
        // cannot deliver — this assertion fails first.
        const deliveryKeys = Object.keys(SMS_TEMPLATE_DELIVERY).sort();
        const sharedKeys = [...SMS_TRIGGER_TEMPLATE_KEYS].sort();
        expect(deliveryKeys).toEqual(sharedKeys);
    });
});

describe("SERVICE_FEEDBACK_LINK delivery", () => {
    const buildService = (overrides: { aligoService: any; logRepository: any }) =>
        new SmsTriggerDeliveryService(
            { ensureApproved: jest.fn().mockResolvedValue(undefined) } as unknown as MessageSenderApprovalService,
            overrides.aligoService as unknown as AligoService,
            { getByKey: jest.fn() } as unknown as SystemTemplateService,
            overrides.logRepository as unknown as IAlimtalkLogRepository,
        );

    const createFeedbackJob = () =>
        AlimtalkTriggerJobEntity.reconstitute(
            "job-feedback-link",
            "branch-1",
            "system:service_feedback_link",
            "pending",
            new Date("2026-07-03T06:00:00.000Z"),
            null,
            null,
            null,
            7,
            11,
            AlimtalkTriggerRecipientType.PRIMARY_EMPLOYEE,
            "010-1111-2222",
            AlimtalkTriggerTemplateKey.SERVICE_FEEDBACK_LINK,
            "system:service_feedback_link:schedule:11:primary",
            {
                clientId: 7,
                clientName: "김산모",
                employeeId: 30,
                employeeName: "홍제공",
                memberId: "employee:30",
                recipientName: "홍제공",
                recipientPhone: "010-1111-2222",
                messageBody: "[아가잼잼] 김산모님 제공기록지 링크\nhttps://mobile.test/feedback/efl_token",
                templateVariables: {
                    clientName: "김산모",
                    employeeName: "홍제공",
                    feedbackUrl: "https://mobile.test/feedback/efl_token",
                },
            },
            new Date("2026-07-02T00:00:00.000Z"),
            new Date("2026-07-02T00:00:00.000Z"),
        );

    it("sends the payload message and records it in SMS history", async () => {
        const aligoService = {
            sendSms: jest.fn().mockResolvedValue({
                request: { receiver: "01011112222", msgType: "LMS", testModeYn: "N" },
                response: { result_code: 1, message: "성공", msg_id: 123, success_cnt: 1, error_cnt: 0 },
            }),
        };
        const logRepository = { save: jest.fn().mockImplementation(async (log: AlimtalkLogEntity) => log) };
        const service = buildService({ aligoService, logRepository });

        await expect(service.sendJob(createFeedbackJob())).resolves.toBe(true);

        expect(aligoService.sendSms).toHaveBeenCalledWith({
            receiver: "010-1111-2222",
            message: "[아가잼잼] 김산모님 제공기록지 링크\nhttps://mobile.test/feedback/efl_token",
            recipientName: "홍제공",
            title: "제공기록지 작성 링크",
            msgType: "AUTO",
        });
        const savedLog = logRepository.save.mock.calls[0]?.[0] as AlimtalkLogEntity;
        expect(savedLog.provider).toBe("aligo_sms");
        expect(savedLog.templateKey).toBe("service_feedback_link_sms");
        expect(savedLog.status).toBe("sent");
        expect(savedLog.variables).toEqual(expect.objectContaining({
            automationKey: "SERVICE_FEEDBACK_LINK_SMS",
            triggerType: "service_start_at_15",
            feedbackUrl: "https://mobile.test/feedback/efl_token",
        }));
    });

    it("records a failed retryable SMS history row when Aligo rejects the feedback link message", async () => {
        const aligoService = {
            sendSms: jest.fn().mockResolvedValue({
                request: { receiver: "01011112222", msgType: "LMS", testModeYn: "N" },
                response: { result_code: -1, message: "잔액 부족", msg_id: null, success_cnt: 0, error_cnt: 1 },
            }),
        };
        const logRepository = { save: jest.fn().mockImplementation(async (log: AlimtalkLogEntity) => log) };
        const service = buildService({ aligoService, logRepository });

        await expect(service.sendJob(createFeedbackJob())).resolves.toBe(false);

        const savedLog = logRepository.save.mock.calls[0]?.[0] as AlimtalkLogEntity;
        expect(savedLog.templateKey).toBe("service_feedback_link_sms");
        expect(savedLog.status).toBe("failed");
        expect(savedLog.errorMessage).toBe("잔액 부족");
        expect(savedLog.nextRetryAt).toBeInstanceOf(Date);
    });
});

describe("PRICE_INFO data guard", () => {
    const createPriceInfoJob = (templateVariables: Record<string, string>) =>
        AlimtalkTriggerJobEntity.reconstitute(
            "job-price-info",
            "branch-1",
            "rule-price-info",
            "pending",
            new Date("2026-06-30T00:00:00.000Z"),
            null,
            null,
            null,
            7,
            null,
            AlimtalkTriggerRecipientType.CLIENT,
            "010-1234-5678",
            AlimtalkTriggerTemplateKey.PRICE_INFO,
            "rule-price-info:7",
            {
                clientId: 7,
                clientName: "김지니",
                memberId: "7",
                recipientName: "김지니",
                recipientPhone: "010-1234-5678",
                templateVariables,
            },
            new Date("2026-06-30T00:00:00.000Z"),
            new Date("2026-06-30T00:00:00.000Z"),
        );

    const buildService = (overrides: { aligoService: any; logRepository: any; systemTemplateService?: any }) =>
        new SmsTriggerDeliveryService(
            { ensureApproved: jest.fn().mockResolvedValue(undefined) } as unknown as MessageSenderApprovalService,
            overrides.aligoService as unknown as AligoService,
            (overrides.systemTemplateService ?? {
                getByKey: jest.fn().mockResolvedValue({ content: "총 금액 {{fullPrice}}원 / {{bankName}} {{accNum}}" }),
            }) as unknown as SystemTemplateService,
            overrides.logRepository as unknown as IAlimtalkLogRepository,
        );

    it("cancels a PRICE_INFO job and does not send when price/bank data is missing", async () => {
        const aligoService = { sendSms: jest.fn() };
        const logRepository = { save: jest.fn() };
        const service = buildService({ aligoService, logRepository });
        const job = createPriceInfoJob({ name: "김지니", fullPrice: "", actualPrice: "", bankName: "", accNum: "" });

        const sent = await service.sendJob(job);

        expect(sent).toBe(false);
        expect(job.status).toBe("canceled");
        expect(aligoService.sendSms).not.toHaveBeenCalled();
        expect(logRepository.save).not.toHaveBeenCalled();
    });

    it("sends a PRICE_INFO job when all essential data is present", async () => {
        const aligoService = {
            sendSms: jest.fn().mockResolvedValue({
                request: { senderPhone: "01099998888", receiver: "01012345678", msgType: "LMS", testModeYn: "N" },
                response: { result_code: 1, message: "성공", msg_id: 321, success_cnt: 1, error_cnt: 0, msg_type: "LMS" },
            }),
        };
        const logRepository = { save: jest.fn().mockImplementation(async (log) => log) };
        const service = buildService({ aligoService, logRepository });
        const job = createPriceInfoJob({
            name: "김지니",
            fullPrice: "1200000",
            actualPrice: "120000",
            bankName: "국민",
            accNum: "123-45-6789",
            duration: "20",
            type: "단태아 첫째아 A가1형",
        });

        const sent = await service.sendJob(job);

        expect(sent).toBe(true);
        expect(aligoService.sendSms).toHaveBeenCalledTimes(1);
        expect(logRepository.save).toHaveBeenCalledTimes(1);
    });

    it("cancels a PRICE_INFO job when price/bank are present but duration is blank", async () => {
        const aligoService = { sendSms: jest.fn() };
        const logRepository = { save: jest.fn() };
        const service = buildService({ aligoService, logRepository });
        const job = createPriceInfoJob({
            name: "김지니",
            fullPrice: "1200000",
            actualPrice: "120000",
            bankName: "국민",
            accNum: "123-45-6789",
            duration: "",
            type: "단태아 첫째아 A가1형",
        });

        const sent = await service.sendJob(job);

        expect(sent).toBe(false);
        expect(job.status).toBe("canceled");
        expect(aligoService.sendSms).not.toHaveBeenCalled();
    });
});
