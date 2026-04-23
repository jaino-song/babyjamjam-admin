import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";

import {
    ConsultationInquiryEntity,
    ConsultationSelectedServices,
    CreateConsultationInquiryParams,
} from "domain/entities/consultation-inquiry.entity";
import {
    CONSULTATION_INQUIRY_REPOSITORY,
    IConsultationInquiryRepository,
} from "domain/repositories/consultation-inquiry.repository.interface";
import {
    ConsultationInquiryListQueryDto,
    CreatePublicConsultationInquiryDto,
} from "interface/dto/consultation-inquiry.dto";

export interface PaginatedConsultationInquiries {
    data: ConsultationInquiryEntity[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

function normalizeSelectedServices(
    selectedServices: CreatePublicConsultationInquiryDto["selectedServices"],
): ConsultationSelectedServices | null {
    if (!selectedServices) {
        return null;
    }

    return {
        plan: selectedServices.plan
            ? {
                  id: selectedServices.plan.id,
                  name: selectedServices.plan.name,
                  priceLabel: selectedServices.plan.priceLabel,
                  durationDays: selectedServices.plan.durationDays ?? null,
              }
            : null,
        addons: selectedServices.addons.map((addon) => ({
            id: addon.id,
            name: addon.name,
            priceLabel: addon.priceLabel,
            quantity: addon.quantity,
            group: addon.group ?? null,
        })),
    };
}

@Injectable()
export class ConsultationInquiryService {
    constructor(
        @Inject(CONSULTATION_INQUIRY_REPOSITORY)
        private readonly repository: IConsultationInquiryRepository,
    ) {}

    async createPublicInquiry(dto: CreatePublicConsultationInquiryDto): Promise<ConsultationInquiryEntity> {
        if (!dto.privacyAccepted) {
            throw new BadRequestException("개인정보 수집 및 이용 동의가 필요합니다.");
        }

        const branch = await this.repository.findActiveBranchBySlug(dto.branchSlug);
        if (!branch) {
            throw new NotFoundException("상담 가능한 지점을 찾을 수 없습니다.");
        }

        const params: CreateConsultationInquiryParams = {
            branchId: branch.id,
            publicBranchSlug: branch.slug,
            motherName: dto.motherName,
            phone: dto.phone,
            address: dto.address,
            dueDate: new Date(dto.dueDate),
            birthExperience: dto.birthExperience,
            voucherType: dto.voucherType?.trim() || null,
            preferredCaregiverName: dto.preferredCaregiverName?.trim() || null,
            referralSource: dto.referralSource,
            privacyAcceptedAt: new Date(),
            selectedServices: normalizeSelectedServices(dto.selectedServices),
            source: "website",
            status: "new",
        };

        return this.repository.create(params);
    }

    async listForBranch(
        branchId: string,
        query: ConsultationInquiryListQueryDto,
    ): Promise<PaginatedConsultationInquiries> {
        const page = query.page ?? 1;
        const limit = query.limit ?? 20;
        const search = query.search?.trim() || undefined;
        const status = query.status || "all";

        const result = await this.repository.findManyByBranch({
            branchId,
            page,
            limit,
            search,
            status,
        });

        return {
            data: result.data,
            total: result.total,
            page,
            limit,
            totalPages: Math.max(1, Math.ceil(result.total / limit)),
        };
    }
}
