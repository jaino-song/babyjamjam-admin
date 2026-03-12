export const ALIGO_SMS_MESSAGE_TYPES = ["SMS", "LMS"] as const;
export type AligoSmsMessageType = (typeof ALIGO_SMS_MESSAGE_TYPES)[number];

export interface SendAligoSmsDto {
    senderPhone?: string;
    receiver: string;
    message: string;
    recipientName?: string;
    title?: string;
    msgType?: AligoSmsMessageType | "AUTO";
    scheduledDate?: string;
    scheduledTime?: string;
    testMode?: boolean;
}

export interface SendAligoSmsResult {
    request: {
        senderPhone?: string;
        receiver: string;
        msgType: AligoSmsMessageType;
        scheduledDate?: string;
        scheduledTime?: string;
        testModeYn: "Y" | "N";
    };
    response: {
        result_code: number;
        message: string;
        msg_id?: number;
        success_cnt?: number;
        error_cnt?: number;
        msg_type?: "SMS" | "LMS" | "MMS";
    };
}

export function getMessageBytes(message: string): number {
    return Buffer.byteLength(message, "utf8");
}

export function resolveAligoSmsMessageType(params: {
    message: string;
    title?: string;
    requestedType?: AligoSmsMessageType | "AUTO";
}): AligoSmsMessageType {
    if (params.requestedType && params.requestedType !== "AUTO") {
        return params.requestedType;
    }

    if (params.title?.trim()) {
        return "LMS";
    }

    return getMessageBytes(params.message) > 90 ? "LMS" : "SMS";
}
