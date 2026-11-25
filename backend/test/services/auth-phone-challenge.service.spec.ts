import { BadRequestException, HttpException, Logger } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import crypto = require("crypto");

import {
    AuthPhoneChallengeService,
    PHONE_CHALLENGE_MAX_ATTEMPTS,
    PHONE_CHALLENGE_MAX_PER_10_MIN,
    PHONE_CHALLENGE_MAX_PER_DAY,
    PHONE_CHALLENGE_TTL_MS,
} from "application/services/auth-phone-challenge.service";
import { AligoSmsResponse, IAligoSmsApiPort } from "domain/ports/aligo-sms-api.port";
import {
    AuthPhoneChallengeRow,
    IAuthPhoneChallengeRepository,
} from "domain/repositories/auth-phone-challenge.repository.interface";
import { PrismaService } from "infrastructure/database/prisma.service";
import { SbAuthPhoneChallengeRepository } from "infrastructure/database/repositories/sb.auth-phone-challenge.repository";

const NOW = new Date("2026-11-21T03:00:00Z");
const PHONE = "01000000000";
const TOKEN = "unit-test-challenge-token";
const CODE = "000042";
const hash = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
const expiredDetail = "인증번호가 만료됐어요. 처음부터 다시 시도해 주세요.";

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: Error) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

async function flushDelivery() {
    // deliver awaits the provider and then the invalidation; drain both continuations.
    for (let index = 0; index < 4; index++) await Promise.resolve();
}

function fixture(overrides: Partial<AuthPhoneChallengeRow> = {}): AuthPhoneChallengeRow {
    const id = "b9b24d34-a932-4523-86fd-20e7cbd3c4c2";
    return {
        id, purpose: "kakao_link", tokenHash: hash(TOKEN), phone: PHONE,
        codeHash: hash(`${id}:${CODE}`), attemptCount: 0,
        userId: "9e6007de-2a83-40d6-8eca-92f12aaf4d09", kakaoId: null,
        email: null, passwordHash: null, name: null,
        createdAt: NOW, expiresAt: new Date(NOW.getTime() + PHONE_CHALLENGE_TTL_MS), consumedAt: null,
        ...overrides,
    };
}

const refusal = (detail: string) => ({
    status: 400,
    response: {
        code: "VALIDATION_FAILED",
        errors: [{ pointer: "/code", code: "INVALID_VALUE", detail }],
    },
});

