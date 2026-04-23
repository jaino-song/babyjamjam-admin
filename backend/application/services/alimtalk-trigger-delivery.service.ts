import { Injectable } from "@nestjs/common";
import { SystemSettingService } from "application/services/system-setting.service";
import { MessageSenderApprovalService } from "application/services/message-sender-approval.service";
import { SendAligoAlimtalkUsecase } from "application/usecases/aligo";
import { SendAlimtalkUsecase as SendChannelTalkAlimtalkUsecase } from "application/usecases/channeltalk";
import { UpsertChannelTalkUserDto, CreateChannelTalkEventDto } from "application/dto/channeltalk";
import {
    ALIMTALK_TRIGGER_TEMPLATE_CATALOG,
    AlimtalkTriggerTemplateKey,
} from "domain/constants/alimtalk-trigger-catalog";
import { AlimtalkTriggerJobEntity } from "domain/entities/alimtalk-trigger-job.entity";
import { AligoTemplateKey } from "application/dto/aligo/alimtalk-template.dto";

@Injectable()
export class AlimtalkTriggerDeliveryService {
    constructor(
        private readonly systemSettingService: SystemSettingService,
        private readonly messageSenderApprovalService: MessageSenderApprovalService,
        private readonly sendAligoAlimtalkUsecase: SendAligoAlimtalkUsecase,
        private readonly sendChannelTalkAlimtalkUsecase: SendChannelTalkAlimtalkUsecase,
    ) {}

    async sendJob(job: AlimtalkTriggerJobEntity): Promise<boolean> {
        if (!job.branchId) {
            return false;
        }

        await this.messageSenderApprovalService.ensureApproved(job.branchId);

        const provider = await this.systemSettingService.getAlimtalkProvider();
        if (provider === "none") {
            return false;
        }

        const template = ALIMTALK_TRIGGER_TEMPLATE_CATALOG[job.templateKey];
        const providerMapping = template.providers[provider];
        if (!providerMapping) {
            throw new Error(`Template ${job.templateKey} is not available for provider ${provider}`);
        }

        const payload = job.payload;

        if (provider === "aligo") {
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

        const result = await this.sendChannelTalkAlimtalkUsecase.execute(
            new UpsertChannelTalkUserDto({
                memberId: payload.memberId,
                name: payload.recipientName,
                mobileNumber: payload.recipientPhone.replace(/-/g, ""),
            }),
            new CreateChannelTalkEventDto({
                memberId: payload.memberId,
                eventName: providerMapping.templateKey,
                properties: payload.templateVariables,
            }),
        );

        return result !== null;
    }

    private toAligoVariables(
        templateKey: AlimtalkTriggerTemplateKey,
        variables: Record<string, string>,
    ): Record<string, string> {
        switch (templateKey) {
            case AlimtalkTriggerTemplateKey.CLIENT_WELCOME:
                return {
                    고객명: variables["clientName"] ?? "",
                    등록일: variables["registrationDate"] ?? "",
                    서비스타입: variables["serviceType"] ?? "",
                };
            case AlimtalkTriggerTemplateKey.SERVICE_START_REMINDER:
                return {
                    고객명: variables["clientName"] ?? "",
                    서비스시작일: variables["serviceStartDate"] ?? "",
                    발송기준: variables["timingText"] ?? "",
                };
            case AlimtalkTriggerTemplateKey.SERVICE_END_REMINDER:
                return {
                    고객명: variables["clientName"] ?? "",
                    서비스종료일: variables["serviceEndDate"] ?? "",
                    발송기준: variables["timingText"] ?? "",
                };
            case AlimtalkTriggerTemplateKey.EMPLOYEE_ASSIGNED:
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
