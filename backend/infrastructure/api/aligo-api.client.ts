import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
    AligoSendSmsParams,
    AligoSmsResponse,
    IAligoSmsApiPort,
} from "domain/ports/aligo-sms-api.port";
import { maskPhone } from "application/utils/mask";

export const DEFAULT_ALIGO_SENDER_PHONE = "010-9641-1878";
const ALIGO_SEND_TIMEOUT_MS = 30_000;

@Injectable()
export class AligoApiClient implements IAligoSmsApiPort {
    private readonly logger = new Logger(AligoApiClient.name);
    private readonly ALIGO_SMS_API_URL: string;
    private readonly ALIGO_API_KEY: string;
    private readonly ALIGO_USER_ID: string;
    private readonly ALIGO_SENDER_PHONE: string;
    private readonly isConfigured: boolean;

    constructor(private readonly configService: ConfigService) {
        this.ALIGO_SMS_API_URL = configService.get("ALIGO_SMS_API_URL") || "https://apis.aligo.in";
        this.ALIGO_API_KEY = configService.get("ALIGO_API_KEY") || "";
        this.ALIGO_USER_ID = configService.get("ALIGO_USER_ID") || "";
        this.ALIGO_SENDER_PHONE = (configService.get("ALIGO_SENDER_PHONE") || DEFAULT_ALIGO_SENDER_PHONE).replace(/\D/g, "");
        this.isConfigured = Boolean(
            this.ALIGO_API_KEY &&
            this.ALIGO_USER_ID &&
            this.ALIGO_SENDER_PHONE,
        );

        if (!this.isConfigured) {
            this.logger.warn(
                "ALIGO_API_KEY, ALIGO_USER_ID, and ALIGO_SENDER_PHONE are required for SMS delivery.",
            );
        }
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

        this.logger.debug(`[Aligo] Sending sms to ${maskPhone(params.receiver)}`);

        const response = await fetch(url, {
            method: "POST",
            body: formData,
            signal: AbortSignal.timeout(ALIGO_SEND_TIMEOUT_MS),
        });

        if (!response.ok) {
            const errorText = await response.text();
            this.logger.error(`[Aligo] SMS API error: ${response.status} - ${errorText}`);
            throw new Error(`Aligo SMS API error (${response.status}): ${errorText}`);
        }

        return this.normalizeSmsResponse(await response.json());
    }

    private normalizeSmsResponse(data: unknown): AligoSmsResponse {
        const response = data && typeof data === "object"
            ? data as Record<string, unknown>
            : {};

        return {
            result_code: this.toNumber(response["result_code"], 0),
            message: typeof response["message"] === "string" ? response["message"] : "",
            msg_id: this.toOptionalNumber(response["msg_id"]),
            success_cnt: this.toOptionalNumber(response["success_cnt"]),
            error_cnt: this.toOptionalNumber(response["error_cnt"]),
            msg_type: this.toSmsMessageType(response["msg_type"]),
        };
    }

    private toNumber(value: unknown, fallback: number): number {
        return this.toOptionalNumber(value) ?? fallback;
    }

    private toOptionalNumber(value: unknown): number | undefined {
        if (typeof value === "number" && Number.isFinite(value)) {
            return value;
        }
        if (typeof value === "string" && value.trim()) {
            const parsed = Number(value);
            return Number.isFinite(parsed) ? parsed : undefined;
        }
        return undefined;
    }

    private toSmsMessageType(value: unknown): AligoSmsResponse["msg_type"] {
        return value === "SMS" || value === "LMS" || value === "MMS"
            ? value
            : undefined;
    }

    private assertConfigured() {
        if (!this.isConfigured) {
            throw new Error("Aligo SMS integration is not configured.");
        }
    }
}
