export const CONSULTATION_INQUIRY_STATUSES = ["new", "contacted", "closed"] as const;
export type ConsultationInquiryStatus = (typeof CONSULTATION_INQUIRY_STATUSES)[number];

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
    source: string;
    status: string;
    readAt: string | null;
    createdAt: string;
    updatedAt: string;
    branchName?: string;
}

export interface PaginatedConsultationInquiries {
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
    status?: "all" | ConsultationInquiryStatus;
    readState?: "all" | "read" | "unread";
}
