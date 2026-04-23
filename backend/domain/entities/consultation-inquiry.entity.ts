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

export interface CreateConsultationInquiryParams {
    branchId: string;
    publicBranchSlug: string;
    motherName: string;
    phone: string;
    address: string;
    dueDate: Date;
    birthExperience: string;
    voucherType: string | null;
    preferredCaregiverName: string | null;
    referralSource: string;
    privacyAcceptedAt: Date;
    selectedServices: ConsultationSelectedServices | null;
    source: string;
    status: ConsultationInquiryStatus;
}

export interface ConsultationInquiryEntity {
    id: string;
    branchId: string;
    publicBranchSlug: string;
    motherName: string;
    phone: string;
    address: string;
    dueDate: Date;
    birthExperience: string;
    voucherType: string | null;
    preferredCaregiverName: string | null;
    referralSource: string;
    privacyAcceptedAt: Date;
    selectedServices: ConsultationSelectedServices | null;
    source: string;
    status: string;
    createdAt: Date;
    updatedAt: Date;
    branchName?: string;
}
