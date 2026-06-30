import { Injectable, Logger } from "@nestjs/common";
import { createHash, randomBytes } from "crypto";
import { PrismaService } from "infrastructure/database/prisma.service";

/** Resolved context attached to a request after the access token is validated. */
export interface FeedbackTokenContext {
    tokenId: string;
    branchId: string;
    scheduleId: number;
    employeeId: number;
}

export type VerifyDobResult =
    | { ok: true; accessToken: string }
    | { ok: false; reason: "invalid_token" | "wrong_dob" | "locked"; attemptsLeft?: number };

/** Max DOB attempts before the link is locked (staff must re-issue). */
export const MAX_DOB_ATTEMPTS = 5;

/**
 * No-login per-assignment feedback access (BJJ-247).
 * Two secrets per token row:
 *   - link token: carried in the SMS URL (possession). Only reaches the DOB challenge.
 *   - access token: minted after a correct DOB (knowledge). Grants the feedback endpoints
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

    /** Strip everything but digits so "90-01-01" and "900101" compare equal. */
    private normalizeDob(dob: string): string {
        return (dob ?? "").replace(/\D/g, "");
    }

    /**
     * Issue a fresh link for an assignment, revoking any prior active token for the schedule
     * (so a replaced provider's old link stops working). Returns the plaintext link token once.
     */
    async issueLink(params: {
        branchId: string;
        scheduleId: number;
        employeeId: number;
        expectedDob: string;
        expiresAt: Date;
    }): Promise<{ linkToken: string }> {
        await this.revokeForSchedule(params.scheduleId);

        const linkToken = `efl_${randomBytes(32).toString("base64url")}`;
        await this.prismaService.employee_feedback_token.create({
            data: {
                branchId: params.branchId,
                scheduleId: params.scheduleId,
                employeeId: params.employeeId,
                linkTokenHash: this.hash(linkToken),
                expectedDobHash: this.hash(this.normalizeDob(params.expectedDob)),
                expiresAt: params.expiresAt,
            },
        });
        return { linkToken };
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
     * Verify a DOB against the link token. On success mint + persist a new access token.
     * On failure increment attempts and lock after MAX_DOB_ATTEMPTS.
     */
    async verifyDobAndMintAccess(linkToken: string, dob: string): Promise<VerifyDobResult> {
        const record = await this.resolveLink(linkToken);
        if (!record) return { ok: false, reason: "invalid_token" };
        if (record.failedAttempts >= MAX_DOB_ATTEMPTS) return { ok: false, reason: "locked" };

        if (this.hash(this.normalizeDob(dob)) !== record.expectedDobHash) {
            const updated = await this.prismaService.employee_feedback_token.update({
                where: { id: record.id },
                data: { failedAttempts: { increment: 1 } },
            });
            const attemptsLeft = Math.max(0, MAX_DOB_ATTEMPTS - updated.failedAttempts);
            return { ok: false, reason: attemptsLeft === 0 ? "locked" : "wrong_dob", attemptsLeft };
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
        };
    }

    /** Revoke every active token for an assignment (replacement / termination). */
    async revokeForSchedule(scheduleId: number): Promise<void> {
        await this.prismaService.employee_feedback_token.updateMany({
            where: { scheduleId, active: true },
            data: { active: false, revokedAt: new Date() },
        });
    }
}
