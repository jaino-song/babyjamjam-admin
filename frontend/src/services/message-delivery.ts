import { api } from "@/lib/api/client";

import type {
    MessageDeliverySmsDuplicateCheckResponse,
    MessageDeliverySmsType,
    MessageDeliveryTriggerType,
    SendMessageDeliverySmsRequest,
    SendMessageDeliverySmsResponse,
} from "@babyjamjam/shared/types/message";

export type {
    MessageDeliverySmsDuplicateCheckResponse,
    MessageDeliverySmsType,
    MessageDeliveryTriggerType,
    SendMessageDeliverySmsRequest,
    SendMessageDeliverySmsResponse,
};

export const messageDeliveryApi = {
    checkSmsDuplicate: async (payload: SendMessageDeliverySmsRequest, expectedBranchId?: string | null): Promise<MessageDeliverySmsDuplicateCheckResponse> => {
        const { data } = await api.post("/message-deliveries/sms/duplicate-check", payload, {
            ...(expectedBranchId != null ? { params: { expectedBranchId } } : {}),
        });
        if (!data || typeof data.checkedAt !== "string" || Number.isNaN(Date.parse(data.checkedAt))
            || !Array.isArray(data.matchIds) || !data.matchIds.every((id: unknown) => typeof id === "number" && Number.isSafeInteger(id) && id > 0)
            || typeof data.payloadHash !== "string" || !data.payloadHash
            || (data.latestSentAt !== null && (typeof data.latestSentAt !== "string" || Number.isNaN(Date.parse(data.latestSentAt))))) {
            throw new Error("중복 확인 응답이 올바르지 않습니다.");
        }
        return data;
    },
    sendSms: async (
        payload: SendMessageDeliverySmsRequest,
        expectedBranchId?: string | null,
    ): Promise<SendMessageDeliverySmsResponse> => {
        const { data } = expectedBranchId
            ? await api.post("/message-deliveries/sms", payload, {
                params: { expectedBranchId },
            })
            : await api.post("/message-deliveries/sms", payload);
        return data;
    },
};
