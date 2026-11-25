import { BadRequestException, ConflictException, Injectable, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash, randomBytes } from "crypto";
import { PrismaService } from "infrastructure/database/prisma.service";
import { runSystemScope } from "infrastructure/tenant/run-system-scope";
import { tenantContextStore } from "infrastructure/tenant/tenant-context.store";

import { ServiceRecordSecurityEventService } from "./service-record-security-event.service";
import { resolveServiceRecordCaseTarget, type ServiceRecordCaseTarget } from "./service-record-case-target";
import { codeOnlyProblemBody, problemBody } from "application/utils/problem-bodies";

export const SERVICE_RECORD_PHONE_CHALLENGE_MAX_FAILED_ATTEMPTS = 5;

/**
 * Whether a token row may still authorise a caregiver write. Shared by
 * `resolveAccess` (request guard) and the entry service's in-transaction
 * re-check so the two cannot drift apart.
 */
export function isServiceRecordAccessTokenUsable(
    record: {
        active: boolean;
        revokedAt: Date | null;
        verifiedAt: Date | null;
        lockedAt: Date | null;
        failedAttempts: number;
        expiresAt: Date;
    },
    now: number = Date.now(),
): boolean {
    return record.active
        && !record.revokedAt
        && Boolean(record.verifiedAt)
        && !record.lockedAt
        && record.failedAttempts < SERVICE_RECORD_PHONE_CHALLENGE_MAX_FAILED_ATTEMPTS
        && record.expiresAt.getTime() > now;
}
export const SERVICE_RECORD_PHONE_CHALLENGE_WINDOW_MS = 15 * 60 * 1000;

