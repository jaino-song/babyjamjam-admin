import { AlimtalkTriggerDeliveryService } from "application/services/alimtalk-trigger-delivery.service";
import { MessageTriggerDeliveryService } from "application/services/message-trigger-delivery.service";
import { SmsTriggerDeliveryService } from "application/services/sms-trigger-delivery.service";
import {
    AlimtalkTriggerRecipientType,
    AlimtalkTriggerTemplateKey,
} from "domain/constants/alimtalk-trigger-catalog";
import { AlimtalkTriggerJobEntity } from "domain/entities/alimtalk-trigger-job.entity";

describe("MessageTriggerDeliveryService", () => {
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
                templateVariables: {},
            },
            new Date("2026-06-05T00:00:00.000Z"),
            new Date("2026-06-05T00:00:00.000Z"),
        );

    it("routes SMS trigger templates to the SMS delivery service", async () => {
        const smsTriggerDeliveryService = {
            canHandle: jest.fn().mockReturnValue(true),
            sendJob: jest.fn().mockResolvedValue(true),
        };
        const alimtalkTriggerDeliveryService = {
            sendJob: jest.fn(),
        };
        const service = new MessageTriggerDeliveryService(
            smsTriggerDeliveryService as unknown as SmsTriggerDeliveryService,
            alimtalkTriggerDeliveryService as unknown as AlimtalkTriggerDeliveryService,
        );
        const job = createJob(AlimtalkTriggerTemplateKey.SERVICE_INFO);

        await expect(service.sendJob(job)).resolves.toBe(true);

        expect(smsTriggerDeliveryService.canHandle).toHaveBeenCalledWith(AlimtalkTriggerTemplateKey.SERVICE_INFO);
        expect(smsTriggerDeliveryService.sendJob).toHaveBeenCalledWith(job);
        expect(alimtalkTriggerDeliveryService.sendJob).not.toHaveBeenCalled();
    });

    it("routes non-SMS trigger templates to the alimtalk delivery service", async () => {
        const smsTriggerDeliveryService = {
            canHandle: jest.fn().mockReturnValue(false),
            sendJob: jest.fn(),
        };
        const alimtalkTriggerDeliveryService = {
            sendJob: jest.fn().mockResolvedValue(true),
        };
        const service = new MessageTriggerDeliveryService(
            smsTriggerDeliveryService as unknown as SmsTriggerDeliveryService,
            alimtalkTriggerDeliveryService as unknown as AlimtalkTriggerDeliveryService,
        );
        const job = createJob(AlimtalkTriggerTemplateKey.CLIENT_WELCOME);

        await expect(service.sendJob(job)).resolves.toBe(true);

        expect(smsTriggerDeliveryService.canHandle).toHaveBeenCalledWith(AlimtalkTriggerTemplateKey.CLIENT_WELCOME);
        expect(smsTriggerDeliveryService.sendJob).not.toHaveBeenCalled();
        expect(alimtalkTriggerDeliveryService.sendJob).toHaveBeenCalledWith(job);
    });
});
