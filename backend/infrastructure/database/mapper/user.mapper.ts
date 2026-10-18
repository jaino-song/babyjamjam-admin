import { UserEntity, AuthProvider } from "domain/entities/user.entity";

type UserRow = {
    id: string;
    kakaoId: string | null;
    email: string | null;
    name: string | null;
    profileImage: string | null;
    role: string | null;
    createdAt: Date;
    passwordHash: string | null;
    emailVerified: boolean;
    emailVerifiedAt: Date | null;
    authProvider: string;
};

export class UserMapper {
    static toDomain(row: UserRow): UserEntity {
        return UserEntity.reconstitute(
            row.id,
            row.kakaoId,
            row.email,
            row.name,
            row.profileImage,
            row.role || 'user',
            row.createdAt,
            row.passwordHash,
            row.emailVerified,
            row.emailVerifiedAt,
            (row.authProvider || 'kakao') as AuthProvider,
        );
    }

    static toPrismaCreate(entity: UserEntity) {
        return {
            kakaoId: entity.kakaoId,
            email: entity.email,
            name: entity.name,
            profileImage: entity.profileImage,
            role: entity.role,
            passwordHash: entity.passwordHash,
            emailVerified: entity.emailVerified,
            emailVerifiedAt: entity.emailVerifiedAt,
            authProvider: entity.authProvider,
        };
    }

    static toPrismaUpdate(entity: UserEntity) {
        return {
            email: entity.email,
            name: entity.name,
            profileImage: entity.profileImage,
            role: entity.role,
            passwordHash: entity.passwordHash,
            emailVerified: entity.emailVerified,
            emailVerifiedAt: entity.emailVerifiedAt,
            authProvider: entity.authProvider,
        };
    }
}