/** Resolved context attached to a request after the access token is validated. */
export interface ServiceRecordTokenContext {
    tokenId: string;
    branchId: string;
    scheduleId: number;
    employeeId: number;
    serviceRecordCaseId?: string | null;
    babyId?: string | null;
    babyRank?: number | null;
    babyCount?: number | null;
    employeeName?: string;
    /** Internal proof that the verified session did not rotate before a write. */
    accessTokenHash?: string;
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

/** A change in caregiver history leaves an unbound case for explicit adoption. */
export async function hasConflictingUnboundCaseHistory(
    db: Prisma.TransactionClient,
    { branchId, clientId, scheduleId, employeeId, babyId }: {
        branchId: string; clientId: number; scheduleId: number; employeeId: number; babyId: string;
    },
): Promise<boolean> {
    const conflictingAssignment = await db.service_record_baby_assignment.findFirst({
        where: { branchId, clientId, OR: [{ employeeId: { not: employeeId } }, { babyId: { not: babyId } }] },
        select: { id: true },
    });
    if (conflictingAssignment) return true;

    // The first configured allocation may have no outgoing baby owners.
    // Other schedules still carry that legacy caregiver history.
    return Boolean(await db.employee_schedule.findFirst({
        where: { branchId, clientId, id: { not: scheduleId }, primaryEmployeeId: { not: employeeId } },
        select: { id: true },
    }));
}

/**
 * No-login per-assignment service-record access (BJJ-247).
 * Two secrets per token row:
 *   - link token: carried in the SMS URL (possession). Stored plaintext so the issued
 *     form URL can be recovered from the database when needed; only reaches the phone challenge.
 *   - access token: minted after a correct phone number (knowledge). Grants the service-record endpoints
 *     until expiresAt (= midnight KST after schedule.endDate).
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
        record: Pick<ServiceRecordLinkTokenParams, "branchId" | "scheduleId" | "employeeId" | "serviceRecordCaseId">,
        db: Prisma.TransactionClient,
        options: { lockCase?: boolean; throwOnFinalized?: boolean } = {},
    ) {
        return tenantContextStore.run({ origin: "http", branchId: record.branchId }, async () => {
            const { branchId, scheduleId, employeeId } = record;
            const original = await db.employee_schedule.findFirst({
                where: { id: scheduleId, branchId },
                select: { clientId: true },
            });
            if (!original) return null;
            const { clientId } = original;
            // Allocation and entry writes take the client lock before the case
            // and token. Re-read the authority after waiting on these locks.
            if (options.lockCase) {
                await db.$executeRaw(Prisma.sql`
                    SELECT id FROM client WHERE id = ${clientId} AND branch_id = ${branchId}::uuid FOR UPDATE
                `);
                await db.$executeRaw(Prisma.sql`
                    SELECT id FROM employee WHERE id = ${employeeId} AND branch_id = ${branchId}::uuid FOR SHARE
                `);
            }
            const target = await resolveServiceRecordCaseTarget(db, {
                branchId, clientId, caseId: record.serviceRecordCaseId ?? undefined,
            });
            if (target.kind !== "resolved") return null;
            const { caseId, babyId } = target;
            if (babyId === null && record.serviceRecordCaseId) {
                const singleton = await resolveServiceRecordCaseTarget(db, { branchId, clientId });
                if (singleton.kind !== "resolved" || singleton.caseId !== caseId) return null;
            }

            if (options.lockCase) {
                await db.$executeRaw(Prisma.sql`
                    SELECT id FROM service_record_case
                    WHERE branch_id = ${branchId}::uuid AND client_id = ${clientId} AND id = ${caseId}::uuid
                    FOR SHARE
                `);
            }
            const serviceCase = await db.service_record_case.findFirst({
                where: { id: caseId, branchId, clientId },
                select: { finalizedAt: true },
            });
            if (!serviceCase) return null;
            if (serviceCase.finalizedAt) {
                if (options.throwOnFinalized) {
                    throw new BadRequestException(problemBody("VALIDATION_FAILED", {
                        pointer: "/scheduleId",
                        code: "INVALID_VALUE",
                        detail: "최종 확정된 제공기록지는 링크를 다시 발급할 수 없습니다.",
                        location: "body",
                    }));
                }
                return null;
            }

            const current = await db.employee_schedule.findFirst({
                where: {
                    clientId, branchId, replaced: false, terminatedAt: null,
                    client: { branchId, deletedAt: null },
                },
                orderBy: { id: "desc" },
                select: { id: true, primaryEmployeeId: true, client: { select: { serviceStatus: true } } },
            });
            if (!current || current.id !== scheduleId || current.client.serviceStatus === "terminated") return null;

            let employee: { name: string; phone: string | null } | null;
            if (babyId) {
                employee = (await db.service_record_baby_assignment.findFirst({
                    where: {
                        branchId, clientId, scheduleId, babyId, employeeId,
                        activeOwner: true, endedAt: null, teamSlot: { active: true },
                        employee: { branchId, deletedAt: null },
                    },
                    select: { employee: { select: { name: true, phone: true } } },
                }))?.employee ?? null;
            } else {
                if (current.primaryEmployeeId !== employeeId) return null;
                const { babyCount } = target;
                if (babyCount !== null) {
                    if (babyCount !== 1) return null;
                    const [owner, otherOwner] = await db.service_record_baby_assignment.findMany({
                        where: {
                            branchId, clientId, scheduleId, activeOwner: true, endedAt: null,
                            baby: { active: true }, teamSlot: { active: true },
                        },
                        select: { babyId: true, employeeId: true },
                        take: 2,
                    });
                    if (!owner || otherOwner || owner.employeeId !== employeeId
                        || await hasConflictingUnboundCaseHistory(db, { branchId, clientId, scheduleId, employeeId, babyId: owner.babyId })) {
                        return null;
                    }
                }
                employee = await db.employee.findFirst({
                    where: { id: employeeId, branchId, deletedAt: null },
                    select: { name: true, phone: true },
                });
            }
            const phone = this.normalizePhone(employee?.phone ?? "");
            return employee && phone ? { target, clientId, employeeName: employee.name, phoneHash: this.hash(phone) } : null;
        });
    }

    private async credentialScope(
        tx: Prisma.TransactionClient,
        params: ServiceRecordLinkTokenParams,
        current: { clientId: number; target: Extract<ServiceRecordCaseTarget, { kind: "resolved" }> },
    ): Promise<Prisma.service_record_tokenWhereInput> {
        const { branchId, scheduleId, employeeId } = params;
        const explicitCase = { serviceRecordCaseId: current.target.caseId };
        const singleton = params.serviceRecordCaseId
            ? await resolveServiceRecordCaseTarget(tx, { branchId, clientId: current.clientId })
            : current.target;
        return {
            branchId, scheduleId, employeeId, revokedAt: null,
            ...(singleton.kind === "resolved" && singleton.caseId === current.target.caseId
                ? { OR: [explicitCase, { serviceRecordCaseId: null }] }
                : explicitCase),
        };
    }

    /** A link stays with its case and employee for the lifetime of the credential. */
    async issueLink(params: ServiceRecordLinkTokenParams): Promise<{ linkToken: string }> {
        return this.persistLink(params, true);
    }

