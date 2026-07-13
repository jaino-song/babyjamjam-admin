import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash, randomBytes } from "crypto";
import { PrismaService } from "infrastructure/database/prisma.service";

/** Resolved context attached to a request after the access token is validated. */
export interface FeedbackTokenContext {
    tokenId: string;
    branchId: string;
    scheduleId: number;
    employeeId: number;
    serviceRecordCaseId?: string | null;
}

export type VerifyPhoneResult =
    | { ok: true; accessToken: string }
    | { ok: false; reason: "invalid_token" | "wrong_phone" | "locked"; attemptsLeft?: number };

/** Max phone verification attempts before the link is locked (staff must re-issue). */
export const MAX_PHONE_ATTEMPTS = 5;

interface FeedbackLinkTokenParams {
    branchId: string;
    scheduleId: number;
    employeeId: number;
    serviceRecordCaseId?: string | null;
    expectedPhone: string;
    expiresAt: Date;
}

/**
 * No-login per-assignment feedback access (BJJ-247).
 * Two secrets per token row:
 *   - link token: carried in the SMS URL (possession). Only reaches the phone challenge.
 *   - access token: minted after a correct phone number (knowledge). Grants the feedback endpoints
 *     until expiresAt (= schedule.endDate + grace buffer).
 * Both are stored only as sha256 hashes. Mirrors CallIngestTokenService.
 */
@Injectable()
export class EmployeeFeedbackTokenService {
    private readonly logger = new Logger(EmployeeFeedbackTokenService.name);

    constructor(private readonly prismaService: PrismaService) {}

    private hash(value: string): string {
        return createHash("sha256").update(value).digest("hex");
    }

    /** Strip everything but digits so "010-1234-5678" and "01012345678" compare equal. */
    private normalizePhone(phone: string): string {
        return (phone ?? "").replace(/\D/g, "");
    }

    /**
     * Issue a fresh link for an assignment, revoking any prior active token for the schedule
     * (so a replaced provider's old link stops working). Returns the plaintext link token once.
     */
    async issueLink(params: FeedbackLinkTokenParams): Promise<{ linkToken: string }> {
        const linkToken = `efl_${randomBytes(32).toString("base64url")}`;
        await this.prismaService.$transaction(async (tx) => {
            await tx.employee_feedback_token.updateMany({
                where: {
                    active: true,
                    OR: [
                        { scheduleId: params.scheduleId },
                        ...(params.serviceRecordCaseId
                            ? [{ serviceRecordCaseId: params.serviceRecordCaseId }]
                            : []),
                    ],
                },
                data: { active: false, revokedAt: new Date() },
            });
            await tx.employee_feedback_token.create({
                data: {
                    branchId: params.branchId,
                    scheduleId: params.scheduleId,
                    employeeId: params.employeeId,
                    serviceRecordCaseId: params.serviceRecordCaseId,
                    linkTokenHash: this.hash(linkToken),
                    expectedPhoneHash: this.hash(this.normalizePhone(params.expectedPhone)),
                    expiresAt: params.expiresAt,
                },
            });
        });
        return { linkToken };
    }

    /**
     * Prepare the exact link shown in the admin preview without making it usable yet.
     * The plaintext token is returned once and must stay in the authenticated admin's
     * in-memory form state until send activates this same row.
     */
    async prepareLink(params: FeedbackLinkTokenParams): Promise<{ linkToken: string }> {
        const linkToken = `efl_${randomBytes(32).toString("base64url")}`;
        await this.prismaService.employee_feedback_token.create({
            data: {
                branchId: params.branchId,
                scheduleId: params.scheduleId,
                employeeId: params.employeeId,
                serviceRecordCaseId: params.serviceRecordCaseId,
                linkTokenHash: this.hash(linkToken),
                expectedPhoneHash: this.hash(this.normalizePhone(params.expectedPhone)),
                expiresAt: params.expiresAt,
                active: false,
            },
        });
        return { linkToken };
    }

