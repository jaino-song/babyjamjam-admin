export type AuthProvider = 'kakao' | 'email' | 'both';

export class UserEntity {
    constructor(
        public readonly id: string,
        public readonly kakaoId: string | null,
        public email: string | null,
        public name: string | null,
        public profileImage: string | null,
        public role: string | null,
        public readonly createdAt: Date,
        public passwordHash: string | null,
        public emailVerified: boolean,
        public emailVerifiedAt: Date | null,
        public authProvider: AuthProvider,
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

    /**
     * Check if user can login with password
     */
    canLoginWithPassword(): boolean {
        return this.passwordHash !== null && this.emailVerified;
    }

    /**
     * Check if user can login with Kakao
     */
    canLoginWithKakao(): boolean {
        return this.kakaoId !== null;
    }

    /**
     * Mark email as verified
     */
    verifyEmail(): void {
        if (this.emailVerified) {
            return;
        }
        this.emailVerified = true;
        this.emailVerifiedAt = new Date();
    }

    /**
     * Link a password to an OAuth account (for account linking)
     */
    linkPassword(passwordHash: string): void {
        if (this.passwordHash !== null) {
            throw new Error('User already has a password');
        }
        this.passwordHash = passwordHash;
        this.authProvider = 'both';
    }

    /**
     * Link Kakao account to an email account
     */
    linkKakao(kakaoId: string): void {
        if (this.kakaoId !== null) {
            throw new Error('User already has a Kakao account linked');
        }
        // Note: this requires mutable kakaoId, which is currently readonly
        // For now, this operation would need to be done at the repository level
        this.authProvider = 'both';
    }

    /**
     * Update password hash
     */
    updatePasswordHash(passwordHash: string): void {
        this.passwordHash = passwordHash;
    }

    /**
     * Create a new user with Kakao OAuth
     */
    static createWithKakao(
        kakaoId: string,
        name?: string,
        profileImage?: string,
        email?: string,
    ): UserEntity {
        return new UserEntity(
            '',
            kakaoId,
            email || null,
            name || null,
            profileImage || null,
            'user',
            new Date(),
            null, // passwordHash
            false, // emailVerified - OAuth users don't need email verification
            null, // emailVerifiedAt
            'kakao',
        );
    }

    /**
     * Create a new user with email/password
     */
    static createWithEmail(
        email: string,
        passwordHash: string,
        name?: string,
    ): UserEntity {
        return new UserEntity(
            '',
            null, // kakaoId
            email,
            name || null,
            null, // profileImage
            'user',
            new Date(),
            passwordHash,
            false, // emailVerified - requires verification
            null, // emailVerifiedAt
            'email',
        );
    }

    /**
     * @deprecated Use createWithKakao instead
     */
    static create(kakaoId: string, name?: string, profileImage?: string, email?: string): UserEntity {
        return UserEntity.createWithKakao(kakaoId, name, profileImage, email);
    }

    /**
     * Reconstitute an entity from persistence data (used by Mapper).
     * This method is infrastructure-agnostic - it only knows domain types.
     */
    static reconstitute(
        id: string,
        kakaoId: string | null,
        email: string | null,
        name: string | null,
        profileImage: string | null,
        role: string | null,
        createdAt: Date,
        passwordHash: string | null,
        emailVerified: boolean,
        emailVerifiedAt: Date | null,
        authProvider: AuthProvider,
    ): UserEntity {
        return new UserEntity(
            id,
            kakaoId,
            email,
            name,
            profileImage,
            role || 'user',
            createdAt,
            passwordHash,
            emailVerified,
            emailVerifiedAt,
            authProvider,
        );
    }
}