import { BadRequestException, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { AuthService } from "application/services/auth.service";
import { AuthPhoneChallengeService } from "application/services/auth-phone-challenge.service";
import { PrismaService } from "infrastructure/database/prisma.service";
import { JwtService } from "@nestjs/jwt";
import { EmailPort } from "domain/ports/email.port";
import { IAuthTokenRepository } from "domain/repositories/auth-token.repository.interface";
import { AuthSessionService } from "application/services/auth-session.service";

const phone = "01012345678";
const birthDate = "1990-01-01";
const token = "a".repeat(64);
const refusal = { status: 400, response: { code: "VALIDATION_FAILED", errors: [{ pointer: "/code", code: "INVALID_VALUE", detail: "계정을 연결할 수 없어요. 처음부터 다시 시도해 주세요." }] } };
const holder = () => ({ id: "user", phone: "010-1234-5678", birthDate, kakaoId: null as string | null,
    passwordHash: "old-hash" as string | null, authProvider: "email", approvalStatus: "approved", role: null as string | null,
    email: "old@example.invalid", emailVerified: false, emailVerifiedAt: null as Date | null,
    name: "Stored" as string | null, profileImage: null as string | null });
const pending = () => ({ id: "pending", kind: "pending_kakao_signup", kakaoId: "new-kakao", profileImage: "image",
    expiresAt: new Date(Date.now() + 60000), consumedAt: null as Date | null });
const delegates = () => ({ user: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null),
    findUnique: jest.fn(), create: jest.fn().mockResolvedValue({ id: "created", email: "new@example.invalid" }),
    update: jest.fn(), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    auth_flow_state: { findUnique: jest.fn().mockResolvedValue(pending()), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    auth_token: { deleteMany: jest.fn(), create: jest.fn() }, auth_email_outbox: { create: jest.fn() } });

describe("SMS account linking", () => {
    let tx: ReturnType<typeof delegates>;
    let prisma: ReturnType<typeof delegates> & { $transaction: jest.Mock };
    let challenge: { issue: jest.Mock; verify: jest.Mock; consume: jest.Mock };
    let service: AuthService;
    let user: ReturnType<typeof holder>;
    let stored: ReturnType<typeof pending>;
    let challengeConsumed: boolean;
    let log: jest.SpyInstance;
    let row: { id: string; userId: string | null; kakaoId: string | null; phone: string; email: string | null; passwordHash: string | null; name: string };
    beforeEach(() => {
        log = jest.spyOn(Logger.prototype, "log").mockImplementation(() => undefined);
        tx = delegates();
        prisma = { ...delegates(), $transaction: jest.fn() };
        user = holder();
        stored = pending();
        challengeConsumed = false;
        row = { id: "challenge", userId: "user", kakaoId: "new-kakao", phone, email: "new@example.invalid", passwordHash: "new-hash", name: "New" };
        tx.user.findUnique.mockImplementation(async () => ({ ...user }));
        tx.user.updateMany.mockImplementation(async ({ data }) => {
            Object.assign(user, data);
            return { count: 1 };
        });
        prisma.auth_flow_state.findUnique.mockImplementation(async () => ({ ...stored }));
        tx.auth_flow_state.findUnique.mockImplementation(async () => ({ ...stored }));
        tx.auth_flow_state.updateMany.mockImplementation(async () => {
            if (stored.consumedAt) return { count: 0 };
            stored.consumedAt = new Date();
            return { count: 1 };
        });
        challenge = {
            issue: jest.fn().mockResolvedValue({ challengeToken: token }),
            verify: jest.fn().mockImplementation(async () => row),
            consume: jest.fn(async () => {
                if (challengeConsumed) throw new BadRequestException(refusal.response);
                challengeConsumed = true;
            }),
        };
        // Model rollback to test retries and durable account state. A distinct
        // client and tx-only assertions establish the production boundary.
        prisma.$transaction.mockImplementation(async callback => {
            const before = { ...user };
            const pendingConsumedAt = stored.consumedAt;
            const consumed = challengeConsumed;
            try {
                return await callback(tx);
            } catch (error) {
                Object.assign(user, before);
                stored.consumedAt = pendingConsumedAt;
                challengeConsumed = consumed;
                throw error;
            }
        });
        service = new AuthService(prisma as unknown as PrismaService, {} as JwtService, {} as EmailPort,
            {} as IAuthTokenRepository, {} as AuthSessionService, undefined, challenge as unknown as AuthPhoneChallengeService);
        jest.spyOn(service, "hashPassword").mockResolvedValue("new-hash");
    });
    afterEach(() => jest.restoreAllMocks());
    const startKakao = (s: AuthService) => s.completeKakaoOnboarding("pending-token", phone, birthDate, "user");
    const startEmail = (s: AuthService) => s.registerWithEmail("New@example.invalid", "Password1!", "New", phone, birthDate);

    function expectTransactionOnlyAccountAccess() {
        for (const method of Object.values(prisma.user)) expect(method).not.toHaveBeenCalled();
        for (const method of Object.values(prisma.auth_token)) expect(method).not.toHaveBeenCalled();
        expect(prisma.auth_email_outbox.create).not.toHaveBeenCalled();
        expect(prisma.auth_flow_state.updateMany).not.toHaveBeenCalled();
    }

    it("creates a Kakao account and consumes the token when there is no holder", async () => {
        await expect(startKakao(service)).resolves.toMatchObject({ userId: "created" });
        expect(tx.auth_flow_state.updateMany).toHaveBeenCalledTimes(1);
        expect(tx.user.create).toHaveBeenCalledTimes(1);
        expect(challenge.issue).not.toHaveBeenCalled();
    });
    it.each(["kakao", "two", "existingKakaoRow"])("refuses conflicting Kakao holder %s before consuming", async reason => {
        tx.user.findMany.mockResolvedValue(reason === "two" ? [user, { ...user, id: "second" }] : [{ ...user, kakaoId: reason === "kakao" ? "taken" : null }]);
        if (reason === "existingKakaoRow") tx.user.findFirst.mockResolvedValue({ id: "own" });
        await expect(startKakao(service)).rejects.toMatchObject({ status: 400, response: { errors: [{ pointer: "/phone" }] } });
        expect(tx.auth_flow_state.updateMany).not.toHaveBeenCalled();
    });
    it.each(["match", "birth", "rejected", "owner"])("issues Kakao challenge with identical response: %s", async reason => {
        if (reason === "birth") user.birthDate = "1991-01-01";
        if (reason === "rejected") user.approvalStatus = "rejected";
        if (reason === "owner") user.role = "owner";
        tx.user.findMany.mockResolvedValue([user]);
        await expect(startKakao(service)).resolves.toEqual({ success: true, linkVerificationRequired: true, linkChallengeToken: token,
            message: "입력하신 정보와 일치하는 기존 계정이 있으면 문자로 인증번호를 보내드려요." });
        expect(challenge.issue).toHaveBeenCalledWith({ purpose: "kakao_link", phone, kakaoId: "new-kakao", targetUserId: reason === "match" ? "user" : null });
        expect(tx.user.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { phone: { in: [phone, user.phone] } } }));
        expect(tx.auth_flow_state.updateMany).not.toHaveBeenCalled();
        expect(tx.user.create).not.toHaveBeenCalled();
    });
    it("links Kakao with exactly three fields on the distinct transaction", async () => {
        const before = { ...user };
        await expect(service.verifyKakaoLink("pending-token", token, "123456")).resolves.toMatchObject({ linked: true });
        expect(tx.user.findFirst).toHaveBeenCalledTimes(1);
        expect(tx.user.findFirst).toHaveBeenCalledWith({ where: { kakaoId: row.kakaoId }, select: { id: true } });
        expect(challenge.verify).toHaveBeenCalledWith({ purpose: "kakao_link", challengeToken: token, code: "123456" });
        expect(challenge.consume).toHaveBeenCalledWith(tx, "challenge");
        expect(tx.auth_flow_state.updateMany).toHaveBeenCalledTimes(1);
        expect(tx.user.updateMany).toHaveBeenCalledWith({ where: { id: "user", kakaoId: null, phone: { in: [phone, user.phone] },
            approvalStatus: { not: "rejected" }, OR: [{ role: null }, { role: { not: "owner" } }] },
        data: { kakaoId: "new-kakao", authProvider: "both", profileImage: "image" } });
        expect(prisma.user.updateMany).not.toHaveBeenCalled();
        expect(prisma.auth_flow_state.updateMany).not.toHaveBeenCalled();
        expect(user).toEqual({ ...before, kakaoId: "new-kakao", authProvider: "both", profileImage: "image" });
        expect(challengeConsumed).toBe(true);
        expect(stored.consumedAt).toBeInstanceOf(Date);
        expect(tx.auth_flow_state.updateMany).toHaveBeenCalledWith({
            where: { id: stored.id, kind: "pending_kakao_signup", consumedAt: null, expiresAt: { gt: expect.any(Date) } },
            data: { consumedAt: expect.any(Date) },
        });
        expect(log).toHaveBeenCalledTimes(1);
        expect(JSON.parse(log.mock.calls[0]![0])).toEqual({ event: "auth_account_linked", userId: "user", method: "kakao" });
        expectTransactionOnlyAccountAccess();
    });
    it.each(["decoy", "mismatch", "gainedKakao", "phone", "rejected", "owner", "taken", "missing", "cas", "unique"])("refuses Kakao recheck %s", async reason => {
        if (reason === "decoy") row.userId = null;
        if (reason === "mismatch") row.kakaoId = "other";
        if (reason === "gainedKakao") user.kakaoId = "other";
        if (reason === "phone") user.phone = "01099999999";
        if (reason === "rejected") user.approvalStatus = "rejected";
        if (reason === "owner") user.role = "owner";
        if (reason === "taken") tx.user.findFirst.mockResolvedValue({ id: "other" });
        if (reason === "missing") tx.user.findUnique.mockResolvedValue(null);
        if (reason === "cas") tx.user.updateMany.mockResolvedValue({ count: 0 });
        if (reason === "unique") tx.user.updateMany.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("duplicate", { code: "P2002", clientVersion: "test" }));
        const before = { ...user };
        await expect(service.verifyKakaoLink("pending-token", token, "123456")).rejects.toMatchObject(refusal);
        if (reason === "taken") {
            expect(tx.user.findFirst).toHaveBeenCalledTimes(1);
            expect(tx.user.findFirst).toHaveBeenCalledWith({ where: { kakaoId: row.kakaoId }, select: { id: true } });
        }
        expect(user).toEqual(before);
        expect(challengeConsumed).toBe(false);
        expect(stored.consumedAt).toBeNull();
        expect(log).not.toHaveBeenCalled();
        if (!["cas", "unique"].includes(reason)) expect(tx.user.updateMany).not.toHaveBeenCalled();
    });
    it.each(["invalid", "consumed", "expired", "wrongKind", "cas"])("rejects pending signup %s with 401", async reason => {
        if (reason === "invalid") prisma.auth_flow_state.findUnique.mockResolvedValue(null);
        if (reason === "consumed") prisma.auth_flow_state.findUnique.mockResolvedValue({ ...pending(), consumedAt: new Date() });
        if (reason === "expired") prisma.auth_flow_state.findUnique.mockResolvedValue({ ...pending(), expiresAt: new Date(0) });
        if (reason === "wrongKind") prisma.auth_flow_state.findUnique.mockResolvedValue({ ...pending(), kind: "auth_code" });
        if (reason === "cas") tx.auth_flow_state.updateMany.mockResolvedValue({ count: 0 });
        await expect(service.verifyKakaoLink("invalid", token, "123456")).rejects.toMatchObject({ status: 401 });
        expect(tx.user.updateMany).not.toHaveBeenCalled();
        expect(challengeConsumed).toBe(false);
        if (reason !== "cas") expect(challenge.verify).not.toHaveBeenCalled();
    });
    it.each([false, true])("returns generic success for another email holder, including when a candidate exists (%s)", async hasCandidate => {
        prisma.user.findUnique.mockResolvedValue({ id: "other" });
        if (hasCandidate) prisma.user.findMany.mockResolvedValue([{ ...user, kakaoId: "kakao", passwordHash: null }]);
        await expect(startEmail(service)).resolves.toEqual({ success: true, message: "인증 이메일이 발송되었습니다. 이메일을 확인해주세요." });
        expect(challenge.issue).not.toHaveBeenCalled();
        expect(service.hashPassword).not.toHaveBeenCalled();
        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(tx.user.create).not.toHaveBeenCalled();
    });
    it.each(["match", "birth", "rejected", "owner", "ownEmail"])("issues email challenge and hashes even for decoy %s", async reason => {
        user.kakaoId = "kakao"; user.passwordHash = null;
        if (reason === "birth") user.birthDate = "1991-01-01";
        if (reason === "rejected") user.approvalStatus = "rejected";
        if (reason === "owner") user.role = "owner";
        if (reason === "ownEmail") {
            user.email = "new@example.invalid";
            prisma.user.findUnique.mockResolvedValue(user);
        }
        prisma.user.findMany.mockResolvedValue([user]);
        await expect(startEmail(service)).resolves.toEqual({ success: true, linkVerificationRequired: true,
            linkChallengeToken: token, message: "입력하신 정보와 일치하는 기존 계정이 있으면 문자로 인증번호를 보내드려요." });
        expect(service.hashPassword).toHaveBeenCalledWith("Password1!");
        expect(challenge.issue).toHaveBeenCalledWith({ purpose: "email_link", phone, email: "new@example.invalid", passwordHash: "new-hash", name: "New",
            targetUserId: ["match", "ownEmail"].includes(reason) ? "user" : null });
        expect(tx.user.create).not.toHaveBeenCalled();
    });
    it.each(["password", "two", "noKakao"])("refuses email phone holder %s", async reason => {
        user.kakaoId = reason === "noKakao" ? null : "kakao";
        user.passwordHash = reason === "password" ? "existing-hash" : null;
        prisma.user.findMany.mockResolvedValue(reason === "two" ? [user, { ...user, id: "second" }] : [user]);
        await expect(startEmail(service)).rejects.toMatchObject({ status: 400, response: { errors: [{ pointer: "/phone", code: "INVALID_VALUE" }] } });
        expect(challenge.issue).not.toHaveBeenCalled();
    });
    it("creates email account as before when no holder", async () => {
        await expect(startEmail(service)).resolves.toMatchObject({ userId: "created" });
        expect(tx.user.create).toHaveBeenCalledTimes(1);
        expect(tx.auth_token.create).toHaveBeenCalledTimes(1);
        expect(tx.auth_email_outbox.create).toHaveBeenCalledTimes(1);
    });
    it.each([
        { method: "kakao", decoy: false },
        { method: "kakao", decoy: true },
        { method: "email", decoy: false },
        { method: "email", decoy: true },
    ])("normalizes hyphenated phone input before issuing $method challenge (decoy=$decoy)", async ({ method, decoy }) => {
        user.phone = phone;
        if (decoy) user.birthDate = "1991-01-01";
        if (method === "email") { user.kakaoId = "kakao"; user.passwordHash = null; }
        const lookup = method === "kakao" ? tx.user.findMany : prisma.user.findMany;
        lookup.mockResolvedValue([user]);
        const result = method === "kakao"
            ? await service.completeKakaoOnboarding("pending-token", "010-1234-5678", birthDate, "user")
            : await service.registerWithEmail("New@example.invalid", "Password1!", "New", "010-1234-5678", birthDate);
        expect(result).toEqual({ success: true, linkVerificationRequired: true, linkChallengeToken: token,
            message: "입력하신 정보와 일치하는 기존 계정이 있으면 문자로 인증번호를 보내드려요." });
        expect(lookup).toHaveBeenCalledWith(expect.objectContaining({ where: { phone: { in: [phone, "010-1234-5678"] } } }));
        expect(challenge.issue).toHaveBeenCalledTimes(1);
        expect(challenge.issue).toHaveBeenCalledWith({
            purpose: method === "kakao" ? "kakao_link" : "email_link", phone, targetUserId: decoy ? null : user.id,
            ...(method === "kakao" ? { kakaoId: stored.kakaoId }
                : { email: "new@example.invalid", passwordHash: "new-hash", name: "New" }),
        });
        if (method === "email") expect(service.hashPassword).toHaveBeenCalledWith("Password1!");
        expect(tx.auth_flow_state.updateMany).not.toHaveBeenCalled();
        expect(tx.user.create).not.toHaveBeenCalled();
        expect(tx.user.updateMany).not.toHaveBeenCalled();
    });
    it.each([false, true])("links email (already verified=%s)", async verified => {
        user.kakaoId = "kakao"; user.passwordHash = null; user.emailVerified = verified;
        if (verified) user.email = "NEW@example.invalid";
        const result = await service.verifyEmailLink(token, "123456");
        expect(tx.user.findFirst).toHaveBeenCalledTimes(1);
        expect(tx.user.findFirst).toHaveBeenCalledWith({ where: { email: row.email, id: { not: user.id } }, select: { id: true } });
        expect(challenge.verify).toHaveBeenCalledWith({ purpose: "email_link", challengeToken: token, code: "123456" });
        expect(result).toMatchObject({ linked: true, code: "ACCOUNTS_LINKED", emailVerificationRequired: !verified });
        expect(challenge.consume).toHaveBeenCalledWith(tx, "challenge");
        expect(tx.user.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: {
            email: row.email, passwordHash: row.passwordHash, authProvider: "both", name: "Stored",
            ...(!verified ? { emailVerified: false, emailVerifiedAt: null } : {}) } }));
        expect(tx.user.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: {
            id: user.id, passwordHash: null, kakaoId: { not: null }, phone: { in: [phone, user.phone] },
            approvalStatus: { not: "rejected" }, OR: [{ role: null }, { role: { not: "owner" } }],
        } }));
        expect(tx.auth_token.deleteMany).toHaveBeenCalledTimes(verified ? 0 : 1);
        expect(tx.auth_token.create).toHaveBeenCalledTimes(verified ? 0 : 1);
        expect(tx.auth_email_outbox.create).toHaveBeenCalledTimes(verified ? 0 : 1);
        if (!verified) {
            expect(tx.auth_token.deleteMany).toHaveBeenCalledWith({ where: { userId: "user", type: "email_verification" } });
            expect(tx.auth_token.create.mock.invocationCallOrder[0]).toBeGreaterThan(tx.auth_token.deleteMany.mock.invocationCallOrder[0]!);
            expect(tx.auth_email_outbox.create.mock.invocationCallOrder[0]).toBeGreaterThan(tx.auth_token.create.mock.invocationCallOrder[0]!);
        }
        expect(prisma.auth_token.create).not.toHaveBeenCalled();
        expect(challengeConsumed).toBe(true);
        expect(log).toHaveBeenCalledTimes(1);
        expect(JSON.parse(log.mock.calls[0]![0])).toEqual({ event: "auth_account_linked", userId: "user", method: "email" });
        expectTransactionOnlyAccountAccess();
    });
    it.each(["decoy", "email", "hash", "missing", "noKakao", "password", "phone", "rejected", "owner", "taken", "cas", "unique"])("refuses email recheck %s", async reason => {
        user.kakaoId = "kakao"; user.passwordHash = null;
        if (reason === "decoy") row.userId = null;
        if (reason === "email") row.email = null;
        if (reason === "hash") row.passwordHash = null;
        if (reason === "missing") tx.user.findUnique.mockResolvedValue(null);
        if (reason === "noKakao") user.kakaoId = null;
        if (reason === "password") user.passwordHash = "gained";
        if (reason === "phone") user.phone = "01099999999";
        if (reason === "rejected") user.approvalStatus = "rejected";
        if (reason === "owner") user.role = "owner";
        if (reason === "taken") tx.user.findFirst.mockResolvedValue({ id: "other" });
        if (reason === "cas") tx.user.updateMany.mockResolvedValue({ count: 0 });
        if (reason === "unique") tx.user.updateMany.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("duplicate", { code: "P2002", clientVersion: "test" }));
        const before = { ...user };
        await expect(service.verifyEmailLink(token, "123456")).rejects.toMatchObject(refusal);
        if (reason === "taken") {
            expect(tx.user.findFirst).toHaveBeenCalledTimes(1);
            expect(tx.user.findFirst).toHaveBeenCalledWith({ where: { email: row.email, id: { not: user.id } }, select: { id: true } });
        }
        expect(user).toEqual(before);
        expect(challengeConsumed).toBe(false);
        expect(log).not.toHaveBeenCalled();
        expect(tx.auth_email_outbox.create).not.toHaveBeenCalled();
        if (!["cas", "unique"].includes(reason)) expect(tx.user.updateMany).not.toHaveBeenCalled();
    });

    it.each(["kakao", "email"] as const)("does not open a transaction for a wrong %s code", async method => {
        challenge.verify.mockRejectedValue(new BadRequestException(refusal.response));
        const result = method === "kakao"
            ? service.verifyKakaoLink("pending-token", token, "000000")
            : service.verifyEmailLink(token, "000000");
        await expect(result).rejects.toMatchObject(refusal);
        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(challenge.consume).not.toHaveBeenCalled();
        expectTransactionOnlyAccountAccess();
    });

    it("preserves the existing Kakao row when it is the only phone holder", async () => {
        user.kakaoId = "new-kakao";
        tx.user.findFirst.mockResolvedValue(user);
        tx.user.findMany.mockResolvedValue([user]);
        tx.user.update.mockResolvedValue(user);
        await expect(startKakao(service)).resolves.toMatchObject({ userId: user.id });
        expect(tx.auth_flow_state.updateMany).toHaveBeenCalledTimes(1);
        expect(tx.user.update).toHaveBeenCalledTimes(1);
        expect(tx.user.create).not.toHaveBeenCalled();
        expect(challenge.issue).not.toHaveBeenCalled();
    });

    it.each(["stored-image", null])("keeps the stored Kakao profile image %s and uses kakao for a passwordless target", async image => {
        user.profileImage = image;
        user.passwordHash = null;
        await service.verifyKakaoLink("pending-token", token, "123456");
        expect(tx.user.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            data: { kakaoId: "new-kakao", authProvider: "kakao", profileImage: image ?? "image" },
        }));
    });

    it.each(["kakao", "email"] as const)("refuses a second %s submission after success", async method => {
        if (method === "email") { user.kakaoId = "kakao"; user.passwordHash = null; }
        const verify = () => method === "kakao"
            ? service.verifyKakaoLink("pending-token", token, "123456")
            : service.verifyEmailLink(token, "123456");
        await verify();
        const linkedUser = { ...user };
        await expect(verify()).rejects.toMatchObject({ status: method === "kakao" ? 401 : 400 });
        expect(user).toEqual(linkedUser);
        expect(tx.user.updateMany).toHaveBeenCalledTimes(1);
        expect(log).toHaveBeenCalledTimes(1);
    });

    it.each(["email", "kakaoId"] as const)("maps a named unique %s constraint to link refusal", async field => {
        if (field === "email") { user.kakaoId = "kakao"; user.passwordHash = null; }
        tx.user.updateMany.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("duplicate", {
            code: "P2002", clientVersion: "test", meta: { target: [field] },
        }));
        const result = field === "email"
            ? service.verifyEmailLink(token, "123456")
            : service.verifyKakaoLink("pending-token", token, "123456");
        await expect(result).rejects.toMatchObject(refusal);
        expect(challengeConsumed).toBe(false);
        expect(stored.consumedAt).toBeNull();
    });

    it.each([false, true])("queues verification for a changed email (previously verified=%s) and uses a missing name", async verified => {
        user.kakaoId = "kakao"; user.passwordHash = null; user.name = null;
        user.emailVerified = verified; user.emailVerifiedAt = new Date();
        await expect(service.verifyEmailLink(token, "123456")).resolves.toEqual({
            success: true, linked: true, code: "ACCOUNTS_LINKED", emailVerificationRequired: true,
            message: "계정이 연결됐어요. 인증 이메일을 확인한 뒤 로그인해 주세요.",
        });
        expect(user).toMatchObject({ name: "New", emailVerified: false, emailVerifiedAt: null });
        expect(tx.auth_email_outbox.create).toHaveBeenCalledWith({ data: expect.objectContaining({
            userId: "user", recipient: "new@example.invalid", name: "New", kind: "email_verification",
            authTokenId: tx.auth_token.create.mock.calls[0]![0].data.id,
        }) });
    });

    it("requires email verification when the same stored address is still unverified", async () => {
        user.kakaoId = "kakao"; user.passwordHash = null; user.email = "NEW@example.invalid";
        await expect(service.verifyEmailLink(token, "123456")).resolves.toMatchObject({ emailVerificationRequired: true });
        expect(tx.auth_token.create).toHaveBeenCalledTimes(1);
        expect(tx.auth_email_outbox.create).toHaveBeenCalledTimes(1);
    });

    it("keeps a stored empty name when linking email", async () => {
        user.kakaoId = "kakao"; user.passwordHash = null; user.name = "";
        await service.verifyEmailLink(token, "123456");
        expect(user.name).toBe("");
        expect(tx.auth_email_outbox.create).toHaveBeenCalledWith({ data: expect.objectContaining({ name: "" }) });
    });

    it("rolls back linking and consumption when email queueing fails, then allows retry", async () => {
        user.kakaoId = "kakao"; user.passwordHash = null;
        const before = { ...user };
        const unavailable = new Error("outbox unavailable");
        tx.auth_email_outbox.create.mockRejectedValueOnce(unavailable);
        await expect(service.verifyEmailLink(token, "123456")).rejects.toBe(unavailable);
        expect(user).toEqual(before);
        expect(challengeConsumed).toBe(false);
        expect(log).not.toHaveBeenCalled();
        await expect(service.verifyEmailLink(token, "123456")).resolves.toMatchObject({ linked: true });
        expect(challengeConsumed).toBe(true);
    });
});
