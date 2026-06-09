import {
    BadGatewayException,
    BadRequestException,
    Body,
    Controller,
    Logger,
    Post,
    UseGuards,
} from "@nestjs/common";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { CurrentTenant, TenantGuard } from "infrastructure/tenant";
import { AligoService } from "application/services/aligo.service";
import { SendSmsMessageDto } from "interface/dto/message-delivery.dto";
import { MessageSenderApprovalService } from "application/services/message-sender-approval.service";
import { PrismaService } from "infrastructure/database/prisma.service";

const ALIGO_SCHEDULE_MIN_LEAD_MS = 10 * 60 * 1000;

@Controller("message-deliveries")
@UseGuards(JwtGuard, TenantGuard)
export class MessageDeliveryController {
    private readonly logger = new Logger(MessageDeliveryController.name);

    constructor(
        private readonly aligoService: AligoService,
        private readonly messageSenderApprovalService: MessageSenderApprovalService,
        private readonly prisma: PrismaService,
    ) {}

    @Post("sms")
    async sendSms(
        @CurrentTenant() tenant: { branchId?: string },
        @Body() dto: SendSmsMessageDto,
    ) {
        const triggerType = dto.triggerType ?? "immediate";
        const branchId = tenant.branchId ?? "";
        this.logger.log(
            `[SMS] Request received: branchId=${branchId || "unknown"}, triggerType=${triggerType}, recipientCount=${this.countSmsRecipients(dto.receiver)}`,
        );

        try {
            await this.messageSenderApprovalService.ensureApproved(branchId);
        } catch (error) {
            this.logger.warn(
                `[SMS] Sender approval check failed: branchId=${branchId || "unknown"}, error=${error instanceof Error ? error.message : String(error)}`,
            );
            throw error;
        }

        if (triggerType === "scheduled") {
            this.assertScheduledAtLeastTenMinutesAhead(
                dto.scheduledDate,
                dto.scheduledTime,
            );
        }

        const scheduledDate = triggerType === "scheduled"
            ? dto.scheduledDate?.replace(/-/g, "")
            : undefined;
        const scheduledTime = triggerType === "scheduled"
            ? dto.scheduledTime?.replace(":", "")
            : undefined;
        const result = await this.aligoService.sendSms({
            receiver: dto.receiver,
            message: dto.message,
            recipientName: dto.recipientName,
            title: dto.title,
            msgType: dto.msgType,
            scheduledDate,
            scheduledTime,
            testMode: dto.testMode,
        }).catch(async (error) => {
            const errorMessage = this.formatErrorMessage(error);
            this.logger.warn(
                `[SMS] Aligo request failed: branchId=${branchId || "unknown"}, error=${errorMessage}`,
            );
            await this.recordFailedSmsLogFromError(
                branchId,
                dto,
                triggerType,
                error,
                scheduledDate,
                scheduledTime,
            ).catch((logError) => {
                this.logger.warn(`Failed to record failed SMS delivery log: ${this.formatErrorMessage(logError)}`);
            });
            throw new BadGatewayException(errorMessage);
        });
        this.logger.log(
            `[SMS] Aligo response received: branchId=${branchId || "unknown"}, resultCode=${result.response.result_code}, errorCount=${result.response.error_cnt ?? 0}`,
        );
        await this.recordSmsLog(branchId, dto, result, triggerType).catch((error) => {
            this.logger.warn(`Failed to record SMS delivery log: ${error instanceof Error ? error.message : String(error)}`);
        });

        if (!this.isAcceptedSmsResult(result)) {
            throw new BadGatewayException(
                result.response.message || "문자 발송 요청이 실패했습니다.",
            );
        }

        return {
            provider: "aligo",
            triggerType,
            request: {
                senderPhone: result.request.senderPhone,
                receiver: result.request.receiver,
                msgType: result.request.msgType,
                scheduledAt:
                    result.request.scheduledDate && result.request.scheduledTime
                        ? `${result.request.scheduledDate}${result.request.scheduledTime}`
                        : undefined,
                testMode: result.request.testModeYn === "Y",
            },
            result: {
                resultCode: result.response.result_code,
                message: result.response.message,
                msgId: result.response.msg_id,
                successCount: result.response.success_cnt,
                errorCount: result.response.error_cnt,
                msgType: result.response.msg_type,
            },
        };
    }

