'use client';

import { useQuery } from '@tanstack/react-query';

import { systemTemplateService } from '@/services/system-template.service';
import type { SystemTemplate } from '../types';
import { useActiveBranchId, isBranchContextAligned } from '../branch-context';

export type SystemTemplateScope = 'global' | 'branch';

type BranchQueryKey = readonly ['system-templates', 'branch', string];

const globalTemplateKeys = {
    all: ['system-templates', 'global'] as const,
    lists: () => [...globalTemplateKeys.all, 'list'] as const,
    list: () => [...globalTemplateKeys.lists()] as const,
    details: () => [...globalTemplateKeys.all, 'detail'] as const,
    detail: (key: string) => [...globalTemplateKeys.details(), key] as const,
    versions: (key: string) => [...globalTemplateKeys.detail(key), 'versions'] as const,
    versionDetail: (key: string, versionNumber: number) =>
        [...globalTemplateKeys.versions(key), versionNumber] as const,
};

export const systemTemplateKeys = {
    all: ['system-templates'] as const,
    global: globalTemplateKeys,
    branchAll: ['system-templates', 'branch'] as const,
    branch: (branchId: string | null): BranchQueryKey =>
        [...systemTemplateKeys.branchAll, branchId ?? 'unavailable'],
    branchLists: (branchId: string | null) => [...systemTemplateKeys.branch(branchId), 'list'] as const,
    branchList: (branchId: string | null) => [...systemTemplateKeys.branchLists(branchId)] as const,
    branchDetails: (branchId: string | null) => [...systemTemplateKeys.branch(branchId), 'detail'] as const,
    branchDetail: (branchId: string | null, key: string) =>
        [...systemTemplateKeys.branchDetails(branchId), key] as const,
    lists: () => [...globalTemplateKeys.lists()] as const,
    list: () => [...globalTemplateKeys.list()] as const,
    details: () => [...globalTemplateKeys.details()] as const,
    detail: (key: string) => [...globalTemplateKeys.detail(key)] as const,
    versions: (key: string) => [...globalTemplateKeys.versions(key)] as const,
    versionDetail: (key: string, versionNumber: number) =>
        [...globalTemplateKeys.versionDetail(key, versionNumber)] as const,
};

export interface UseSystemTemplatesOptions {
    scope?: SystemTemplateScope;
    /** Explicitly pin a branch identity so a switch cannot reuse old cache state. */
    branchId?: string | null;
}

export function useSystemTemplates(options: UseSystemTemplatesOptions = {}) {
    const activeBranchId = useActiveBranchId();
    const scope = options.scope ?? 'branch';
    const branchId = scope === 'branch'
        ? options.branchId === undefined
            ? activeBranchId
            : options.branchId
        : null;
    const queryKey = scope === 'global'
        ? systemTemplateKeys.global.list()
        : systemTemplateKeys.branchList(branchId);
    const branchContextReady = scope === 'global' || isBranchContextAligned(branchId);

    const query = useQuery<SystemTemplate[]>({
        queryKey,
        queryFn: () => {
            if (scope === 'global') {
                return systemTemplateService.getAll().then((r) => r.data);
            }
            if (!branchId) {
                throw new Error('Branch selection required');
            }
            return systemTemplateService.getAllForBranch(branchId).then((r) => r.data);
        },
        enabled: scope === 'global' || branchContextReady,
        staleTime: 1000 * 60 * 5,
    });

    // A disabled branch query can still expose a previous cache entry. Hide it
    // while the captured identity is unavailable or no longer matches the
    // active branch cookie so old tenant data cannot flash during a switch.
    if (scope === 'branch' && !branchContextReady) {
        return { ...query, data: undefined };
    }

    return query;
}
