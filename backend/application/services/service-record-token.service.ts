import { BadRequestException, Injectable, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash, randomBytes } from "crypto";
import { PrismaService } from "infrastructure/database/prisma.service";
import { runSystemScope } from "infrastructure/tenant/run-system-scope";
import { tenantContextStore } from "infrastructure/tenant/tenant-context.store";

import { ServiceRecordSecurityEventService } from "./service-record-security-event.service";

export const SERVICE_RECORD_PHONE_CHALLENGE_MAX_FAILED_ATTEMPTS = 5;
export const SERVICE_RECORD_PHONE_CHALLENGE_WINDOW_MS = 15 * 60 * 1000;

/** Resolved context attached to a request after the access token is validated. */
export interface ServiceRecordTokenContext {
    tokenId: string;
    branchId: string;
    scheduleId: number;
    employeeId: number;
    serviceRecordCaseId?: string | null;
}

export type VerifyPhoneResult =
    | { ok: true; accessToken: string }
    | { ok: false; reason: "verification_failed" };


interface ServiceRecordLinkTokenParams {
    branchId: string;
    scheduleId: number;
    employeeId: number;
    serviceRecordCaseId?: string | null;
    expectedPhone: string;
    expiresAt: Date;
    resetChallenge?: boolean;
}

/**
 * No-login per-assignment service-record access (BJJ-247).
 * Two secrets per token row:
 *   - link token: carried in the SMS URL (possession). Stored plaintext so the issued
 *     form URL can be recovered from the database when needed; only reaches the phone challenge.
 *   - access token: minted after a correct phone number (knowledge). Grants the service-record endpoints
 *     until expiresAt (= schedule.endDate + grace buffer).
 * The access token and expected phone remain sha256 hashes. `linkTokenHash` retains its
 * legacy Prisma/database name even though newly issued form-link values are plaintext.
 */
@Injectable()
export class ServiceRecordTokenService {
    constructor(
        private readonly prismaService: PrismaService,
        @Optional() private readonly securityEventService?: ServiceRecordSecurityEventService,
    ) {}

    private hash(value: string): string {
        return createHash("sha256").update(value).digest("hex");
    }

    /** Strip everything but digits so "010-1234-5678" and "01012345678" compare equal. */
    private normalizePhone(phone: string): string {
        return (phone ?? "").replace(/\D/g, "");
    }

    private async currentProvider(
        record: { scheduleId: number; branchId: string },
        db: Prisma.TransactionClient | PrismaService,
    ) {
        // Public token requests have no tenant context; both lookups are pinned to the token's branch.
        return tenantContextStore.run({ origin: "http", branchId: record.branchId }, async () => {
            const original = await db.employee_schedule.findUnique({ where: { id: record.scheduleId }, select: { clientId: true, branchId: true } });
            if (!original || original.branchId !== record.branchId) return null;
            const current = await db.employee_schedule.findFirst({
                where: { clientId: original.clientId, branchId: record.branchId, replaced: false },
                orderBy: { id: "desc" },
                include: { primaryEmployee: true, client: { select: { serviceStatus: true } } },
            });
            if (!current || current.client.serviceStatus === "terminated" || current.primaryEmployee.deletedAt) return null;
            return current;
        });
    }

    /** Reuse the contract URL, changing authentication only when its provider changes. */
    async issueLink(params: ServiceRecordLinkTokenParams): Promise<{ linkToken: string }> {
        return this.persistLink(params, true);
    }

