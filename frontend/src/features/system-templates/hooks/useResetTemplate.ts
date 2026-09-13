'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { systemTemplateService } from '@/services/system-template.service';
import { systemTemplateKeys } from './useSystemTemplates';

export function useResetTemplate() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (key: string) => systemTemplateService.reset(key).then((r) => r.data),
        onSuccess: async (_, key) => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: systemTemplateKeys.global.all }),
                queryClient.invalidateQueries({ queryKey: systemTemplateKeys.global.detail(key) }),
                // Resetting a default changes the effective value for every
                // branch that has not frozen its template snapshot.
                queryClient.invalidateQueries({ queryKey: systemTemplateKeys.branchAll }),
            ]);
        },
    });
}
