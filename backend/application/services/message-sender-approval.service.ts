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
import { PhoneNumber } from "domain/value-objects/phone-number.vo";

type BranchSenderApprovalRecord = {
    senderPhone: string | null;
    approvalStatus: MessageSenderApprovalStatus;
    requestedAt: Date | null;
    approvedAt: Date | null;
};

const MESSAGE_SENDER_APPROVAL_REQUEST_ROLES = new Set([
    "owner",
    "admin",
    "manager",
]);

function isMobileSenderPhone(value: string): boolean {
    const normalized = value.replace(/\D/g, "");
    return /^01[016789]\d{7,8}$/.test(normalized);
}

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
                smsSenderPhone: true,
                smsSenderApprovalStatus: true,
                smsSenderApprovalRequestedAt: true,
                smsSenderApprovalApprovedAt: true,
            },
        });

        if (!branch) {
            throw new NotFoundException("Branch not found");
        }

        return {
            senderPhone: branch.smsSenderPhone ?? null,
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
        senderPhone: string;
    }): Promise<BranchSenderApprovalRecord> {
        if (!this.canRequest(params.branchRole)) {
            throw new ForbiddenException(
                "Only branch owners, admins or managers can request sender approval.",
            );
        }

        const senderPhone = PhoneNumber.create(params.senderPhone);
        if (!senderPhone) {
            throw new BadRequestException("유효한 발신번호를 입력해 주세요.");
        }
        if (!isMobileSenderPhone(params.senderPhone)) {
            throw new BadRequestException(
                "휴대 전화번호만 가능합니다.",
            );
        }

        const branch = await this.prisma.branch.update({
            where: { id: params.branchId },
            data: {
                smsSenderPhone: senderPhone.toString(),
                smsSenderApprovalStatus: "pending",
                smsSenderApprovalRequestedAt: new Date(),
                smsSenderApprovalRequestedBy: params.userId,
                smsSenderApprovalApprovedAt: null,
                smsSenderApprovalApprovedBy: null,
            },
            select: {
                smsSenderPhone: true,
                smsSenderApprovalStatus: true,
                smsSenderApprovalRequestedAt: true,
                smsSenderApprovalApprovedAt: true,
            },
        });

        return {
            senderPhone: branch.smsSenderPhone ?? null,
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
                smsSenderPhone: true,
                smsSenderApprovalStatus: true,
                smsSenderApprovalRequestedAt: true,
            },
        });

        if (!current) {
            throw new NotFoundException("Branch not found");
        }

        if (
            this.normalizeStatus(current.smsSenderApprovalStatus) !== "pending"
            || !current.smsSenderPhone
        ) {
            throw new BadRequestException(
                "승인 대기 중인 메시지 발신번호 신청이 없습니다.",
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
                smsSenderPhone: true,
                smsSenderApprovalStatus: true,
                smsSenderApprovalRequestedAt: true,
                smsSenderApprovalApprovedAt: true,
            },
        });

        return {
            senderPhone: branch.smsSenderPhone ?? null,
            approvalStatus: this.normalizeStatus(
                branch.smsSenderApprovalStatus,
            ),
            requestedAt: branch.smsSenderApprovalRequestedAt ?? null,
            approvedAt: branch.smsSenderApprovalApprovedAt ?? null,
        };
    }

    async ensureApproved(branchId: string): Promise<string> {
        const state = await this.getState(branchId);
        if (state.approvalStatus !== "approved" || !state.senderPhone) {
            throw new ForbiddenException(
                "관리자 승인이 완료된 발신번호가 있어야 문자 발송 기능을 사용할 수 있습니다.",
            );
        }

        return state.senderPhone;
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
