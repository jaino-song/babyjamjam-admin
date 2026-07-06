import { AlimtalkTriggerDeliveryService } from "application/services/alimtalk-trigger-delivery.service";
import { MessageSenderApprovalService } from "application/services/message-sender-approval.service";
import { SystemSettingService } from "application/services/system-setting.service";
import {
    AlimtalkTriggerRecipientType,
    AlimtalkTriggerTemplateKey,
} from "domain/constants/alimtalk-trigger-catalog";
import { AlimtalkTriggerJobEntity } from "domain/entities/alimtalk-trigger-job.entity";

describe("AlimtalkTriggerDeliveryService", () => {
    const createJob = (templateKey: AlimtalkTriggerTemplateKey) =>
        AlimtalkTriggerJobEntity.reconstitute(
            `job-${templateKey}`,
            "branch-1",
            "rule-1",
            "pending",
            new Date("2026-06-12T00:00:00.000Z"),
            null,
            null,
            null,
            7,
            null,
            AlimtalkTriggerRecipientType.CLIENT,
            "010-1234-5678",
            templateKey,
            `rule-1:${templateKey}:7`,
            {
                clientId: 7,
                clientName: "김지니",
                memberId: "7",
                recipientName: "김지니",
                recipientPhone: "010-1234-5678",
                templateVariables: {
                    clientName: "김지니",
                    registrationDate: "2026-06-01",
                    serviceType: "산후도우미",
                },
            },
            new Date("2026-06-05T00:00:00.000Z"),
            new Date("2026-06-05T00:00:00.000Z"),
        );

    it("keeps true alimtalk templates on the alimtalk provider path", async () => {
        const sendAligoAlimtalkUsecase = { execute: jest.fn().mockResolvedValue(undefined) };
        const messageSenderApprovalService = {
            ensureApproved: jest.fn().mockResolvedValue(undefined),
        };
        const service = new AlimtalkTriggerDeliveryService(
            { getAlimtalkProvider: jest.fn().mockResolvedValue("aligo_alimtalk") } as unknown as SystemSettingService,
            messageSenderApprovalService as unknown as MessageSenderApprovalService,
            sendAligoAlimtalkUsecase as never,
        );

        await expect(service.sendJob(createJob(AlimtalkTriggerTemplateKey.CLIENT_WELCOME))).resolves.toBe(true);

        expect(messageSenderApprovalService.ensureApproved).toHaveBeenCalledWith("branch-1");
        expect(sendAligoAlimtalkUsecase.execute).toHaveBeenCalledWith(expect.objectContaining({
            templateKey: "CLIENT_CREATED",
            receiver: "010-1234-5678",
            branchId: "branch-1",
            clientId: 7,
            triggerJobId: "job-CLIENT_WELCOME",
        }));
    });
});
