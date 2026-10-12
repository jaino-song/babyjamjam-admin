export interface AligoSmsResponse {
    result_code: number;
    message: string;
    msg_id?: number;
    success_cnt?: number;
    error_cnt?: number;
    msg_type?: "SMS" | "LMS" | "MMS";
}

export interface AligoSendSmsParams {
    sender?: string;
    receiver: string;
    message: string;
    title?: string;
    msgType?: "SMS" | "LMS" | "MMS";
    destination?: string;
    scheduledDate?: string;
    scheduledTime?: string;
    testModeYn?: "Y" | "N";
}

export interface IAligoSmsApiPort {
    sendSms(params: AligoSendSmsParams): Promise<AligoSmsResponse>;
    /** Legacy send-only adapters fail closed when history is unavailable. */
    listHistory?(params: { page: number; page_size: number; start_date: string; limit_day: number }): Promise<unknown>;
    listSmsHistory?(params: { mid: string; page: number; page_size: number }): Promise<unknown>;
    /** Read-only identity of the default-sender path used by automation, never explicit-sender requests. */
    getDefaultSenderPolicy?(): AligoDefaultSenderPolicy;
}

export const ALIGO_DEFAULT_SENDER_POLICY_VERSION = "aligo-default-sender-policy-v1";
export type AligoDefaultSenderPolicy = {
    version: typeof ALIGO_DEFAULT_SENDER_POLICY_VERSION;
    provider: "aligo";
    availability: "available";
    mode: "live" | "stub";
    identityDigest: string;
} | { availability: "unavailable" };

export const ALIGO_SMS_API_PORT = Symbol("ALIGO_SMS_API_PORT");
