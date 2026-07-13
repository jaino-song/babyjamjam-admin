export const messageTriggerKeys = {
    all: ["message-triggers"] as const,
    lists: () => [...messageTriggerKeys.all, "list"] as const,
    list: () => [...messageTriggerKeys.lists()] as const,
    details: () => [...messageTriggerKeys.all, "detail"] as const,
    detail: (id: string) => [...messageTriggerKeys.details(), id] as const,
    upcoming: (limit = 200) => [...messageTriggerKeys.all, "upcoming", limit] as const,
    history: (limit = 200) => [...messageTriggerKeys.all, "history", limit] as const,
    templates: (provider: string, eventType?: string, recipientType?: string) =>
        [...messageTriggerKeys.all, "templates", provider, eventType ?? "all", recipientType ?? "all"] as const,
};
