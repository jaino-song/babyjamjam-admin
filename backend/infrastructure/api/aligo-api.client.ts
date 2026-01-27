import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
    IAligoApiPort,
    AligoSendAlimtalkParams,
    AligoAlimtalkResponse,
} from "domain/ports/aligo-api.port";

@Injectable()
export class AligoApiClient implements IAligoApiPort {
    private readonly logger = new Logger(AligoApiClient.name);
    private readonly ALIGO_API_URL: string;
    private readonly ALIGO_API_KEY: string;
    private readonly ALIGO_USER_ID: string;
    private readonly ALIGO_SENDER_KEY: string;
    private readonly ALIGO_SENDER_PHONE: string;

    constructor(private readonly configService: ConfigService) {
        this.ALIGO_API_URL = configService.getOrThrow("ALIGO_API_URL");
        this.ALIGO_API_KEY = configService.getOrThrow("ALIGO_API_KEY");
        this.ALIGO_USER_ID = configService.getOrThrow("ALIGO_USER_ID");
        this.ALIGO_SENDER_KEY = configService.getOrThrow("ALIGO_SENDER_KEY");
        this.ALIGO_SENDER_PHONE = configService.getOrThrow("ALIGO_SENDER_PHONE");
    }

    async sendAlimtalk(params: AligoSendAlimtalkParams): Promise<AligoAlimtalkResponse> {
        const url = `${this.ALIGO_API_URL}/akv10/alimtalk/send/`;

        const formData = new FormData();
        formData.append("apikey", this.ALIGO_API_KEY);
        formData.append("userid", this.ALIGO_USER_ID);
        formData.append("senderkey", this.ALIGO_SENDER_KEY);
        formData.append("sender", this.ALIGO_SENDER_PHONE);
        formData.append("tpl_code", params.tplCode);
        formData.append("receiver_1", params.receiver);
        formData.append("subject_1", params.subject);
        formData.append("message_1", params.message);

        if (params.buttonJson) {
            formData.append("button_1", params.buttonJson);
        }

        if (params.failoverYn) {
            formData.append("failover", params.failoverYn);
            if (params.failoverSubject) {
                formData.append("fsubject_1", params.failoverSubject);
            }
            if (params.failoverMessage) {
                formData.append("fmessage_1", params.failoverMessage);
            }
        }

        this.logger.debug(`[Aligo] Sending alimtalk: ${params.tplCode} to ${params.receiver}`);

        const response = await fetch(url, {
            method: "POST",
            body: formData,
        });

        if (!response.ok) {
            const errorText = await response.text();
            this.logger.error(`[Aligo] API error: ${response.status} - ${errorText}`);
            throw new Error(`Aligo API error (${response.status}): ${errorText}`);
        }

        const data = (await response.json()) as AligoAlimtalkResponse;

        if (data.code === 0) {
            this.logger.log(`[Aligo] Alimtalk sent successfully: ${params.tplCode}`);
        } else {
            this.logger.warn(`[Aligo] Alimtalk failed: ${data.code} - ${data.message}`);
        }

        return data;
    }
}
