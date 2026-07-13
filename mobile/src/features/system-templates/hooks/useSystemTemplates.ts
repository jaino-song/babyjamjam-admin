'use client';

import { useQuery } from '@tanstack/react-query';

import { systemTemplateService } from '@/services/system-template.service';
import type { SystemTemplate } from '../types';

const normalizeSystemTemplateList = (payload: unknown): SystemTemplate[] => {
    if (Array.isArray(payload)) {
        return payload;
    }

    if (payload && typeof payload === 'object') {
        const nestedList = (payload as { data?: unknown }).data;
        if (Array.isArray(nestedList)) {
            return nestedList;
        }
    }

    return [];
};

export const systemTemplateKeys = {
    all: ['system-templates'] as const,
    lists: () => [...systemTemplateKeys.all, 'list'] as const,
    list: () => [...systemTemplateKeys.lists()] as const,
    details: () => [...systemTemplateKeys.all, 'detail'] as const,
    detail: (key: string) => [...systemTemplateKeys.details(), key] as const,
    versions: (key: string) => [...systemTemplateKeys.detail(key), 'versions'] as const,
    versionDetail: (key: string, versionNumber: number) =>
        [...systemTemplateKeys.versions(key), versionNumber] as const,
};

export function useSystemTemplates() {
    return useQuery<SystemTemplate[]>({
        queryKey: systemTemplateKeys.list(),
        queryFn: () =>
            systemTemplateService.getAll().then((r) => normalizeSystemTemplateList(r.data)),
        staleTime: 1000 * 60 * 5,
    });
}
