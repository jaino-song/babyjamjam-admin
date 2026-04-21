"use client";

import { useQuery } from "@tanstack/react-query";

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

export function useConsultationInquiries(params: ConsultationInquiryListParams) {
    return useQuery<ConsultationInquiryListResponse>({
        queryKey: consultationInquiryQueryKeys.list(params),
        queryFn: () => consultationInquiriesApi.list(params),
        staleTime: 1000 * 60,
    });
}
