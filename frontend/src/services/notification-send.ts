import { isAxiosError } from "axios";

import { api } from "@/lib/api/client";

export interface NotificationRecipient {
    id: string;
    name: string;
}

export interface BroadcastNotificationResult {
    sent: number;
    failed: number;
}

export interface NotificationMessage {
    title: string;
    body: string;
}

// Broadcast can legitimately take a while: the backend queues one email per
// recipient 600ms apart, so a full-branch send can run well past axios's
// default 30s client timeout. Give send/broadcast their own longer budget
// instead of raising it repo-wide for every other endpoint.
const SEND_TIMEOUT_MS = 120_000;

/**
 * True when `error` is this client timing out (as opposed to the backend
 * answering with a real failure). axios reports a client-side timeout as
 * ECONNABORTED by default, or ETIMEDOUT when the signal-based path applies —
 * check both instead of matching on message text.
 */
export function isNotificationSendTimeout(error: unknown): boolean {
    if (!isAxiosError(error)) return false;
    return error.code === "ECONNABORTED" || error.code === "ETIMEDOUT";
}

/** Manager-facing staff notifications (Settings → 알림 보내기). */
export const notificationSendApi = {
    listRecipients: async (): Promise<NotificationRecipient[]> => {
        const { data } = await api.get("/notifications/recipients");
        return data;
    },
    send: async (userId: string, message: NotificationMessage): Promise<void> => {
        await api.post("/notifications/send", { userId, ...message }, { timeout: SEND_TIMEOUT_MS });
    },
    broadcast: async (message: NotificationMessage): Promise<BroadcastNotificationResult> => {
        const { data } = await api.post("/notifications/broadcast", message, { timeout: SEND_TIMEOUT_MS });
        return data;
    },
};
