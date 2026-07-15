export type AuthTokenType = 'email_verification' | 'password_reset';

export class AuthTokenEntity {
    constructor(
        public readonly id: string,
        public readonly userId: string,
        public readonly token: string,
        public readonly type: AuthTokenType,
        public readonly expiresAt: Date,
        public readonly createdAt: Date,
        public usedAt: Date | null,
    ) {}

    /**
     * Check if the token has expired
     */
    isExpired(): boolean {
        return new Date() > this.expiresAt;
    }

    /**
     * Check if the token has already been used
     */
    isUsed(): boolean {
        return this.usedAt !== null;
    }

    /**
     * Check if the token is valid (not expired and not used)
     */
    isValid(): boolean {
        return !this.isExpired() && !this.isUsed();
    }

    /**
     * Mark the token as used
     */
    markAsUsed(): void {
        if (this.isUsed()) {
            throw new Error('Token has already been used');
        }
        this.usedAt = new Date();
    }

    /**
     * Get remaining time until expiration in milliseconds
     */
    getRemainingTime(): number {
        return Math.max(0, this.expiresAt.getTime() - Date.now());
    }

    /**
     * Create a new email verification token
     * Token expires in 24 hours
     */
    static createEmailVerificationToken(
        userId: string,
        hashedToken: string,
    ): AuthTokenEntity {
        const now = new Date();
        const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours

        return new AuthTokenEntity(
            '', // ID will be assigned by database
            userId,
            hashedToken,
            'email_verification',
            expiresAt,
            now,
            null,
        );
    }

    /**
     * Create a new password reset token
     * Token expires in 1 hour
     */
    static createPasswordResetToken(
        userId: string,
        hashedToken: string,
    ): AuthTokenEntity {
        const now = new Date();
        const expiresAt = new Date(now.getTime() + 60 * 60 * 1000); // 1 hour

        return new AuthTokenEntity(
            '', // ID will be assigned by database
            userId,
            hashedToken,
            'password_reset',
            expiresAt,
            now,
            null,
        );
    }

    /**
     * Reconstitute an entity from persistence data (used by Mapper)
     */
    static reconstitute(
        id: string,
        userId: string,
        token: string,
        type: AuthTokenType,
        expiresAt: Date,
        createdAt: Date,
        usedAt: Date | null,
    ): AuthTokenEntity {
        return new AuthTokenEntity(
            id,
            userId,
            token,
            type,
            expiresAt,
            createdAt,
            usedAt,
        );
    }
}
