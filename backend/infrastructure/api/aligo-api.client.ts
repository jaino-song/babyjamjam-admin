import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
    IAligoApiPort,
    AligoSendAlimtalkParams,
    AligoAlimtalkResponse,
    AligoCreateTemplateParams,
    AligoTemplateCreateResponse,
    AligoTemplateListResponse,
} from "domain/ports/aligo-api.port";
import {
    AligoSendSmsParams,
    AligoSmsResponse,
    IAligoSmsApiPort,
} from "domain/ports/aligo-sms-api.port";

@Injectable()
export class AligoApiClient implements IAligoApiPort, IAligoSmsApiPort {
    private readonly logger = new Logger(AligoApiClient.name);
    private readonly ALIGO_API_URL: string;
    private readonly ALIGO_SMS_API_URL: string;
    private readonly ALIGO_API_KEY: string;
    private readonly ALIGO_USER_ID: string;
    private readonly ALIGO_SENDER_KEY: string;
    private readonly ALIGO_SENDER_PHONE: string;
    private readonly isConfigured: boolean;
    private readonly TOKEN_LIFETIME_SECONDS = 1800;
    private cachedToken: { content: string; expiresAt: number } | null = null;

    constructor(private readonly configService: ConfigService) {
        this.ALIGO_API_URL = configService.get("ALIGO_API_URL") || "";
        this.ALIGO_SMS_API_URL = configService.get("ALIGO_SMS_API_URL") || "https://apis.aligo.in";
        this.ALIGO_API_KEY = configService.get("ALIGO_API_KEY") || "";
        this.ALIGO_USER_ID = configService.get("ALIGO_USER_ID") || "";
        this.ALIGO_SENDER_KEY = configService.get("ALIGO_SENDER_KEY") || "";
        this.ALIGO_SENDER_PHONE = configService.get("ALIGO_SENDER_PHONE") || "";
        this.isConfigured = Boolean(
            this.ALIGO_API_URL &&
            this.ALIGO_API_KEY &&
            this.ALIGO_USER_ID &&
            this.ALIGO_SENDER_KEY &&
            this.ALIGO_SENDER_PHONE,
        );

        if (!this.isConfigured) {
            this.logger.warn("ALIGO_API_URL, ALIGO_API_KEY, ALIGO_USER_ID, ALIGO_SENDER_KEY, and ALIGO_SENDER_PHONE not configured. Aligo integration will be disabled.");
        }
    }

