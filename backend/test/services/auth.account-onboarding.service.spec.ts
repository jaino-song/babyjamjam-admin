import { Logger } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Prisma } from "@prisma/client";
import { createHash } from "crypto";
import { AuthService } from "application/services/auth.service";
import { AuthSessionService } from "application/services/auth-session.service";
import { codeOnlyProblemBody, problemBody } from "application/utils/problem-bodies";
import { EmailPort } from "domain/ports/email.port";
import { IAuthTokenRepository } from "domain/repositories/auth-token.repository.interface";
import { AuthTokenEntity } from "domain/entities/auth-token.entity";
import { PrismaService } from "infrastructure/database/prisma.service";

const account = {
    id: "user-1", email: "staff@example.com", name: "Staff", profileImage: null,
    phone: null as string | null, birthDate: null as string | null,
    role: "user" as string | null, requestedRole: "manager", approvalStatus: "approved",
    authProvider: "both", kakaoId: "kakao-1", passwordHash: "hash", emailVerified: true,
    tokenVersion: 2,
};
const token = `pending-onboarding-token.${account.tokenVersion}`;
const phone = "010-1234-5678";
const birthDate = "1990-01-01";
const tokens = { accessToken: "access", refreshToken: "refresh" };
const kakaoData = { kakaoId: account.kakaoId };
const flowState = () => ({
    id: "flow-1", kind: "pending_account_onboarding", userId: account.id,
    expiresAt: new Date(Date.now() + 60_000), consumedAt: null as Date | null,
});
const databaseDouble = () => ({
    user: { findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
    auth_flow_state: { findUnique: jest.fn(), updateMany: jest.fn(), create: jest.fn(), deleteMany: jest.fn() },
    auth_session: { updateMany: jest.fn() },
    user_branch: { findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
});

describe("AuthService account completion", () => {
    let tx: ReturnType<typeof databaseDouble>;
    let prisma: ReturnType<typeof databaseDouble> & { $transaction: jest.Mock };
    let service: AuthService;
    let stored: ReturnType<typeof flowState>;
    let transactionPromise: Promise<unknown>;
    let sessions: { issueSession: jest.Mock; revokeAllUserSessions: jest.Mock };
    let resetTokens: { findByToken: jest.Mock; consumeWithinTx: jest.Mock };
    let log: jest.SpyInstance;

    beforeEach(() => {
        tx = databaseDouble();
        prisma = { ...databaseDouble(), $transaction: jest.fn() };
        stored = flowState();
        tx.auth_flow_state.findUnique.mockImplementation(async () => ({ ...stored }));
        tx.auth_flow_state.updateMany.mockImplementation(async () => {
            if (stored.consumedAt) return { count: 0 };
            stored.consumedAt = new Date();
            return { count: 1 };
        });
        tx.user.findUnique.mockResolvedValue({ ...account });
        tx.user.findFirst.mockResolvedValue(null);
        tx.user.update.mockImplementation(async ({ data }) => ({ ...account, ...data }));
        prisma.user_branch.findMany.mockResolvedValue([{ branchId: "branch-1", role: "user" }]);
        // A distinct transaction client catches accidental reads/writes on prisma.
        // Model rollback only to exercise retry; rejection of the transaction promise
        // and tx-only calls are the evidence that the real transaction can roll back.
        prisma.$transaction.mockImplementation((callback: (client: typeof tx) => Promise<unknown>) => {
            const consumedAt = stored.consumedAt;
            transactionPromise = callback(tx).catch((error: unknown) => {
                stored.consumedAt = consumedAt;
                throw error;
            });
            return transactionPromise;
        });
        sessions = { issueSession: jest.fn().mockResolvedValue(tokens), revokeAllUserSessions: jest.fn() };
        resetTokens = { findByToken: jest.fn(), consumeWithinTx: jest.fn() };
        service = new AuthService(
            prisma as unknown as PrismaService,
            {} as JwtService,
            {} as EmailPort,
            resetTokens as unknown as IAuthTokenRepository,
            sessions as unknown as AuthSessionService,
        );
        log = jest.spyOn(Logger.prototype, "log").mockImplementation();
    });

    afterEach(() => jest.restoreAllMocks());

    function expectTransactionOnlyAccountAccess(): void {
        for (const method of Object.values(prisma.user)) expect(method).not.toHaveBeenCalled();
        for (const method of Object.values(prisma.auth_flow_state)) expect(method).not.toHaveBeenCalled();
        for (const method of Object.values(tx.user_branch)) expect(method).not.toHaveBeenCalled();
        expect(prisma.user_branch.create).not.toHaveBeenCalled();
        expect(prisma.user_branch.update).not.toHaveBeenCalled();
    }

    describe("login routing", () => {
        it.each(["email", "kakao"] as const)("routes %s login with each missing profile field to onboarding", async (provider) => {
            jest.spyOn(service, "verifyPassword").mockResolvedValue(true);
            for (const missing of ["phone", "birthDate"] as const) {
                const user = { ...account, phone, birthDate, [missing]: null };
                prisma.user.findUnique.mockResolvedValue(user);
                prisma.user.findFirst.mockResolvedValue(user);
                const result = provider === "email"
                    ? await service.validateEmailPassword(account.email, "Password1!")
                    : await service.validateKakaoUser(kakaoData);
                expect(result).toEqual({
                    onboardingRequired: true, onboardingKind: "account_completion", userId: account.id,
                    prefill: {
                        email: account.email, name: account.name, profileImage: undefined,
                        phone: user.phone ?? undefined, birthDate: user.birthDate ?? undefined,
                        branchId: "branch-1", role: "user",
                    },
                });
            }
            expect(sessions.issueSession).not.toHaveBeenCalled();
        });

        it.each(["account", "membership", "no branch"])("rejects missing %s role/access before missing phone", async (missing) => {
            jest.spyOn(service, "verifyPassword").mockResolvedValue(true);
            prisma.user.findUnique.mockResolvedValue({ ...account, role: missing === "account" ? null : "user" });
            prisma.user_branch.findMany.mockResolvedValue(missing === "no branch"
                ? [] : [{ branchId: "branch-1", role: missing === "membership" ? null : "user" }]);
            await expect(service.validateEmailPassword(account.email, "Password1!")).rejects.toMatchObject({
                status: 403, response: codeOnlyProblemBody("NO_ACCESSIBLE_BRANCH"),
            });
            expect(sessions.issueSession).not.toHaveBeenCalled();
        });

        it("still signs in an owner with no birth date or branch", async () => {
            prisma.user.findFirst.mockResolvedValue({ ...account, role: "owner", phone, birthDate: null });
            prisma.user_branch.findMany.mockResolvedValue([]);
            await expect(service.validateKakaoUser(kakaoData)).resolves.toEqual({
                user: account.id, ...tokens, requiresBranchSelection: true,
            });
        });
    });

    describe("completeAccountOnboarding", () => {
        it.each([token.replace(/\.2$/, ""), token.replace(/\.2$/, ".1")])("rejects an unversioned or stale token", async (pendingToken) => {
            await expect(service.completeAccountOnboarding(pendingToken, phone, birthDate)).rejects.toMatchObject({
                status: 401, response: codeOnlyProblemBody("AUTH_REQUIRED"),
            });
            expect(tx.user.update).not.toHaveBeenCalled();
            expect(sessions.issueSession).not.toHaveBeenCalled();
            expectTransactionOnlyAccountAccess();
        });

        it("consumes the token and writes only the two profile fields before issuing tokens", async () => {
            await expect(service.completeAccountOnboarding(token, phone, birthDate)).resolves.toEqual({
                user: account.id, ...tokens, requiresBranchSelection: undefined,
            });
            expect(prisma.$transaction).toHaveBeenCalledTimes(1);
            expect(tx.auth_flow_state.findUnique).toHaveBeenCalledWith({
                where: { tokenHash: createHash("sha256").update(token).digest("hex") },
            });
            expect(tx.auth_flow_state.updateMany).toHaveBeenCalledWith({
                where: { id: stored.id, consumedAt: null }, data: { consumedAt: expect.any(Date) },
            });
            expect(tx.user.findUnique).toHaveBeenCalledWith({ where: { id: account.id } });
            expect(tx.user.findFirst).toHaveBeenCalledWith({
                where: { phone: { in: ["01012345678", phone] }, id: { not: account.id } },
            });
            expect(tx.user.update).toHaveBeenCalledWith({ where: { id: account.id, tokenVersion: account.tokenVersion }, data: { phone, birthDate } });
            expectTransactionOnlyAccountAccess();
            const completionLogs = log.mock.calls.map(([message]: [string]) => message)
                .filter((message: string) => message.includes("auth_account_onboarding_completed"));
            expect(completionLogs).toHaveLength(1);
            expect(JSON.parse(completionLogs[0]!)).toEqual({
                event: "auth_account_onboarding_completed", userId: account.id, fieldsWritten: ["phone", "birthDate"],
            });
            expect(completionLogs[0]).not.toContain(phone);
            expect(completionLogs[0]).not.toContain(birthDate);
            expect(completionLogs[0]).not.toContain(token);
        });

        it.each([undefined, "010-9999-9999"])("preserves a stored legacy phone when submitted phone is %s", async (submitted) => {
            const user = { ...account, phone: "legacy-phone" };
            tx.user.findUnique.mockResolvedValue(user);
            tx.user.update.mockImplementation(async ({ data }) => ({ ...user, ...data }));
            await expect(service.completeAccountOnboarding(token, submitted, birthDate)).resolves.toMatchObject(tokens);
            expect(tx.user.update).toHaveBeenCalledWith({ where: { id: account.id, tokenVersion: account.tokenVersion }, data: { birthDate } });
            expect(tx.user.findFirst).not.toHaveBeenCalled();
            expectTransactionOnlyAccountAccess();
        });

        it.each([undefined, "2000-12-31"])("preserves stored birth date when submitted birth date is %s", async (submitted) => {
            const user = { ...account, birthDate };
            tx.user.findUnique.mockResolvedValue(user);
            tx.user.update.mockImplementation(async ({ data }) => ({ ...user, ...data }));
            await expect(service.completeAccountOnboarding(token, phone, submitted)).resolves.toMatchObject(tokens);
            expect(tx.user.update).toHaveBeenCalledWith({ where: { id: account.id, tokenVersion: account.tokenVersion }, data: { phone } });
            expectTransactionOnlyAccountAccess();
        });

        it("stores a digits-only phone exactly as received", async () => {
            await service.completeAccountOnboarding(token, "01012345678", birthDate);
            expect(tx.user.update).toHaveBeenCalledWith({
                where: { id: account.id, tokenVersion: account.tokenVersion }, data: { phone: "01012345678", birthDate },
            });
        });

        it.each([
            ["phone", undefined, birthDate, "전화번호를 입력해 주세요."],
            ["birthDate", phone, undefined, "생년월일을 입력해 주세요."],
        ])("requires missing stored %s", async (field, submittedPhone, submittedBirthDate, detail) => {
            await expect(service.completeAccountOnboarding(token, submittedPhone, submittedBirthDate)).rejects.toMatchObject({
                status: 400,
                response: problemBody("VALIDATION_FAILED", { pointer: `/${field}`, code: "REQUIRED", detail: detail! }),
            });
            expect(stored.consumedAt).toBeNull();
            expect(tx.user.update).not.toHaveBeenCalled();
            expect(sessions.issueSession).not.toHaveBeenCalled();
            expectTransactionOnlyAccountAccess();
        });

        it.each(["01012345678", "010-1234-5678"])("rejects another account's %s inside the transaction and allows retry", async (heldPhone) => {
            tx.user.findFirst.mockImplementation(async ({ where }) => where.phone.in.includes(heldPhone)
                ? { id: "other-user", phone: heldPhone } : null);
            const refusal = {
                status: 400,
                response: problemBody("VALIDATION_FAILED", {
                    pointer: "/phone", code: "INVALID_VALUE", detail: "이미 등록된 전화번호예요. 오너에게 문의해 주세요.",
                }),
            };
            const result = service.completeAccountOnboarding(token, phone, birthDate);
            await expect(result).rejects.toMatchObject(refusal);
            await expect(transactionPromise).rejects.toMatchObject(refusal);
            expect(tx.auth_flow_state.updateMany).toHaveBeenCalledTimes(1);
            expect(tx.user.findUnique).toHaveBeenCalledWith({ where: { id: account.id } });
            expect(tx.user.findFirst).toHaveBeenCalledWith({
                where: { phone: { in: ["01012345678", phone] }, id: { not: account.id } },
            });
            expect(tx.user.update).not.toHaveBeenCalled();
            expectTransactionOnlyAccountAccess();
            expect(stored.consumedAt).toBeNull();
            expect(sessions.issueSession).not.toHaveBeenCalled();
            expect(log).not.toHaveBeenCalled();
            await expect(service.completeAccountOnboarding(token, "010-9999-9999", birthDate)).resolves.toMatchObject(tokens);
            expect(tx.user.update).toHaveBeenCalledWith({
                where: { id: account.id, tokenVersion: account.tokenVersion }, data: { phone: "010-9999-9999", birthDate },
            });
            expectTransactionOnlyAccountAccess();
        });

        it.each(["unknown", "expired", "expiry boundary", "consumed", "wrong kind", "no user id"])("rejects %s token", async (invalid) => {
            if (invalid === "unknown") tx.auth_flow_state.findUnique.mockResolvedValue(null);
            if (invalid === "expired") stored.expiresAt = new Date(Date.now() - 1);
            if (invalid === "expiry boundary") {
                jest.useFakeTimers();
                stored.expiresAt = new Date();
            }
            if (invalid === "consumed") stored.consumedAt = new Date();
            if (invalid === "wrong kind") stored.kind = "pending_kakao_signup";
            if (invalid === "no user id") stored.userId = "";
            try {
                await expect(service.completeAccountOnboarding(token, phone, birthDate)).rejects.toMatchObject({
                    status: 401, response: codeOnlyProblemBody("AUTH_REQUIRED"),
                });
                expect(tx.auth_flow_state.updateMany).not.toHaveBeenCalled();
                expect(tx.user.findUnique).not.toHaveBeenCalled();
                expect(tx.user.update).not.toHaveBeenCalled();
                expect(sessions.issueSession).not.toHaveBeenCalled();
                expectTransactionOnlyAccountAccess();
            } finally {
                jest.useRealTimers();
            }
        });

        it("rejects a lost token consume race", async () => {
            tx.auth_flow_state.updateMany.mockResolvedValue({ count: 0 });
            await expect(service.completeAccountOnboarding(token, phone, birthDate)).rejects.toMatchObject({
                status: 401, response: codeOnlyProblemBody("AUTH_REQUIRED"),
            });
            expect(tx.user.findUnique).not.toHaveBeenCalled();
            expectTransactionOnlyAccountAccess();
        });

        it("rejects revocation between the account read and profile update", async () => {
            tx.user.update.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("Version changed", {
                code: "P2025", clientVersion: "test",
            }));
            await expect(service.completeAccountOnboarding(token, phone, birthDate)).rejects.toMatchObject({
                status: 401, response: codeOnlyProblemBody("AUTH_REQUIRED"),
            });
            expect(tx.user.update).toHaveBeenCalledWith({
                where: { id: account.id, tokenVersion: account.tokenVersion }, data: { phone, birthDate },
            });
            expect(stored.consumedAt).toBeNull();
            expect(sessions.issueSession).not.toHaveBeenCalled();
            expectTransactionOnlyAccountAccess();
        });

        it("rejects a missing user", async () => {
            tx.user.findUnique.mockResolvedValue(null);
            await expect(service.completeAccountOnboarding(token, phone, birthDate)).rejects.toMatchObject({
                status: 401, response: codeOnlyProblemBody("AUTH_REQUIRED"),
            });
            expect(stored.consumedAt).toBeNull();
            expect(tx.user.update).not.toHaveBeenCalled();
            expectTransactionOnlyAccountAccess();
        });

        it.each(["pending", "rejected"])("rechecks %s approval before writing", async (approvalStatus) => {
            tx.user.findUnique.mockResolvedValue({ ...account, approvalStatus });
            await expect(service.completeAccountOnboarding(token, phone, birthDate)).rejects.toMatchObject({
                status: 403, response: codeOnlyProblemBody(approvalStatus === "pending" ? "PENDING_APPROVAL" : "ACCOUNT_REJECTED"),
            });
            expect(stored.consumedAt).toBeNull();
            expect(tx.user.findFirst).not.toHaveBeenCalled();
            expect(tx.user.update).not.toHaveBeenCalled();
            expect(sessions.issueSession).not.toHaveBeenCalled();
            expectTransactionOnlyAccountAccess();
        });

        it("rejects replay after a successful completion", async () => {
            await service.completeAccountOnboarding(token, phone, birthDate);
            await expect(service.completeAccountOnboarding(token, phone, birthDate)).rejects.toMatchObject({
                status: 401, response: codeOnlyProblemBody("AUTH_REQUIRED"),
            });
            expect(tx.user.update).toHaveBeenCalledTimes(1);
            expect(sessions.issueSession).toHaveBeenCalledTimes(1);
        });

        it("fails closed if the updated account is unexpectedly still incomplete", async () => {
            tx.user.update.mockResolvedValue({ ...account });
            await expect(service.completeAccountOnboarding(token, phone, birthDate)).rejects.toMatchObject({
                status: 401, response: codeOnlyProblemBody("AUTH_REQUIRED"),
            });
            expect(sessions.issueSession).not.toHaveBeenCalled();
        });
    });

    describe("pending credential revocation (staff-login-linking-u1/F1)", () => {
        let currentUser: typeof account;

        beforeEach(() => {
            currentUser = { ...account };
            prisma.user.findUnique.mockImplementation(async () => ({ ...currentUser }));
            tx.user.findUnique.mockImplementation(async () => ({ ...currentUser }));
            const updateUser = async ({ data }: { data: Record<string, unknown> }) => {
                const { tokenVersion, ...fields } = data;
                Object.assign(currentUser, fields);
                if (tokenVersion) currentUser.tokenVersion += 1;
                return { ...currentUser };
            };
            prisma.user.update.mockImplementation(updateUser);
            tx.user.update.mockImplementation(updateUser);
            const states = new Map<string, ReturnType<typeof flowState>>();
            prisma.auth_flow_state.create.mockImplementation(async ({ data }) => {
                states.set(data.tokenHash, { ...flowState(), ...data });
            });
            const findState = async ({ where }: { where: { tokenHash: string } }) => {
                const state = states.get(where.tokenHash);
                if (state) stored = state;
                return state ?? null;
            };
            prisma.auth_flow_state.findUnique.mockImplementation(findState);
            tx.auth_flow_state.findUnique.mockImplementation(findState);
        });

        async function revoke(method: "logoutAllSessions" | "resetPassword"): Promise<void> {
            if (method === "logoutAllSessions") {
                await service.logoutAllSessions(account.id);
            } else {
                resetTokens.findByToken.mockResolvedValue(AuthTokenEntity.reconstitute(
                    "reset-1", account.id, "reset-hash", "password_reset",
                    new Date(Date.now() + 60_000), new Date(), null,
                ));
                resetTokens.consumeWithinTx.mockResolvedValue(true);
                jest.spyOn(service, "hashPassword").mockResolvedValue("new-password-hash");
                await service.resetPassword("reset-token", "Password1!");
            }
            expect(currentUser.tokenVersion).toBe(account.tokenVersion + 1);
        }

        it("keeps newly issued credentials unique and allows completion at the issued version", async () => {
            const pending = await service.startPendingAccountOnboarding(account.id);
            expect(await service.startPendingAccountOnboarding(account.id)).not.toBe(pending);
            tx.user.update.mockImplementation(async ({ data }) => ({ ...currentUser, ...data }));
            await expect(service.completeAccountOnboarding(pending, phone, birthDate)).resolves.toMatchObject(tokens);
        });

        it.each(["logoutAllSessions", "resetPassword"] as const)("rejects an issued pending token after %s", async (method) => {
            const pending = await service.startPendingAccountOnboarding(account.id);
            await revoke(method);
            tx.user.update.mockClear();
            await expect(service.completeAccountOnboarding(pending, phone, birthDate)).rejects.toMatchObject({
                status: 401, response: codeOnlyProblemBody("AUTH_REQUIRED"),
            });
            await expect(service.getPendingAccountOnboarding(pending)).rejects.toMatchObject({ status: 401 });
            expect(tx.user.update).not.toHaveBeenCalled();
            expect(sessions.issueSession).not.toHaveBeenCalled();
        });

        it.each(["logoutAllSessions", "resetPassword"] as const)("rejects an outstanding exchange code after %s", async (method) => {
            const code = await service.createPendingAccountOnboardingCode(account.id);
            await revoke(method);
            prisma.auth_flow_state.create.mockClear();
            await expect(service.exchangeCodeForTokens(code)).rejects.toMatchObject({
                status: 401, response: codeOnlyProblemBody("AUTH_REQUIRED"),
            });
            expect(prisma.auth_flow_state.create).not.toHaveBeenCalled();
            expect(sessions.issueSession).not.toHaveBeenCalled();
        });

        it("does not let a caller replace the version on a revoked token", async () => {
            const pending = await service.startPendingAccountOnboarding(account.id);
            await revoke("logoutAllSessions");
            const forged = pending.replace(/\.[^.]+$/, `.${currentUser.tokenVersion}`);
            await expect(service.completeAccountOnboarding(forged, phone, birthDate)).rejects.toMatchObject({ status: 401 });
            expect(sessions.issueSession).not.toHaveBeenCalled();
        });

        it("exchanges a current code and still rejects its pending token after revocation", async () => {
            const code = await service.createPendingAccountOnboardingCode(account.id);
            const result = await service.exchangeCodeForTokens(code);
            expect(result).toMatchObject({ onboardingRequired: true, onboardingRoute: "/onboarding" });
            if (!("pendingAccountOnboardingToken" in result)) throw new Error("Expected account onboarding token");
            await revoke("logoutAllSessions");
            await expect(service.completeAccountOnboarding(result.pendingAccountOnboardingToken, phone, birthDate))
                .rejects.toMatchObject({ status: 401 });
            expect(sessions.issueSession).not.toHaveBeenCalled();
        });
    });
});
