export const alimtalkTriggerKeys = {
    all: ["alimtalk-triggers"] as const,
    lists: () => [...alimtalkTriggerKeys.all, "list"] as const,
    list: () => [...alimtalkTriggerKeys.lists()] as const,
    details: () => [...alimtalkTriggerKeys.all, "detail"] as const,
    detail: (id: string) => [...alimtalkTriggerKeys.details(), id] as const,
    templates: (provider: string, eventType?: string, recipientType?: string) =>
        [...alimtalkTriggerKeys.all, "templates", provider, eventType ?? "all", recipientType ?? "all"] as const,
};
