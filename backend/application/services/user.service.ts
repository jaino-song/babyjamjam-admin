import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
    CreateUserUsecase,
    FindUserByIdUsecase,
    FindUserByKakaoIdUsecase,
    UpdateUserUsecase,
    DeleteUserUsecase,
} from "application/usecases/user";
import { UserEntity } from "domain/entities/user.entity";
import { PrismaService } from "infrastructure/database/prisma.service";

export interface UserDirectoryBranch {
    id: string;
    name: string;
    role: string | null;
}

export interface UserDirectoryItem {
    id: string;
    kakaoId: string | null;
    email: string | null;
    name: string | null;
    phone: string | null;
    birthDate: string | null;
    profileImage: string | null;
    role: string | null;
    createdAt: Date;
    emailVerified: boolean;
    authProvider: string;
    approvalStatus: string;
    requestedRole: string | null;
    branches: UserDirectoryBranch[];
}

export interface UserApprovalSummary {
    id: string;
    name: string | null;
    email: string | null;
    role: string | null;
    approvalStatus: string;
    approvedAt: Date | null;
    approvedBy: string | null;
    requestedRole: string | null;
    tokenVersion: number;
}

@Injectable()
export class UserService {
    constructor(
        private readonly createUserUsecase: CreateUserUsecase,
        private readonly findUserByIdUsecase: FindUserByIdUsecase,
        private readonly findUserByKakaoIdUsecase: FindUserByKakaoIdUsecase,
        private readonly updateUserUsecase: UpdateUserUsecase,
        private readonly deleteUserUsecase: DeleteUserUsecase,
        private readonly prismaService: PrismaService,
    ) {}

    create(params: { kakaoId: string, name?: string, email?: string, profileImage?: string }): Promise<UserEntity> {
        return this.createUserUsecase.execute(params.kakaoId, params.name, params.email, params.profileImage);
    }

    findById(id: string): Promise<UserEntity | null> {
        return this.findUserByIdUsecase.execute(id);
    }

    findByKakaoId(kakaoId: string): Promise<UserEntity | null> {
        return this.findUserByKakaoIdUsecase.execute(kakaoId);
    }

    update(id: string, params: { name?: string, email?: string, profileImage?: string, role?: string | null, callerRole?: string }): Promise<UserEntity> {
        return this.updateUserUsecase.execute(id, params);
    }

    async findDirectory(params?: { branchId?: string, status?: string }): Promise<UserDirectoryItem[]> {
        const where: Prisma.userWhereInput = {};

        if (params?.branchId) {
            where.OR = [
                { userBranches: { some: { branchId: params.branchId } } },
                { ownedBranches: { some: { id: params.branchId } } },
            ];
        }

        if (params?.status) {
            where.approvalStatus = params.status;
        }

        const users = await this.prismaService.user.findMany({
            where: Object.keys(where).length > 0 ? where : undefined,
            orderBy: { createdAt: "desc" },
            select: {
                id: true,
                kakaoId: true,
                email: true,
                name: true,
                phone: true,
                birthDate: true,
                profileImage: true,
                role: true,
                createdAt: true,
                emailVerified: true,
                authProvider: true,
                approvalStatus: true,
                requestedRole: true,
                ownedBranches: {
                    orderBy: { createdAt: "asc" },
                    select: {
                        id: true,
                        name: true,
                    },
                },
                userBranches: {
                    orderBy: { joinedAt: "asc" },
                    select: {
                        role: true,
                        branch: {
                            select: {
                                id: true,
                                name: true,
                            },
                        },
                    },
                },
            },
        });

        return users.map((user) => {
            const branches = new Map<string, UserDirectoryBranch>();

            user.ownedBranches.forEach((branch) => {
                branches.set(branch.id, {
                    id: branch.id,
                    name: branch.name,
                    role: "owner",
                });
            });

            user.userBranches.forEach((membership) => {
                if (!branches.has(membership.branch.id)) {
                    branches.set(membership.branch.id, {
                        id: membership.branch.id,
                        name: membership.branch.name,
                        role: membership.role ?? null,
                    });
                }
            });

            return {
                id: user.id,
                kakaoId: user.kakaoId,
                email: user.email,
                name: user.name,
                phone: user.phone,
                birthDate: user.birthDate,
                profileImage: user.profileImage,
                role: user.role,
                createdAt: user.createdAt,
                emailVerified: user.emailVerified,
                authProvider: user.authProvider,
                approvalStatus: user.approvalStatus,
                requestedRole: user.requestedRole,
                branches: Array.from(branches.values()),
            };
        });
    }

    delete(id: string) {
        return this.deleteUserUsecase.execute(id);
    }

    approve(
        id: string,
        params: { role: string, approvedBy: string, branchId?: string },
    ): Promise<UserApprovalSummary> {
        return this.prismaService.$transaction(async (tx) => {
            const user = await tx.user.update({
                where: { id },
                data: {
                    approvalStatus: "approved",
                    approvedAt: new Date(),
                    approvedBy: params.approvedBy,
                    role: params.role,
                    tokenVersion: { increment: 1 },
                },
                select: {
                    id: true,
                    name: true,
                    email: true,
                    role: true,
                    approvalStatus: true,
                    approvedAt: true,
                    approvedBy: true,
                    requestedRole: true,
                    tokenVersion: true,
                },
            });

            await tx.user_branch.updateMany({
                where: params.branchId
                    ? { userId: id, branchId: params.branchId }
                    : { userId: id },
                data: { role: params.role },
            });

            return user;
        });
    }

    reject(id: string): Promise<UserApprovalSummary> {
        return this.prismaService.user.update({
            where: { id },
            data: {
                approvalStatus: "rejected",
                tokenVersion: { increment: 1 },
            },
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                approvalStatus: true,
                approvedAt: true,
                approvedBy: true,
                requestedRole: true,
                tokenVersion: true,
            },
        });
    }
}
