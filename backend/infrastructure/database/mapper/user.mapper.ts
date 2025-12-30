import { UserEntity } from "domain/entities/user.entity";

type UserRow = {
    id: string;
    kakao_id: string;
    email: string | null;
    name: string | null;
    profile_image: string | null;
    role: string | null;
    created_at: Date;
};

export class UserMapper {
    static toDomain(row: UserRow): UserEntity {
        return new UserEntity(
            row.id,
            row.kakao_id,
            row.email,
            row.name,
            row.profile_image,
            row.role || 'user',
            row.created_at,
        );
    }

    static toPrismaCreate(entity: UserEntity) {
        return {
            kakao_id: entity.kakaoId,
            email: entity.email,
            name: entity.name,
            profile_image: entity.profileImage,
            role: entity.role,
        };
    }

    static toPrismaUpdate(entity: UserEntity) {
        return {
            email: entity.email,
            name: entity.name,
            profile_image: entity.profileImage,
            role: entity.role,
        };
    }
}
