import {
    BadRequestException,
    Body,
    Controller,
    Post,
    UseGuards,
} from "@nestjs/common";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { CurrentTenant, TenantGuard } from "infrastructure/tenant";
import { AligoService } from "application/services/aligo.service";
import { SendSmsMessageDto } from "interface/dto/message-delivery.dto";
import { MessageSenderApprovalService } from "application/services/message-sender-approval.service";

const ALIGO_SCHEDULE_MIN_LEAD_MS = 10 * 60 * 1000;

@Controller("message-deliveries")
@UseGuards(JwtGuard, TenantGuard)
export class MessageDeliveryController {
    constructor(
        private readonly aligoService: AligoService,
        private readonly messageSenderApprovalService: MessageSenderApprovalService,
    ) {}

    @Post("sms")
    async sendSms(
        @CurrentTenant() tenant: { organizationId?: string },
        @Body() dto: SendSmsMessageDto,
    ) {
        const triggerType = dto.triggerType ?? "immediate";
        const senderPhone = await this.messageSenderApprovalService.ensureApproved(
            tenant.organizationId ?? "",
        );

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
            senderPhone,
            receiver: dto.receiver,
            message: dto.message,
            recipientName: dto.recipientName,
            title: dto.title,
            msgType: dto.msgType,
            scheduledDate,
            scheduledTime,
            testMode: dto.testMode,
        });

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
}
