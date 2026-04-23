import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import {
    ConsultationInquiryEntity,
    ConsultationSelectedServices,
    CreateConsultationInquiryParams,
} from "domain/entities/consultation-inquiry.entity";
import {
    ConsultationInquiryBranchLookup,
    ConsultationInquiryListParams,
    ConsultationInquiryListResult,
    IConsultationInquiryRepository,
} from "domain/repositories/consultation-inquiry.repository.interface";
import { PrismaService } from "infrastructure/database/prisma.service";

type InquiryWithBranch = Prisma.consultation_inquiryGetPayload<{
    include: { branch: { select: { name: true } } };
}>;

function toEntity(row: InquiryWithBranch): ConsultationInquiryEntity {
    return {
        id: row.id,
        branchId: row.branchId,
        publicBranchSlug: row.publicBranchSlug,
        motherName: row.motherName,
        phone: row.phone,
        address: row.address,
        dueDate: row.dueDate,
        birthExperience: row.birthExperience,
        voucherType: row.voucherType,
        preferredCaregiverName: row.preferredCaregiverName,
        referralSource: row.referralSource,
        privacyAcceptedAt: row.privacyAcceptedAt,
        selectedServices: row.selectedServices as ConsultationSelectedServices | null,
        source: row.source,
        status: row.status,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        branchName: row.branch.name,
    };
}

@Injectable()
export class SbConsultationInquiryRepository implements IConsultationInquiryRepository {
    constructor(private readonly prisma: PrismaService) {}

    findActiveBranchBySlug(slug: string): Promise<ConsultationInquiryBranchLookup | null> {
        return this.prisma.branch.findFirst({
            where: {
                slug,
                isActive: true,
            },
            select: {
                id: true,
                name: true,
                slug: true,
            },
        });
    }

    async create(params: CreateConsultationInquiryParams): Promise<ConsultationInquiryEntity> {
        const row = await this.prisma.consultation_inquiry.create({
            data: {
                branchId: params.branchId,
                publicBranchSlug: params.publicBranchSlug,
                motherName: params.motherName,
                phone: params.phone,
                address: params.address,
                dueDate: params.dueDate,
                birthExperience: params.birthExperience,
                voucherType: params.voucherType,
                preferredCaregiverName: params.preferredCaregiverName,
                referralSource: params.referralSource,
                privacyAcceptedAt: params.privacyAcceptedAt,
                ...(params.selectedServices
                    ? { selectedServices: params.selectedServices as unknown as Prisma.InputJsonValue }
                    : {}),
                source: params.source,
                status: params.status,
            },
            include: {
                branch: { select: { name: true } },
            },
        });

        return toEntity(row);
    }

    async findManyByBranch(params: ConsultationInquiryListParams): Promise<ConsultationInquiryListResult> {
        const where: Prisma.consultation_inquiryWhereInput = {
            branchId: params.branchId,
        };

        if (params.status && params.status !== "all") {
            where.status = params.status;
        }

        if (params.search) {
            where.OR = [
                { motherName: { contains: params.search } },
                { phone: { contains: params.search } },
                { address: { contains: params.search } },
            ];
        }

        const [data, total] = await this.prisma.$transaction([
            this.prisma.consultation_inquiry.findMany({
                where,
                orderBy: { createdAt: "desc" },
                skip: (params.page - 1) * params.limit,
                take: params.limit,
                include: {
                    branch: { select: { name: true } },
                },
            }),
            this.prisma.consultation_inquiry.count({ where }),
        ]);

        return {
            data: data.map(toEntity),
            total,
        };
    }
}
