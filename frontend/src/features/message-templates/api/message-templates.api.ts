import { api } from '@/core/api/client';
import type { MessageTemplate, PaginatedTemplates, CreateTemplateDto, UpdateTemplateDto } from '../types';

export const messageTemplatesApi = {
    list: (page: number = 1, limit: number = 10) => 
        api.get<PaginatedTemplates>('/message-templates', { params: { page, limit } }),

    getById: (id: string) => 
        api.get<MessageTemplate>(`/message-templates/${id}`),

    create: (data: CreateTemplateDto) => 
        api.post<MessageTemplate>('/message-templates', data),

    update: (id: string, data: UpdateTemplateDto) =>
        api.patch<MessageTemplate>(`/message-templates/${id}`, data),

    delete: (id: string) => 
        api.delete(`/message-templates/${id}`),
};
