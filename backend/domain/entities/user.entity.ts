export class UserEntity {
    constructor(
        public readonly id: string,
        public readonly kakaoId: string,
        public email: string | null,
        public name: string | null,
        public profileImage: string | null,
        public role: string | null,
        public readonly createdAt: Date,
    ) {}

    isAdmin(): boolean {
        return this.role === "admin";
    }

    canManageDocuments(): boolean {
        return this.role !== null && ['admin', 'manager'].includes(this.role);
    }

    updateProfile(name: string, email: string): void {
        this.name = name;
        this.email = email;
    }

    static create(kakaoId: string, name?: string, profileImage?: string, email?: string): UserEntity {
        return new UserEntity(
            '',
            kakaoId,
            email || null,
            name || null,
            profileImage || null,
            'user',
            new Date(),
        );
    }

    /**
     * Reconstitute an entity from persistence data (used by Mapper).
     * This method is infrastructure-agnostic - it only knows domain types.
     */
    static reconstitute(
        id: string,
        kakaoId: string,
        email: string | null,
        name: string | null,
        profileImage: string | null,
        role: string | null,
        createdAt: Date,
    ): UserEntity {
        return new UserEntity(
            id,
            kakaoId,
            email,
            name,
            profileImage,
            role || 'user',
            createdAt,
        );
    }
}