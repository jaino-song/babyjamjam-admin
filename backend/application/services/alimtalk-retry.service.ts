import { Inject, Injectable, Logger } from "@nestjs/common";
import { ALIGO_TEMPLATES } from "application/dto/aligo";
import { AligoTemplateKey } from "application/dto/aligo/alimtalk-template.dto";
import { maskPhone } from "application/utils/mask";
import { AlimtalkLogEntity } from "domain/entities/alimtalk-log.entity";
import { ALIGO_API_PORT, IAligoApiPort } from "domain/ports/aligo-api.port";
import {
    ALIMTALK_LOG_REPOSITORY,
    IAlimtalkLogRepository,
} from "domain/repositories/alimtalk-log.repository.interface";

@Injectable()
export class AlimtalkRetryService {
    private readonly logger = new Logger(AlimtalkRetryService.name);

    constructor(
        @Inject(ALIMTALK_LOG_REPOSITORY)
        private readonly logRepository: IAlimtalkLogRepository,
        @Inject(ALIGO_API_PORT)
        private readonly aligoApi: IAligoApiPort,
    ) {}

    async retry(log: AlimtalkLogEntity): Promise<void> {
        try {
            const templateKey = log.templateKey as AligoTemplateKey;
            const template = ALIGO_TEMPLATES[templateKey];
            if (!template) {
                log.markFailed(`Unknown template: ${log.templateKey}`);
                await this.logRepository.update(log);
                return;
            }

            const response = await this.aligoApi.sendAlimtalk({
                tplCode: template.code,
                receiver: log.receiver,
                subject: `알림톡 - ${log.templateKey}`,
                message: log.messageBody,
            });

            log.markSent(response.info?.mid?.toString());
            await this.logRepository.update(log);
            this.logger.log(`[Retry] Successfully resent ${log.templateKey} to ${maskPhone(log.receiver)}`);
        } catch (error) {
            log.markFailed(error instanceof Error ? error.message : String(error));
            await this.logRepository.update(log);
            this.logger.warn(`[Retry] Failed attempt ${log.attempts} for log ${log.id}: ${error}`);
        }
    }
}