    private async persistLink(params: ServiceRecordLinkTokenParams, activate: boolean): Promise<{ linkToken: string }> {
        return this.prismaService.$transaction(async (tx) => {
            const current = await this.currentProvider(params, tx, { lockCase: true, throwOnFinalized: true });
            if (!current || current.phoneHash !== this.hash(this.normalizePhone(params.expectedPhone))) {
                throw new ConflictException(codeOnlyProblemBody("SERVICE_RECORD_WRITE_TARGET_CHANGED"));
            }

            const scope = await this.credentialScope(tx, params, current);
            const row = await tx.service_record_token.findFirst({
                where: scope,
                orderBy: [{ active: "desc" }, { createdAt: "desc" }, { id: "desc" }],
            });
            if (row) {
                const authenticationChanged = row.expectedPhoneHash !== current.phoneHash;
                const updated = await tx.service_record_token.updateMany({
                    where: { ...scope, id: row.id },
                    data: {
                        expectedPhoneHash: current.phoneHash,
                        expiresAt: params.expiresAt,
                        ...(activate ? { active: true } : {}),
                        ...(authenticationChanged || params.resetChallenge ? {
                            accessTokenHash: null, verifiedAt: null, failedAttempts: 0,
                            challengeWindowStartedAt: null, lockedAt: null,
                        } : {}),
                    },
                });
                if (updated.count === 1) return { linkToken: row.linkTokenHash };
            }

            const linkToken = `efl_${randomBytes(32).toString("base64url")}`;
            await tx.service_record_token.create({
                data: {
                    branchId: params.branchId, scheduleId: params.scheduleId, employeeId: params.employeeId,
                    serviceRecordCaseId: current.target.caseId, linkTokenHash: linkToken,
                    expectedPhoneHash: current.phoneHash, expiresAt: params.expiresAt, active: activate,
                },
            });
            return { linkToken };
        });
    }

    async reuseActiveLink(
        params: ServiceRecordLinkTokenParams,
        options: { includeLocked?: boolean } = {},
    ): Promise<{ linkToken: string } | null> {
        return this.prismaService.$transaction(async (tx) => {
            const current = await this.currentProvider(params, tx, { lockCase: true });
            if (!current || current.phoneHash !== this.hash(this.normalizePhone(params.expectedPhone))) return null;
            const where = {
                ...await this.credentialScope(tx, params, current),
                expectedPhoneHash: current.phoneHash,
                active: true,
                ...(options.includeLocked === false ? { lockedAt: null } : {}),
            };
            const record = await tx.service_record_token.findFirst({
                where, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            });
            if (!record) return null;

            const updated = await tx.service_record_token.updateMany({
                where: { ...where, id: record.id },
                data: { expiresAt: params.expiresAt },
            });
            return updated.count === 1 ? { linkToken: record.linkTokenHash } : null;
        });
    }

    /** Prepare the exact URL shown in the composer without activating it. */
    async prepareLink(params: ServiceRecordLinkTokenParams): Promise<{ linkToken: string }> {
        return this.persistLink(params, false);
    }

    async activatePreparedLink(params: ServiceRecordLinkTokenParams & { linkToken: string }): Promise<boolean> {
        const expectedPhoneHash = this.hash(this.normalizePhone(params.expectedPhone));

        return this.prismaService.$transaction(async (tx) => {
            const candidate = await this.findByLinkToken(params.linkToken, tx);
            if (!candidate || candidate.branchId !== params.branchId
                || candidate.scheduleId !== params.scheduleId || candidate.employeeId !== params.employeeId) return false;

            const current = await this.currentProvider(params, tx, { lockCase: true });
            if (!current || current.phoneHash !== expectedPhoneHash) return false;
            const scope = await this.credentialScope(tx, params, current);
            const record = await tx.service_record_token.findFirst({ where: { ...scope, id: candidate.id } });
            if (!record || record.expectedPhoneHash !== expectedPhoneHash || record.expiresAt.getTime() <= Date.now()) return false;

            // Serialize activation with the active challenge without clearing a lock.
            const activeRows = await this.lockActiveRowsForAssignment(tx, record, current.target.caseId, Boolean(scope.OR));
            if (activeRows.some((row) => row.lockedAt || row.failedAttempts >= SERVICE_RECORD_PHONE_CHALLENGE_MAX_FAILED_ATTEMPTS)) return false;
            const updated = await tx.service_record_token.updateMany({
                where: { ...scope, id: record.id, expectedPhoneHash },
                data: { active: true, expiresAt: params.expiresAt },
            });
            return updated.count === 1;
        });
    }

