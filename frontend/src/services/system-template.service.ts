import { api } from '@/lib/api/client';

import type {
    CustomVariable,
    PreviewSystemTemplateRequest,
    PreviewSystemTemplateResponse,
    SystemTemplate,
    SystemTemplateVersionDetail,
    SystemTemplateVersionSummary,
    SystemTemplateValidationResult,
    UpdateSystemTemplateRequest,
    UpdateSystemTemplateResponse,
} from '../features/system-templates/types';

export const systemTemplateService = {
    getAll: () => api.get<SystemTemplate[]>('/system-templates'),

    getAllForBranch: (expectedBranchId: string) =>
        api.get<SystemTemplate[]>('/branch-system-templates', {
            params: { expectedBranchId },
        }),

    getByKey: (key: string) => api.get<SystemTemplate>(`/system-templates/${key}`),

    getBranchByKey: (key: string, expectedBranchId: string) =>
        api.get<SystemTemplate>(`/branch-system-templates/${key}`, {
            params: { expectedBranchId },
        }),

    update: (key: string, content: string, customVariables?: CustomVariable[]) => {
        const payload: UpdateSystemTemplateRequest = customVariables
            ? { content, customVariables }
            : { content };
        return api.put<UpdateSystemTemplateResponse>(`/system-templates/${key}`, payload);
    },

    updateBranch: (
        key: string,
        content: string,
        customVariables: CustomVariable[] | undefined,
        expectedBranchId: string,
    ) => {
        const payload: UpdateSystemTemplateRequest = customVariables
            ? { content, customVariables }
            : { content };
        return api.put<UpdateSystemTemplateResponse>(`/branch-system-templates/${key}`, payload, {
            params: { expectedBranchId },
        });
    },

    validate: (key: string, content: string) =>
        api.post<SystemTemplateValidationResult>(`/system-templates/${key}/validate`, { content }),

    preview: (key: string, data: Record<string, unknown>, content?: string) => {
        const payload: PreviewSystemTemplateRequest =
            content === undefined ? { data } : { content, data };
        return api.post<PreviewSystemTemplateResponse>(`/system-templates/${key}/preview`, payload);
    },

    getVersions: (key: string) =>
        api.get<SystemTemplateVersionSummary[]>(`/system-templates/${key}/versions`),

    getVersionContent: (key: string, versionNumber: number) =>
        api.get<SystemTemplateVersionDetail>(`/system-templates/${key}/versions/${versionNumber}`),

    rollback: (key: string, versionNumber: number) =>
        api.post<UpdateSystemTemplateResponse>(`/system-templates/${key}/rollback/${versionNumber}`),

    reset: (key: string) => api.post<UpdateSystemTemplateResponse>(`/system-templates/${key}/reset`),
};