    private async persistLink(params: ServiceRecordLinkTokenParams, activate: boolean): Promise<{ linkToken: string }> {
        return this.prismaService.$transaction(async (tx) => {
            await tx.$executeRaw(Prisma.sql`
                SELECT pg_advisory_xact_lock(hashtextextended(${`service-record-link:${params.branchId}:${params.serviceRecordCaseId ?? params.scheduleId}`}, 0))
            `);
            const current = await this.currentProvider(params, tx);
            if (!current || current.id !== params.scheduleId || current.primaryEmployeeId !== params.employeeId
                || !this.normalizePhone(current.primaryEmployee.phone ?? "")) {
                throw new Error("Service record assignment is no longer current");
            }
            const serviceCase = await tx.service_record_case.findFirst({
                where: { branchId: params.branchId, clientId: current.clientId },
                select: { finalizedAt: true },
            });
            if (serviceCase?.finalizedAt) {
                throw new BadRequestException("최종 확정된 제공기록지는 링크를 다시 발급할 수 없습니다.");
            }
            const scope = {
                branchId: params.branchId,
                OR: [
                    { scheduleId: params.scheduleId },
                    ...(params.serviceRecordCaseId ? [{ serviceRecordCaseId: params.serviceRecordCaseId }] : []),
                ],
            };
            const previous = await tx.service_record_token.findMany({ where: scope, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
            const expectedPhoneHash = this.hash(this.normalizePhone(current.primaryEmployee.phone ?? ""));
            for (const row of previous) {
                const authenticationChanged = row.employeeId !== params.employeeId
                    || row.scheduleId !== params.scheduleId
                    || row.expectedPhoneHash !== expectedPhoneHash
                    || row.revokedAt !== null;
                await tx.service_record_token.update({
                    where: { id: row.id, branchId: params.branchId },
                    data: {
                        scheduleId: params.scheduleId,
                        employeeId: params.employeeId,
                        serviceRecordCaseId: params.serviceRecordCaseId,
                        expectedPhoneHash,
                        expiresAt: params.expiresAt,
                        ...(activate || row.active || row.revokedAt ? { active: true, revokedAt: null } : {}),
                        ...(authenticationChanged || params.resetChallenge ? {
                            accessTokenHash: null, verifiedAt: null, failedAttempts: 0,
                            challengeWindowStartedAt: null, lockedAt: null,
                        } : {}),
                    },
                });
            }
            if (previous[0]) return { linkToken: previous[0].linkTokenHash };
            const linkToken = `efl_${randomBytes(32).toString("base64url")}`;
            await tx.service_record_token.create({
                data: {
                    branchId: params.branchId, scheduleId: params.scheduleId, employeeId: params.employeeId,
                    serviceRecordCaseId: params.serviceRecordCaseId, linkTokenHash: linkToken,
                    expectedPhoneHash, expiresAt: params.expiresAt, active: activate,
                },
            });
            return { linkToken };
        });
    }

    /**
     * Reuse the current provider's active link and only extend its expiry.
     * Provider replacement changes the schedule/employee and revokes the old row,
     * so only an unchanged assignment can match this lookup.
     */
    async reuseActiveLink(
        params: ServiceRecordLinkTokenParams,
        options: { includeLocked?: boolean } = {},
    ): Promise<{ linkToken: string } | null> {
        const current = await this.currentProvider(params, this.prismaService);
        if (!current || current.id !== params.scheduleId || current.primaryEmployeeId !== params.employeeId) return null;
        const includeLocked = options.includeLocked ?? true;
        const record = await this.prismaService.service_record_token.findFirst({
            where: {
                branchId: params.branchId,
                scheduleId: params.scheduleId,
                employeeId: params.employeeId,
                expectedPhoneHash: this.hash(this.normalizePhone(params.expectedPhone)),
                active: true,
                revokedAt: null,
                ...(includeLocked ? {} : { lockedAt: null }),
            },
            orderBy: { createdAt: "desc" },
        });
        if (!record) return null;

        const updated = await this.prismaService.service_record_token.updateMany({
            where: {
                id: record.id,
                branchId: params.branchId,
                scheduleId: params.scheduleId,
                employeeId: params.employeeId,
                expectedPhoneHash: this.hash(this.normalizePhone(params.expectedPhone)),
                active: true,
                revokedAt: null,
                ...(includeLocked ? {} : { lockedAt: null }),
            },
            data: { expiresAt: params.expiresAt },
        });
        if (updated.count === 0) return null;
        return { linkToken: record.linkTokenHash };
    }

    /**
     * Prepare the exact link shown in the admin preview without making it usable yet.
     * Repeated previews reuse the same row; send activates it without rotating the URL.
     */
    async prepareLink(params: ServiceRecordLinkTokenParams): Promise<{ linkToken: string }> {
        return this.persistLink(params, false);
    }

    /** Activate a prepared link only when it still matches the tenant assignment and phone. */
    async activatePreparedLink(params: ServiceRecordLinkTokenParams & { linkToken: string }): Promise<boolean> {
        const expectedPhoneHash = this.hash(this.normalizePhone(params.expectedPhone));

        return this.prismaService.$transaction(async (tx) => {
            const record = await this.findByLinkToken(params.linkToken, tx);
            if (
                !record
                || record.expiresAt.getTime() < Date.now()
                || record.branchId !== params.branchId
                || record.scheduleId !== params.scheduleId
                || record.employeeId !== params.employeeId
                || record.expectedPhoneHash !== expectedPhoneHash
            ) {
                return false;
            }

            const current = await this.currentProvider(record, tx);
            if (!current || current.id !== params.scheduleId || current.primaryEmployeeId !== params.employeeId
                || this.hash(this.normalizePhone(current.primaryEmployee.phone ?? "")) !== expectedPhoneHash) return false;

            // A prepared token may have been created before the currently active
            // challenge exhausted its budget. Do not let a later send activate that
            // token and silently replace the locked record; only the explicit
            // owner/admin reset path may clear a lock.
            const activeRows = await this.lockActiveRowsForAssignment(tx, {
                branchId: params.branchId,
                scheduleId: params.scheduleId,
                serviceRecordCaseId: record.serviceRecordCaseId,
            });
            if (activeRows.some((row) => row.lockedAt !== null)) return false;

            await tx.service_record_token.update({
                where: { id: record.id, branchId: record.branchId },
                data: {
                    active: true,
                    revokedAt: null,
                    expiresAt: params.expiresAt,
                },
            });
            return true;
        });
    }

    /** Resolve a usable (active, not revoked, not expired, not locked) link-token row, else null. */
    async resolveLink(linkToken: string) {
        const record = await this.findByLinkToken(linkToken, this.prismaService);
        if (!record || (!record.active && !record.revokedAt) || record.expiresAt.getTime() < Date.now()) return null;
        const current = await this.currentProvider(record, this.prismaService);
        if (!current || (record.revokedAt && record.scheduleId === current.id)) return null;
        const changed = record.scheduleId !== current.id || record.employeeId !== current.primaryEmployeeId
            || record.expectedPhoneHash !== this.hash(this.normalizePhone(current.primaryEmployee.phone ?? ""));
        if (!changed && (record.lockedAt || record.failedAttempts >= SERVICE_RECORD_PHONE_CHALLENGE_MAX_FAILED_ATTEMPTS)) return null;
        return record;
    }

    /** Resolve form links by their plaintext database value. */
    private async findByLinkToken(linkToken: string, client: Prisma.TransactionClient | PrismaService) {
        return runSystemScope(async () => await client.service_record_token.findUnique({
            where: { linkTokenHash: linkToken },
        }));
    }

    /**
     * Lock the challenge row before reading its attempt state. The fallback keeps
     * unit-test doubles and old adapters compatible; production Prisma always has
     * `$queryRaw`, so concurrent guesses serialize on this row lock.
     */
    private async findAndLockByLinkToken(linkToken: string, tx: Prisma.TransactionClient) {
        const transaction = tx as Prisma.TransactionClient & {
            $queryRaw?: <T>(query: Prisma.Sql) => Promise<T>;
        };
        if (typeof transaction.$queryRaw !== "function") {
            return this.findByLinkToken(linkToken, tx);
        }

        const rows = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            SELECT "id"
            FROM "service_record_token"
            WHERE "link_token_hash" = ${linkToken}
            FOR UPDATE
        `);
        const [row] = rows;
        return row
            ? this.findByLinkToken(linkToken, tx)
            : null;
    }

    /**
     * Lock every currently active token for an assignment before checking lockout
     * state. This gives activation the same serialization boundary as the phone
     * challenge: if the fifth failed guess wins the row lock first, activation
     * waits and observes the committed lock. Activation never resets challenge state.
     *
     * The fallback keeps lightweight test doubles compatible; production Prisma
     * always exposes `$queryRaw` on its transaction client.
     */
    private async lockActiveRowsForAssignment(
        tx: Prisma.TransactionClient,
        params: Pick<ServiceRecordLinkTokenParams, "branchId" | "scheduleId" | "serviceRecordCaseId">,
    ): Promise<Array<{ lockedAt: Date | null }>> {
        const transaction = tx as Prisma.TransactionClient & {
            $queryRaw?: <T>(query: Prisma.Sql) => Promise<T>;
        };
        if (typeof transaction.$queryRaw !== "function") {
            const locked = await tx.service_record_token.findFirst({
                where: {
                    branchId: params.branchId,
                    active: true,
                    revokedAt: null,
                    lockedAt: { not: null },
                    OR: [
                        { scheduleId: params.scheduleId },
                        ...(params.serviceRecordCaseId
                            ? [{ serviceRecordCaseId: params.serviceRecordCaseId }]
                            : []),
                    ],
                },
                select: { lockedAt: true },
            });
            return locked ? [{ lockedAt: locked.lockedAt }] : [];
        }

        const serviceRecordCaseId = params.serviceRecordCaseId ?? null;
        return transaction.$queryRaw<Array<{ lockedAt: Date | null }>>(Prisma.sql`
            SELECT "locked_at" AS "lockedAt"
            FROM "service_record_token"
            WHERE "branch_id" = ${params.branchId}::uuid
              AND (
                  "schedule_id" = ${params.scheduleId}
                  OR "service_record_case_id" = ${serviceRecordCaseId}::uuid
              )
              AND "active" = TRUE
              AND "revoked_at" IS NULL
            FOR UPDATE
        `);
    }

    private unavailable(reason: "invalid_token" | "expired" | "locked"): VerifyPhoneResult {
        this.securityEventService?.emit({
            outcome: "challenge_unavailable",
            reason,
        });
        return { ok: false, reason: "verification_failed" };
    }

    private emitChallengeEvent(
        record: {
            id: string;
            branchId: string;
            scheduleId: number;
            employeeId: number;
        },
        outcome: "challenge_failed" | "challenge_locked" | "challenge_succeeded",
        failedAttempts: number,
    ): void {
        this.securityEventService?.emit({
            outcome,
            tokenId: record.id,
            branchId: record.branchId,
            scheduleId: record.scheduleId,
            employeeId: record.employeeId,
            failedAttempts,
        });
    }

    /**
     * Verify a phone number against the link token. On success mint + persist a new access token.
     * Wrong phone numbers consume a finite per-link budget in a fifteen-minute window.
     * The fifth failed guess locks the link until an authenticated admin reissues it.
     *
     * Authentication always uses the current assigned provider's registered phone.
     * Ownership or phone changes invalidate the old access session, including before SMS reissue.
     */
    async verifyPhoneAndMintAccess(linkToken: string, phone: string): Promise<VerifyPhoneResult> {
        const submittedPhoneHash = this.hash(this.normalizePhone(phone));
        return this.prismaService.$transaction(async (tx) => {
            const record = await this.findAndLockByLinkToken(linkToken, tx);
            if (!record) return this.unavailable("invalid_token");
            return tenantContextStore.run({ origin: "http", branchId: record.branchId }, async (): Promise<VerifyPhoneResult> => {
                const now = new Date();
                if (!record.active && !record.revokedAt) return this.unavailable("invalid_token");
                const current = await this.currentProvider(record, tx);
                const currentPhone = this.normalizePhone(current?.primaryEmployee.phone ?? "");
                if (!current || !currentPhone) return this.unavailable("invalid_token");
                const currentPhoneHash = this.hash(currentPhone);
                if (record.scheduleId !== current.id || record.employeeId !== current.primaryEmployeeId || record.expectedPhoneHash !== currentPhoneHash) {
                    const rebound = await tx.service_record_token.update({
                        where: { id: record.id, branchId: record.branchId },
                        data: {
                            scheduleId: current.id, employeeId: current.primaryEmployeeId,
                            expectedPhoneHash: currentPhoneHash, active: true, revokedAt: null,
                            accessTokenHash: null, verifiedAt: null, failedAttempts: 0,
                            challengeWindowStartedAt: null, lockedAt: null,
                        },
                    });
                    Object.assign(record, rebound);
                }
                if (!record.active || record.revokedAt) return this.unavailable("invalid_token");
                if (record.expiresAt.getTime() < now.getTime()) return this.unavailable("expired");
                if (record.lockedAt) return this.unavailable("locked");

                let failedAttempts = record.failedAttempts;
                let challengeWindowStartedAt = record.challengeWindowStartedAt;

                // Legacy rows may carry an audit count without the new lock marker. Never
                // let such a row mint access after the finite budget has already been spent.
                if (failedAttempts >= SERVICE_RECORD_PHONE_CHALLENGE_MAX_FAILED_ATTEMPTS) {
                    await tx.service_record_token.update({
                        where: { id: record.id, branchId: record.branchId },
                        data: {
                            lockedAt: now,
                            accessTokenHash: null,
                            verifiedAt: null,
                        },
                    });
                    this.emitChallengeEvent(record, "challenge_locked", failedAttempts);
                    return { ok: false, reason: "verification_failed" };
                }

                if (
                    challengeWindowStartedAt
                    && now.getTime() - challengeWindowStartedAt.getTime() >= SERVICE_RECORD_PHONE_CHALLENGE_WINDOW_MS
                ) {
                    failedAttempts = 0;
                    challengeWindowStartedAt = null;
                    await tx.service_record_token.update({
                        where: { id: record.id, branchId: record.branchId },
                        data: {
                            failedAttempts: 0,
                            challengeWindowStartedAt: null,
                        },
                    });
                }

                if (submittedPhoneHash !== currentPhoneHash) {
                    const nextFailedAttempts = failedAttempts + 1;
                    const shouldLock = nextFailedAttempts >= SERVICE_RECORD_PHONE_CHALLENGE_MAX_FAILED_ATTEMPTS;
                    await tx.service_record_token.update({
                        where: { id: record.id, branchId: record.branchId },
                        data: {
                            failedAttempts: nextFailedAttempts,
                            challengeWindowStartedAt: challengeWindowStartedAt ?? now,
                            ...(shouldLock
                                ? {
                                    lockedAt: now,
                                    accessTokenHash: null,
                                    verifiedAt: null,
                                }
                                : {}),
                        },
                    });
                    this.emitChallengeEvent(
                        record,
                        shouldLock ? "challenge_locked" : "challenge_failed",
                        nextFailedAttempts,
                    );
                    return { ok: false, reason: "verification_failed" };
                }

                const accessToken = `efa_${randomBytes(32).toString("base64url")}`;
                await tx.service_record_token.update({
                    where: { id: record.id, branchId: record.branchId },
                    data: {
                        accessTokenHash: this.hash(accessToken),
                        verifiedAt: now,
                        failedAttempts: 0,
                        challengeWindowStartedAt: null,
                        lockedAt: null,
                    },
                });
                this.emitChallengeEvent(record, "challenge_succeeded", failedAttempts);
                return { ok: true, accessToken };
            });
        });
    }

    /** Resolve a usable access token to its assignment context, else null. */
    async resolveAccess(accessToken: string): Promise<ServiceRecordTokenContext | null> {
        const record = await runSystemScope(async () => await this.prismaService.service_record_token.findUnique({
            where: { accessTokenHash: this.hash(accessToken) },
        }));
        if (
            !record ||
            !record.active ||
            record.revokedAt ||
            !record.verifiedAt ||
            record.lockedAt ||
            record.failedAttempts >= SERVICE_RECORD_PHONE_CHALLENGE_MAX_FAILED_ATTEMPTS ||
            record.expiresAt.getTime() < Date.now()
        ) {
            return null;
        }
        const current = await this.currentProvider(record, this.prismaService);
        if (!current || current.id !== record.scheduleId || current.primaryEmployeeId !== record.employeeId
            || this.hash(this.normalizePhone(current.primaryEmployee.phone ?? "")) !== record.expectedPhoneHash) return null;
        return {
            tokenId: record.id,
            branchId: record.branchId,
            scheduleId: record.scheduleId,
            employeeId: record.employeeId,
            ...(record.serviceRecordCaseId
                ? { serviceRecordCaseId: record.serviceRecordCaseId }
                : {}),
        };
    }

    async extendExpiryForSchedule(scheduleId: number, newExpiresAt: Date, tx?: Prisma.TransactionClient): Promise<void> {
        const db = tx ?? this.prismaService;
        const schedule = await db.employee_schedule.findUnique({ where: { id: scheduleId }, select: { branchId: true } });
        if (!schedule?.branchId) return;
        await db.service_record_token.updateMany({
            where: { scheduleId, branchId: schedule.branchId, active: true, revokedAt: null },
            data: { expiresAt: newExpiresAt },
        });
    }

    async extendExpiryForCase(serviceRecordCaseId: string, newExpiresAt: Date, tx?: Prisma.TransactionClient): Promise<void> {
        const db = tx ?? this.prismaService;
        const record = await db.service_record_case.findUnique({ where: { id: serviceRecordCaseId }, select: { branchId: true } });
        if (!record) return;
        await db.service_record_token.updateMany({
            where: { serviceRecordCaseId, branchId: record.branchId, active: true, revokedAt: null },
            data: { expiresAt: newExpiresAt },
        });
    }

    /** Revoke every active token for an assignment (replacement / termination). */
    async revokeForSchedule(scheduleId: number): Promise<void> {
        const schedule = await this.prismaService.employee_schedule.findUnique({ where: { id: scheduleId }, select: { branchId: true } });
        if (!schedule?.branchId) return;
        await this.prismaService.service_record_token.updateMany({
            where: { scheduleId, branchId: schedule.branchId, active: true },
            data: { active: false, revokedAt: new Date(), accessTokenHash: null, verifiedAt: null },
        });
    }
}
