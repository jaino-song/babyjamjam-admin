'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { systemTemplateService } from '@/services/system-template.service';
import { systemTemplateKeys } from './useSystemTemplates';

export function useRollbackTemplate() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ key, versionNumber }: { key: string; versionNumber: number }) =>
            systemTemplateService.rollback(key, versionNumber).then((r) => r.data),
        onSuccess: async (_, { key }) => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: systemTemplateKeys.global.all }),
                queryClient.invalidateQueries({ queryKey: systemTemplateKeys.global.detail(key) }),
                queryClient.invalidateQueries({ queryKey: systemTemplateKeys.branchAll }),
            ]);
        },
    });
}
