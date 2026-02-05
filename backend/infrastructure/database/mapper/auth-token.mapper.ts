import { AuthTokenEntity, AuthTokenType } from "domain/entities/auth-token.entity";

type AuthTokenRow = {
    id: string;
    userId: string;
    token: string;
    type: string;
    expiresAt: Date;
    createdAt: Date;
    usedAt: Date | null;
};

export class AuthTokenMapper {
    static toDomain(row: AuthTokenRow): AuthTokenEntity {
        return AuthTokenEntity.reconstitute(
            row.id,
            row.userId,
            row.token,
            row.type as AuthTokenType,
            row.expiresAt,
            row.createdAt,
            row.usedAt,
        );
    }

    static toPrismaCreate(entity: AuthTokenEntity) {
        return {
            userId: entity.userId,
            token: entity.token,
            type: entity.type,
            expiresAt: entity.expiresAt,
            createdAt: entity.createdAt,
            usedAt: entity.usedAt,
        };
    }

    static toPrismaUpdate(entity: AuthTokenEntity) {
        return {
            usedAt: entity.usedAt,
        };
    }
}
