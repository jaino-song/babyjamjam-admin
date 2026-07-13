import { Prisma } from "@prisma/client";

import { AuthTokenEntity, AuthTokenType } from "../entities/auth-token.entity";

export interface IAuthTokenRepository {
    /**
     * Find a token by its hashed value
     */
    findByToken(hashedToken: string): Promise<AuthTokenEntity | null>;

    /**
     * Find all tokens for a user by type
     */
    findByUserIdAndType(userId: string, type: AuthTokenType): Promise<AuthTokenEntity[]>;

    /**
     * Create a new auth token
     */
    create(token: AuthTokenEntity): Promise<AuthTokenEntity>;

    /**
     * Update an existing token (e.g., mark as used)
     */
    update(token: AuthTokenEntity): Promise<AuthTokenEntity>;

    /** Atomically consumes one valid, unused token inside the caller's transaction. */
    consumeWithinTx(
        tx: Prisma.TransactionClient,
        hashedToken: string,
        type: AuthTokenType,
    ): Promise<boolean>;

    /**
     * Delete a token by ID
     */
    delete(id: string): Promise<void>;

    /**
     * Delete all tokens for a user by type
     * Useful for invalidating previous tokens when generating a new one
     */
    deleteByUserIdAndType(userId: string, type: AuthTokenType): Promise<void>;

    /**
     * Delete all expired tokens (cleanup job)
     */
    deleteExpiredTokens(): Promise<number>;
}

export const AUTH_TOKEN_REPOSITORY = 'AUTH_TOKEN_REPOSITORY';
