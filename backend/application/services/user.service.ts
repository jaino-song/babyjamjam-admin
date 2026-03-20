import { Injectable } from "@nestjs/common";
import { 
    CreateUserUsecase,
    FindUserByIdUsecase,
    FindUserByKakaoIdUsecase,
    UpdateUserUsecase,
    DeleteUserUsecase,
} from "application/usecases/user";
import { UserEntity } from "domain/entities/user.entity";
import { PrismaService } from "infrastructure/database/prisma.service";

export interface UserDirectoryOrganization {
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
    organizations: UserDirectoryOrganization[];
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

    update(id: string, params: { name?: string, email?: string, profileImage?: string, role?: string | null }): Promise<UserEntity> {
        return this.updateUserUsecase.execute(id, params);
    }

    async findDirectory(params?: { organizationId?: string }): Promise<UserDirectoryItem[]> {
        const users = await this.prismaService.user.findMany({
            where: params?.organizationId
                ? {
                    OR: [
                        { userOrganizations: { some: { organizationId: params.organizationId } } },
                        { ownedOrganizations: { some: { id: params.organizationId } } },
                    ],
                }
                : undefined,
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
                ownedOrganizations: {
                    orderBy: { createdAt: "asc" },
                    select: {
                        id: true,
                        name: true,
                    },
                },
                userOrganizations: {
                    orderBy: { joinedAt: "asc" },
                    select: {
                        role: true,
                        organization: {
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
            const organizations = new Map<string, UserDirectoryOrganization>();

            user.ownedOrganizations.forEach((organization) => {
                organizations.set(organization.id, {
                    id: organization.id,
                    name: organization.name,
                    role: "owner",
                });
            });

            user.userOrganizations.forEach((membership) => {
                if (!organizations.has(membership.organization.id)) {
                    organizations.set(membership.organization.id, {
                        id: membership.organization.id,
                        name: membership.organization.name,
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
                organizations: Array.from(organizations.values()),
            };
        });
    }

    delete(id: string) {
        return this.deleteUserUsecase.execute(id);
    }
}
