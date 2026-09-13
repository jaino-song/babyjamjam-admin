'use client';

import { useQuery } from '@tanstack/react-query';

import { useGetAuthUser } from '@/hooks/useGetAuthUser';
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
    branchLists: (branchId: string | null) =>
        [...systemTemplateKeys.all, 'branch', branchId ?? 'unavailable', 'list'] as const,
    branchList: (branchId: string | null) => [...systemTemplateKeys.branchLists(branchId)] as const,
    branchDetails: (branchId: string | null) =>
        [...systemTemplateKeys.all, 'branch', branchId ?? 'unavailable', 'detail'] as const,
    branchDetail: (branchId: string | null, key: string) =>
        [...systemTemplateKeys.branchDetails(branchId), key] as const,
    versions: (key: string) => [...systemTemplateKeys.detail(key), 'versions'] as const,
    versionDetail: (key: string, versionNumber: number) =>
        [...systemTemplateKeys.versions(key), versionNumber] as const,
};

export interface UseSystemTemplatesOptions {
    /**
     * 생략하면 인증 세션의 지점을 따른다. 목록도 지점 유효 카탈로그
     * (스냅샷 또는 관리자 기본값)를 반환하며, 전역 카탈로그가 필요한
     * 특수한 호출처만 null을 명시한다.
     */
    branchId?: string | null;
}

export function useSystemTemplates(options: UseSystemTemplatesOptions = {}) {
    const { data: authUser, isLoading: isAuthUserLoading } = useGetAuthUser();
    const branchId = options.branchId === undefined ? authUser?.branchId ?? null : options.branchId;

    const query = useQuery<SystemTemplate[]>({
        queryKey: systemTemplateKeys.branchList(branchId),
        queryFn: () => {
            if (!branchId) {
                throw new Error('Branch selection required');
            }
            return systemTemplateService
                .getAllForBranch(branchId)
                .then((r) => normalizeSystemTemplateList(r.data));
        },
        enabled: !!(!isAuthUserLoading) && Boolean(branchId),
        staleTime: 1000 * 60 * 5,
    });

    // 인증 세션이 로드되는 동안에는 쿼리가 아직 활성화되지 않았어도
    // 로딩으로 보여준다. 그렇지 않으면 지점을 알기 전에 목록이 빈 채로
    // 렌더링된다.
    return { ...query, isLoading: isAuthUserLoading || query.isLoading };
}