    /** Activate a prepared link only when it still matches the tenant assignment and phone. */
    async activatePreparedLink(params: FeedbackLinkTokenParams & { linkToken: string }): Promise<boolean> {
        const linkTokenHash = this.hash(params.linkToken);
        const expectedPhoneHash = this.hash(this.normalizePhone(params.expectedPhone));

        return this.prismaService.$transaction(async (tx) => {
            const record = await tx.employee_feedback_token.findUnique({
                where: { linkTokenHash },
            });
            if (
                !record
                || record.revokedAt
                || record.expiresAt.getTime() < Date.now()
                || record.branchId !== params.branchId
                || record.scheduleId !== params.scheduleId
                || record.employeeId !== params.employeeId
                || record.expectedPhoneHash !== expectedPhoneHash
            ) {
                return false;
            }

            if (!record.active) {
                await tx.employee_feedback_token.updateMany({
                    where: {
                        active: true,
                        OR: [
                            { scheduleId: params.scheduleId },
                            ...(record.serviceRecordCaseId
                                ? [{ serviceRecordCaseId: record.serviceRecordCaseId }]
                                : []),
                        ],
                    },
                    data: { active: false, revokedAt: new Date() },
                });
            }

            await tx.employee_feedback_token.update({
                where: { id: record.id },
                data: {
                    active: true,
                    revokedAt: null,
                    expiresAt: params.expiresAt,
                },
            });
            return true;
        });
    }

    /** Resolve a usable (active, not revoked, not expired) link-token row, else null. */
    async resolveLink(linkToken: string) {
        const record = await this.prismaService.employee_feedback_token.findUnique({
            where: { linkTokenHash: this.hash(linkToken) },
        });
        if (!record || !record.active || record.revokedAt || record.expiresAt.getTime() < Date.now()) {
            return null;
        }
        return record;
    }

    /**
     * Verify a phone number against the link token. On success mint + persist a new access token.
     * On failure increment attempts and lock after MAX_PHONE_ATTEMPTS.
     */
    async verifyPhoneAndMintAccess(linkToken: string, phone: string): Promise<VerifyPhoneResult> {
        const record = await this.resolveLink(linkToken);
        if (!record) return { ok: false, reason: "invalid_token" };
        if (record.failedAttempts >= MAX_PHONE_ATTEMPTS) return { ok: false, reason: "locked" };

        if (this.hash(this.normalizePhone(phone)) !== record.expectedPhoneHash) {
            const updated = await this.prismaService.employee_feedback_token.update({
                where: { id: record.id },
                data: { failedAttempts: { increment: 1 } },
            });
            const attemptsLeft = Math.max(0, MAX_PHONE_ATTEMPTS - updated.failedAttempts);
            return { ok: false, reason: attemptsLeft === 0 ? "locked" : "wrong_phone", attemptsLeft };
        }

        const accessToken = `efa_${randomBytes(32).toString("base64url")}`;
        await this.prismaService.employee_feedback_token.update({
            where: { id: record.id },
            data: { accessTokenHash: this.hash(accessToken), verifiedAt: new Date(), failedAttempts: 0 },
        });
        return { ok: true, accessToken };
    }

    /** Resolve a usable access token to its assignment context, else null. */
    async resolveAccess(accessToken: string): Promise<FeedbackTokenContext | null> {
        const record = await this.prismaService.employee_feedback_token.findUnique({
            where: { accessTokenHash: this.hash(accessToken) },
        });
        if (
            !record ||
            !record.active ||
            record.revokedAt ||
            !record.verifiedAt ||
            record.expiresAt.getTime() < Date.now()
        ) {
            return null;
        }
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
        await (tx ?? this.prismaService).employee_feedback_token.updateMany({
            where: { scheduleId, active: true, revokedAt: null },
            data: { expiresAt: newExpiresAt },
        });
    }

    async extendExpiryForCase(serviceRecordCaseId: string, newExpiresAt: Date, tx?: Prisma.TransactionClient): Promise<void> {
        await (tx ?? this.prismaService).employee_feedback_token.updateMany({
            where: { serviceRecordCaseId, active: true, revokedAt: null },
            data: { expiresAt: newExpiresAt },
        });
    }

    /** Revoke every active token for an assignment (replacement / termination). */
    async revokeForSchedule(scheduleId: number): Promise<void> {
        await this.prismaService.employee_feedback_token.updateMany({
            where: { scheduleId, active: true },
            data: { active: false, revokedAt: new Date() },
        });
    }
}
