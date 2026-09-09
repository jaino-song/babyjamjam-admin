'use client';

import { useQuery } from '@tanstack/react-query';

import { systemTemplateService } from '@/services/system-template.service';
import type { SystemTemplate } from '../types';
import { getActiveBranchId, isBranchContextAligned } from '../branch-context';
import {
    systemTemplateKeys,
    type SystemTemplateScope,
} from './useSystemTemplates';

export interface UseSystemTemplateOptions {
    scope?: SystemTemplateScope;
    /** Explicit branch identity keeps details isolated during branch switches. */
    branchId?: string | null;
}

export function useSystemTemplate(key: string, options: UseSystemTemplateOptions = {}) {
    const scope = options.scope ?? 'branch';
    const branchId = scope === 'branch'
        ? options.branchId === undefined
            ? getActiveBranchId()
            : options.branchId
        : null;
    const branchContextReady = scope === 'global' || isBranchContextAligned(branchId);

    const query = useQuery<SystemTemplate>({
        queryKey: scope === 'global'
            ? systemTemplateKeys.global.detail(key)
            : systemTemplateKeys.branchDetail(branchId, key),
        queryFn: () => {
            if (scope === 'global') {
                return systemTemplateService.getByKey(key).then((r) => r.data);
            }
            if (!branchId) {
                throw new Error('Branch selection required');
            }
            return systemTemplateService.getBranchByKey(key, branchId).then((r) => r.data);
        },
        enabled: !!key && branchContextReady,
    });

    if (scope === 'branch' && !branchContextReady) {
        return { ...query, data: undefined };
    }

    return query;
}
