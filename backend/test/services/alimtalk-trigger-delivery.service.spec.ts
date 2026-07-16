import { AlimtalkTriggerDeliveryService } from "application/services/alimtalk-trigger-delivery.service";
import { SystemSettingService } from "application/services/system-setting.service";
import {
    MessageTriggerRecipientType,
    MessageTriggerTemplateKey,
} from "domain/constants/message-trigger-catalog";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import { TriggerJobDeferredError } from "domain/errors/trigger-job-deferred.error";

describe("AlimtalkTriggerDeliveryService", () => {
    const createJob = (
        templateKey: MessageTriggerTemplateKey,
        branchId: string | null = "branch-1",
    ) =>
        MessageTriggerJobEntity.reconstitute(
            `job-${templateKey}`,
            branchId,
            "rule-1",
            "pending",
            new Date("2026-06-12T00:00:00.000Z"),
            null,
            null,
            null,
            7,
            null,
            MessageTriggerRecipientType.CLIENT,
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

    const captureError = async (promise: Promise<unknown>): Promise<unknown> => {
        try {
            await promise;
            return undefined;
        } catch (error) {
            return error;
        }
    };

    const createService = (provider: "aligo_alimtalk" | "none" = "aligo_alimtalk") => {
        const sendAligoAlimtalkUsecase = { execute: jest.fn().mockResolvedValue(undefined) };
        const service = new AlimtalkTriggerDeliveryService(
            { getAlimtalkProvider: jest.fn().mockResolvedValue(provider) } as unknown as SystemSettingService,
            sendAligoAlimtalkUsecase as never,
        );
        return { sendAligoAlimtalkUsecase, service };
    };

    it("keeps true alimtalk templates on the alimtalk provider path", async () => {
        const { sendAligoAlimtalkUsecase, service } = createService();

        await expect(service.sendJob(createJob(MessageTriggerTemplateKey.CLIENT_WELCOME))).resolves.toBe(true);

        expect(sendAligoAlimtalkUsecase.execute).toHaveBeenCalledWith(expect.objectContaining({
            templateKey: "CLIENT_CREATED",
            receiver: "010-1234-5678",
            recipientName: "김지니",
            branchId: "branch-1",
            clientId: 7,
            triggerJobId: "job-CLIENT_WELCOME",
        }));
    });

    it("throws a config deferred error when the provider is none", async () => {
        const { sendAligoAlimtalkUsecase, service } = createService("none");

        const error = await captureError(service.sendJob(createJob(MessageTriggerTemplateKey.CLIENT_WELCOME)));

        expect(error).toBeInstanceOf(TriggerJobDeferredError);
        expect(error).toMatchObject({
            kind: "config",
            message: "Alimtalk provider is not configured for trigger delivery",
        });
        expect(sendAligoAlimtalkUsecase.execute).not.toHaveBeenCalled();
    });

    it("throws a config deferred error when the template is unmapped for the provider", async () => {
        const { sendAligoAlimtalkUsecase, service } = createService();

        const error = await captureError(service.sendJob(createJob(MessageTriggerTemplateKey.SERVICE_RECORD_LINK)));

        expect(error).toBeInstanceOf(TriggerJobDeferredError);
        expect(error).toMatchObject({
            kind: "config",
            message: "Template SERVICE_RECORD_LINK is not available for provider aligo_alimtalk",
        });
        expect(sendAligoAlimtalkUsecase.execute).not.toHaveBeenCalled();
    });

    it("throws a plain error when branchId is missing", async () => {
        const { sendAligoAlimtalkUsecase, service } = createService();

        const error = await captureError(service.sendJob(createJob(MessageTriggerTemplateKey.CLIENT_WELCOME, null)));

        expect(error).toBeInstanceOf(Error);
        expect(error).not.toBeInstanceOf(TriggerJobDeferredError);
        expect(error).toMatchObject({
            message: "Alimtalk trigger job job-CLIENT_WELCOME is missing branchId",
        });
        expect(sendAligoAlimtalkUsecase.execute).not.toHaveBeenCalled();
    });
});
