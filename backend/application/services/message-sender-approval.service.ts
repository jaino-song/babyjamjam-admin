import type { Prisma } from "@prisma/client";
import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    InternalServerErrorException,
    NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "infrastructure/database/prisma.service";
import {
    MessageSenderApprovalStatus,
} from "interface/dto/message-sender-approval.dto";
import { AdminAuditActor, AdminAuditEventWriter } from "application/services/admin-audit-event.service";
import { currentAdminAuditActor } from "application/services/admin-audit-context";
import { codeOnlyProblemBody, problemBody } from "application/utils/problem-bodies";

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
    constructor(
        private readonly prisma: PrismaService,
        private readonly auditWriter?: AdminAuditEventWriter,
    ) {}

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
            throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
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
        actor?: AdminAuditActor;
    }): Promise<BranchSenderApprovalRecord> {
        if (!this.canRequest(params.branchRole)) {
            throw new ForbiddenException(codeOnlyProblemBody("ACCESS_DENIED"));
        }

        const actor = params.actor ?? currentAdminAuditActor();
        if (!this.auditWriter && !actor) {
            return this.requestApprovalWithoutAudit(params);
        }
        this.requireAuditActor(actor);

        const branch = await this.prisma.$transaction(async (transaction) => {
            const current = await transaction.branch.findUnique({
                where: { id: params.branchId },
                select: {
                    smsSenderApprovalStatus: true,
                    smsSenderApprovalRequestedAt: true,
                    smsSenderApprovalApprovedAt: true,
                },
            });
            const updated = await transaction.branch.update({
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
            await this.appendAudit(transaction, actor, {
                action: "branch.sms_sender_approval.requested",
                branchId: params.branchId,
                targetType: "branch",
                targetId: params.branchId,
                before: current ? this.auditState(current) : null,
                after: this.auditState(updated),
            });
            return updated;
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
        actor?: AdminAuditActor;
    }): Promise<BranchSenderApprovalRecord> {
        const actor = params.actor ?? currentAdminAuditActor();
        if (!this.auditWriter && !actor) {
            return this.approvePendingRequestWithoutAudit(params);
        }
        this.requireAuditActor(actor);

        const branch = await this.prisma.$transaction(async (transaction) => {
            const current = await transaction.branch.findUnique({
                where: { id: params.branchId },
                select: {
                    smsSenderApprovalStatus: true,
                    smsSenderApprovalRequestedAt: true,
                    smsSenderApprovalApprovedAt: true,
                },
            });

            if (!current) {
                throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
            }

            if (this.normalizeStatus(current.smsSenderApprovalStatus) !== "pending") {
                throw new BadRequestException(problemBody("VALIDATION_FAILED", {
                    pointer: "/approvalStatus",
                    code: "INVALID_VALUE",
                    detail: "승인 대기 중인 메시지 발송 권한 신청이 없습니다.",
                    location: "body",
                }));
            }

            const updated = await transaction.branch.update({
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
            await this.appendAudit(transaction, actor, {
                action: "branch.sms_sender_approval.approved",
                branchId: params.branchId,
                targetType: "branch",
                targetId: params.branchId,
                before: this.auditState(current),
                after: this.auditState(updated),
            });
            return updated;
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

    async getApprovedBranches(branchIds: string[], transaction?: Prisma.TransactionClient): Promise<Map<string, Date | null>> {
        const uniqueBranchIds = [...new Set(branchIds)];
        if (uniqueBranchIds.length === 0) {
            return new Map();
        }

        const branches = await (transaction ?? this.prisma).branch.findMany({
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
            throw new ForbiddenException(codeOnlyProblemBody("ACCESS_DENIED"));
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

    private async requestApprovalWithoutAudit(params: {
        branchId: string;
        userId: string;
        branchRole?: string | null;
        actor?: AdminAuditActor;
    }): Promise<BranchSenderApprovalRecord> {
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
            approvalStatus: this.normalizeStatus(branch.smsSenderApprovalStatus),
            requestedAt: branch.smsSenderApprovalRequestedAt ?? null,
            approvedAt: branch.smsSenderApprovalApprovedAt ?? null,
        };
    }

    private async approvePendingRequestWithoutAudit(params: {
        branchId: string;
        userId: string;
        actor?: AdminAuditActor;
    }): Promise<BranchSenderApprovalRecord> {
        const current = await this.prisma.branch.findUnique({
            where: { id: params.branchId },
            select: {
                smsSenderApprovalStatus: true,
            },
        });

        if (!current) {
            throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
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
            approvalStatus: this.normalizeStatus(branch.smsSenderApprovalStatus),
            requestedAt: branch.smsSenderApprovalRequestedAt ?? null,
            approvedAt: branch.smsSenderApprovalApprovedAt ?? null,
        };
    }

    private requireAuditActor(actor: AdminAuditActor | undefined): asserts actor is AdminAuditActor {
        if (!this.auditWriter) {
            throw new InternalServerErrorException(codeOnlyProblemBody("INTERNAL_ERROR"));
        }
        if (!actor?.userId) {
            throw new InternalServerErrorException(codeOnlyProblemBody("INTERNAL_ERROR"));
        }
    }

    private async appendAudit(
        transaction: Parameters<AdminAuditEventWriter["append"]>[0],
        actor: AdminAuditActor,
        event: Omit<Parameters<AdminAuditEventWriter["append"]>[1], "actor" | "outcome" | "source">,
    ): Promise<void> {
        await this.auditWriter!.append(transaction, {
            ...event,
            actor,
            outcome: "success",
            source: "backend",
        });
    }

    private auditState(value: {
        smsSenderApprovalStatus: string | null;
        smsSenderApprovalRequestedAt?: Date | null;
        smsSenderApprovalApprovedAt?: Date | null;
    }): Record<string, unknown> {
        return {
            status: this.normalizeStatus(value.smsSenderApprovalStatus),
            requestedAt: value.smsSenderApprovalRequestedAt ?? null,
            approvedAt: value.smsSenderApprovalApprovedAt ?? null,
        };
    }
}
