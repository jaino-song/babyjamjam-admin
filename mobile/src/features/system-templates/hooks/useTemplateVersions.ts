'use client';

import { useQuery } from '@tanstack/react-query';

import { systemTemplateService } from '@/services/system-template.service';
import type { VersionHistoryItem } from '../types';
import { systemTemplateKeys } from './useSystemTemplates';

export function useTemplateVersions(key: string) {
    return useQuery<VersionHistoryItem[]>({
        queryKey: systemTemplateKeys.versions(key),
        queryFn: () => systemTemplateService.getVersions(key).then((r) => r.data),
        enabled: !!key,
    });
}
