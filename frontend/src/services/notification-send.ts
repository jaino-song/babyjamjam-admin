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

/** Manager-facing staff notifications (Settings → 알림 보내기). */
export const notificationSendApi = {
    listRecipients: async (): Promise<NotificationRecipient[]> => {
        const { data } = await api.get("/notifications/recipients");
        return data;
    },
    send: async (userId: string, message: NotificationMessage): Promise<void> => {
        await api.post("/notifications/send", { userId, ...message });
    },
    broadcast: async (message: NotificationMessage): Promise<BroadcastNotificationResult> => {
        const { data } = await api.post("/notifications/broadcast", message);
        return data;
    },
};
