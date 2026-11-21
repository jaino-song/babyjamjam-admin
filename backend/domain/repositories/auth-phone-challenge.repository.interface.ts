import type { Prisma } from "@prisma/client";

export const AUTH_PHONE_CHALLENGE_REPOSITORY = "AUTH_PHONE_CHALLENGE_REPOSITORY";

export interface AuthPhoneChallengeRow {
    id: string;
    purpose: string;
    tokenHash: string;
    phone: string;
    codeHash: string | null;
    attemptCount: number;
    userId: string | null;
    kakaoId: string | null;
    email: string | null;
    passwordHash: string | null;
    name: string | null;
    expiresAt: Date;
    createdAt: Date;
    consumedAt: Date | null;
}

export interface IAuthPhoneChallengeRepository {
    deleteCreatedBefore(cutoff: Date): Promise<void>;
    createWithinLimits(
        row: AuthPhoneChallengeRow,
        limits: { shortWindowStart: Date; shortMax: number; dayWindowStart: Date; dayMax: number },
    ): Promise<"created" | "rate_limited">;
    findByTokenHash(tokenHash: string): Promise<AuthPhoneChallengeRow | null>;
    registerAttempt(id: string, maxAttempts: number): Promise<boolean>;
    invalidate(id: string): Promise<void>;
    consumeWithinTx(tx: Prisma.TransactionClient, id: string): Promise<boolean>;
}