    async sendAlimtalk(params: AligoSendAlimtalkParams): Promise<AligoAlimtalkResponse> {
        this.assertConfigured();
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

    async sendSms(params: AligoSendSmsParams): Promise<AligoSmsResponse> {
        this.assertConfigured();
        const url = `${this.ALIGO_SMS_API_URL}/send/`;

        const formData = new FormData();
        formData.append("key", this.ALIGO_API_KEY);
        formData.append("user_id", this.ALIGO_USER_ID);
        formData.append("sender", params.sender ?? this.ALIGO_SENDER_PHONE);
        formData.append("receiver", params.receiver);
        formData.append("msg", params.message);

        if (params.msgType) {
            formData.append("msg_type", params.msgType);
        }
        if (params.title) {
            formData.append("title", params.title);
        }
        if (params.destination) {
            formData.append("destination", params.destination);
        }
        if (params.scheduledDate) {
            formData.append("rdate", params.scheduledDate);
        }
        if (params.scheduledTime) {
            formData.append("rtime", params.scheduledTime);
        }
        if (params.testModeYn) {
            formData.append("testmode_yn", params.testModeYn);
        }

        this.logger.debug(`[Aligo] Sending sms to ${params.receiver}`);

        const response = await fetch(url, {
            method: "POST",
            body: formData,
        });

        if (!response.ok) {
            const errorText = await response.text();
            this.logger.error(`[Aligo] SMS API error: ${response.status} - ${errorText}`);
            throw new Error(`Aligo SMS API error (${response.status}): ${errorText}`);
        }

        return (await response.json()) as AligoSmsResponse;
    }

    async createTemplate(params: AligoCreateTemplateParams): Promise<AligoTemplateCreateResponse> {
        this.assertConfigured();
        const url = `${this.ALIGO_API_URL}/akv10/template/add/`;

        const formData = new FormData();
        formData.append("apikey", this.ALIGO_API_KEY);
        formData.append("userid", this.ALIGO_USER_ID);
        formData.append("senderkey", this.ALIGO_SENDER_KEY);
        formData.append("tpl_name", params.templateName);
        formData.append("tpl_content", params.templateContent);
        formData.append("tpl_type", params.templateType);
        formData.append("tpl_emtype", params.emphasisType);

        if (params.title) {
            formData.append("tpl_title", params.title);
        }

        if (params.subtitle) {
            formData.append("tpl_stitle", params.subtitle);
        }

        if (params.extra) {
            formData.append("tpl_extra", params.extra);
        }

        if (params.advert) {
            formData.append("tpl_advert", params.advert);
        }

        if (params.buttons && params.buttons.length > 0) {
            formData.append("tpl_button", JSON.stringify({ button: params.buttons }));
        }

        if (params.image) {
            const imageBlob = new Blob([new Uint8Array(params.image.buffer)], { type: params.image.mimeType });
            formData.append("image", imageBlob, params.image.filename);
        }

        this.logger.debug(`[Aligo] Creating alimtalk template: ${params.templateName}`);

        const response = await fetch(url, {
            method: "POST",
            body: formData,
        });

        if (!response.ok) {
            const errorText = await response.text();
            this.logger.error(`[Aligo] Template API error: ${response.status} - ${errorText}`);
            throw new Error(`Aligo template API error (${response.status}): ${errorText}`);
        }

        return (await response.json()) as AligoTemplateCreateResponse;
    }

    async listTemplates(): Promise<AligoTemplateListResponse> {
        this.assertConfigured();
        const token = await this.getAligoToken();
        const url = `${this.ALIGO_API_URL}/akv10/template/list/`;

        const formData = new FormData();
        formData.append("token", token);
        formData.append("apikey", this.ALIGO_API_KEY);
        formData.append("userid", this.ALIGO_USER_ID);
        formData.append("senderkey", this.ALIGO_SENDER_KEY);
        formData.append("sender", this.ALIGO_SENDER_PHONE);

        this.logger.debug("[Aligo] Fetching alimtalk template list");

        const response = await fetch(url, {
            method: "POST",
            body: formData,
        });

        if (!response.ok) {
            const errorText = await response.text();
            this.logger.error(`[Aligo] Template list API error: ${response.status} - ${errorText}`);
            throw new Error(`Aligo template list API error (${response.status}): ${errorText}`);
        }

        return (await response.json()) as AligoTemplateListResponse;
    }

    private async getAligoToken(): Promise<string> {
        if (this.cachedToken && Date.now() < this.cachedToken.expiresAt) {
            return this.cachedToken.content;
        }

        const url = `${this.ALIGO_API_URL}/akv10/token/create/${this.TOKEN_LIFETIME_SECONDS}/s`;
        const formData = new FormData();
        formData.append("apikey", this.ALIGO_API_KEY);
        formData.append("userid", this.ALIGO_USER_ID);

        const response = await fetch(url, {
            method: "POST",
            body: formData,
        });

        if (!response.ok) {
            const errorText = await response.text();
            this.logger.error(`[Aligo] Token issue error: ${response.status} - ${errorText}`);
            throw new Error(`Aligo token API error (${response.status}): ${errorText}`);
        }

        const data = (await response.json()) as { code: number; message: string; token?: string };
        if (data.code !== 0 || !data.token) {
            throw new Error(`Aligo token issue failed: ${data.message ?? "unknown error"}`);
        }

        this.cachedToken = {
            content: data.token,
            expiresAt: Date.now() + this.TOKEN_LIFETIME_SECONDS * 1000 - 60_000,
        };
        return data.token;
    }

    private assertConfigured() {
        if (!this.isConfigured) {
            throw new Error("Aligo integration is not configured.");
        }
    }
}
