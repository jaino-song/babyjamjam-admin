import { Injectable, Logger } from "@nestjs/common";
import { SendAligoAlimtalkUsecase } from "application/usecases/aligo";
import { ClientEntity } from "domain/entities/client.entity";

interface ContractSignedInfo {
    contractType: string;
    signedDate: string;
    serviceStartDate: string;
    employeeName: string;
}

interface PaymentInfo {
    amount: number;
    date: string;
    method: string;
    serviceMonth: string;
}

@Injectable()
export class AligoService {
    private readonly logger = new Logger(AligoService.name);

    constructor(private readonly sendAlimtalkUsecase: SendAligoAlimtalkUsecase) {}

    async sendClientCreatedAlimtalk(client: ClientEntity): Promise<void> {
        const phone = this.formatPhoneNumber(client.phone);
        if (!phone) {
            this.logger.warn(`[Aligo] Cannot send alimtalk: no phone for client ${client.id}`);
            return;
        }

        await this.safeSend({
            templateKey: "CLIENT_CREATED",
            receiver: phone,
            variables: {
                고객명: client.name,
                등록일: this.formatDate(new Date()),
                서비스타입: "방문요양",
            },
        });
    }

    async sendContractSignedAlimtalk(
        client: ClientEntity,
        contractInfo: ContractSignedInfo
    ): Promise<void> {
        const phone = this.formatPhoneNumber(client.phone);
        if (!phone) return;

        await this.safeSend({
            templateKey: "CONTRACT_SIGNED",
            receiver: phone,
            variables: {
                고객명: client.name,
                계약유형: contractInfo.contractType,
                계약일: contractInfo.signedDate,
                서비스시작일: contractInfo.serviceStartDate,
                담당자명: contractInfo.employeeName,
            },
        });
    }

    async sendContractReminder3DaysAlimtalk(
        client: ClientEntity,
        serviceStartDate: string
    ): Promise<void> {
        const phone = this.formatPhoneNumber(client.phone);
        if (!phone) return;

        await this.safeSend({
            templateKey: "CONTRACT_REMINDER_3DAYS",
            receiver: phone,
            variables: {
                고객명: client.name,
                서비스시작일: serviceStartDate,
            },
        });
    }

    async sendContractReminder1DayAlimtalk(
        client: ClientEntity,
        serviceStartDate: string
    ): Promise<void> {
        const phone = this.formatPhoneNumber(client.phone);
        if (!phone) return;

        await this.safeSend({
            templateKey: "CONTRACT_REMINDER_1DAY",
            receiver: phone,
            variables: {
                고객명: client.name,
                서비스시작일: serviceStartDate,
            },
        });
    }

    async sendPaymentConfirmedAlimtalk(
        client: ClientEntity,
        paymentInfo: PaymentInfo
    ): Promise<void> {
        const phone = this.formatPhoneNumber(client.phone);
        if (!phone) return;

        await this.safeSend({
            templateKey: "PAYMENT_CONFIRMED",
            receiver: phone,
            variables: {
                고객명: client.name,
                결제금액: this.formatCurrency(paymentInfo.amount),
                결제일: paymentInfo.date,
                결제방법: paymentInfo.method,
                서비스월: paymentInfo.serviceMonth,
            },
        });
    }

    async sendSurveyRequestAlimtalk(
        client: ClientEntity,
        serviceEndDate: string,
        employeeName: string,
        surveyLink: string
    ): Promise<void> {
        const phone = this.formatPhoneNumber(client.phone);
        if (!phone) return;

        await this.safeSend({
            templateKey: "SURVEY_REQUEST",
            receiver: phone,
            variables: {
                고객명: client.name,
                서비스종료일: serviceEndDate,
                담당자명: employeeName,
                설문링크: surveyLink,
            },
            buttonUrl: surveyLink,
        });
    }

    async sendPaymentReminderAlimtalk(
        client: ClientEntity,
        registrationDate: string,
        daysSince: number,
        expectedAmount?: string,
        paymentDeadline?: string
    ): Promise<void> {
        const phone = this.formatPhoneNumber(client.phone);
        if (!phone) return;

        await this.safeSend({
            templateKey: "PAYMENT_REMINDER",
            receiver: phone,
            variables: {
                고객명: client.name,
                등록일: registrationDate,
                예상금액: expectedAmount || "",
                결제기한: paymentDeadline || "",
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

    private formatPhoneNumber(phone: string | null): string | null {
        if (!phone) return null;
        return phone.replace(/-/g, "");
    }

    private formatDate(date: Date): string {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        return `${year}-${month}-${day}`;
    }

    private formatCurrency(amount: number): string {
        return `${amount.toLocaleString("ko-KR")}원`;
    }
}
