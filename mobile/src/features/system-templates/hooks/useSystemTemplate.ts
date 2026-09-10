'use client';

import { useQuery } from '@tanstack/react-query';

import { useGetAuthUser } from '@/hooks/useGetAuthUser';
import { systemTemplateService } from '@/services/system-template.service';
import type { SystemTemplate } from '../types';
import { systemTemplateKeys } from './useSystemTemplates';

export interface UseSystemTemplateOptions {
    /**
     * 생략하면 인증 세션의 지점을 따른다. 지점 유효 템플릿(스냅샷 또는
     * 관리자 기본값)이 기본 조회 대상이며, 전역 기본값이 필요한 특수한
     * 호출처만 null을 명시한다.
     */
    branchId?: string | null;
}

export function useSystemTemplate(key: string, options: UseSystemTemplateOptions = {}) {
    const { data: authUser, isLoading: isAuthUserLoading } = useGetAuthUser();
    const branchId = options.branchId === undefined ? authUser?.branchId ?? null : options.branchId;

    const query = useQuery<SystemTemplate>({
        queryKey: systemTemplateKeys.branchDetail(branchId, key),
        queryFn: () => {
            if (!branchId) {
                throw new Error('Branch selection required');
            }
            return systemTemplateService.getBranchByKey(key, branchId).then((r) => r.data);
        },
        enabled: !!key && !isAuthUserLoading && Boolean(branchId),
    });

    // 인증 세션이 로드되는 동안에는 쿼리가 아직 활성화되지 않았어도
    // 로딩으로 보여준다. 그렇지 않으면 지점을 알기 전에 상세 화면이
    // "템플릿을 찾을 수 없습니다"를 번쩍이게 된다.
    return { ...query, isLoading: isAuthUserLoading || query.isLoading };
}
