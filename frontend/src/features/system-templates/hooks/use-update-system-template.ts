'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { systemTemplateService } from '@/services/system-template.service';
import { systemTemplateKeys } from './useSystemTemplates';
import type { CustomVariable, UpdateSystemTemplateResponse } from '../types';
import { getActiveBranchId, isBranchContextAligned } from '../branch-context';

export interface ApiErrorResponse {
  message: string;
  statusCode?: number;
}

export interface UpdateParams {
  key: string;
  content: string;
  customVariables?: CustomVariable[];
  scope?: 'global' | 'branch';
  branchId?: string | null;
}

interface MutationContext {
  scope: 'global' | 'branch';
  branchId: string | null;
}

export function useUpdateSystemTemplate() {
  const queryClient = useQueryClient();
  
  return useMutation<UpdateSystemTemplateResponse, unknown, UpdateParams, MutationContext>({
    mutationFn: ({ key, content, customVariables, scope = 'global', branchId }) => {
      if (scope === 'branch') {
        const activeBranchId = branchId ?? getActiveBranchId();
        if (!activeBranchId || !isBranchContextAligned(activeBranchId)) {
          throw new Error('지점을 선택한 뒤 템플릿을 저장해 주세요.');
        }

        return systemTemplateService
          .updateBranch(key, content, customVariables, activeBranchId)
          .then((r) => r.data);
      }

      return systemTemplateService.update(key, content, customVariables).then((r) => r.data);
    },
    onMutate: ({ scope = 'global', branchId }) => ({
      scope,
      branchId: scope === 'branch' ? branchId ?? getActiveBranchId() : null,
    }),
    onSuccess: async (_, { key }, context) => {
      if (context.scope === 'branch' && context.branchId) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: systemTemplateKeys.branch(context.branchId) }),
          queryClient.invalidateQueries({
            queryKey: systemTemplateKeys.branchDetail(context.branchId, key),
          }),
        ]);
        return;
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: systemTemplateKeys.global.all }),
        queryClient.invalidateQueries({ queryKey: systemTemplateKeys.global.detail(key) }),
        // A global default can change the effective value of every unfrozen
        // branch, so branch caches must be refetched on the next visit.
        queryClient.invalidateQueries({ queryKey: systemTemplateKeys.branchAll }),
      ]);
    },
  });
}
