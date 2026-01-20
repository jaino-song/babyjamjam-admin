import { api } from '@/core/api/client';

import type {
    SystemTemplate,
    ValidationResult,
    VersionDetail,
    VersionHistoryItem,
} from '../features/system-templates/types';

export const systemTemplateService = {
    getAll: () => api.get<SystemTemplate[]>('/system-templates'),

    getByKey: (key: string) => api.get<SystemTemplate>(`/system-templates/${key}`),

    update: (key: string, content: string) =>
        api.put<SystemTemplate>(`/system-templates/${key}`, { content }),

    validate: (key: string, content: string) =>
        api.post<ValidationResult>(`/system-templates/${key}/validate`, { content }),

    preview: (key: string, data: Record<string, unknown>, content?: string) =>
        api.post<string>(`/system-templates/${key}/preview`, { content, data }),

    getVersions: (key: string) =>
        api.get<VersionHistoryItem[]>(`/system-templates/${key}/versions`),

    getVersionContent: (key: string, versionNumber: number) =>
        api.get<VersionDetail>(`/system-templates/${key}/versions/${versionNumber}`),

    rollback: (key: string, versionNumber: number) =>
        api.post<SystemTemplate>(`/system-templates/${key}/rollback/${versionNumber}`),

    reset: (key: string) => api.post<SystemTemplate>(`/system-templates/${key}/reset`),
};
