import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import {
    AuthPhoneChallengeRow,
    IAuthPhoneChallengeRepository,
} from "domain/repositories/auth-phone-challenge.repository.interface";
import { PrismaService } from "../prisma.service";

@Injectable()
export class SbAuthPhoneChallengeRepository implements IAuthPhoneChallengeRepository {
    constructor(private readonly prismaService: PrismaService) {}

    async deleteCreatedBefore(cutoff: Date): Promise<void> {
        await this.prismaService.auth_phone_challenge.deleteMany({
            where: { createdAt: { lt: cutoff } },
        });
    }

    async createWithinLimits(
        row: AuthPhoneChallengeRow,
        limits: { shortWindowStart: Date; shortMax: number; dayWindowStart: Date; dayMax: number },
    ): Promise<"created" | "rate_limited"> {
        return this.prismaService.$transaction(async (tx) => {
            await tx.$executeRaw(Prisma.sql`
                SELECT pg_advisory_xact_lock(hashtextextended('auth_phone_challenge:' || ${row.phone}, 0))
            `);
            const shortCount = await tx.auth_phone_challenge.count({
                where: { phone: row.phone, createdAt: { gte: limits.shortWindowStart } },
            });
            const dayCount = await tx.auth_phone_challenge.count({
                where: { phone: row.phone, createdAt: { gte: limits.dayWindowStart } },
            });
            if (shortCount >= limits.shortMax || dayCount >= limits.dayMax) {
                return "rate_limited";
            }
            await tx.auth_phone_challenge.create({ data: row });
            return "created";
        });
    }

    findByTokenHash(tokenHash: string): Promise<AuthPhoneChallengeRow | null> {
        return this.prismaService.auth_phone_challenge.findUnique({ where: { tokenHash } });
    }

    async registerAttempt(id: string, maxAttempts: number): Promise<boolean> {
        const result = await this.prismaService.auth_phone_challenge.updateMany({
            where: { id, consumedAt: null, attemptCount: { lt: maxAttempts } },
            data: { attemptCount: { increment: 1 } },
        });
        return result.count === 1;
    }

    async invalidate(id: string): Promise<void> {
        await this.prismaService.auth_phone_challenge.updateMany({
            where: { id, consumedAt: null },
            data: { codeHash: null, consumedAt: new Date() },
        });
    }

    async consumeWithinTx(tx: Prisma.TransactionClient, id: string): Promise<boolean> {
        const result = await tx.auth_phone_challenge.updateMany({
            where: { id, consumedAt: null },
            data: { consumedAt: new Date() },
        });
        return result.count === 1;
    }
}
