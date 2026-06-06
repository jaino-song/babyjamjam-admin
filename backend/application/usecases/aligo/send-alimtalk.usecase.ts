import { Injectable, Inject, Logger } from "@nestjs/common";
import { ALIGO_API_PORT, IAligoApiPort, AligoAlimtalkResponse } from "domain/ports/aligo-api.port";
import { SendAligoAlimtalkDto, AligoMessageBuilder, ALIGO_TEMPLATES } from "application/dto/aligo";
import { maskPhone } from "application/utils/mask";
import { ALIMTALK_LOG_REPOSITORY, IAlimtalkLogRepository } from "domain/repositories/alimtalk-log.repository.interface";
import { AlimtalkLogEntity } from "domain/entities/alimtalk-log.entity";

@Injectable()
export class SendAligoAlimtalkUsecase {
    private readonly logger = new Logger(SendAligoAlimtalkUsecase.name);

    constructor(
        @Inject(ALIGO_API_PORT)
        private readonly aligoApi: IAligoApiPort,
        @Inject(ALIMTALK_LOG_REPOSITORY)
        private readonly logRepository: IAlimtalkLogRepository,
    ) {}

    async execute(dto: SendAligoAlimtalkDto): Promise<AligoAlimtalkResponse> {
        const template = ALIGO_TEMPLATES[dto.templateKey];
        const message = AligoMessageBuilder.buildMessage(dto.templateKey, dto.variables);
        const subject = `알림톡 - ${dto.templateKey}`;

        const buttonJson = dto.buttonUrl
            ? AligoMessageBuilder.buildButtonJson(dto.buttonUrl)
            : undefined;

        // 발송 로그 생성
        const log = AlimtalkLogEntity.create({
            branchId: dto.branchId,
            provider: "aligo",
            templateKey: dto.templateKey,
            triggerJobId: dto.triggerJobId,
            receiver: dto.receiver,
            clientId: dto.clientId,
            messageBody: message,
            variables: dto.variables,
        });
        const savedLog = await this.logRepository.save(log);

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
