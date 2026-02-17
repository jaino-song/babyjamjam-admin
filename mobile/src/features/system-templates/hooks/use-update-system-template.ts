'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { systemTemplateService } from '@/services/system-template.service';
import { systemTemplateKeys } from './useSystemTemplates';
import type { CustomVariable, SystemTemplate } from '../types';

export interface ApiErrorResponse {
  message: string;
  statusCode?: number;
}

interface UpdateParams {
  key: string;
  content: string;
  customVariables?: CustomVariable[];
}

export function useUpdateSystemTemplate() {
  const queryClient = useQueryClient();
  
  return useMutation<SystemTemplate, ApiErrorResponse, UpdateParams>({
    mutationFn: ({ key, content, customVariables }) =>
      systemTemplateService.update(key, content, customVariables).then(r => r.data),
    onSuccess: (_, { key }) => {
      queryClient.invalidateQueries({ queryKey: systemTemplateKeys.detail(key) });
      queryClient.invalidateQueries({ queryKey: systemTemplateKeys.all });
    },
  });
}
