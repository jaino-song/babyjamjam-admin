export declare class UserEntity {
    readonly id: string;
    readonly kakaoId: string;
    email: string | null;
    name: string | null;
    profileImage: string | null;
    role: string | null;
    readonly createdAt: Date;
    constructor(id: string, kakaoId: string, email: string | null, name: string | null, profileImage: string | null, role: string | null, createdAt: Date);
    isAdmin(): boolean;
    canManageDocuments(): boolean;
    updateProfile(name: string, email: string): void;
    static create(kakaoId: string, name?: string, profileImage?: string, email?: string): UserEntity;
    static fromPrisma(prismaData: {
        id: string;
        kakaoId: string;
        email: string | null;
        name: string | null;
        profile_image: string | null;
        role: string | null;
        created_at: Date;
    }): UserEntity;
    toPersistence(): {
        id: string;
        kakaoId: string;
        email: string | null;
        name: string | null;
        profile_image: string | null;
        role: string | null;
        created_at: Date;
    };
}
