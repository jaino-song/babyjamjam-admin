import { BadRequestException, HttpException, Inject, Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from "crypto";

import { ALIGO_SMS_API_PORT, IAligoSmsApiPort } from "domain/ports/aligo-sms-api.port";
import {
    AUTH_PHONE_CHALLENGE_REPOSITORY,
    AuthPhoneChallengeRow,
    IAuthPhoneChallengeRepository,
} from "domain/repositories/auth-phone-challenge.repository.interface";
import { codeOnlyProblemBody, problemBody } from "../utils/problem-bodies";

export const PHONE_CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const PHONE_CHALLENGE_MAX_ATTEMPTS = 5;
export const PHONE_CHALLENGE_MAX_PER_10_MIN = 3;
export const PHONE_CHALLENGE_MAX_PER_DAY = 10;

const TEN_MINUTES_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DUMMY_CODE_HASH = Buffer.alloc(32);
const EXPIRED_DETAIL = "인증번호가 만료됐어요. 처음부터 다시 시도해 주세요.";
type PhoneChallengePurpose = "kakao_link" | "email_link";

@Injectable()
export class AuthPhoneChallengeService {
    private readonly logger = new Logger(AuthPhoneChallengeService.name);

    constructor(
        @Inject(AUTH_PHONE_CHALLENGE_REPOSITORY)
        private readonly repository: IAuthPhoneChallengeRepository,
        @Inject(ALIGO_SMS_API_PORT)
        private readonly sms: IAligoSmsApiPort,
    ) {}

    async issue(params: {
        purpose: PhoneChallengePurpose;
        phone: string;
        targetUserId: string | null;
        kakaoId?: string;
        email?: string;
        passwordHash?: string;
        name?: string;
    }): Promise<{ challengeToken: string; expiresAt: Date }> {
        if (!/^0\d{9,10}$/.test(params.phone)) {
            throw new Error("Phone challenge requires a normalized phone number");
        }
        const now = new Date();
        try {
            await this.repository.deleteCreatedBefore(new Date(now.getTime() - DAY_MS));
        } catch {
            this.logger.warn(JSON.stringify({ event: "auth_phone_challenge_cleanup_failed" }));
        }
        const id = randomUUID();
        const challengeToken = randomBytes(32).toString("hex");
        const code = params.targetUserId !== null ? randomInt(0, 1_000_000).toString().padStart(6, "0") : null;
        const expiresAt = new Date(now.getTime() + PHONE_CHALLENGE_TTL_MS);
        const result = await this.repository.createWithinLimits({
            id,
            purpose: params.purpose,
            tokenHash: this.hash(challengeToken),
            phone: params.phone,
            codeHash: code === null ? null : this.hash(`${id}:${code}`),
            attemptCount: 0,
            userId: params.targetUserId,
            kakaoId: params.targetUserId === null ? null : params.kakaoId ?? null,
            email: params.targetUserId === null ? null : params.email ?? null,
            passwordHash: params.targetUserId === null ? null : params.passwordHash ?? null,
            name: params.targetUserId === null ? null : params.name ?? null,
            expiresAt,
            createdAt: now,
            consumedAt: null,
        }, {
            shortWindowStart: new Date(now.getTime() - TEN_MINUTES_MS),
            shortMax: PHONE_CHALLENGE_MAX_PER_10_MIN,
            dayWindowStart: new Date(now.getTime() - DAY_MS),
            dayMax: PHONE_CHALLENGE_MAX_PER_DAY,
        });
        if (result === "rate_limited") {
            throw new HttpException(codeOnlyProblemBody("REQUEST_RATE_LIMITED"), 429);
        }
        if (code !== null) {
            void this.deliver(id, params.phone, code);
        }
        this.logger.log(JSON.stringify({ event: "auth_phone_challenge_issued", id, purpose: params.purpose, decoy: code === null }));
        return { challengeToken, expiresAt };
    }

    async verify(params: {
        purpose: PhoneChallengePurpose;
        challengeToken: string;
        code: string;
    }): Promise<AuthPhoneChallengeRow> {
        const row = await this.repository.findByTokenHash(this.hash(params.challengeToken));
        if (!row || row.purpose !== params.purpose || row.consumedAt || row.expiresAt.getTime() <= Date.now()) {
            throw this.refusal(EXPIRED_DETAIL);
        }
        if (!await this.repository.registerAttempt(row.id, PHONE_CHALLENGE_MAX_ATTEMPTS)) {
            throw this.refusal("인증번호 입력 횟수를 초과했어요. 처음부터 다시 시도해 주세요.");
        }
        const actual = Buffer.from(this.hash(`${row.id}:${params.code}`), "hex");
        const expected = row.codeHash === null ? DUMMY_CODE_HASH : Buffer.from(row.codeHash, "hex");
        const matches = actual.length === expected.length && timingSafeEqual(actual, expected);
        if (!matches || row.codeHash === null) {
            throw this.refusal("인증번호가 올바르지 않아요.");
        }
        return row;
    }

    async consume(tx: Prisma.TransactionClient, id: string): Promise<void> {
        if (!await this.repository.consumeWithinTx(tx, id)) {
            throw this.refusal(EXPIRED_DETAIL);
        }
    }

    private async deliver(id: string, phone: string, code: string): Promise<void> {
        let resultCode: number | "thrown" = "thrown";
        try {
            const result = await this.sms.sendSms({
                receiver: phone,
                message: `[아가잼잼 어드민] 계정 연결 인증번호 ${code} 입니다. 다른 사람에게 알려주지 마세요.`,
                msgType: "SMS",
            });
            resultCode = result.result_code;
            if (resultCode === 1) return;
        } catch {
            // A timeout may follow delivery, so retain the row for rate limiting.
        }
        let invalidationFailed = false;
        try {
            await this.repository.invalidate(id);
        } catch {
            // Never leak a rejected background promise or database/provider error text.
            invalidationFailed = true;
        }
        this.logger.warn(JSON.stringify({ event: "auth_phone_challenge_delivery_failed", id, resultCode, invalidationFailed }));
    }

    private hash(value: string): string {
        return createHash("sha256").update(value).digest("hex");
    }

    private refusal(detail: string): BadRequestException {
        return new BadRequestException(problemBody("VALIDATION_FAILED", { pointer: "/code", code: "INVALID_VALUE", detail }));
    }
}
