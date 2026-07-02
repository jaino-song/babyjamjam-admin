import { Injectable, Logger } from "@nestjs/common";
import {
    SendAligoAlimtalkUsecase,
    SendAligoSmsUsecase,
} from "application/usecases/aligo";
import { SendAligoSmsDto, SendAligoSmsResult } from "application/dto/aligo/send-sms.dto";
import { ClientEntity } from "domain/entities/client.entity";
import { PhoneNumber } from "domain/value-objects/phone-number.vo";
import { maskPhone } from "application/utils/mask";

interface ContractSignedInfo {
    contractType: string;
    signedDate: string;
    serviceStartDate: string;
    employeeName: string;
}

@Injectable()
export class AligoService {
    private readonly logger = new Logger(AligoService.name);

    constructor(
        private readonly sendAlimtalkUsecase: SendAligoAlimtalkUsecase,
        private readonly sendSmsUsecase: SendAligoSmsUsecase,
    ) {}

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

    async sendContractSignedAlimtalk(
        client: ClientEntity,
        contractInfo: ContractSignedInfo
    ): Promise<void> {
        const phone = PhoneNumber.create(client.phone);
        if (!phone) {
            this.logger.warn(`[Aligo] Invalid or missing phone for client ${client.id}: ${maskPhone(client.phone)}`);
            return;
        }

        await this.safeSend({
            templateKey: "CONTRACT_SIGNED",
            receiver: phone.toString(),
            branchId: client.branchId ?? undefined,
            clientId: client.id,
            variables: {
                고객명: client.name,
                계약유형: contractInfo.contractType,
                계약일: contractInfo.signedDate,
                서비스시작일: contractInfo.serviceStartDate,
                담당자명: contractInfo.employeeName,
            },
        });
    }

    private async safeSend(
        dto: Parameters<SendAligoAlimtalkUsecase["execute"]>[0]
    ): Promise<void> {
        try {
            await this.sendAlimtalkUsecase.execute(dto);
        } catch (error) {
            this.logger.error(
                `[Aligo] Failed to send alimtalk: ${dto.templateKey}`,
                error instanceof Error ? error.stack : String(error)
            );
        }
    }
}
