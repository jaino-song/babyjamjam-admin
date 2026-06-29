import { Inject, Injectable, Logger } from "@nestjs/common";
import { SystemSettingService } from "application/services/system-setting.service";
import { MessageSenderApprovalService } from "application/services/message-sender-approval.service";
import { AligoService } from "application/services/aligo.service";
import { SystemTemplateService } from "application/services/system-template.service";
import { SendAligoAlimtalkUsecase } from "application/usecases/aligo";
import { SendAlimtalkUsecase as SendChannelTalkAlimtalkUsecase } from "application/usecases/channeltalk";
import { SendAligoSmsResult } from "application/dto/aligo/send-sms.dto";
import { UpsertChannelTalkUserDto, CreateChannelTalkEventDto } from "application/dto/channeltalk";
import { SYSTEM_TEMPLATE_REGISTRY, SystemTemplateKey } from "domain/constants/system-template-registry";
import {
    ALIMTALK_TRIGGER_TEMPLATE_CATALOG,
    AlimtalkTriggerTemplateKey,
} from "domain/constants/alimtalk-trigger-catalog";
import { AlimtalkTriggerJobEntity } from "domain/entities/alimtalk-trigger-job.entity";
import {
    AlimtalkLogEntity,
    AlimtalkLogStatus,
    SMS_DELIVERY_RETRY_DELAY_MS,
} from "domain/entities/alimtalk-log.entity";
import {
    ALIMTALK_LOG_REPOSITORY,
    IAlimtalkLogRepository,
} from "domain/repositories/alimtalk-log.repository.interface";
import { AligoTemplateKey } from "application/dto/aligo/alimtalk-template.dto";

interface SmsTemplateDeliveryConfig {
    smsLogTemplateKey: string;
    automationKey: string;
    triggerType: string;
    title: string;
    systemTemplateKey: SystemTemplateKey;
}

export const SMS_TEMPLATE_DELIVERY: Partial<Record<AlimtalkTriggerTemplateKey, SmsTemplateDeliveryConfig>> = {
    [AlimtalkTriggerTemplateKey.SERVICE_INFO]: {
        smsLogTemplateKey: "service_info_sms",
        automationKey: "SERVICE_INFO_SMS",
        triggerType: "service_start_before_7_days",
        title: "서비스 안내",
        systemTemplateKey: SystemTemplateKey.SERVICE_INFO,
    },
    [AlimtalkTriggerTemplateKey.CLIENT_GREETING]: {
        smsLogTemplateKey: "client_greeting_sms",
        automationKey: "CLIENT_GREETING_SMS",
        triggerType: "client_created",
        title: "인사 메시지",
        systemTemplateKey: SystemTemplateKey.GREETING,
    },
    [AlimtalkTriggerTemplateKey.PRICE_INFO]: {
        smsLogTemplateKey: "price_info_sms",
        automationKey: "PRICE_INFO_SMS",
        triggerType: "price_info",
        title: "비용 안내",
        systemTemplateKey: SystemTemplateKey.PRICE_INFO,
    },
    [AlimtalkTriggerTemplateKey.REMINDER]: {
        smsLogTemplateKey: "reminder_sms",
        automationKey: "REMINDER_SMS",
        triggerType: "reminder",
        title: "리마인드",
        systemTemplateKey: SystemTemplateKey.REMINDER,
    },
    [AlimtalkTriggerTemplateKey.THANKS]: {
        smsLogTemplateKey: "thanks_sms",
        automationKey: "THANKS_SMS",
        triggerType: "thanks",
        title: "예약 완료",
        systemTemplateKey: SystemTemplateKey.THANKS,
    },
    [AlimtalkTriggerTemplateKey.SURVEY]: {
        smsLogTemplateKey: "survey_sms",
        automationKey: "SURVEY_SMS",
        triggerType: "survey",
        title: "모니터링 설문",
        systemTemplateKey: SystemTemplateKey.SURVEY,
    },
    [AlimtalkTriggerTemplateKey.INFO]: {
        smsLogTemplateKey: "info_sms",
        automationKey: "INFO_SMS",
        triggerType: "info",
        title: "정보 안내",
        systemTemplateKey: SystemTemplateKey.INFO,
    },
};

@Injectable()
export class AlimtalkTriggerDeliveryService {
    private readonly logger = new Logger(AlimtalkTriggerDeliveryService.name);

    constructor(
        private readonly systemSettingService: SystemSettingService,
        private readonly messageSenderApprovalService: MessageSenderApprovalService,
        private readonly aligoService: AligoService,
        private readonly systemTemplateService: SystemTemplateService,
        private readonly sendAligoAlimtalkUsecase: SendAligoAlimtalkUsecase,
        private readonly sendChannelTalkAlimtalkUsecase: SendChannelTalkAlimtalkUsecase,
        @Inject(ALIMTALK_LOG_REPOSITORY)
        private readonly logRepository: IAlimtalkLogRepository,
    ) {}