    async resolveLink(linkToken: string) {
        const record = await this.findByLinkToken(linkToken, this.prismaService);
        if (!record?.active || record.revokedAt || record.expiresAt.getTime() <= Date.now()) return null;
        const current = await this.currentProvider(record, this.prismaService);
        if (!current) return null;
        const unchangedPhone = record.expectedPhoneHash === current.phoneHash;
        if (unchangedPhone && (record.lockedAt || record.failedAttempts >= SERVICE_RECORD_PHONE_CHALLENGE_MAX_FAILED_ATTEMPTS)) return null;
        return record;
    }

    /** Does a token row exist for this exact link token (any state)? Lets the UI tell a wrong link from an unusable one. */
    async linkTokenExists(linkToken: string): Promise<boolean> {
        return Boolean(await this.findByLinkToken(linkToken, this.prismaService));
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

    private async lockActiveRowsForAssignment(
        tx: Prisma.TransactionClient,
        record: { branchId: string; scheduleId: number; employeeId: number },
        caseId: string,
        allowLegacy: boolean,
    ) {
        const { branchId, scheduleId, employeeId } = record;
        if (typeof tx.$queryRaw !== "function") {
            return tx.service_record_token.findMany({
                where: {
                    branchId, scheduleId, employeeId, active: true, revokedAt: null,
                    OR: [{ serviceRecordCaseId: caseId }, ...(allowLegacy ? [{ serviceRecordCaseId: null }] : [])],
                },
                select: { lockedAt: true, failedAttempts: true },
            });
        }

        return tx.$queryRaw<Array<{ lockedAt: Date | null; failedAttempts: number }>>(Prisma.sql`
            SELECT locked_at AS "lockedAt", failed_attempts AS "failedAttempts"
            FROM service_record_token
            WHERE branch_id = ${branchId}::uuid AND schedule_id = ${scheduleId} AND employee_id = ${employeeId}
              AND (service_record_case_id = ${caseId}::uuid
                   ${allowLegacy ? Prisma.sql`OR service_record_case_id IS NULL` : Prisma.empty})
              AND active = TRUE AND revoked_at IS NULL
            ORDER BY id FOR UPDATE
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
            const candidate = await this.findByLinkToken(linkToken, tx);
            if (!candidate) return this.unavailable("invalid_token");
            const current = await this.currentProvider(candidate, tx, { lockCase: true });
            if (!current) return this.unavailable("invalid_token");
            const record = await this.findAndLockByLinkToken(linkToken, tx);
            if (!record) return this.unavailable("invalid_token");
            return tenantContextStore.run({ origin: "http", branchId: record.branchId }, async (): Promise<VerifyPhoneResult> => {
                const now = new Date();
                if (!record.active || record.revokedAt
                    || record.scheduleId !== candidate.scheduleId || record.employeeId !== candidate.employeeId
                    || record.serviceRecordCaseId !== candidate.serviceRecordCaseId) return this.unavailable("invalid_token");
                if (record.expiresAt.getTime() <= now.getTime()) return this.unavailable("expired");
                const currentPhoneHash = current.phoneHash;
                if (record.expectedPhoneHash !== currentPhoneHash) {
                    const healed = await tx.service_record_token.update({
                        where: { id: record.id, branchId: record.branchId },
                        data: {
                            expectedPhoneHash: currentPhoneHash, accessTokenHash: null, verifiedAt: null,
                            failedAttempts: 0, challengeWindowStartedAt: null, lockedAt: null,
                        },
                    });
                    Object.assign(record, healed);
                }
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

    /**
     * Lock one token row by id and return its current state, for a caregiver write
     * transaction that must re-check the token after the guard resolved it. The
     * lock makes a concurrent revoke/replace serialise with the write. The row is
     * read through system scope so tenant scoping cannot hide it. The fallback
     * keeps narrow unit-test doubles compatible; production Prisma always has
     * `$queryRaw` on its transaction client.
     */
    async lockAccessTokenForWrite(tx: Prisma.TransactionClient, tokenId: string) {
        const transaction = tx as Prisma.TransactionClient & {
            $queryRaw?: <T>(query: Prisma.Sql) => Promise<T>;
        };
        if (typeof transaction.$queryRaw === "function") {
            await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
                SELECT "id"
                FROM "service_record_token"
                WHERE "id" = ${tokenId}::uuid
                FOR UPDATE
            `);
        }
        return runSystemScope(async () => await tx.service_record_token.findUnique({
            where: { id: tokenId },
        }));
    }

