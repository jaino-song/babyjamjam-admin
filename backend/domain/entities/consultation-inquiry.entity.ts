export const CONSULTATION_INQUIRY_STATUSES = ["new", "contacted", "closed"] as const;

export type ConsultationInquiryStatus = (typeof CONSULTATION_INQUIRY_STATUSES)[number];

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
    source: string;
    status: ConsultationInquiryStatus;
    readAt?: Date | null;
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
    source: string;
    status: string;
    readAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    branchName?: string;
}
