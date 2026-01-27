import { Injectable, Inject, Logger } from "@nestjs/common";
import { ALIGO_API_PORT, IAligoApiPort, AligoAlimtalkResponse } from "domain/ports/aligo-api.port";
import { SendAligoAlimtalkDto, AligoMessageBuilder, ALIGO_TEMPLATES } from "application/dto/aligo";

@Injectable()
export class SendAligoAlimtalkUsecase {
    private readonly logger = new Logger(SendAligoAlimtalkUsecase.name);

    constructor(
        @Inject(ALIGO_API_PORT)
        private readonly aligoApi: IAligoApiPort
    ) {}

    async execute(dto: SendAligoAlimtalkDto): Promise<AligoAlimtalkResponse> {
        const template = ALIGO_TEMPLATES[dto.templateKey];
        const message = AligoMessageBuilder.buildMessage(dto.templateKey, dto.variables);
        const subject = `알림톡 - ${dto.templateKey}`;

        const buttonJson = dto.buttonUrl
            ? AligoMessageBuilder.buildButtonJson(dto.buttonUrl)
            : undefined;

        this.logger.debug(`[Aligo] Sending ${dto.templateKey} to ${dto.receiver}`);

        return this.aligoApi.sendAlimtalk({
            tplCode: template.code,
            receiver: dto.receiver,
            subject,
            message,
            buttonJson,
        });
    }
}
