import { Injectable, Logger } from "@nestjs/common";
import { SystemSettingService } from "application/services/system-setting.service";
import { ChannelTalkService, ContractSignedInfo, PaymentInfo } from "application/services/channeltalk.service";
import { AligoService } from "application/services/aligo.service";
import { ClientEntity } from "domain/entities/client.entity";
import { AlimtalkProvider } from "domain/entities/system-setting.entity";

@Injectable()
export class AlimtalkService {
    private readonly logger = new Logger(AlimtalkService.name);

    constructor(
        private readonly systemSettingService: SystemSettingService,
        private readonly channelTalkService: ChannelTalkService,
        private readonly aligoService: AligoService
    ) {}

    async getProvider(): Promise<AlimtalkProvider> {
        return this.systemSettingService.getAlimtalkProvider();
    }

    async sendClientCreatedAlimtalk(client: ClientEntity): Promise<void> {
        await this.routeToProvider(
            (service) => service.sendClientCreatedAlimtalk(client),
            "sendClientCreatedAlimtalk"
        );
    }

    async sendContractSignedAlimtalk(
        client: ClientEntity,
        contractInfo: ContractSignedInfo
    ): Promise<void> {
        await this.routeToProvider(
            (service) => service.sendContractSignedAlimtalk(client, contractInfo),
            "sendContractSignedAlimtalk"
        );
    }

    async sendContractReminder3DaysAlimtalk(
        client: ClientEntity,
        serviceStartDate: string
    ): Promise<void> {
        await this.routeToProvider(
            (service) => service.sendContractReminder3DaysAlimtalk(client, serviceStartDate),
            "sendContractReminder3DaysAlimtalk"
        );
    }

    async sendContractReminder1DayAlimtalk(
        client: ClientEntity,
        serviceStartDate: string
    ): Promise<void> {
        await this.routeToProvider(
            (service) => service.sendContractReminder1DayAlimtalk(client, serviceStartDate),
            "sendContractReminder1DayAlimtalk"
        );
    }

    async sendPaymentConfirmedAlimtalk(
        client: ClientEntity,
        paymentInfo: PaymentInfo
    ): Promise<void> {
        await this.routeToProvider(
            (service) => service.sendPaymentConfirmedAlimtalk(client, paymentInfo),
            "sendPaymentConfirmedAlimtalk"
        );
    }

    async sendSurveyRequestAlimtalk(
        client: ClientEntity,
        serviceEndDate: string,
        employeeName: string,
        surveyLink: string
    ): Promise<void> {
        await this.routeToProvider(
            (service) => service.sendSurveyRequestAlimtalk(client, serviceEndDate, employeeName, surveyLink),
            "sendSurveyRequestAlimtalk"
        );
    }

    async sendPaymentReminderAlimtalk(
        client: ClientEntity,
        registrationDate: string,
        daysSince: number,
        expectedAmount?: string,
        paymentDeadline?: string
    ): Promise<void> {
        await this.routeToProvider(
            (service) =>
                service.sendPaymentReminderAlimtalk(
                    client,
                    registrationDate,
                    daysSince,
                    expectedAmount,
                    paymentDeadline
                ),
            "sendPaymentReminderAlimtalk"
        );
    }

    private async routeToProvider(
        action: (service: ChannelTalkService | AligoService) => Promise<void>,
        methodName: string
    ): Promise<void> {
        try {
            const provider = await this.systemSettingService.getAlimtalkProvider();

            switch (provider) {
                case "aligo":
                    await action(this.aligoService);
                    break;
                case "channeltalk":
                    await action(this.channelTalkService);
                    break;
                case "none":
                    this.logger.debug(`[Alimtalk] Provider is 'none', skipping ${methodName}`);
                    break;
                default:
                    this.logger.warn(`[Alimtalk] Unknown provider: ${provider}, skipping ${methodName}`);
            }
        } catch (error) {
            this.logger.error(
                `[Alimtalk] Failed to execute ${methodName}`,
                error instanceof Error ? error.stack : String(error)
            );
        }
    }
}
