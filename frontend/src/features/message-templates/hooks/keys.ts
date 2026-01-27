export const messageTemplateKeys = {
    all: ['message-templates'] as const,
    lists: () => [...messageTemplateKeys.all, 'list'] as const,
    list: (page: number, limit: number) => [...messageTemplateKeys.lists(), { page, limit }] as const,
    details: () => [...messageTemplateKeys.all, 'detail'] as const,
    detail: (id: string) => [...messageTemplateKeys.details(), id] as const,
};
