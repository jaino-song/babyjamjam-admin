import {
    ConsultationInquiryEntity,
    CreateConsultationInquiryParams,
} from "domain/entities/consultation-inquiry.entity";

export interface ConsultationInquiryListParams {
    branchId: string;
    page: number;
    limit: number;
    search?: string;
    status?: string;
}

export interface ConsultationInquiryListResult {
    data: ConsultationInquiryEntity[];
    total: number;
}

export interface ConsultationInquiryBranchLookup {
    id: string;
    name: string;
    slug: string;
}

export interface IConsultationInquiryRepository {
    findActiveBranchBySlug(slug: string): Promise<ConsultationInquiryBranchLookup | null>;
    findNotificationRecipientUserIds(branchId: string): Promise<string[]>;
    create(params: CreateConsultationInquiryParams): Promise<ConsultationInquiryEntity>;
    findManyByBranch(params: ConsultationInquiryListParams): Promise<ConsultationInquiryListResult>;
    markRead(branchId: string, id: string): Promise<ConsultationInquiryEntity>;
}

export const CONSULTATION_INQUIRY_REPOSITORY = "CONSULTATION_INQUIRY_REPOSITORY";
