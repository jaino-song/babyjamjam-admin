import { Injectable, Logger } from "@nestjs/common";
import { SendAligoSmsUsecase } from "application/usecases/aligo";
import { SendAligoSmsDto, SendAligoSmsResult } from "application/dto/aligo/send-sms.dto";

import { isSmsPreSendError } from "./sms-provider-outcome.service";
import { maskSmsRecipient } from "infrastructure/config/outbound-recipient-policy";

@Injectable()
export class AligoService {
    private readonly logger = new Logger(AligoService.name);

    constructor(private readonly sendSmsUsecase: SendAligoSmsUsecase) {}

    async sendSms(dto: SendAligoSmsDto): Promise<SendAligoSmsResult> {
        try {
            return await this.sendSmsUsecase.execute(dto);
        } catch (error) {
            if (isSmsPreSendError(error)) throw error;
            if (dto.confidential) throw new Error("Confidential SMS delivery failed");
            this.logger.error(
                `[Aligo] Failed to send sms to ${dto.receiver.split(",").map(maskSmsRecipient).join(",")}`,
            );
            throw error;
        }
    }

}