    async sendJob(job: AlimtalkTriggerJobEntity): Promise<boolean> {
        if (!job.branchId) {
            return false;
        }

        await this.messageSenderApprovalService.ensureApproved(job.branchId);

        const smsConfig = SMS_TEMPLATE_DELIVERY[job.templateKey];
        if (smsConfig) {
            return this.sendSmsJob(job, smsConfig);
        }

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

    private async sendSmsJob(
        job: AlimtalkTriggerJobEntity,
        config: SmsTemplateDeliveryConfig,
    ): Promise<boolean> {
        const payload = job.payload;
        const baseVariables: Record<string, string> = {
            name: payload.recipientName,
            clientName: payload.recipientName,
            ...payload.templateVariables,
        };
        const message = await this.resolveSmsMessage(config.systemTemplateKey, baseVariables);
        const receiver = payload.recipientPhone;

        try {
            const result = await this.aligoService.sendSms({
                receiver,
                message,
                recipientName: payload.recipientName,
                title: config.title,
                msgType: "AUTO",
            });
            const isAccepted = this.isAcceptedSmsResult(result);
            await this.recordSmsLog({
                job,
                config,
                message,
                receiver: result.request.receiver,
                status: isAccepted ? "sent" : "failed",
                aligoMid: result.response.msg_id ? String(result.response.msg_id) : null,
                errorMessage: isAccepted ? null : result.response.message,
                msgType: result.request.msgType,
                templateVariables: payload.templateVariables,
            });
            return isAccepted;
        } catch (error) {
            const errorMessage = this.formatErrorMessage(error);
            await this.recordSmsLog({
                job,
                config,
                message,
                receiver,
                status: "failed",
                aligoMid: null,
                errorMessage,
                msgType: "AUTO",
                templateVariables: payload.templateVariables,
            }).catch((logError) => {
                this.logger.warn(
                    `Failed to record SMS log: ${this.formatErrorMessage(logError)}`,
                );
            });
            throw error;
        }
    }

    private async resolveSmsMessage(
        systemTemplateKey: SystemTemplateKey,
        variables: Record<string, string>,
    ): Promise<string> {
        try {
            const template = await this.systemTemplateService.getByKey(systemTemplateKey);
            return this.renderTemplate(template.content, variables);
        } catch (error) {
            this.logger.warn(
                `[SMS Automation] Failed to load system template ${systemTemplateKey}, using registry default: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
            return this.renderTemplate(
                SYSTEM_TEMPLATE_REGISTRY[systemTemplateKey].defaultContent,
                variables,
            );
        }
    }

    private renderTemplate(template: string, variables: Record<string, string>): string {
        return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => variables[key] ?? match);
    }

    private async recordSmsLog(params: {
        job: AlimtalkTriggerJobEntity;
        config: SmsTemplateDeliveryConfig;
        message: string;
        receiver: string;
        status: AlimtalkLogStatus;
        aligoMid: string | null;
        errorMessage: string | null;
        msgType: string;
        templateVariables: Record<string, string>;
    }): Promise<void> {
        const now = new Date();
        await this.logRepository.save(
            AlimtalkLogEntity.reconstitute(
                0,
                params.job.branchId,
                "aligo_sms",
                params.config.smsLogTemplateKey,
                params.job.id,
                params.receiver,
                params.job.clientId,
                params.message,
                {
                    ...params.templateVariables,
                    automationKey: params.config.automationKey,
                    systemTemplateKey: params.config.systemTemplateKey,
                    recipientName: params.job.payload.recipientName,
                    title: params.config.title,
                    triggerType: params.config.triggerType,
                    msgType: params.msgType,
                },
                params.status,
                params.aligoMid,
                params.errorMessage,
                1,
                now,
                params.status === "failed"
                    ? new Date(now.getTime() + SMS_DELIVERY_RETRY_DELAY_MS)
                    : null,
                now,
                now,
            ),
        );
    }

    private isAcceptedSmsResult(result: SendAligoSmsResult): boolean {
        const resultCode = Number(result.response.result_code);
        const errorCount = Number(result.response.error_cnt ?? 0);
        return resultCode === 1 && errorCount === 0;
    }

    private formatErrorMessage(error: unknown): string {
        if (error instanceof Error && error.message.trim()) {
            return error.message;
        }
        const message = String(error ?? "").trim();
        return message || "문자 발송 요청이 실패했습니다.";
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
