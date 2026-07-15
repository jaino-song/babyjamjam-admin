import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "infrastructure/database/prisma.service";
import {
    MessageSenderApprovalStatus,
} from "interface/dto/message-sender-approval.dto";

type BranchSenderApprovalRecord = {
    approvalStatus: MessageSenderApprovalStatus;
    requestedAt: Date | null;
    approvedAt: Date | null;
};

const MESSAGE_SENDER_APPROVAL_REQUEST_ROLES = new Set([
    "owner",
    "admin",
    "manager",
]);

@Injectable()
export class MessageSenderApprovalService {
    constructor(private readonly prisma: PrismaService) {}

    canRequest(branchRole?: string | null): boolean {
        return branchRole
            ? MESSAGE_SENDER_APPROVAL_REQUEST_ROLES.has(branchRole)
            : false;
    }

    async getState(branchId: string): Promise<BranchSenderApprovalRecord> {
        const branch = await this.prisma.branch.findUnique({
            where: { id: branchId },
            select: {
                smsSenderApprovalStatus: true,
                smsSenderApprovalRequestedAt: true,
                smsSenderApprovalApprovedAt: true,
            },
        });

        if (!branch) {
            throw new NotFoundException("Branch not found");
        }

        return {
            approvalStatus: this.normalizeStatus(
                branch.smsSenderApprovalStatus,
            ),
            requestedAt: branch.smsSenderApprovalRequestedAt ?? null,
            approvedAt: branch.smsSenderApprovalApprovedAt ?? null,
        };
    }

    async requestApproval(params: {
        branchId: string;
        userId: string;
        branchRole?: string | null;
    }): Promise<BranchSenderApprovalRecord> {
        if (!this.canRequest(params.branchRole)) {
            throw new ForbiddenException(
                "Only branch owners, admins or managers can request sender approval.",
            );
        }

        const branch = await this.prisma.branch.update({
            where: { id: params.branchId },
            data: {
                smsSenderApprovalStatus: "pending",
                smsSenderApprovalRequestedAt: new Date(),
                smsSenderApprovalRequestedBy: params.userId,
                smsSenderApprovalApprovedAt: null,
                smsSenderApprovalApprovedBy: null,
            },
            select: {
                smsSenderApprovalStatus: true,
                smsSenderApprovalRequestedAt: true,
                smsSenderApprovalApprovedAt: true,
            },
        });

        return {
            approvalStatus: this.normalizeStatus(
                branch.smsSenderApprovalStatus,
            ),
            requestedAt: branch.smsSenderApprovalRequestedAt ?? null,
            approvedAt: branch.smsSenderApprovalApprovedAt ?? null,
        };
    }

    async approvePendingRequest(params: {
        branchId: string;
        userId: string;
    }): Promise<BranchSenderApprovalRecord> {
        const current = await this.prisma.branch.findUnique({
            where: { id: params.branchId },
            select: {
                smsSenderApprovalStatus: true,
            },
        });

        if (!current) {
            throw new NotFoundException("Branch not found");
        }

        if (this.normalizeStatus(current.smsSenderApprovalStatus) !== "pending") {
            throw new BadRequestException(
                "승인 대기 중인 메시지 발송 권한 신청이 없습니다.",
            );
        }

        const branch = await this.prisma.branch.update({
            where: { id: params.branchId },
            data: {
                smsSenderApprovalStatus: "approved",
                smsSenderApprovalApprovedAt: new Date(),
                smsSenderApprovalApprovedBy: params.userId,
            },
            select: {
                smsSenderApprovalStatus: true,
                smsSenderApprovalRequestedAt: true,
                smsSenderApprovalApprovedAt: true,
            },
        });

        return {
            approvalStatus: this.normalizeStatus(
                branch.smsSenderApprovalStatus,
            ),
            requestedAt: branch.smsSenderApprovalRequestedAt ?? null,
            approvedAt: branch.smsSenderApprovalApprovedAt ?? null,
        };
    }

    async isApproved(branchId: string): Promise<boolean> {
        const approvedBranchIds = await this.getApprovedBranchIds([branchId]);
        return approvedBranchIds.has(branchId);
    }

    async getApprovedBranchIds(branchIds: string[]): Promise<Set<string>> {
        const uniqueBranchIds = [...new Set(branchIds)];
        if (uniqueBranchIds.length === 0) {
            return new Set();
        }

        const branches = await this.prisma.branch.findMany({
            where: {
                id: { in: uniqueBranchIds },
                smsSenderApprovalStatus: "approved",
            },
            select: {
                id: true,
            },
        });

        return new Set(branches.map((branch) => branch.id));
    }

    async getApprovedBranches(branchIds: string[]): Promise<Map<string, Date | null>> {
        const uniqueBranchIds = [...new Set(branchIds)];
        if (uniqueBranchIds.length === 0) {
            return new Map();
        }

        const branches = await this.prisma.branch.findMany({
            where: {
                id: { in: uniqueBranchIds },
                smsSenderApprovalStatus: "approved",
            },
            select: {
                id: true,
                smsSenderApprovalApprovedAt: true,
            },
        });

        return new Map(
            branches.map((branch) => [
                branch.id,
                branch.smsSenderApprovalApprovedAt ?? null,
            ]),
        );
    }

    async ensureApproved(branchId: string): Promise<void> {
        const state = await this.getState(branchId);
        if (state.approvalStatus !== "approved") {
            throw new ForbiddenException(
                "메시지 발송 권한 승인이 필요합니다.",
            );
        }
    }

    private normalizeStatus(
        status: string | null | undefined,
    ): MessageSenderApprovalStatus {
        if (status === "pending" || status === "approved") {
            return status;
        }
        return "not_requested";
    }
}
