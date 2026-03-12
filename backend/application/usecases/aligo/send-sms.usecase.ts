import { Inject, Injectable } from "@nestjs/common";
import {
    ALIGO_SMS_API_PORT,
    IAligoSmsApiPort,
} from "domain/ports/aligo-sms-api.port";
import {
    resolveAligoSmsMessageType,
    SendAligoSmsDto,
    SendAligoSmsResult,
} from "application/dto/aligo/send-sms.dto";
import { PhoneNumber } from "domain/value-objects/phone-number.vo";

@Injectable()
export class SendAligoSmsUsecase {
    constructor(
        @Inject(ALIGO_SMS_API_PORT)
        private readonly aligoSmsApi: IAligoSmsApiPort,
    ) {}

    async execute(dto: SendAligoSmsDto): Promise<SendAligoSmsResult> {
        const receiver = this.normalizeReceiver(dto.receiver);
        const msgType = resolveAligoSmsMessageType({
            message: dto.message,
            title: dto.title,
            requestedType: dto.msgType,
        });
        const testModeYn = dto.testMode ? "Y" : "N";
        const destination =
            dto.recipientName?.trim() && dto.message.includes("%고객명%")
                ? `${receiver}|${dto.recipientName.trim()}`
                : undefined;

        const response = await this.aligoSmsApi.sendSms({
            sender: dto.senderPhone,
            receiver,
            message: dto.message,
            title: msgType === "LMS" ? dto.title?.trim() || undefined : undefined,
            msgType,
            destination,
            scheduledDate: dto.scheduledDate,
            scheduledTime: dto.scheduledTime,
            testModeYn,
        });

        return {
            request: {
                senderPhone: dto.senderPhone,
                receiver,
                msgType,
                scheduledDate: dto.scheduledDate,
                scheduledTime: dto.scheduledTime,
                testModeYn,
            },
            response,
        };
    }

    private normalizeReceiver(receiver: string): string {
        return receiver
            .split(",")
            .map((phone) => phone.trim())
            .filter(Boolean)
            .map((phone) => {
                const normalized = PhoneNumber.create(phone);
                if (!normalized) {
                    throw new Error(`Invalid receiver phone number: ${phone}`);
                }
                return normalized.toString();
            })
            .join(",");
    }
}
