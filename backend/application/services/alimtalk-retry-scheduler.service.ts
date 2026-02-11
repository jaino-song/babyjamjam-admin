import { Injectable, Inject, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { ALIMTALK_LOG_REPOSITORY, IAlimtalkLogRepository } from "domain/repositories/alimtalk-log.repository.interface";
import { ALIGO_API_PORT, IAligoApiPort } from "domain/ports/aligo-api.port";
import { ALIGO_TEMPLATES } from "application/dto/aligo";
import { AligoTemplateKey } from "application/dto/aligo/alimtalk-template.dto";

@Injectable()
export class AlimtalkRetrySchedulerService {
    private readonly logger = new Logger(AlimtalkRetrySchedulerService.name);

    constructor(
        @Inject(ALIMTALK_LOG_REPOSITORY)
        private readonly logRepository: IAlimtalkLogRepository,
        @Inject(ALIGO_API_PORT)
        private readonly aligoApi: IAligoApiPort,
    ) {}

    @Cron("*/5 * * * *", { timeZone: "Asia/Seoul" })
    async retryFailedMessages(): Promise<void> {
        const pendingLogs = await this.logRepository.findPendingRetries();

        if (pendingLogs.length === 0) return;

        this.logger.log(`[Retry] Found ${pendingLogs.length} messages to retry`);

        for (const log of pendingLogs) {
            try {
                const templateKey = log.templateKey as AligoTemplateKey;
                const template = ALIGO_TEMPLATES[templateKey];
                if (!template) {
                    log.markFailed(`Unknown template: ${log.templateKey}`);
                    await this.logRepository.update(log);
                    continue;
                }

                const response = await this.aligoApi.sendAlimtalk({
                    tplCode: template.code,
                    receiver: log.receiver,
                    subject: `알림톡 - ${log.templateKey}`,
                    message: log.messageBody,
                });

                log.markSent(response.info?.mid?.toString());
                await this.logRepository.update(log);
                this.logger.log(`[Retry] Successfully resent ${log.templateKey} to ${log.receiver}`);
            } catch (error) {
                log.markFailed(error instanceof Error ? error.message : String(error));
                await this.logRepository.update(log);
                this.logger.warn(`[Retry] Failed attempt ${log.attempts} for log ${log.id}: ${error}`);
            }
        }
    }
}