    private async recordSmsLog(
        branchId: string,
        dto: SendSmsMessageDto,
        result: Awaited<ReturnType<AligoService["sendSms"]>>,
        triggerType: string,
    ) {
        const isAccepted = this.isAcceptedSmsResult(result);
        const status = isAccepted
            ? triggerType === "scheduled" ? "pending" : "sent"
            : "failed";
        await this.prisma.alimtalk_log.create({
            data: {
                branchId: branchId || null,
                provider: "aligo_sms",
                templateKey: dto.title?.trim() || "manual_sms",
                receiver: result.request.receiver,
                clientId: dto.clientId ?? null,
                messageBody: dto.message,
                variables: {
                    recipientName: dto.recipientName ?? null,
                    title: dto.title ?? null,
                    triggerType,
                    msgType: result.request.msgType,
                    scheduledDate: result.request.scheduledDate ?? null,
                    scheduledTime: result.request.scheduledTime ?? null,
                },
                status,
                aligoMid: result.response.msg_id ? String(result.response.msg_id) : null,
                errorMessage: isAccepted ? null : result.response.message,
                attempts: 1,
                lastAttemptAt: new Date(),
            },
        });
    }

    private async recordFailedSmsLogFromError(
        branchId: string,
        dto: SendSmsMessageDto,
        triggerType: string,
        error: unknown,
        scheduledDate?: string,
        scheduledTime?: string,
    ) {
        const errorMessage = this.formatErrorMessage(error);
        await this.prisma.alimtalk_log.create({
            data: {
                branchId: branchId || null,
                provider: "aligo_sms",
                templateKey: dto.title?.trim() || "manual_sms",
                receiver: dto.receiver,
                clientId: dto.clientId ?? null,
                messageBody: dto.message,
                variables: {
                    recipientName: dto.recipientName ?? null,
                    title: dto.title ?? null,
                    triggerType,
                    msgType: dto.msgType ?? null,
                    scheduledDate: scheduledDate ?? null,
                    scheduledTime: scheduledTime ?? null,
                    providerError: errorMessage,
                },
                status: "failed",
                aligoMid: null,
                errorMessage,
                attempts: 1,
                lastAttemptAt: new Date(),
            },
        });
    }

    private isAcceptedSmsResult(
        result: Awaited<ReturnType<AligoService["sendSms"]>>,
    ) {
        const resultCode = Number(result.response.result_code);
        const errorCount = Number(result.response.error_cnt ?? 0);
        return (
            resultCode === 1 &&
            errorCount === 0
        );
    }

    private countSmsRecipients(receiver: string): number {
        return receiver
            .split(",")
            .map((phone) => phone.trim())
            .filter(Boolean).length;
    }

    private assertScheduledAtLeastTenMinutesAhead(
        scheduledDate?: string,
        scheduledTime?: string,
    ) {
        if (!scheduledDate || !scheduledTime) {
            return;
        }

        const scheduledAtMs = this.parseKstSchedule(scheduledDate, scheduledTime);
        if (scheduledAtMs - Date.now() < ALIGO_SCHEDULE_MIN_LEAD_MS) {
            throw new BadRequestException(
                "예약 발송은 한국시간 기준 현재 시각보다 10분 이후만 등록할 수 있습니다.",
            );
        }
    }

    private parseKstSchedule(date: string, time: string): number {
        const scheduledAt = new Date(`${date}T${time}:00+09:00`).getTime();
        if (Number.isNaN(scheduledAt)) {
            throw new BadRequestException("예약 발송 일시 형식이 올바르지 않습니다.");
        }
        return scheduledAt;
    }

    private formatErrorMessage(error: unknown): string {
        if (error instanceof Error && error.message.trim()) {
            return error.message;
        }
        const message = String(error ?? "").trim();
        return message || "문자 발송 요청이 실패했습니다.";
    }
}
