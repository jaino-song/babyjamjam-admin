import { Inject, Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { Prisma } from "@prisma/client";

import { EMAIL_PORT, EmailPort } from "domain/ports/email.port";
import { PrismaService } from "infrastructure/database/prisma.service";
import { AuthEmailTokenService } from "./auth-email-token.service";

type ClaimedEmail = {
    id: string;
    auth_token_id: string;
    kind: string;
    recipient: string;
    name: string | null;
    attempts: number;
};

class AuthTokenUnavailableError extends Error {
    constructor() {
        super("auth_token_invalid");
        this.name = "AuthTokenUnavailableError";
    }
}

@Injectable()
export class AuthEmailOutboxService {
    private readonly logger = new Logger(AuthEmailOutboxService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly tokens: AuthEmailTokenService,
        @Inject(EMAIL_PORT) private readonly email: EmailPort,
    ) {}

    @Cron("*/5 * * * * *")
    async deliverPending(): Promise<void> {
        const claimed = await this.claimBatch(20);
        for (const item of claimed) {
            await this.deliver(item);
        }
    }

    private async claimBatch(limit: number): Promise<ClaimedEmail[]> {
        return this.prisma.$transaction(async (tx) => {
            await tx.$executeRaw(Prisma.sql`
                UPDATE "auth_email_outbox" AS outbox
                SET
                    "status" = 'failed',
                    "claimed_at" = NULL,
                    "error_code" = 'auth_token_invalid',
                    "updated_at" = NOW()
                WHERE outbox."status" IN ('pending', 'retry', 'processing')
                  AND NOT EXISTS (
                      SELECT 1
                      FROM "auth_token" AS token
                      WHERE token."id" = outbox."auth_token_id"
                        AND token."type" = outbox."kind"
                        AND token."used_at" IS NULL
                        AND token."expires_at" > NOW()
                  )
            `);
            return tx.$queryRaw<ClaimedEmail[]>(Prisma.sql`
                WITH candidates AS (
                    SELECT outbox."id"
                    FROM "auth_email_outbox" AS outbox
                    WHERE (
                        (
                            outbox."status" IN ('pending', 'retry')
                            AND outbox."next_attempt_at" <= NOW()
                        )
                        OR (
                            outbox."status" = 'processing'
                            AND outbox."claimed_at" <= NOW() - INTERVAL '5 minutes'
                        )
                    )
                      AND EXISTS (
                          SELECT 1
                          FROM "auth_token" AS token
                          WHERE token."id" = outbox."auth_token_id"
                            AND token."type" = outbox."kind"
                            AND token."used_at" IS NULL
                            AND token."expires_at" > NOW()
                      )
                    ORDER BY outbox."created_at" ASC
                    FOR UPDATE SKIP LOCKED
                    LIMIT ${limit}
                )
                UPDATE "auth_email_outbox" AS outbox
                SET
                    "status" = 'processing',
                    "claimed_at" = NOW(),
                    "attempts" = outbox."attempts" + 1,
                    "updated_at" = NOW()
                FROM candidates
                WHERE outbox."id" = candidates."id"
                RETURNING
                    outbox."id",
                    outbox."auth_token_id",
                    outbox."kind",
                    outbox."recipient",
                    outbox."name",
                    outbox."attempts"
            `);
        });
    }

    private async deliver(item: ClaimedEmail): Promise<void> {
        try {
            await this.prisma.$transaction(async (tx) => {
                const valid = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
                    SELECT outbox."id"
                    FROM "auth_email_outbox" AS outbox
                    JOIN "auth_token" AS token
                      ON token."id" = outbox."auth_token_id"
                    WHERE outbox."id" = CAST(${item.id} AS UUID)
                      AND outbox."status" = 'processing'
                      AND token."id" = CAST(${item.auth_token_id} AS UUID)
                      AND token."type" = ${item.kind}
                      AND token."used_at" IS NULL
                      AND token."expires_at" > NOW()
                    FOR UPDATE OF outbox, token
                `);
                if (valid.length !== 1) {
                    throw new AuthTokenUnavailableError();
                }

                const publicToken = this.tokens.publicTokenForId(item.auth_token_id);
                if (item.kind === "email_verification") {
                    const url = `${this.frontendUrl()}/verify-email?token=${encodeURIComponent(publicToken)}`;
                    await this.email.sendVerificationEmail(
                        item.recipient,
                        item.name,
                        url,
                    );
                } else if (item.kind === "password_reset") {
                    const url = `${this.frontendUrl()}/reset-password?token=${encodeURIComponent(publicToken)}`;
                    await this.email.sendPasswordResetEmail(
                        item.recipient,
                        item.name,
                        url,
                    );
                } else {
                    throw new Error("unsupported_outbox_kind");
                }

                await tx.auth_email_outbox.update({
                    where: { id: item.id },
                    data: {
                        status: "sent",
                        sentAt: new Date(),
                        claimedAt: null,
                        errorCode: null,
                    },
                });
            }, {
                maxWait: 5_000,
                timeout: 30_000,
            });
            this.logger.log(JSON.stringify({
                event: "auth_email_outbox",
                result: "sent",
                kind: item.kind,
                outboxId: item.id,
            }));
        } catch (error) {
            const tokenUnavailable = error instanceof AuthTokenUnavailableError;
            const exhausted = tokenUnavailable || item.attempts >= 5;
            const retryDelayMs = Math.min(
                60 * 60 * 1000,
                30_000 * 2 ** Math.max(0, item.attempts - 1),
            );
            await this.prisma.auth_email_outbox.updateMany({
                where: { id: item.id, status: "processing" },
                data: {
                    status: exhausted ? "failed" : "retry",
                    claimedAt: null,
                    nextAttemptAt: new Date(Date.now() + retryDelayMs),
                    errorCode: tokenUnavailable
                        ? "auth_token_invalid"
                        : this.safeErrorCode(error),
                },
            });
            this.logger.error(JSON.stringify({
                event: "auth_email_outbox",
                result: exhausted ? "failed" : "retry",
                kind: item.kind,
                outboxId: item.id,
            }));
        }
    }

    private frontendUrl(): string {
        if (process.env["NODE_ENV"] === "production") {
            return process.env["PRODUCTION_FRONTEND_URL"] || "http://localhost:3000";
        }
        if (process.env["NODE_ENV"] === "preview") {
            return process.env["PREVIEW_FRONTEND_URL"] || "http://localhost:3000";
        }
        return process.env["DEVELOPMENT_FRONTEND_URL"] || "http://localhost:3000";
    }

    private safeErrorCode(error: unknown): string {
        const name = error instanceof Error ? error.name : "UnknownError";
        return name.replace(/[^A-Za-z0-9_:-]/g, "_").slice(0, 64);
    }
}
