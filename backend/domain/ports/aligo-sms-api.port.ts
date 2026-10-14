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

export interface AligoSmsDeliveryDetailRow {
    mdid: string | null;
    /** Digits only (non-digits stripped). */
    receiver: string;
    /** Trimmed raw Aligo sms_state ("" if missing). */
    smsState: string;
    /** Raw Aligo send_date string or null. */
    sendDate: string | null;
}

export interface AligoSmsDeliveryDetailsResult {
    /** Aligo result_code (1 = ok). Non-1 is RETURNED, not thrown. */
    resultCode: number;
    message: string;
    /** All pages concatenated. */
    rows: AligoSmsDeliveryDetailRow[];
}

export interface IAligoSmsApiPort {
    sendSms(params: AligoSendSmsParams): Promise<AligoSmsResponse>;
    /** HTTP non-OK / network / timeout throws; a non-1 result_code is returned. */
    getSmsDeliveryDetails?(mid: string): Promise<AligoSmsDeliveryDetailsResult>;
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
