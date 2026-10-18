import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHash } from "node:crypto";
import {
    AligoSendSmsParams,
    AligoSmsDeliveryDetailRow,
    AligoSmsDeliveryDetailsResult,
    AligoSmsResponse,
    IAligoSmsApiPort,
    ALIGO_DEFAULT_SENDER_POLICY_VERSION,
    AligoDefaultSenderPolicy,
} from "domain/ports/aligo-sms-api.port";

export const DEFAULT_ALIGO_SENDER_PHONE = "010-9641-1878";
const ALIGO_SEND_TIMEOUT_MS = 30_000;
export const ALIGO_HISTORY_CALL_TIMEOUT_MS = 10_000;
const ALIGO_LIST_PAGE_SIZE = 500;
const ALIGO_LIST_MAX_PAGES = 20;

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

    getDefaultSenderPolicy(): AligoDefaultSenderPolicy {
        if (!this.isConfigured) return { availability: "unavailable" };
        return { availability: "available", provider: "aligo", mode: "live", version: ALIGO_DEFAULT_SENDER_POLICY_VERSION,
            identityDigest: createHash("sha256").update(JSON.stringify({
                version: ALIGO_DEFAULT_SENDER_POLICY_VERSION, provider: "aligo", mode: "live",
                sender: this.ALIGO_SENDER_PHONE, endpoint: this.ALIGO_SMS_API_URL,
            })).digest("hex") };
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
            signal: AbortSignal.timeout(ALIGO_SEND_TIMEOUT_MS),
        });

        if (!response.ok) {
            const errorText = await response.text();
            this.logger.error(`[Aligo] SMS API error: ${response.status} - ${errorText}`);
            throw new Error(`Aligo SMS API error (${response.status}): ${errorText}`);
        }

        return this.normalizeSmsResponse(await response.json());
    }

    listHistory(params: { page: number; page_size: number; start_date: string; limit_day: number }): Promise<unknown> {
        return this.historyRequest("list", params);
    }

    listSmsHistory(params: { mid: string; page: number; page_size: number }): Promise<unknown> {
        return this.historyRequest("sms_list", params);
    }

    private async historyRequest(endpoint: "list" | "sms_list", params: Record<string, string | number>): Promise<unknown> {
        this.assertConfigured();
        const form = new FormData();
        form.append("key", this.ALIGO_API_KEY);
        form.append("user_id", this.ALIGO_USER_ID);
        for (const [key, value] of Object.entries(params)) form.append(key, String(value));
        const response = await fetch(`${this.ALIGO_SMS_API_URL}/${endpoint}/`, {
            method: "POST", body: form, signal: AbortSignal.timeout(ALIGO_HISTORY_CALL_TIMEOUT_MS),
        });
        if (!response.ok) throw new Error("Aligo history HTTP failure");
        const data: unknown = await response.json();
        if (!data || typeof data !== "object" || Array.isArray(data)) {
            throw new Error("Aligo history malformed response");
        }
        const body = data as Record<string, unknown>;
        const code = this.toOptionalNumber(body["result_code"]);
        if (code === undefined || code <= 0 || typeof body["message"] !== "string"
            || !Array.isArray(body["list"]) || (body["next_yn"] !== "Y" && body["next_yn"] !== "N")) {
            throw new Error("Aligo history unsuccessful or malformed response");
        }
        for (const row of body["list"]) {
            if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("Aligo history malformed row");
            const fields = row as Record<string, unknown>;
            if (endpoint === "list") {
                if ((typeof fields["mid"] !== "string" && typeof fields["mid"] !== "number")
                    || !String(fields["mid"]).trim() || typeof fields["msg"] !== "string" || typeof fields["reg_date"] !== "string") {
                    throw new Error("Aligo history malformed send row");
                }
            } else if (typeof fields["receiver"] !== "string" || typeof fields["sms_state"] !== "string") {
                throw new Error("Aligo history malformed receiver row");
            }
        }
        return data;
    }

    async getSmsDeliveryDetails(mid: string): Promise<AligoSmsDeliveryDetailsResult> {
        this.assertConfigured();
        const url = `${this.ALIGO_SMS_API_URL}/sms_list/`;
        const rows: AligoSmsDeliveryDetailRow[] = [];
        let resultCode = 1;
        let message = "";

        for (let page = 1; page <= ALIGO_LIST_MAX_PAGES; page += 1) {
            const formData = new FormData();
            formData.append("key", this.ALIGO_API_KEY);
            formData.append("user_id", this.ALIGO_USER_ID);
            formData.append("mid", mid);
            formData.append("page", String(page));
            formData.append("page_size", String(ALIGO_LIST_PAGE_SIZE));

            this.logger.debug(`[Aligo] Fetching sms delivery details mid=${mid} page=${page}`);

            const response = await fetch(url, {
                method: "POST",
                body: formData,
                signal: AbortSignal.timeout(ALIGO_SEND_TIMEOUT_MS),
            });

            if (!response.ok) {
                const errorText = await response.text();
                this.logger.error(`[Aligo] SMS list API error: ${response.status} - ${errorText}`);
                throw new Error(`Aligo SMS list API error (${response.status}): ${errorText}`);
            }

            const data = await response.json() as unknown;
            const body = data && typeof data === "object" ? data as Record<string, unknown> : {};
            resultCode = this.toNumber(body["result_code"], 0);
            message = typeof body["message"] === "string" ? body["message"] : "";
            if (resultCode !== 1) {
                return { resultCode, message, rows: [] };
            }

            const list = Array.isArray(body["list"]) ? body["list"] as unknown[] : [];
            for (const item of list) {
                rows.push(this.normalizeDeliveryDetailRow(item));
            }

            if (body["next_yn"] !== "Y") break;
        }

        return { resultCode, message, rows };
    }

    private normalizeDeliveryDetailRow(item: unknown): AligoSmsDeliveryDetailRow {
        const row = item && typeof item === "object" ? item as Record<string, unknown> : {};
        const mdid = row["mdid"];
        const sendDate = row["send_date"];
        const smsState = row["sms_state"];
        const receiver = row["receiver"];
        return {
            mdid: typeof mdid === "string" || typeof mdid === "number" ? String(mdid) : null,
            receiver: typeof receiver === "string" || typeof receiver === "number"
                ? String(receiver).replace(/\D/g, "")
                : "",
            smsState: typeof smsState === "string" ? smsState.trim() : "",
            sendDate: typeof sendDate === "string" && sendDate.trim() ? sendDate : null,
        };
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
