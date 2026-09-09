import { MessageTriggerDeliveryService } from "application/services/message-trigger-delivery.service";
import { SmsTriggerDeliveryService } from "application/services/sms-trigger-delivery.service";
import {
    MessageTriggerRecipientType,
    MessageTriggerTemplateKey,
} from "domain/constants/message-trigger-catalog";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import type { SmsTriggerDeliveryPreparation } from "application/services/sms-trigger-delivery.service";

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

    it("delegates preparation and prepared delivery without reopening the SMS resolver", async () => {
        const preparation = {
            snapshot: { snapshotHash: "snapshot-hash" },
            serializedSnapshot: "serialized-snapshot",
        } as unknown as SmsTriggerDeliveryPreparation;
        const smsTriggerDeliveryService = {
            sendJob: jest.fn(),
            prepareJob: jest.fn().mockResolvedValue(preparation),
            sendPreparedJob: jest.fn().mockResolvedValue(true),
        };
        const service = new MessageTriggerDeliveryService(
            smsTriggerDeliveryService as unknown as SmsTriggerDeliveryService,
        );
        const job = MessageTriggerJobEntity.create({
            branchId: "branch-1",
            ruleId: "rule-1",
            scheduledFor: new Date("2026-06-12T00:00:00.000Z"),
            clientId: 7,
            recipientType: MessageTriggerRecipientType.CLIENT,
            recipientPhone: "01012345678",
            templateKey: MessageTriggerTemplateKey.SERVICE_INFO,
            dedupeKey: "rule-1:service-info:7",
            payload: {
                memberId: "7",
                recipientName: "김지니",
                recipientPhone: "01012345678",
                templateVariables: {},
            },
        });

        await expect(service.prepareJob(job)).resolves.toBe(preparation);
        await expect(service.sendPreparedJob(job, preparation)).resolves.toBe(true);
        expect(smsTriggerDeliveryService.prepareJob).toHaveBeenCalledWith(job);
        expect(smsTriggerDeliveryService.sendPreparedJob).toHaveBeenCalledWith(job, preparation);
        expect(smsTriggerDeliveryService.sendJob).not.toHaveBeenCalled();
    });
});
