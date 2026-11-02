import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { MessageSenderApprovalStatus } from "interface/dto/message-sender-approval.dto";
import {
    CreateSystemAdminBranchDto,
    SystemAdminBranchRequestDto,
    SystemAdminBranchUserDto,
    UpdateSystemAdminBranchDto,
} from "interface/dto/system-admin.dto";
import { PrismaService } from "infrastructure/database/prisma.service";
import { AdminAuditActor, AdminAuditEventWriter } from "application/services/admin-audit-event.service";
import { currentAdminAuditActor } from "application/services/admin-audit-context";
import { codeOnlyProblemBody } from "application/utils/problem-bodies";
import { isTransactionConflict } from "application/utils/transaction-conflict";

const MAX_BRANCH_MUTATION_TRANSACTION_ATTEMPTS = 3;

@Injectable()
export class SystemAdminService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly auditWriter?: AdminAuditEventWriter,
    ) {}

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
                smsSenderApprovalStatus: true,
                smsSenderApprovalRequestedAt: true,
                smsSenderApprovalApprovedAt: true,
                smsSenderApprovalRequestedBy: true,
                admin: {
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
            admin: branch.admin,
            owner: branch.admin,
            messageSenderApproval: {
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

    async createBranch(
        dto: Omit<CreateSystemAdminBranchDto, "ownerId">,
        onCreated?: (transaction: Prisma.TransactionClient, branchId: string) => Promise<void>,
        actor?: AdminAuditActor,
    ): Promise<SystemAdminBranchRequestDto> {
        actor = actor ?? currentAdminAuditActor();
        // Fail before opening a write transaction for legacy callers while the
        // transaction-local lookup below remains the race-safe authority check.
        if (dto.adminId) {
            await this.getEligibleBranchManager(this.prisma, dto.adminId);
        }
        try {
            const branch = await this.runBranchMutationTransaction(async (tx) => {
                // Match approval/account mutations: user locks precede branch writes.
                if (dto.adminId) await this.lockRow(tx, "user", dto.adminId);
                const manager = dto.adminId
                    ? await this.getEligibleBranchManager(tx, dto.adminId)
                    : null;
                const createdBranch = await tx.branch.create({
                    data: {
                        name: dto.name,
                        slug: dto.slug,
                        adminId: dto.adminId ?? null,
                        region: normalizeOptionalText(dto.region),
                        district: normalizeOptionalText(dto.district),
                        address: normalizeOptionalText(dto.address),
                        phone: normalizeOptionalText(dto.phone),
                        email: normalizeOptionalText(dto.email),
                        isActive: dto.isActive,
                    },
                    select: { id: true },
                });

                if (manager) {
                    await this.assignBranchManager(tx, createdBranch.id, manager);
                }
                await onCreated?.(tx, createdBranch.id);
                await this.appendAudit(tx, actor, {
                    action: "branch.created",
                    branchId: createdBranch.id,
                    targetType: "branch",
                    targetId: createdBranch.id,
                    before: null,
                    after: {
                        id: createdBranch.id,
                        adminId: dto.adminId ?? null,
                        isActive: dto.isActive ?? true,
                    },
                });
                return createdBranch;
            });

            return this.getBranchRequest(branch.id);
        } catch (error) {
            this.rethrowBranchMutationError(error);
        }
    }

    async updateBranch(
        branchId: string,
        dto: Omit<UpdateSystemAdminBranchDto, "ownerId">,
        actor?: AdminAuditActor,
    ): Promise<SystemAdminBranchRequestDto> {
        actor = actor ?? currentAdminAuditActor();
        try {
            await this.runBranchMutationTransaction(async (tx) => {
                // Discover the lock set without holding a branch lock. All involved
                // users are locked in one order before the branch, including the old
                // admin whose final-branch read/demotion must serialize across branches.
                const snapshot = await tx.branch.findUnique({
                    where: { id: branchId },
                    select: { adminId: true },
                });
                if (!snapshot) {
                    throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
                }
                const userIds = [...new Set([snapshot.adminId, dto.adminId]
                    .filter((id): id is string => Boolean(id)))].sort();
                for (const userId of userIds) {
                    await this.lockRow(tx, "user", userId);
                }
                await this.lockRow(tx, "branch", branchId);
                const existing = await tx.branch.findUnique({
                    where: { id: branchId },
                    select: { adminId: true, isActive: true },
                });
                if (!existing) {
                    throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
                }
                // A concurrent writer may have changed the branch admin while we waited.
                // Never acquire an extra user lock after the branch (lock inversion).
                if (existing.adminId !== snapshot.adminId) {
                    throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
                }

                const manager = dto.adminId
                    ? await this.getEligibleBranchManager(tx, dto.adminId)
                    : null;
                if (dto.adminId === undefined && existing.adminId) {
                    await this.ensureAdminMembership(tx, branchId, existing.adminId);
                }

                await tx.branch.update({
                    where: { id: branchId },
                    data: {
                        ...(dto.name !== undefined ? { name: dto.name } : {}),
                        ...(dto.slug !== undefined ? { slug: dto.slug } : {}),
                        ...(dto.adminId !== undefined ? { adminId: dto.adminId } : {}),
                        ...(dto.region !== undefined
                            ? { region: normalizeOptionalText(dto.region) }
                            : {}),
                        ...(dto.district !== undefined
                            ? { district: normalizeOptionalText(dto.district) }
                            : {}),
                        ...(dto.address !== undefined
                            ? { address: normalizeOptionalText(dto.address) }
                            : {}),
                        ...(dto.phone !== undefined
                            ? { phone: normalizeOptionalText(dto.phone) }
                            : {}),
                        ...(dto.email !== undefined
                            ? { email: normalizeOptionalText(dto.email) }
                            : {}),
                        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
                        updatedAt: new Date(),
                    },
                });

                if (manager) {
                    await this.assignBranchManager(tx, branchId, manager);
                }

                if (dto.adminId !== undefined && existing.adminId && existing.adminId !== dto.adminId) {
                    await tx.user_branch.updateMany({
                        where: {
                            userId: existing.adminId,
                            branchId,
                            role: "admin",
                        },
                        data: { role: "user" },
                    });
                    // A few legacy rows used an owner-equivalent membership
                    // role. Revoke that authority as well during transfer.
                    await tx.user_branch.updateMany({
                        where: {
                            userId: existing.adminId,
                            branchId,
                            role: "owner",
                        },
                        data: { role: "user" },
                    });
                    const stillAdminsBranch = await tx.branch.findFirst({
                        where: { adminId: existing.adminId },
                        select: { id: true },
                    });
                    if (!stillAdminsBranch) {
                        await tx.user.updateMany({
                            where: { id: existing.adminId, role: "admin" },
                            data: { role: "user" },
                        });
                    }
                }

                await this.appendAudit(tx, actor, {
                    action: dto.adminId !== undefined && existing.adminId !== dto.adminId
                        ? "branch.owner_transferred"
                        : "branch.updated",
                    branchId,
                    targetType: "branch",
                    targetId: branchId,
                    before: {
                        id: branchId,
                        adminId: existing.adminId ?? null,
                        isActive: existing.isActive ?? true,
                    },
                    after: {
                        id: branchId,
                        adminId: dto.adminId !== undefined ? dto.adminId : existing.adminId ?? null,
                        isActive: dto.isActive !== undefined
                            ? dto.isActive
                            : existing.isActive ?? true,
                    },
                });
            });

            return this.getBranchRequest(branchId);
        } catch (error) {
            this.rethrowBranchMutationError(error);
        }
    }

    private async runBranchMutationTransaction<T>(
        callback: (tx: Prisma.TransactionClient) => Promise<T>,
    ): Promise<T> {
        for (let attempt = 1; attempt <= MAX_BRANCH_MUTATION_TRANSACTION_ATTEMPTS; attempt += 1) {
            try {
                return await this.prisma.$transaction(callback);
            } catch (error) {
                if (!isTransactionConflict(error)) throw error;
                if (attempt === MAX_BRANCH_MUTATION_TRANSACTION_ATTEMPTS) {
                    throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
                }
            }
        }
        throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
    }

    private async getEligibleBranchManager(
        client: Pick<PrismaService, "user"> | Prisma.TransactionClient,
        userId: string,
    ): Promise<{ id: string; role: string }> {
        const manager = await client.user.findFirst({
            where: {
                id: userId,
                approvalStatus: "approved",
                role: { in: ["owner", "admin", "manager", "user"] },
            },
            select: { id: true, role: true },
        });

        if (!manager?.role) {
            throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        }

        return { id: manager.id, role: manager.role };
    }

    private async assignBranchManager(
        tx: Prisma.TransactionClient,
        branchId: string,
        manager: { id: string; role: string },
    ): Promise<void> {
        const managerRole = manager.role === "owner" ? "owner" : "admin";

        await tx.user.update({
            where: { id: manager.id },
            data: { role: managerRole },
        });
        await tx.user_branch.upsert({
            where: {
                userId_branchId: { userId: manager.id, branchId },
            },
            create: {
                userId: manager.id,
                branchId,
                role: "admin",
            },
            update: { role: "admin" },
        });
    }

    private async ensureAdminMembership(
        tx: Prisma.TransactionClient,
        branchId: string,
        adminId: string,
    ): Promise<void> {
        // Older rows may contain admin_id without the corresponding membership.
        // Repair that narrow inconsistency inside the same locked branch
        // transaction before allowing any further branch mutation.
        if (typeof tx.user_branch.findUnique !== "function") return;
        const membership = await tx.user_branch.findUnique({
            where: { userId_branchId: { userId: adminId, branchId } },
        });
        if (!membership) {
            await tx.user_branch.upsert({
                where: { userId_branchId: { userId: adminId, branchId } },
                create: { userId: adminId, branchId, role: "admin" },
                update: { role: "admin" },
            });
            return;
        }
        if (membership.role !== "admin" && membership.role !== "owner") {
            await tx.user_branch.updateMany({
                where: { userId: adminId, branchId },
                data: { role: "admin" },
            });
        }
    }

    private async lockRow(
        tx: Prisma.TransactionClient,
        table: "branch" | "user",
        id: string,
    ): Promise<void> {
        if (typeof tx.$queryRaw !== "function") return;
        const query = table === "branch"
            ? Prisma.sql`SELECT "id" FROM "branch" WHERE "id" = ${id}::uuid FOR UPDATE`
            : Prisma.sql`SELECT "id" FROM "user" WHERE "id" = ${id}::uuid FOR UPDATE`;
        await tx.$queryRaw(query);
    }

    private async appendAudit(
        tx: Prisma.TransactionClient,
        actor: AdminAuditActor | undefined,
        event: Omit<Parameters<AdminAuditEventWriter["append"]>[1], "actor" | "outcome" | "source">,
    ): Promise<void> {
        // 내부 조립 불변성(감사 writer 누락·인증 컨텍스트 없는 감사)은 사용자 입력으로
        // 도달하지 않아요. 공개 문제 계약이 아니라 내부 결함 신호로 남기 위해 Error를 유지해요.
        if (!this.auditWriter) {
            if (actor) throw new Error("Admin audit writer is required for audited branch mutations");
            return;
        }
        if (!actor?.userId) {
            throw new Error("Authenticated actor is required for audited branch mutations");
        }
        await this.auditWriter.append(tx, {
            ...event,
            actor: actor ?? null,
            outcome: "success",
            source: "backend",
        });
    }

    private async getBranchRequest(branchId: string): Promise<SystemAdminBranchRequestDto> {
        const branch = await this.prisma.branch.findUnique({
            where: { id: branchId },
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
                smsSenderApprovalStatus: true,
                smsSenderApprovalRequestedAt: true,
                smsSenderApprovalApprovedAt: true,
                smsSenderApprovalRequestedBy: true,
                admin: {
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

        if (!branch) {
            throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
        }

        const requester = branch.smsSenderApprovalRequestedBy
            ? await this.prisma.user.findUnique({
                where: { id: branch.smsSenderApprovalRequestedBy },
                select: {
                    id: true,
                    name: true,
                    email: true,
                    phone: true,
                    role: true,
                },
            })
            : null;

        return {
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
            admin: branch.admin,
            owner: branch.admin,
            messageSenderApproval: {
                approvalStatus: normalizeMessageSenderApprovalStatus(
                    branch.smsSenderApprovalStatus,
                ),
                requestedAt: branch.smsSenderApprovalRequestedAt?.toISOString() ?? null,
                approvedAt: branch.smsSenderApprovalApprovedAt?.toISOString() ?? null,
                requestedBy: requester,
            },
        };
    }

    private rethrowBranchMutationError(error: unknown): never {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
            if (error.code === "P2002") {
                throw new ConflictException(codeOnlyProblemBody("REQUEST_CONFLICT"));
            }
            if (error.code === "P2025") {
                throw new NotFoundException(codeOnlyProblemBody("RESOURCE_NOT_FOUND"));
            }
        }

        throw error;
    }
}

function normalizeOptionalText(value: string | undefined): string | null {
    const normalized = value?.trim();
    return normalized ? normalized : null;
}

function normalizeMessageSenderApprovalStatus(
    value: string | null | undefined,
): MessageSenderApprovalStatus {
    if (value === "pending" || value === "approved") {
        return value;
    }

    return "not_requested";
}
