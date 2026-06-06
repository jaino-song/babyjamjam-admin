import { Injectable, Logger } from "@nestjs/common";
import { AligoService } from "application/services/aligo.service";
import { MessageSenderApprovalService } from "application/services/message-sender-approval.service";
import { SystemTemplateService } from "application/services/system-template.service";
import { SystemTemplateKey, SYSTEM_TEMPLATE_REGISTRY } from "domain/constants/system-template-registry";
import { ClientEntity } from "domain/entities/client.entity";
import { PhoneNumber } from "domain/value-objects/phone-number.vo";
import { PrismaService } from "infrastructure/database/prisma.service";

const CLIENT_GREETING_SMS_TEMPLATE_KEY = "client_greeting_sms";
const CLIENT_GREETING_SMS_TITLE = "인사 메시지";
const CLIENT_GREETING_SMS_RETRY_DELAY_MS = 60 * 60 * 1000;

@Injectable()
export class ClientGreetingSmsAutomationService {
    private readonly logger = new Logger(ClientGreetingSmsAutomationService.name);

    constructor(
        private readonly aligoService: AligoService,
        private readonly messageSenderApprovalService: MessageSenderApprovalService,
        private readonly systemTemplateService: SystemTemplateService,
        private readonly prisma: PrismaService,
    ) {}

    async sendClientGreetingSms(branchId: string, client: ClientEntity): Promise<void> {
        const phone = PhoneNumber.create(client.phone);
        if (!phone) {
            this.logger.warn(`[SMS Automation] Invalid or missing phone for client ${client.id}: ${client.phone}`);
            return;
        }

        const senderPhone = await this.messageSenderApprovalService.ensureApproved(branchId);
        const message = await this.resolveGreetingMessage(client);
        const receiver = phone.toString();
        const result = await this.aligoService.sendSms({
            senderPhone,
            receiver,
            message,
            recipientName: client.name,
            title: CLIENT_GREETING_SMS_TITLE,
            msgType: "AUTO",
        }).catch(async (error) => {
            await this.recordFailedSmsLogFromError(
                branchId,
                client,
                receiver,
                message,
                senderPhone,
                error,
            );
            throw error;
        });

        const isAccepted = this.isAcceptedSmsResult(result);
        await this.prisma.alimtalk_log.create({
            data: {
                branchId,
                provider: "aligo_sms",
                templateKey: CLIENT_GREETING_SMS_TEMPLATE_KEY,
                receiver: result.request.receiver,
                clientId: client.id,
                messageBody: message,
                variables: {
                    automationKey: "CLIENT_GREETING_SMS",
                    systemTemplateKey: SystemTemplateKey.GREETING,
                    recipientName: client.name,
                    title: CLIENT_GREETING_SMS_TITLE,
                    triggerType: "client_created",
                    msgType: result.request.msgType,
                    senderPhone,
                },
                status: isAccepted ? "sent" : "failed",
                aligoMid: result.response.msg_id ? String(result.response.msg_id) : null,
                errorMessage: isAccepted ? null : result.response.message,
                attempts: 1,
                lastAttemptAt: new Date(Date.now()),
                nextRetryAt: isAccepted ? null : this.nextRetryAt(),
            },
        });

        if (!isAccepted) {
            throw new Error(result.response.message || "문자 발송 요청이 실패했습니다.");
        }
    }

    private async recordFailedSmsLogFromError(
        branchId: string,
        client: ClientEntity,
        receiver: string,
        message: string,
        senderPhone: string,
        error: unknown,
    ) {
        const errorMessage = this.formatErrorMessage(error);
        await this.prisma.alimtalk_log.create({
            data: {
                branchId,
                provider: "aligo_sms",
                templateKey: CLIENT_GREETING_SMS_TEMPLATE_KEY,
                receiver,
                clientId: client.id,
                messageBody: message,
                variables: {
                    automationKey: "CLIENT_GREETING_SMS",
                    systemTemplateKey: SystemTemplateKey.GREETING,
                    recipientName: client.name,
                    title: CLIENT_GREETING_SMS_TITLE,
                    triggerType: "client_created",
                    msgType: "AUTO",
                    senderPhone,
                    providerError: errorMessage,
                },
                status: "failed",
                aligoMid: null,
                errorMessage,
                attempts: 1,
                lastAttemptAt: new Date(Date.now()),
                nextRetryAt: this.nextRetryAt(),
            },
        });
    }

    private async resolveGreetingMessage(client: ClientEntity): Promise<string> {
        try {
            const template = await this.systemTemplateService.getByKey(SystemTemplateKey.GREETING);
            return this.renderClientVariables(template.content, client);
        } catch (error) {
            this.logger.warn(
                `[SMS Automation] Failed to load greeting system template, using registry default: ${
                    error instanceof Error ? error.message : String(error)
                }`,
            );
            return this.renderClientVariables(
                SYSTEM_TEMPLATE_REGISTRY[SystemTemplateKey.GREETING].defaultContent,
                client,
            );
        }
    }

    private renderClientVariables(template: string, client: ClientEntity): string {
        const values: Record<string, string> = {
            name: client.name,
            clientName: client.name,
            phone: client.phone ?? "",
        };

        return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) => values[key] ?? match);
    }

    private isAcceptedSmsResult(result: Awaited<ReturnType<AligoService["sendSms"]>>): boolean {
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

    private nextRetryAt(): Date {
        return new Date(Date.now() + CLIENT_GREETING_SMS_RETRY_DELAY_MS);
    }
}
