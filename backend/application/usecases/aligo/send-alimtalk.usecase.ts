import { Injectable, Inject, Logger } from "@nestjs/common";
import { ALIGO_API_PORT, IAligoApiPort, AligoAlimtalkResponse } from "domain/ports/aligo-api.port";
import { SendAligoAlimtalkDto, AligoMessageBuilder, ALIGO_TEMPLATES } from "application/dto/aligo";
import { maskPhone } from "application/utils/mask";
import { MESSAGE_LOG_REPOSITORY, IMessageLogRepository } from "domain/repositories/message-log.repository.interface";
import { MessageLogEntity } from "domain/entities/message-log.entity";
import { TriggerJobDeferredError } from "domain/errors/trigger-job-deferred.error";
import { isTransientPrismaConnectivityError } from "infrastructure/database/prisma-error.utils";

@Injectable()
export class SendAligoAlimtalkUsecase {
    private readonly logger = new Logger(SendAligoAlimtalkUsecase.name);

    constructor(
        @Inject(ALIGO_API_PORT)
        private readonly aligoApi: IAligoApiPort,
        @Inject(MESSAGE_LOG_REPOSITORY)
        private readonly logRepository: IMessageLogRepository,
    ) {}

    async execute(dto: SendAligoAlimtalkDto): Promise<AligoAlimtalkResponse> {
        const template = ALIGO_TEMPLATES[dto.templateKey];
        const message = AligoMessageBuilder.buildMessage(dto.templateKey, dto.variables);
        const subject = `알림톡 - ${dto.templateKey}`;

        const buttonJson = dto.buttonUrl
            ? AligoMessageBuilder.buildButtonJson(dto.buttonUrl)
            : undefined;

        // 발송 로그 생성
        const log = MessageLogEntity.create({
            branchId: dto.branchId,
            provider: "aligo_alimtalk",
            templateKey: dto.templateKey,
            triggerJobId: dto.triggerJobId,
            receiver: dto.receiver,
            clientId: dto.clientId,
            recipientName: dto.recipientName ?? null,
            recipientPhone: dto.receiver,
            messageBody: message,
            variables: dto.variables,
        });
        let savedLog: MessageLogEntity;
        try {
            savedLog = await this.logRepository.save(log);
        } catch (error) {
            if (isTransientPrismaConnectivityError(error)) {
                throw new TriggerJobDeferredError(
                    "transient",
                    error instanceof Error ? error.message : String(error),
                );
            }
            throw error;
        }

        this.logger.debug(`[Aligo] Sending ${dto.templateKey} to ${maskPhone(dto.receiver)}`);

        try {
            const response = await this.aligoApi.sendAlimtalk({
                tplCode: template.code,
                receiver: dto.receiver,
                subject,
                message,
                buttonJson,
            });

            savedLog.markSent(response.info?.mid?.toString());
            await this.logRepository.update(savedLog);
            return response;
        } catch (error) {
            savedLog.markFailed(error instanceof Error ? error.message : String(error));
            await this.logRepository.update(savedLog);
            throw error;
        }
    }
}
