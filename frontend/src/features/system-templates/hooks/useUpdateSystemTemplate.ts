'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';

import { systemTemplateService } from '@/services/system-template.service';
import { systemTemplateKeys } from './useSystemTemplates';

export function useUpdateSystemTemplate() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: ({ key, content }: { key: string; content: string }) =>
            systemTemplateService.update(key, content).then((r) => r.data),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: systemTemplateKeys.all });
        },
    });
}
