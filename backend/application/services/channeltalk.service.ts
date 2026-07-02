import { Injectable } from "@nestjs/common";
import { SendAlimtalkUsecase } from "application/usecases/channeltalk";
import {
    CHANNELTALK_EVENTS,
    UpsertChannelTalkUserDto,
    CreateChannelTalkEventDto,
    ContractSignedProperties,
} from "application/dto/channeltalk";
import { ClientEntity } from "domain/entities/client.entity";

// ─────────────────────────────────────────────────────────────────────────────
// Input DTOs for service methods
// ─────────────────────────────────────────────────────────────────────────────

export interface ContractSignedInfo {
    contractType: string;
    signedDate: string; // YYYY-MM-DD
    serviceStartDate: string; // YYYY-MM-DD
    employeeName: string;
}

@Injectable()
export class ChannelTalkService {
    constructor(private readonly sendAlimtalkUsecase: SendAlimtalkUsecase) {}

    /**
     * Send 알림톡 when a contract is signed
     * Event: CONTRACT_SIGNED
     */
    async sendContractSignedAlimtalk(
        client: ClientEntity,
        contractInfo: ContractSignedInfo
    ): Promise<void> {
        const userDto = new UpsertChannelTalkUserDto({
            memberId: client.id.toString(),
            name: client.name,
            mobileNumber: this.formatPhoneNumber(client.phone),
        });

        const properties: ContractSignedProperties = {
            clientName: client.name,
            contractType: contractInfo.contractType,
            signedDate: contractInfo.signedDate,
            serviceStartDate: contractInfo.serviceStartDate,
            employeeName: contractInfo.employeeName,
        };

        const eventDto = new CreateChannelTalkEventDto({
            memberId: client.id.toString(),
            eventName: CHANNELTALK_EVENTS.CONTRACT_SIGNED,
            properties,
        });

        await this.sendAlimtalkUsecase.execute(userDto, eventDto);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Helper methods
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Format phone number to Channel Talk format (no hyphens)
     * e.g., "010-1234-5678" -> "01012345678"
     */
    private formatPhoneNumber(phone: string | null): string | undefined {
        if (!phone) return undefined;
        return phone.replace(/-/g, "");
    }
}
