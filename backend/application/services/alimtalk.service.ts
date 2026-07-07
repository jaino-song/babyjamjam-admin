import { Injectable, Logger } from "@nestjs/common";
import { SystemSettingService } from "application/services/system-setting.service";
import { AligoService } from "application/services/aligo.service";
import { ClientEntity } from "domain/entities/client.entity";
import { AlimtalkProvider } from "domain/entities/system-setting.entity";

interface ContractSignedInfo {
    contractType: string;
    signedDate: string;
    serviceStartDate: string;
    employeeName: string;
}

@Injectable()
export class AlimtalkService {
    private readonly logger = new Logger(AlimtalkService.name);

    constructor(
        private readonly systemSettingService: SystemSettingService,
        private readonly aligoService: AligoService
    ) {}

    async getProvider(): Promise<AlimtalkProvider> {
        return this.systemSettingService.getAlimtalkProvider();
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

    private async routeToProvider(
        action: (service: AligoService) => Promise<void>,
        methodName: string
    ): Promise<void> {
        try {
            const provider = await this.systemSettingService.getAlimtalkProvider();

            switch (provider) {
                case "aligo_alimtalk":
                    await action(this.aligoService);
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