describe("AuthPhoneChallengeService", () => {
    let repository: jest.Mocked<IAuthPhoneChallengeRepository>;
    let sms: jest.Mocked<Pick<IAligoSmsApiPort, "sendSms">>;
    let service: AuthPhoneChallengeService;
    let warn: jest.SpyInstance;
    let log: jest.SpyInstance;
    const realParams = { purpose: "kakao_link" as const, phone: PHONE, targetUserId: fixture().userId };
    const verifyParams = { purpose: "kakao_link" as const, challengeToken: TOKEN, code: CODE };

    beforeEach(() => {
        jest.useFakeTimers().setSystemTime(NOW);
        warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
        log = jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
        repository = {
            deleteCreatedBefore: jest.fn().mockResolvedValue(undefined),
            createWithinLimits: jest.fn().mockResolvedValue("created"),
            findByTokenHash: jest.fn().mockResolvedValue(fixture()),
            registerAttempt: jest.fn().mockResolvedValue(true),
            invalidate: jest.fn().mockResolvedValue(undefined),
            consumeWithinTx: jest.fn().mockResolvedValue(true),
        };
        sms = { sendSms: jest.fn().mockResolvedValue({ result_code: 1, message: "ok" }) };
        service = new AuthPhoneChallengeService(repository, sms);
    });

    afterEach(() => {
        jest.restoreAllMocks();
        jest.useRealTimers();
    });

    it("commits a real challenge before sending and resolves while the SMS remains pending", async () => {
        const send = deferred<AligoSmsResponse>();
        sms.sendSms.mockReturnValue(send.promise);
        const params = { ...realParams, kakaoId: "kakao-unit", email: "qa@example.invalid", passwordHash: "bcrypt-test-hash", name: "QA-unit" };
        const result = await service.issue(params);
        const stored = repository.createWithinLimits.mock.calls[0]![0];
        const message = sms.sendSms.mock.calls[0]![0].message;
        const code = message.match(/\b\d{6}\b/)![0];

        expect(repository.deleteCreatedBefore).toHaveBeenCalledWith(new Date(NOW.getTime() - 86_400_000));
        expect(repository.createWithinLimits).toHaveBeenCalledTimes(1);
        expect(repository.createWithinLimits).toHaveBeenCalledWith({
            id: expect.stringMatching(/^[0-9a-f-]{36}$/),
            purpose: params.purpose, tokenHash: hash(result.challengeToken), phone: PHONE,
            codeHash: hash(`${stored.id}:${code}`), userId: params.targetUserId,
            attemptCount: 0, createdAt: NOW, consumedAt: null,
            kakaoId: params.kakaoId, email: params.email, passwordHash: params.passwordHash, name: params.name,
            expiresAt: new Date(NOW.getTime() + PHONE_CHALLENGE_TTL_MS),
        }, {
            shortWindowStart: new Date(NOW.getTime() - 600_000), shortMax: PHONE_CHALLENGE_MAX_PER_10_MIN,
            dayWindowStart: new Date(NOW.getTime() - 86_400_000), dayMax: PHONE_CHALLENGE_MAX_PER_DAY,
        });
        expect(result).toEqual({ challengeToken: expect.stringMatching(/^[0-9a-f]{64}$/), expiresAt: stored.expiresAt });
        expect(sms.sendSms).toHaveBeenCalledTimes(1);
        expect(sms.sendSms).toHaveBeenCalledWith({ receiver: PHONE, message, msgType: "SMS" });
        expect(repository.deleteCreatedBefore.mock.invocationCallOrder[0]).toBeLessThan(repository.createWithinLimits.mock.invocationCallOrder[0]!);
        expect(repository.createWithinLimits.mock.invocationCallOrder[0]).toBeLessThan(sms.sendSms.mock.invocationCallOrder[0]!);
        expect(repository.invalidate).not.toHaveBeenCalled();
        expect(log).toHaveBeenCalledTimes(1);
        expect(JSON.parse(log.mock.calls[0]![0])).toEqual({ event: "auth_phone_challenge_issued", id: stored.id, purpose: params.purpose, decoy: false });
        expect(JSON.stringify(log.mock.calls)).not.toContain(PHONE);
        expect(JSON.stringify(log.mock.calls)).not.toContain(result.challengeToken);
        send.resolve({ result_code: 1, message: "ok" });
        await flushDelivery();
    });

    it("stores a decoy with the same limits and response shape without generating a code or sending", async () => {
        const random = jest.spyOn(crypto, "randomInt");
        const result = await service.issue({ ...realParams, targetUserId: null,
            kakaoId: "unused-kakao", email: "unused@example.invalid", passwordHash: "unused-hash", name: "Unused" });
        expect(repository.createWithinLimits).toHaveBeenCalledWith(expect.objectContaining({
            codeHash: null, userId: null, tokenHash: hash(result.challengeToken),
        }), expect.objectContaining({ shortMax: 3, dayMax: 10 }));
        const stored = repository.createWithinLimits.mock.calls[0]![0];
        expect(stored.kakaoId).toBeNull();
        expect(stored.email).toBeNull();
        expect(stored.passwordHash).toBeNull();
        expect(stored.name).toBeNull();
        expect(Object.keys(result).sort()).toEqual(["challengeToken", "expiresAt"]);
        expect(random).not.toHaveBeenCalled();
        expect(sms.sendSms).not.toHaveBeenCalled();
        expect(JSON.parse(log.mock.calls[0]![0])).toMatchObject({ decoy: true });
    });

    it.each([true, false])("throws 429 without SMS at the limit (real=%s)", async (real) => {
        repository.createWithinLimits.mockResolvedValue("rate_limited");
        await expect(service.issue({ ...realParams, targetUserId: real ? realParams.targetUserId : null }))
            .rejects.toMatchObject({ status: 429, response: { code: "REQUEST_RATE_LIMITED" } });
        expect(sms.sendSms).not.toHaveBeenCalled();
    });

    it.each(["throws", "refuses"])("invalidates after an already successful issue when the provider %s", async (failure) => {
        const send = deferred<AligoSmsResponse>();
        sms.sendSms.mockReturnValue(send.promise);
        jest.spyOn(crypto, "randomInt").mockImplementation(() => 42);
        const result = await service.issue(realParams);
        expect(result.challengeToken).toHaveLength(64);
        expect(repository.invalidate).not.toHaveBeenCalled();
        const stored = repository.createWithinLimits.mock.calls[0]![0];
        if (failure === "throws") send.reject(new Error(`${PHONE} ${CODE} private provider message`));
        else send.resolve({ result_code: 0, message: `${PHONE} ${CODE} private provider message` });
        await flushDelivery();
        expect(repository.invalidate).toHaveBeenCalledTimes(1);
        expect(repository.invalidate).toHaveBeenCalledWith(stored.id);
        expect(repository.deleteCreatedBefore).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(JSON.parse(warn.mock.calls[0]![0])).toMatchObject({ id: stored.id, resultCode: failure === "throws" ? "thrown" : 0 });
        const warnings = JSON.stringify(warn.mock.calls);
        for (const secret of [PHONE, CODE, result.challengeToken, "private provider message"]) expect(warnings).not.toContain(secret);
    });

    it.each(["throws", "refuses"])("verifies a failed SMS challenge identically to a decoy when the provider %s", async (failure) => {
        const rows = new Map<string, AuthPhoneChallengeRow>();
        repository.createWithinLimits.mockImplementation(async (row) => {
            rows.set(row.id, { ...row });
            return "created";
        });
        repository.findByTokenHash.mockImplementation(async (tokenHash) => {
            const row = [...rows.values()].find((entry) => entry.tokenHash === tokenHash);
            return row ? { ...row } : null;
        });
        repository.registerAttempt.mockImplementation(async (id, maxAttempts) => {
            const row = rows.get(id);
            if (!row || row.consumedAt !== null || row.attemptCount >= maxAttempts) return false;
            row.attemptCount++;
            return true;
        });
        // Exercise the production invalidation write against an in-memory Prisma double.
        const prisma = {
            auth_phone_challenge: {
                updateMany: jest.fn(async ({ where, data }: {
                    where: { id: string; consumedAt: null };
                    data: Partial<AuthPhoneChallengeRow>;
                }) => {
                    const row = rows.get(where.id);
                    if (!row || row.consumedAt !== where.consumedAt) return { count: 0 };
                    Object.assign(row, data);
                    return { count: 1 };
                }),
            },
        };
        const persistedRepository = new SbAuthPhoneChallengeRepository(prisma as unknown as PrismaService);
        repository.invalidate.mockImplementation((id) => persistedRepository.invalidate(id));
        const send = deferred<AligoSmsResponse>();
        sms.sendSms.mockReturnValue(send.promise);
        jest.spyOn(crypto, "randomInt").mockImplementation(() => 42);

        const real = await service.issue(realParams);
        const decoy = await service.issue({ ...realParams, targetUserId: null });
        if (failure === "throws") send.reject(new Error("provider timeout"));
        else send.resolve({ result_code: 0, message: "refused" });
        await flushDelivery();
        expect(repository.invalidate).toHaveBeenCalledTimes(1);

        const compare = jest.spyOn(crypto, "timingSafeEqual");
        for (let attempt = 0; attempt < PHONE_CHALLENGE_MAX_ATTEMPTS; attempt++) {
            for (const { challengeToken } of [real, decoy]) {
                await expect(service.verify({ ...verifyParams, challengeToken }))
                    .rejects.toMatchObject(refusal("인증번호가 올바르지 않아요."));
            }
        }
        expect(compare).toHaveBeenCalledTimes(2 * PHONE_CHALLENGE_MAX_ATTEMPTS);
        expect(compare).toHaveBeenCalledWith(expect.any(Buffer), Buffer.alloc(32));
        for (const { challengeToken } of [real, decoy]) {
            await expect(service.verify({ ...verifyParams, challengeToken }))
                .rejects.toMatchObject(refusal("인증번호 입력 횟수를 초과했어요. 처음부터 다시 시도해 주세요."));
        }
        expect(compare).toHaveBeenCalledTimes(2 * PHONE_CHALLENGE_MAX_ATTEMPTS);
        expect(rows.size).toBe(2);
        for (const row of rows.values()) {
            expect(row).toMatchObject({ codeHash: null, consumedAt: null, attemptCount: PHONE_CHALLENGE_MAX_ATTEMPTS });
        }
        jest.setSystemTime(real.expiresAt);
        for (const { challengeToken } of [real, decoy]) {
            await expect(service.verify({ ...verifyParams, challengeToken })).rejects.toMatchObject(refusal(expiredDetail));
        }
    });

    it("contains a synchronous send error and a rejected invalidation without an unhandled rejection", async () => {
        sms.sendSms.mockImplementation(() => { throw new Error("private provider error"); });
        repository.invalidate.mockRejectedValue(new Error("private database error"));
        await expect(service.issue(realParams)).resolves.toHaveProperty("challengeToken");
        await flushDelivery();
        expect(warn).toHaveBeenCalledTimes(1);
        expect(JSON.parse(warn.mock.calls[0]![0])).toMatchObject({ resultCode: "thrown", invalidationFailed: true });
        expect(JSON.stringify(warn.mock.calls)).not.toContain("private");
    });

    it("ignores and safely logs cleanup failures", async () => {
        repository.deleteCreatedBefore.mockRejectedValue(new Error(`${PHONE} private cleanup error`));
        await expect(service.issue(realParams)).resolves.toHaveProperty("challengeToken");
        expect(repository.createWithinLimits).toHaveBeenCalledTimes(1);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(warn.mock.calls)).not.toContain(PHONE);
        expect(JSON.stringify(warn.mock.calls)).not.toContain("private");
    });

    it.each(["", "1012345678", "010-0000-0000", "010000000", "010000000000", "01000000000\n"])("rejects a non-normalized phone %j before storage", async (phone) => {
        const error = await service.issue({ ...realParams, phone }).catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(Error);
        expect(error).not.toBeInstanceOf(HttpException);
        expect(repository.deleteCreatedBefore).not.toHaveBeenCalled();
        expect(repository.createWithinLimits).not.toHaveBeenCalled();
        expect(sms.sendSms).not.toHaveBeenCalled();
    });

    it.each(["0212345678", "01000000000"])("accepts a normalized phone with 10 or 11 digits (%s)", async (phone) => {
        await expect(service.issue({ ...realParams, phone, targetUserId: null })).resolves.toHaveProperty("challengeToken");
    });

    it("pads a random value of 42 to six digits and keeps the branded SMS within 90 EUC-KR bytes", async () => {
        const random = jest.spyOn(crypto, "randomInt").mockImplementation(() => 42);
        await service.issue(realParams);
        expect(random).toHaveBeenCalledWith(0, 1_000_000);
        const message = sms.sendSms.mock.calls[0]![0].message;
        expect(message).toBe(`[아가잼잼 어드민] 계정 연결 인증번호 ${CODE} 입니다. 다른 사람에게 알려주지 마세요.`);
        // This message uses only ASCII and Hangul syllables, each Hangul syllable is two EUC-KR bytes.
        expect([...message].every((character) => /^[\x00-\x7f가-힣]$/.test(character))).toBe(true);
        const bytes = [...message].reduce((total, character) => total + (character.charCodeAt(0) <= 0x7f ? 1 : 2), 0);
        expect(bytes).toBe(82);
        expect(bytes).toBeLessThanOrEqual(90);
        const stored = repository.createWithinLimits.mock.calls[0]![0];
        expect(stored.codeHash).toBe(hash(`${stored.id}:${CODE}`));
    });

    it("returns the right-code row without consuming it and registers the attempt before comparing", async () => {
        const compare = jest.spyOn(crypto, "timingSafeEqual");
        const row = await service.verify(verifyParams);
        expect(row).toEqual(fixture());
        expect(repository.findByTokenHash).toHaveBeenCalledWith(hash(TOKEN));
        expect(repository.registerAttempt).toHaveBeenCalledWith(row.id, PHONE_CHALLENGE_MAX_ATTEMPTS);
        expect(compare).toHaveBeenCalledTimes(1);
        expect(repository.registerAttempt.mock.invocationCallOrder[0]).toBeLessThan(compare.mock.invocationCallOrder[0]!);
        expect(repository.consumeWithinTx).not.toHaveBeenCalled();
    });

    it("counts a wrong code before refusing it", async () => {
        await expect(service.verify({ ...verifyParams, code: "123456" })).rejects.toMatchObject(refusal("인증번호가 올바르지 않아요."));
        expect(repository.registerAttempt).toHaveBeenCalledWith(fixture().id, 5);
    });

    it.each([
        ["expired", fixture({ expiresAt: new Date(NOW.getTime() - 1) })],
        ["at expiry", fixture({ expiresAt: NOW })],
        ["consumed", fixture({ consumedAt: NOW })],
        ["unknown token", null],
        ["wrong purpose", fixture({ purpose: "email_link" })],
    ])("refuses an %s challenge before registering an attempt", async (_label, row) => {
        repository.findByTokenHash.mockResolvedValue(row);
        await expect(service.verify(verifyParams)).rejects.toMatchObject(refusal(expiredDetail));
        expect(repository.registerAttempt).not.toHaveBeenCalled();
    });

    it("refuses exhausted attempts without comparing, even with the right code", async () => {
        const compare = jest.spyOn(crypto, "timingSafeEqual");
        repository.registerAttempt.mockResolvedValue(false);
        await expect(service.verify(verifyParams)).rejects.toMatchObject(refusal("인증번호 입력 횟수를 초과했어요. 처음부터 다시 시도해 주세요."));
        expect(compare).not.toHaveBeenCalled();
    });

    it("counts the fifth wrong attempt and refuses the sixth even with the right code", async () => {
        repository.registerAttempt.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
        repository.findByTokenHash.mockResolvedValue(fixture({ attemptCount: 4 }));
        await expect(service.verify({ ...verifyParams, code: "123456" })).rejects.toMatchObject(refusal("인증번호가 올바르지 않아요."));
        await expect(service.verify(verifyParams)).rejects.toMatchObject(refusal("인증번호 입력 횟수를 초과했어요. 처음부터 다시 시도해 주세요."));
        expect(repository.registerAttempt).toHaveBeenCalledTimes(2);
    });

    it("does equal-length timing-safe work for a decoy and never matches it", async () => {
        repository.findByTokenHash.mockResolvedValue(fixture({ codeHash: null, userId: null }));
        // Even a hypothetical dummy hash match must never authenticate a decoy.
        const compare = jest.spyOn(crypto, "timingSafeEqual").mockReturnValue(true);
        await expect(service.verify(verifyParams)).rejects.toMatchObject(refusal("인증번호가 올바르지 않아요."));
        expect(repository.registerAttempt).toHaveBeenCalledWith(fixture().id, 5);
        expect(compare).toHaveBeenCalledWith(expect.any(Buffer), Buffer.alloc(32));
        expect(compare.mock.calls[0]![0].byteLength).toBe(32);
        expect(repository.registerAttempt.mock.invocationCallOrder[0]).toBeLessThan(compare.mock.invocationCallOrder[0]!);
    });

    it("refuses a malformed stored hash without timingSafeEqual throwing", async () => {
        repository.findByTokenHash.mockResolvedValue(fixture({ codeHash: "ab" }));
        await expect(service.verify(verifyParams)).rejects.toBeInstanceOf(BadRequestException);
    });

    it.each([true, false])("passes the caller transaction to consumption (consumed=%s)", async (consumed) => {
        const tx = {} as Prisma.TransactionClient;
        repository.consumeWithinTx.mockResolvedValue(consumed);
        const result = service.consume(tx, fixture().id);
        if (consumed) await expect(result).resolves.toBeUndefined();
        else await expect(result).rejects.toMatchObject(refusal(expiredDetail));
        expect(repository.consumeWithinTx).toHaveBeenCalledWith(tx, fixture().id);
    });
});
