"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
    consultationInquiriesApi,
    ConsultationInquiryListParams,
    ConsultationInquiryListResponse,
} from "@/services/api";

export const consultationInquiryQueryKeys = {
    all: ["consultation-inquiries"] as const,
    list: (params: ConsultationInquiryListParams) =>
        [...consultationInquiryQueryKeys.all, "list", params] as const,
};

export function useConsultationInquiries(params: ConsultationInquiryListParams, enabled = true) {
    return useQuery<ConsultationInquiryListResponse>({
        queryKey: consultationInquiryQueryKeys.list(params),
        queryFn: () => consultationInquiriesApi.list(params),
        enabled,
        staleTime: 1000 * 60,
    });
}

export function useMarkConsultationInquiryRead() {
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: (id: string) => consultationInquiriesApi.markRead(id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: consultationInquiryQueryKeys.all });
        },
    });
}
