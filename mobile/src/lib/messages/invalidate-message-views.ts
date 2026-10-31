import type { QueryClient } from "@tanstack/react-query";

import { messageTriggerKeys } from "@/features/message-triggers/hooks/keys";

export async function invalidateMessageViews(queryClient: QueryClient): Promise<void> {
    await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["messages", "logs"] }),
        queryClient.invalidateQueries({ queryKey: messageTriggerKeys.all }),
    ]);
}
