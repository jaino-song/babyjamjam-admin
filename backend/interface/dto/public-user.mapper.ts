import { UserEntity } from "domain/entities/user.entity";

export type PublicUser = Pick<UserEntity,
    "id" | "email" | "name" | "profileImage" | "role" | "createdAt"
    | "emailVerified" | "emailVerifiedAt" | "authProvider"
>;

export function toPublicUser(user: UserEntity): PublicUser;
export function toPublicUser(user: UserEntity | null): PublicUser | null;
export function toPublicUser(user: UserEntity | null): PublicUser | null {
    if (!user) return null;
    return {
        id: user.id,
        email: user.email,
        name: user.name,
        profileImage: user.profileImage,
        role: user.role,
        createdAt: user.createdAt,
        emailVerified: user.emailVerified,
        emailVerifiedAt: user.emailVerifiedAt,
        authProvider: user.authProvider,
    };
}