    /** Resolve a usable access token to its assignment context, else null. */
    async resolveAccess(accessToken: string): Promise<ServiceRecordTokenContext | null> {
        const record = await runSystemScope(async () => await this.prismaService.service_record_token.findUnique({
            where: { accessTokenHash: this.hash(accessToken) },
        }));
        if (!record || !isServiceRecordAccessTokenUsable(record)) {
            return null;
        }
        const current = await this.currentProvider(record, this.prismaService);
        if (!current || current.phoneHash !== record.expectedPhoneHash) return null;
        return {
            tokenId: record.id,
            branchId: record.branchId,
            scheduleId: record.scheduleId,
            employeeId: record.employeeId,
            serviceRecordCaseId: current.target.caseId,
            babyId: current.target.babyId,
            babyRank: current.target.rank,
            babyCount: current.target.babyCount,
            employeeName: current.employeeName,
            accessTokenHash: record.accessTokenHash ?? undefined,
        };
    }

    /** Called after the entry service has acquired the owning write set. */
    async currentEmployeeForWrite(tx: Prisma.TransactionClient, ctx: ServiceRecordTokenContext, caseId: string) {
        const token = await this.lockAccessTokenForWrite(tx, ctx.tokenId);
        if (!token || !isServiceRecordAccessTokenUsable(token)
            || token.branchId !== ctx.branchId || token.scheduleId !== ctx.scheduleId
            || token.employeeId !== ctx.employeeId || token.accessTokenHash !== ctx.accessTokenHash) return null;
        const current = await this.currentProvider(token, tx);
        return current?.target.caseId === caseId && current.phoneHash === token.expectedPhoneHash
            ? { name: current.employeeName } : null;
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

    async extendExpiryForCase(
        serviceRecordCaseId: string,
        newExpiresAt: Date,
        tx?: Prisma.TransactionClient,
        options: { onlyRaise?: boolean } = {},
    ): Promise<void> {
        const db = tx ?? this.prismaService;
        const record = await db.service_record_case.findUnique({ where: { id: serviceRecordCaseId }, select: { branchId: true } });
        if (!record) return;
        await db.service_record_token.updateMany({
            where: {
                serviceRecordCaseId,
                branchId: record.branchId,
                active: true,
                revokedAt: null,
                // onlyRaise: an earlier end date must not cut short a link already sent.
                ...(options.onlyRaise ? { expiresAt: { lt: newExpiresAt } } : {}),
            },
            data: { expiresAt: newExpiresAt },
        });
    }

    /**
     * Revoke every active token for an assignment (replacement / termination).
     * `tx` lets a caller that already holds the schedule fence revoke on its own
     * connection: opening another transaction from inside it would wait on
     * client/case locks that this connection
     * cannot see.
     */
    async revokeForSchedule(scheduleId: number, tx?: Prisma.TransactionClient): Promise<void> {
        const db = tx ?? this.prismaService;
        const schedule = await db.employee_schedule.findUnique({ where: { id: scheduleId }, select: { branchId: true } });
        if (!schedule?.branchId) return;
        await db.service_record_token.updateMany({
            where: { scheduleId, branchId: schedule.branchId, revokedAt: null },
            data: { active: false, revokedAt: new Date(), accessTokenHash: null, verifiedAt: null },
        });
    }
}
