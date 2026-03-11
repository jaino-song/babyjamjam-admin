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

type OrganizationSenderApprovalRecord = {
    senderPhone: string | null;
    approvalStatus: MessageSenderApprovalStatus;
    requestedAt: Date | null;
    approvedAt: Date | null;
};

@Injectable()
export class MessageSenderApprovalService {
    constructor(private readonly prisma: PrismaService) {}

    canRequest(orgRole?: string | null): boolean {
        return orgRole === "admin" || orgRole === "manager";
    }

    async getState(organizationId: string): Promise<OrganizationSenderApprovalRecord> {
        const organization = await this.prisma.organization.findUnique({
            where: { id: organizationId },
            select: {
                smsSenderPhone: true,
                smsSenderApprovalStatus: true,
                smsSenderApprovalRequestedAt: true,
                smsSenderApprovalApprovedAt: true,
            },
        });

        if (!organization) {
            throw new NotFoundException("Organization not found");
        }

        return {
            senderPhone: organization.smsSenderPhone ?? null,
            approvalStatus: this.normalizeStatus(
                organization.smsSenderApprovalStatus,
            ),
            requestedAt: organization.smsSenderApprovalRequestedAt ?? null,
            approvedAt: organization.smsSenderApprovalApprovedAt ?? null,
        };
    }

    async requestApproval(params: {
        organizationId: string;
        userId: string;
        orgRole?: string | null;
        senderPhone: string;
    }): Promise<OrganizationSenderApprovalRecord> {
        if (!this.canRequest(params.orgRole)) {
            throw new ForbiddenException(
                "Only organization admins or managers can request sender approval.",
            );
        }

        const senderPhone = PhoneNumber.create(params.senderPhone);
        if (!senderPhone) {
            throw new BadRequestException("유효한 발신번호를 입력해 주세요.");
        }

        const organization = await this.prisma.organization.update({
            where: { id: params.organizationId },
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
            senderPhone: organization.smsSenderPhone ?? null,
            approvalStatus: this.normalizeStatus(
                organization.smsSenderApprovalStatus,
            ),
            requestedAt: organization.smsSenderApprovalRequestedAt ?? null,
            approvedAt: organization.smsSenderApprovalApprovedAt ?? null,
        };
    }

    async ensureApproved(organizationId: string): Promise<string> {
        const state = await this.getState(organizationId);
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
