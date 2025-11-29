"use client";

import { useQuery } from "@tanstack/react-query";
import { eformsignApi } from "@/services/api";
import { EformsignDocumentsResponse } from "@/app/lib/eformsign/types";

// Query keys
export const eformsignQueryKeys = {
  documents: (accessToken: string) => ["eformsign-documents", accessToken] as const,
};

// Hook to fetch eformsign documents
export function useEformsignDocuments(accessToken: string) {
  return useQuery<EformsignDocumentsResponse>({
    queryKey: eformsignQueryKeys.documents(accessToken),
    queryFn: async () => {
      return await eformsignApi.getDocuments(accessToken);
    },
    enabled: !!accessToken,
    staleTime: 1000 * 60 * 5, // 5 minutes
    gcTime: 1000 * 60 * 60, // 1 hour
  });
}
