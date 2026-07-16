import { MessageTriggerDeliveryService } from "application/services/message-trigger-delivery.service";
import { SmsTriggerDeliveryService } from "application/services/sms-trigger-delivery.service";
import {
    MessageTriggerRecipientType,
    MessageTriggerTemplateKey,
} from "domain/constants/message-trigger-catalog";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";

describe("MessageTriggerDeliveryService", () => {
    it("delegates every active trigger delivery to the SMS service", async () => {
        const smsTriggerDeliveryService = {
            sendJob: jest.fn().mockResolvedValue(true),
        };
        const service = new MessageTriggerDeliveryService(
            smsTriggerDeliveryService as unknown as SmsTriggerDeliveryService,
        );
        const job = MessageTriggerJobEntity.reconstitute(
            "job-1",
            "branch-1",
            "rule-1",
            "pending",
            new Date("2026-06-12T00:00:00.000Z"),
            null,
            null,
            null,
            7,
            null,
            MessageTriggerRecipientType.CLIENT,
            "01012345678",
            MessageTriggerTemplateKey.SERVICE_INFO,
            "rule-1:service-info:7",
            {
                memberId: "7",
                recipientName: "김지니",
                recipientPhone: "01012345678",
                templateVariables: {},
            },
            new Date("2026-06-05T00:00:00.000Z"),
            new Date("2026-06-05T00:00:00.000Z"),
        );

        await expect(service.sendJob(job)).resolves.toBe(true);
        expect(smsTriggerDeliveryService.sendJob).toHaveBeenCalledWith(job);
    });
});
