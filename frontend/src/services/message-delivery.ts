import { api } from "@/lib/api/client";

import type {
    MessageDeliverySmsType,
    MessageDeliveryTriggerType,
    SendMessageDeliverySmsRequest,
    SendMessageDeliverySmsResponse,
} from "@babyjamjam/shared/types/message";

export type {
    MessageDeliverySmsType,
    MessageDeliveryTriggerType,
    SendMessageDeliverySmsRequest,
    SendMessageDeliverySmsResponse,
};

export const messageDeliveryApi = {
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
