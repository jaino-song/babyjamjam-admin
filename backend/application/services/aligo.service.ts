import { Injectable, Logger } from "@nestjs/common";
import { SendAligoSmsUsecase } from "application/usecases/aligo";
import { SendAligoSmsDto, SendAligoSmsResult } from "application/dto/aligo/send-sms.dto";
import { maskPhone } from "application/utils/mask";

@Injectable()
export class AligoService {
    private readonly logger = new Logger(AligoService.name);

    constructor(private readonly sendSmsUsecase: SendAligoSmsUsecase) {}

    async sendSms(dto: SendAligoSmsDto): Promise<SendAligoSmsResult> {
        try {
            return await this.sendSmsUsecase.execute(dto);
        } catch (error) {
            this.logger.error(
                `[Aligo] Failed to send sms to ${maskPhone(dto.receiver)}`,
                error instanceof Error ? error.stack : String(error),
            );
            throw error;
        }
    }

}
