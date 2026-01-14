import { Injectable, Logger } from "@nestjs/common";
import { SendAlimtalkUsecase } from "application/usecases/channeltalk";
import {
    CHANNELTALK_EVENTS,
    UpsertChannelTalkUserDto,
    CreateChannelTalkEventDto,
    ContractSignedProperties,
    ContractReminderProperties,
    PaymentConfirmedProperties,
    SurveyRequestProperties,
    PaymentReminderProperties,
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

export interface PaymentInfo {
    amount: number;
    date: string; // YYYY-MM-DD
    method: string;
    serviceMonth: string; // e.g., "2024년 1월"
}

@Injectable()
export class ChannelTalkService {
    private readonly logger = new Logger(ChannelTalkService.name);

    constructor(private readonly sendAlimtalkUsecase: SendAlimtalkUsecase) {}

    /**
     * Send 알림톡 when a new client is created
     * Event: CLIENT_CREATED
     */
    async sendClientCreatedAlimtalk(client: ClientEntity): Promise<void> {
        const userDto = new UpsertChannelTalkUserDto({
            memberId: client.id.toString(),
            name: client.name,
            mobileNumber: this.formatPhoneNumber(client.phone),
        });

        const eventDto = new CreateChannelTalkEventDto({
            memberId: client.id.toString(),
            eventName: CHANNELTALK_EVENTS.CLIENT_CREATED,
            properties: {
                clientName: client.name,
                registrationDate: this.formatDate(new Date()),
                serviceType: "방문요양", // 고객 등록 시 기본 서비스 타입
            },
        });

        await this.sendAlimtalkUsecase.execute(userDto, eventDto);
    }

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

    /**
     * Send 알림톡 3 days before service starts
     * Event: CONTRACT_REMINDER_3DAYS
     */
    async sendContractReminder3DaysAlimtalk(
        client: ClientEntity,
        serviceStartDate: string,
        contractLink?: string
    ): Promise<void> {
        const userDto = new UpsertChannelTalkUserDto({
            memberId: client.id.toString(),
            name: client.name,
            mobileNumber: this.formatPhoneNumber(client.phone),
        });

        const properties: ContractReminderProperties = {
            clientName: client.name,
            serviceStartDate,
            daysUntilStart: 3,
            contractLink,
        };

        const eventDto = new CreateChannelTalkEventDto({
            memberId: client.id.toString(),
            eventName: CHANNELTALK_EVENTS.CONTRACT_REMINDER_3DAYS,
            properties,
        });

        await this.sendAlimtalkUsecase.execute(userDto, eventDto);
    }

    /**
     * Send 알림톡 1 day before service starts
     * Event: CONTRACT_REMINDER_1DAY
     */
    async sendContractReminder1DayAlimtalk(
        client: ClientEntity,
        serviceStartDate: string,
        contractLink?: string
    ): Promise<void> {
        const userDto = new UpsertChannelTalkUserDto({
            memberId: client.id.toString(),
            name: client.name,
            mobileNumber: this.formatPhoneNumber(client.phone),
        });

        const properties: ContractReminderProperties = {
            clientName: client.name,
            serviceStartDate,
            daysUntilStart: 1,
            contractLink,
        };

        const eventDto = new CreateChannelTalkEventDto({
            memberId: client.id.toString(),
            eventName: CHANNELTALK_EVENTS.CONTRACT_REMINDER_1DAY,
            properties,
        });

        await this.sendAlimtalkUsecase.execute(userDto, eventDto);
    }

    /**
     * Send 알림톡 when payment is confirmed
     * Event: PAYMENT_CONFIRMED
     */
    async sendPaymentConfirmedAlimtalk(
        client: ClientEntity,
        paymentInfo: PaymentInfo
    ): Promise<void> {
        const userDto = new UpsertChannelTalkUserDto({
            memberId: client.id.toString(),
            name: client.name,
            mobileNumber: this.formatPhoneNumber(client.phone),
        });

        const properties: PaymentConfirmedProperties = {
            clientName: client.name,
            paymentAmount: this.formatCurrency(paymentInfo.amount),
            paymentDate: paymentInfo.date,
            paymentMethod: paymentInfo.method,
            serviceMonth: paymentInfo.serviceMonth,
        };

        const eventDto = new CreateChannelTalkEventDto({
            memberId: client.id.toString(),
            eventName: CHANNELTALK_EVENTS.PAYMENT_CONFIRMED,
            properties,
        });

        await this.sendAlimtalkUsecase.execute(userDto, eventDto);
    }

    /**
     * Send 알림톡 requesting a survey after service ends
     * Event: SURVEY_REQUEST
     */
    async sendSurveyRequestAlimtalk(
        client: ClientEntity,
        serviceEndDate: string,
        employeeName: string,
        surveyLink: string
    ): Promise<void> {
        const userDto = new UpsertChannelTalkUserDto({
            memberId: client.id.toString(),
            name: client.name,
            mobileNumber: this.formatPhoneNumber(client.phone),
        });

        const properties: SurveyRequestProperties = {
            clientName: client.name,
            serviceEndDate,
            surveyLink,
            employeeName,
        };

        const eventDto = new CreateChannelTalkEventDto({
            memberId: client.id.toString(),
            eventName: CHANNELTALK_EVENTS.SURVEY_REQUEST,
            properties,
        });

        await this.sendAlimtalkUsecase.execute(userDto, eventDto);
    }

    /**
     * Send 알림톡 reminding about payment
     * Event: PAYMENT_REMINDER
     */
    async sendPaymentReminderAlimtalk(
        client: ClientEntity,
        registrationDate: string,
        daysSince: number,
        expectedAmount?: string,
        paymentDeadline?: string
    ): Promise<void> {
        const userDto = new UpsertChannelTalkUserDto({
            memberId: client.id.toString(),
            name: client.name,
            mobileNumber: this.formatPhoneNumber(client.phone),
        });

        const properties: PaymentReminderProperties = {
            clientName: client.name,
            registrationDate,
            daysSinceRegistration: daysSince,
            expectedAmount,
            paymentDeadline,
        };

        const eventDto = new CreateChannelTalkEventDto({
            memberId: client.id.toString(),
            eventName: CHANNELTALK_EVENTS.PAYMENT_REMINDER,
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

    /**
     * Format date to YYYY-MM-DD string
     */
    private formatDate(date: Date): string {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
    }

    /**
     * Format number to Korean currency string
     * e.g., 150000 -> "150,000원"
     */
    private formatCurrency(amount: number): string {
        return `${amount.toLocaleString("ko-KR")}원`;
    }
}
