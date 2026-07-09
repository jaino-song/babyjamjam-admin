import { Injectable } from "@nestjs/common";
import { SystemSettingService } from "application/services/system-setting.service";
import { SendAligoAlimtalkUsecase } from "application/usecases/aligo";
import {
    MESSAGE_TRIGGER_TEMPLATE_CATALOG,
    MessageTriggerTemplateKey,
} from "domain/constants/message-trigger-catalog";
import { MessageTriggerJobEntity } from "domain/entities/message-trigger-job.entity";
import { TriggerJobDeferredError } from "domain/errors/trigger-job-deferred.error";
import { AligoTemplateKey } from "application/dto/aligo/alimtalk-template.dto";

@Injectable()
export class AlimtalkTriggerDeliveryService {
    constructor(
        private readonly systemSettingService: SystemSettingService,
        private readonly sendAligoAlimtalkUsecase: SendAligoAlimtalkUsecase,
    ) {}

    async sendJob(job: MessageTriggerJobEntity): Promise<boolean> {
        if (!job.branchId) {
            throw new Error(`Alimtalk trigger job ${job.id} is missing branchId`);
        }

        const provider = await this.systemSettingService.getAlimtalkProvider();
        if (provider === "none") {
            throw new TriggerJobDeferredError(
                "config",
                "Alimtalk provider is not configured for trigger delivery",
            );
        }

        const template = MESSAGE_TRIGGER_TEMPLATE_CATALOG[job.templateKey];
        const providerMapping = template.providers[provider];
        if (!providerMapping) {
            throw new TriggerJobDeferredError(
                "config",
                `Template ${job.templateKey} is not available for provider ${provider}`,
            );
        }

        const payload = job.payload;

        await this.sendAligoAlimtalkUsecase.execute({
            templateKey: providerMapping.templateKey as AligoTemplateKey,
            receiver: payload.recipientPhone,
            variables: this.toAligoVariables(job.templateKey, payload.templateVariables),
            buttonUrl: payload.buttonUrl ?? undefined,
            branchId: job.branchId ?? undefined,
            clientId: job.clientId ?? undefined,
            triggerJobId: job.id,
        });
        return true;
    }

    private toAligoVariables(
        templateKey: MessageTriggerTemplateKey,
        variables: Record<string, string>,
    ): Record<string, string> {
        switch (templateKey) {
            case MessageTriggerTemplateKey.CLIENT_WELCOME:
                return {
                    고객명: variables["clientName"] ?? "",
                    등록일: variables["registrationDate"] ?? "",
                    서비스타입: variables["serviceType"] ?? "",
                };
            case MessageTriggerTemplateKey.SERVICE_START_REMINDER:
                return {
                    고객명: variables["clientName"] ?? "",
                    서비스시작일: variables["serviceStartDate"] ?? "",
                    발송기준: variables["timingText"] ?? "",
                };
            case MessageTriggerTemplateKey.SERVICE_END_REMINDER:
                return {
                    고객명: variables["clientName"] ?? "",
                    서비스종료일: variables["serviceEndDate"] ?? "",
                    발송기준: variables["timingText"] ?? "",
                };
            case MessageTriggerTemplateKey.EMPLOYEE_ASSIGNED:
                return {
                    직원명: variables["employeeName"] ?? "",
                    고객명: variables["clientName"] ?? "",
                    서비스시작일: variables["serviceStartDate"] ?? "",
                };
            default:
                return {};
        }
    }
}
