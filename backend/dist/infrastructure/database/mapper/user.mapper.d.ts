import { UserEntity } from "domain/entities/user.entity";
type UserRow = {
    id: string;
    kakaoId: string;
    email: string | null;
    name: string | null;
    profile_image: string | null;
    role: string | null;
    created_at: Date;
};
export declare class UserMapper {
    static toDomain(row: UserRow): UserEntity;
    static toPrismaCreate(entity: UserEntity): {
        kakaoId: string;
        email: string;
        name: string;
        profile_image: string;
        role: string;
    };
    static toPrismaUpdate(entity: UserEntity): {
        email: string;
        name: string;
        profile_image: string;
        role: string;
    };
}
export {};
