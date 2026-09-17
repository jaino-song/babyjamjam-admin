import { api } from "@/lib/api/client";

export interface ConsultationInquiry {
    id: string;
    branchId: string;
    publicBranchSlug: string;
    motherName: string;
    phone: string;
    address: string;
    dueDate: string;
    birthExperience: string;
    voucherType: string | null;
    preferredCaregiverName: string | null;
    referralSource: string;
    privacyAcceptedAt: string;
    selectedServices: ConsultationSelectedServices | null;
    additionalNotes: string | null;
    source: string;
    status: string;
    readAt: string | null;
    createdAt: string;
    updatedAt: string;
    branchName?: string;
}

export interface ConsultationSelectedServices {
    plan: {
        id: string;
        name: string;
        priceLabel: string;
        durationDays: number | null;
    } | null;
    addons: Array<{
        id: string;
        name: string;
        priceLabel: string;
        quantity: number;
        group: string | null;
    }>;
}

export interface ConsultationInquiryListResponse {
    data: ConsultationInquiry[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

export interface ConsultationInquiryListParams {
    page?: number;
    limit?: number;
    search?: string;
    phone?: string;
    status?: string;
    readState?: string;
}

export const consultationInquiriesApi = {
    list: async (params: ConsultationInquiryListParams = {}): Promise<ConsultationInquiryListResponse> => {
        const { data } = await api.get("/consultation-inquiries", { params });
        return data;
    },
    markRead: async (id: string): Promise<ConsultationInquiry> => {
        const { data } = await api.patch(`/consultation-inquiries/${id}/read`);
        return data;
    },
};
