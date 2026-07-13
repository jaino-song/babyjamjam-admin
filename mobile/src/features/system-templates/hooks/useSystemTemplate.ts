'use client';

import { useQuery } from '@tanstack/react-query';

import { systemTemplateService } from '@/services/system-template.service';
import type { SystemTemplate } from '../types';
import { systemTemplateKeys } from './useSystemTemplates';

export function useSystemTemplate(key: string) {
    return useQuery<SystemTemplate>({
        queryKey: systemTemplateKeys.detail(key),
        queryFn: () => systemTemplateService.getByKey(key).then((r) => r.data),
        enabled: !!key,
    });
}
