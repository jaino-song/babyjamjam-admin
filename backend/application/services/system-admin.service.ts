import { Injectable } from "@nestjs/common";

import { MessageSenderApprovalStatus } from "interface/dto/message-sender-approval.dto";
import {
    SystemAdminBranchRequestDto,
    SystemAdminBranchUserDto,
} from "interface/dto/system-admin.dto";
import { PrismaService } from "infrastructure/database/prisma.service";

@Injectable()
export class SystemAdminService {
    constructor(private readonly prisma: PrismaService) {}

    async listBranchRequests(): Promise<SystemAdminBranchRequestDto[]> {
        const branches = await this.prisma.branch.findMany({
            orderBy: [
                { smsSenderApprovalRequestedAt: "desc" },
                { updatedAt: "desc" },
                { name: "asc" },
            ],
            select: {
                id: true,
                name: true,
                slug: true,
                region: true,
                district: true,
                address: true,
                phone: true,
                email: true,
                isActive: true,
                createdAt: true,
                updatedAt: true,
                smsSenderPhone: true,
                smsSenderApprovalStatus: true,
                smsSenderApprovalRequestedAt: true,
                smsSenderApprovalApprovedAt: true,
                smsSenderApprovalRequestedBy: true,
                owner: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                        phone: true,
                        role: true,
                    },
                },
            },
        });

        const requesterIds = Array.from(
            new Set(
                branches
                    .map((branch) => branch.smsSenderApprovalRequestedBy)
                    .filter((userId): userId is string => Boolean(userId)),
            ),
        );
        const requesters = requesterIds.length > 0
            ? await this.prisma.user.findMany({
                where: { id: { in: requesterIds } },
                select: {
                    id: true,
                    name: true,
                    email: true,
                    phone: true,
                    role: true,
                },
            })
            : [];
        const requesterById = new Map<string, SystemAdminBranchUserDto>(
            requesters.map((requester) => [requester.id, requester]),
        );

        return branches.map((branch) => ({
            id: branch.id,
            name: branch.name,
            slug: branch.slug,
            region: branch.region ?? null,
            district: branch.district ?? null,
            address: branch.address ?? null,
            phone: branch.phone ?? null,
            email: branch.email ?? null,
            isActive: branch.isActive ?? false,
            createdAt: branch.createdAt?.toISOString() ?? null,
            updatedAt: branch.updatedAt?.toISOString() ?? null,
            owner: branch.owner,
            messageSenderApproval: {
                senderPhone: branch.smsSenderPhone ?? null,
                approvalStatus: normalizeMessageSenderApprovalStatus(
                    branch.smsSenderApprovalStatus,
                ),
                requestedAt: branch.smsSenderApprovalRequestedAt?.toISOString() ?? null,
                approvedAt: branch.smsSenderApprovalApprovedAt?.toISOString() ?? null,
                requestedBy: branch.smsSenderApprovalRequestedBy
                    ? requesterById.get(branch.smsSenderApprovalRequestedBy) ?? null
                    : null,
            },
        }));
    }
}

function normalizeMessageSenderApprovalStatus(
    value: string | null | undefined,
): MessageSenderApprovalStatus {
    if (value === "pending" || value === "approved") {
        return value;
    }

    return "not_requested";
}
