import { getServiceRecordTokenExpiresAt } from "domain/constants/service-record-link-message";
import { checkWriteArgs } from "infrastructure/database/tenant-isolation.extension";
import { tenantContextStore } from "infrastructure/tenant/tenant-context.store";
import {
    SERVICE_RECORD_PHONE_CHALLENGE_WINDOW_MS,
    ServiceRecordTokenService,
    isServiceRecordAccessTokenUsable,
} from "../../application/services/service-record-token.service";

const BRANCH = "11111111-1111-1111-1111-111111111111";
const OTHER_BRANCH = "22222222-2222-2222-2222-222222222222";
const CASE = "33333333-3333-3333-3333-333333333333";

/** Minimal in-memory fixture of the token's branch, schedule, case and employee. */
function makePrismaMock() {
    const rows: any[] = [];
    let seq = 0;
    const schedules = [{ id: 10, clientId: 1, branchId: BRANCH, replaced: false, primaryEmployeeId: 7,
        primaryEmployee: { id: 7, name: "QA-Caregiver", phone: "010-1111-2222", deletedAt: null },
        client: { serviceStatus: "in_progress", deletedAt: null as Date | null, fetalConfirmation: "UNCONFIRMED" } }];
    const matches = (row: any, where: any): boolean => Object.entries(where).every(([key, value]) => {
        if (key === "OR") return (value as object[]).some((clause) => matches(row, clause));
        if (key === "lockedAt" && value && typeof value === "object" && "not" in value) return row.lockedAt !== value.not;
        return value === undefined || row[key] === value;
    });
    const prisma = {
        __schedules: schedules,
        $executeRaw: jest.fn(),
        employee_schedule: {
            findUnique: jest.fn(async ({ where }: any) => schedules.find(s => s.id === where.id) ?? null),
            findFirst: jest.fn(async ({ where }: any) => [...schedules].reverse().find(s =>
                s.branchId === where.branchId
                && (where.id === undefined || s.id === where.id)
                && (where.clientId === undefined || s.clientId === where.clientId)
                && (where.replaced === undefined || s.replaced === where.replaced)
                && (!where.client || !s.client.deletedAt)) ?? null),
        },
        client: {
            findFirst: jest.fn(async ({ where }: any) => schedules.find(s =>
                s.branchId === where.branchId && s.clientId === where.id && !s.client.deletedAt)?.client ?? null),
        },
        client_baby: { findMany: jest.fn().mockResolvedValue([]) },
        __rows: rows,
        service_record_case: {
            findMany: jest.fn(async ({ where }: any) => (!where.id || where.id === CASE) ? [{ id: CASE, babyId: null }] : []),
            findFirst: jest.fn().mockResolvedValue({ finalizedAt: null }),
        },
        service_record_token: {
            create: jest.fn(async ({ data }: any) => {
                const row = {
                    id: `id${++seq}`,
                    active: true,
                    revokedAt: null,
                    verifiedAt: null,
                    failedAttempts: 0,
                    challengeWindowStartedAt: null,
                    lockedAt: null,
                    accessTokenHash: null,
                    ...data,
                };
                rows.push(row);
                return row;
            }),
            findMany: jest.fn(async ({ where }: any) => rows.filter(r => matches(r, where))),
            findUnique: jest.fn(async ({ where }: any) => rows.find((r) => matches(r, where)) ?? null),
            findFirst: jest.fn(async ({ where, orderBy }: any) => {
                const matching = [...rows].reverse().filter(r => matches(r, where));
                return (orderBy?.[0]?.active ? matching.find(r => r.active) : null) ?? matching[0] ?? null;
            }),
            update: jest.fn(async ({ where, data }: any) => {
                const row = rows.find((r) => matches(r, where));
                return Object.assign(row, data);
            }),
            updateMany: jest.fn(async ({ where, data }: any) => {
                const matching = rows.filter(r => matches(r, where));
                matching.forEach(r => Object.assign(r, data));
                return { count: matching.length };
            }),
        },
        employee: {
            findFirst: jest.fn(async ({ where }: any) => {
                const schedule = schedules.find(s => s.branchId === where.branchId && s.primaryEmployee.id === where.id);
                return schedule?.primaryEmployee.deletedAt === null ? schedule.primaryEmployee : null;
            }),
        },
    };
    return Object.assign(prisma, {
        $transaction: jest.fn(async (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma)),
    });
}

const future = () => new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);

describe("ServiceRecordTokenService", () => {
    function setup() {
        const prisma = makePrismaMock();
        const svc = new ServiceRecordTokenService(prisma as any);
        return { prisma, svc };
    }

    it.each([
        ["2026-11-14T14:59:59.999Z", true],
        ["2026-11-14T15:00:00.000Z", false],
        ["2026-11-14T15:00:00.001Z", false],
    ])("enforces the midnight expiry boundary at %s on all token entry points", async (now, valid) => {
        jest.useFakeTimers().setSystemTime(new Date("2026-11-14T00:00:00.000Z"));
        try {
            const { svc } = setup();
            const params = { branchId: BRANCH, scheduleId: 10, employeeId: 7,
                expectedPhone: "01011112222", expiresAt: new Date("2026-11-14T15:00:00.000Z") };
            const { linkToken } = await svc.issueLink(params);
            const auth = await svc.verifyPhoneAndMintAccess(linkToken, params.expectedPhone);
            if (!auth.ok) throw new Error("fixture verification failed");
            jest.setSystemTime(new Date(now));

            expect(Boolean(await svc.resolveLink(linkToken))).toBe(valid);
            expect(Boolean(await svc.resolveAccess(auth.accessToken))).toBe(valid);
            expect((await svc.verifyPhoneAndMintAccess(linkToken, params.expectedPhone)).ok).toBe(valid);
            expect(await svc.activatePreparedLink({ ...params, linkToken })).toBe(valid);
        } finally {
            jest.useRealTimers();
        }
    });

    it("issues a link, then a correct phone number mints an access token that resolves to the assignment context", async () => {
        const { prisma, svc } = setup();
        const { linkToken } = await svc.issueLink({
            branchId: BRANCH, scheduleId: 10, employeeId: 7, expectedPhone: "010-1111-2222", expiresAt: future(),
        });

        expect(prisma.__rows[0].linkTokenHash).toBe(linkToken);

        // normalized phone compare: "01011112222" must match "010-1111-2222"
        const result = await svc.verifyPhoneAndMintAccess(linkToken, "01011112222");
        expect(result.ok).toBe(true);

        const accessToken = (result as { ok: true; accessToken: string }).accessToken;
        const ctx = await svc.resolveAccess(accessToken);
        expect(ctx).toMatchObject({ tokenId: expect.any(String), branchId: BRANCH, scheduleId: 10, employeeId: 7,
            serviceRecordCaseId: CASE, babyId: null, babyRank: null, babyCount: null });
    });

    describe("client tombstone (deletedAt)", () => {
        const params = () => ({ branchId: BRANCH, scheduleId: 10, employeeId: 7,
            expectedPhone: "01011112222", expiresAt: future() });

        it("stops every token entry point from resolving once the client is tombstoned, without any revocation", async () => {
            const { prisma, svc } = setup();
            const p = params();
            const { linkToken } = await svc.issueLink(p);
            const auth = await svc.verifyPhoneAndMintAccess(linkToken, p.expectedPhone);
            if (!auth.ok) throw new Error("fixture verification failed");
            expect(await svc.resolveAccess(auth.accessToken)).not.toBeNull();

            // Tombstone only; the token row stays active (revocation "failed").
            (prisma.__schedules[0]!.client as any).deletedAt = new Date();
            expect(prisma.__rows[0].active).toBe(true);

            expect(await svc.resolveAccess(auth.accessToken)).toBeNull();
            expect(await svc.resolveLink(linkToken)).toBeNull();
            expect(await svc.verifyPhoneAndMintAccess(linkToken, p.expectedPhone)).toMatchObject({ ok: false });
            expect(await svc.activatePreparedLink({ ...p, linkToken })).toBe(false);
            expect(await svc.reuseActiveLink(p)).toBeNull();
        });

        it("refuses to issue or prepare a link for a tombstoned client", async () => {
            const { prisma, svc } = setup();
            (prisma.__schedules[0]!.client as any).deletedAt = new Date();
            await expect(svc.issueLink(params())).rejects.toThrow();
            await expect(svc.prepareLink(params())).rejects.toThrow();
            expect(prisma.__rows).toHaveLength(0);
        });

        it("leaves a live client unaffected", async () => {
            const { prisma, svc } = setup();
            (prisma.__schedules[0]!.client as any).deletedAt = null;
            const p = params();
            const { linkToken } = await svc.issueLink(p);
            const auth = await svc.verifyPhoneAndMintAccess(linkToken, p.expectedPhone);
            if (!auth.ok) throw new Error("fixture verification failed");
            expect(await svc.resolveLink(linkToken)).not.toBeNull();
            expect(await svc.resolveAccess(auth.accessToken)).not.toBeNull();
        });
    });

    it("reports whether a token row exists for the exact link token, whatever its state", async () => {
        const { prisma, svc } = setup();
        const { linkToken } = await svc.issueLink({
            branchId: BRANCH, scheduleId: 10, employeeId: 7, expectedPhone: "010-1111-2222", expiresAt: future(),
        });
        expect(await svc.linkTokenExists(linkToken)).toBe(true);
        expect(await svc.linkTokenExists(`${linkToken}junk`)).toBe(false);

        prisma.__rows[0].active = false;
        prisma.__rows[0].expiresAt = new Date(Date.now() - 1000);
        expect(await svc.resolveLink(linkToken)).toBeNull();
        expect(await svc.linkTokenExists(linkToken)).toBe(true);
    });

    it("does not reactivate finalized tokens when preparing the composer", async () => {
        const { prisma, svc } = setup();
        const params = { branchId: BRANCH, scheduleId: 10, employeeId: 7,
            expectedPhone: "01011112222", expiresAt: future() };
        await svc.issueLink(params);
        Object.assign(prisma.__rows[0], { active: false, revokedAt: new Date(), accessTokenHash: null });
        prisma.service_record_case.findFirst.mockResolvedValue({ finalizedAt: new Date() });
        const before = { ...prisma.__rows[0] };
        await expect(svc.prepareLink(params)).rejects.toThrow("최종 확정된 제공기록지");
        expect(prisma.__rows[0]).toEqual(before);
    });

    it.each([["case1", CASE], ["undefined", undefined]] as const)("blocks a finalized replacement without reactivating its old token (case %s)", async (_label, serviceRecordCaseId) => {
        const { prisma, svc } = setup();
        const params = { branchId: BRANCH, scheduleId: 10, employeeId: 7, serviceRecordCaseId,
            expectedPhone: "01011112222", expiresAt: future() };
        const { linkToken } = await svc.issueLink(params);
        await svc.revokeForSchedule(10);
        prisma.__schedules[0]!.replaced = true;
        prisma.__schedules.push({ ...prisma.__schedules[0]!, id: 11, replaced: false, primaryEmployeeId: 8,
            primaryEmployee: { id: 8, name: "QA-Next caregiver", phone: "01033334444", deletedAt: null } });
        prisma.service_record_case.findFirst.mockResolvedValue({ finalizedAt: new Date() });
        const before = { ...prisma.__rows[0] };
        prisma.service_record_token.update.mockClear();
        expect(await svc.resolveLink(linkToken)).toBeNull();
        expect(await svc.verifyPhoneAndMintAccess(linkToken, "01033334444")).toMatchObject({ ok: false });
        expect(prisma.service_record_case.findFirst).toHaveBeenLastCalledWith({
            where: { id: CASE, branchId: BRANCH, clientId: 1 }, select: { finalizedAt: true },
        });
        expect(prisma.service_record_token.update).not.toHaveBeenCalled();
        expect(prisma.__rows[0]).toEqual(before);
    });

    it("rejects an existing session and prepared activation after finalization even if a legacy row remains active", async () => {
        const { prisma, svc } = setup();
        const params = { branchId: BRANCH, scheduleId: 10, employeeId: 7,
            expectedPhone: "01011112222", expiresAt: future() };
        const { linkToken } = await svc.issueLink(params);
        const auth = await svc.verifyPhoneAndMintAccess(linkToken, params.expectedPhone);
        expect(auth.ok).toBe(true);
        prisma.service_record_case.findFirst.mockResolvedValue({ finalizedAt: new Date() });
        prisma.service_record_token.update.mockClear();
        if (auth.ok) expect(await svc.resolveAccess(auth.accessToken)).toBeNull();
        expect(await svc.activatePreparedLink({ ...params, linkToken })).toBe(false);
        expect(await svc.reuseActiveLink(params)).toBeNull();
        expect(prisma.service_record_token.update).not.toHaveBeenCalled();
    });

    it("waits for the case lock and rechecks finalization before locking or changing a token", async () => {
        const { prisma, svc } = setup();
        const { linkToken } = await svc.issueLink({ branchId: BRANCH, scheduleId: 10, employeeId: 7,
            expectedPhone: "01011112222", expiresAt: future() });
        prisma.$executeRaw.mockImplementationOnce(async () => {
            // A finalizer commits while verification waits for its case lock.
            prisma.service_record_case.findFirst.mockResolvedValue({ finalizedAt: new Date() });
            return 1;
        });
        const tokenLock = jest.fn();
        (prisma as any).$queryRaw = tokenLock;
        prisma.service_record_token.update.mockClear();
        expect(await svc.verifyPhoneAndMintAccess(linkToken, "01011112222")).toMatchObject({ ok: false });
        expect(tokenLock).not.toHaveBeenCalled();
        expect(prisma.service_record_token.update).not.toHaveBeenCalled();
        const query = (prisma.$executeRaw.mock.calls.at(-1) as unknown as [{ sql: string }])[0];
        expect(query.sql).toContain("FOR SHARE");
    });

    it("uses the resolved tenant for public verification and branch-pins every challenge write", async () => {
        const { prisma, svc } = setup();
        const { linkToken } = await svc.issueLink({ branchId: BRANCH, scheduleId: 10, employeeId: 7, expectedPhone: "01011112222", expiresAt: future() });
        const findUnique = prisma.service_record_token.findUnique;
        prisma.service_record_token.findUnique = jest.fn(async (args: any) => {
            expect(tenantContextStore.get()?.systemScope).toBe(true);
            return findUnique(args);
        });
        const update = prisma.service_record_token.update;
        prisma.service_record_token.update = jest.fn(async (args: any) => {
            expect(tenantContextStore.get()).toEqual({ origin: "http", branchId: BRANCH });
            expect(checkWriteArgs("update", args, BRANCH)).toBeNull();
            return update(args);
        });
        await tenantContextStore.run({ origin: "http" }, async () => {
            expect(await svc.verifyPhoneAndMintAccess(linkToken, "01011112222")).toMatchObject({ ok: true });
            expect(tenantContextStore.get()).toEqual({ origin: "http" });
        });
    });

    it("allows the correct phone on the final allowed attempt and clears transient failures", async () => {
        const { prisma, svc } = setup();
        const { linkToken } = await svc.issueLink({
            branchId: BRANCH, scheduleId: 10, employeeId: 7, expectedPhone: "010-1111-2222", expiresAt: future(),
        });

        for (let i = 0; i < 4; i++) {
            await svc.verifyPhoneAndMintAccess(linkToken, "01000000000");
        }

        const result = await svc.verifyPhoneAndMintAccess(linkToken, "01011112222");

        expect(result).toMatchObject({ ok: true, accessToken: expect.any(String) });
        expect(prisma.__rows[0]).toMatchObject({
            failedAttempts: 0,
            challengeWindowStartedAt: null,
            lockedAt: null,
        });
    });

    it("locks after five failed guesses and does not mint access after lockout", async () => {
        const { prisma, svc } = setup();
        const { linkToken } = await svc.issueLink({
            branchId: BRANCH, scheduleId: 10, employeeId: 7, expectedPhone: "010-1111-2222", expiresAt: future(),
        });

        for (let i = 0; i < 4; i++) {
            expect(await svc.verifyPhoneAndMintAccess(linkToken, "01000000000")).toEqual({
                ok: false,
                reason: "verification_failed",
            });
        }
        expect(prisma.__rows[0].failedAttempts).toBe(4);
        expect(prisma.__rows[0].lockedAt).toBeNull();

        // The fifth failed guess is the final allowed attempt and locks the link.
        expect(await svc.verifyPhoneAndMintAccess(linkToken, "01000000000")).toEqual({
            ok: false,
            reason: "verification_failed",
        });
        expect(prisma.__rows[0].failedAttempts).toBe(5);
        expect(prisma.__rows[0].lockedAt).toEqual(expect.any(Date));

        // Wrong and correct guesses remain generic and cannot mint after lockout.
        expect(await svc.verifyPhoneAndMintAccess(linkToken, "01000000000")).toEqual({
            ok: false,
            reason: "verification_failed",
        });
        expect(await svc.verifyPhoneAndMintAccess(linkToken, "010-1111-2222")).toEqual({
            ok: false,
            reason: "verification_failed",
        });
    });

    it("fails closed for legacy rows that already exhausted the budget before the lock marker existed", async () => {
        const { prisma, svc } = setup();
        const { linkToken } = await svc.issueLink({
            branchId: BRANCH, scheduleId: 10, employeeId: 7, expectedPhone: "010-1111-2222", expiresAt: future(),
        });
        prisma.__rows[0].failedAttempts = 5;
        prisma.__rows[0].challengeWindowStartedAt = new Date(Date.now() - SERVICE_RECORD_PHONE_CHALLENGE_WINDOW_MS - 1);

        expect(await svc.resolveLink(linkToken)).toBeNull();
        await expect(svc.verifyPhoneAndMintAccess(linkToken, "010-1111-2222")).resolves.toEqual({
            ok: false,
            reason: "verification_failed",
        });
        expect(prisma.__rows[0].lockedAt).toEqual(expect.any(Date));
    });

    it("accepts the employee's corrected live phone when the issuance snapshot is stale, and heals the snapshot", async () => {
        const { prisma, svc } = setup();
        // Link issued while the employee record still held a wrong number.
        const { linkToken } = await svc.issueLink({
            branchId: BRANCH, scheduleId: 10, employeeId: 7, expectedPhone: "010-1111-2222", expiresAt: future(),
        });
        const staleHash = prisma.__rows[0].expectedPhoneHash;
        // Admin has since corrected the employee's phone.
        prisma.__schedules[0]!.primaryEmployee.phone = "010-9999-8888";

        const result = await svc.verifyPhoneAndMintAccess(linkToken, "010-9999-8888");
        expect(result).toMatchObject({ ok: true });

        // The snapshot is healed to the corrected phone…
        expect(prisma.__rows[0].expectedPhoneHash).not.toBe(staleHash);
        // …so the old (wrong) number no longer verifies.
        expect(await svc.verifyPhoneAndMintAccess(linkToken, "010-1111-2222")).toEqual({
            ok: false,
            reason: "verification_failed",
        });
        // And the corrected number keeps matching via the snapshot alone.
        expect(await svc.verifyPhoneAndMintAccess(linkToken, "01099998888")).toMatchObject({ ok: true });

        const accessToken = (result as { ok: true; accessToken: string }).accessToken;
        expect(await svc.resolveAccess(accessToken)).toBeNull(); // superseded by the later mint
    });

    it("rejects a phone matching neither the snapshot nor the live employee record", async () => {
        const { prisma, svc } = setup();
        const { linkToken } = await svc.issueLink({
            branchId: BRANCH, scheduleId: 10, employeeId: 7, expectedPhone: "010-1111-2222", expiresAt: future(),
        });
        prisma.__schedules[0]!.primaryEmployee.phone = "010-9999-8888";

        expect(await svc.verifyPhoneAndMintAccess(linkToken, "010-0000-0000")).toEqual({
            ok: false,
            reason: "verification_failed",
        });
        expect(prisma.__rows[0].failedAttempts).toBe(1);
        expect(prisma.__rows[0].expectedPhoneHash).toBeDefined();
    });

    it("starts a fresh challenge window after the prior transient window expires", async () => {
        const { prisma, svc } = setup();
        const { linkToken } = await svc.issueLink({
            branchId: BRANCH, scheduleId: 10, employeeId: 7, expectedPhone: "010-1111-2222", expiresAt: future(),
        });
        prisma.__rows[0].failedAttempts = 4;
        prisma.__rows[0].challengeWindowStartedAt = new Date(
            Date.now() - SERVICE_RECORD_PHONE_CHALLENGE_WINDOW_MS - 1,
        );

        await expect(svc.verifyPhoneAndMintAccess(linkToken, "01000000000")).resolves.toEqual({
            ok: false,
            reason: "verification_failed",
        });

        expect(prisma.__rows[0]).toMatchObject({
            failedAttempts: 1,
            lockedAt: null,
            challengeWindowStartedAt: expect.any(Date),
        });
    });

    it("serializes concurrent wrong guesses so the attempt budget cannot be bypassed", async () => {
        const { prisma, svc } = setup();
        const { linkToken } = await svc.issueLink({
            branchId: BRANCH, scheduleId: 10, employeeId: 7, expectedPhone: "010-1111-2222", expiresAt: future(),
        });
        let transactionTail = Promise.resolve();
        prisma.$transaction.mockImplementation((callback: (tx: typeof prisma) => Promise<unknown>) => {
            const run = transactionTail.then(() => callback(prisma));
            transactionTail = run.then(() => undefined, () => undefined);
            return run;
        });

        const results = await Promise.all(
            Array.from({ length: 20 }, () => svc.verifyPhoneAndMintAccess(linkToken, "01000000000")),
        );

        expect(results.every((result) => result.ok === false)).toBe(true);
        expect(prisma.__rows[0].failedAttempts).toBe(5);
        expect(prisma.__rows[0].lockedAt).toEqual(expect.any(Date));
    });

    it("does not mint through the fallback when the live employee phone is empty", async () => {
        const { prisma, svc } = setup();
        const { linkToken } = await svc.issueLink({
            branchId: BRANCH, scheduleId: 10, employeeId: 7, expectedPhone: "010-1111-2222", expiresAt: future(),
        });
        prisma.__schedules[0]!.primaryEmployee.phone = "";

        expect(await svc.verifyPhoneAndMintAccess(linkToken, "")).toEqual({
            ok: false,
            reason: "verification_failed",
        });
    });

    it("treats an expired token as unusable for both link resolution and access", async () => {
        const { prisma, svc } = setup();
        const { linkToken } = await svc.issueLink({
            branchId: BRANCH, scheduleId: 10, employeeId: 7, expectedPhone: "010-1111-2222", expiresAt: future(),
        });
        const verify = await svc.verifyPhoneAndMintAccess(linkToken, "01011112222");
        const accessToken = (verify as { ok: true; accessToken: string }).accessToken;

        // force expiry
        prisma.__rows[0].expiresAt = new Date(Date.now() - 1000);

        expect(await svc.resolveLink(linkToken)).toBeNull();
        expect(await svc.resolveAccess(accessToken)).toBeNull();
    });

    it("returns the same generic verification result for invalid, expired, and locked links", async () => {
        const { prisma, svc } = setup();
        const { linkToken } = await svc.issueLink({
            branchId: BRANCH, scheduleId: 10, employeeId: 7, expectedPhone: "010-1111-2222", expiresAt: future(),
        });
        const wrong = await svc.verifyPhoneAndMintAccess(linkToken, "01000000000");
        prisma.__rows[0].expiresAt = new Date(Date.now() - 1);
        const expired = await svc.verifyPhoneAndMintAccess(linkToken, "01000000000");
        prisma.__rows[0].expiresAt = future();
        prisma.__rows[0].lockedAt = new Date();
        const locked = await svc.verifyPhoneAndMintAccess(linkToken, "01011112222");

        expect(wrong).toEqual({ ok: false, reason: "verification_failed" });
        expect(expired).toEqual(wrong);
        expect(locked).toEqual(wrong);
    });

    it("revokes an access token when its challenge is locked", async () => {
        const { prisma, svc } = setup();
        const { linkToken } = await svc.issueLink({
            branchId: BRANCH, scheduleId: 10, employeeId: 7, expectedPhone: "010-1111-2222", expiresAt: future(),
        });
        const result = await svc.verifyPhoneAndMintAccess(linkToken, "01011112222");
        const accessToken = (result as { ok: true; accessToken: string }).accessToken;

        prisma.__rows[0].lockedAt = new Date();

        await expect(svc.resolveAccess(accessToken)).resolves.toBeNull();
    });

    it("revokes by schedule (replacement/termination) so the old access stops working", async () => {
        const { svc } = setup();
        const { linkToken } = await svc.issueLink({
            branchId: BRANCH, scheduleId: 10, employeeId: 7, expectedPhone: "010-1111-2222", expiresAt: future(),
        });
        const accessToken = (
            (await svc.verifyPhoneAndMintAccess(linkToken, "01011112222")) as { ok: true; accessToken: string }
        ).accessToken;

        await svc.revokeForSchedule(10);

        expect(await svc.resolveAccess(accessToken)).toBeNull();
        expect(await svc.resolveLink(linkToken)).toBeNull();
    });

    it("a primary reassignment replaces the old URL and session with a new assignee link", async () => {
        const { prisma, svc } = setup();
        const params = { branchId: BRANCH, scheduleId: 10, employeeId: 7, expectedPhone: "010-1111-2222", expiresAt: future() };
        const first = await svc.issueLink(params);
        const oldAuth = await svc.verifyPhoneAndMintAccess(first.linkToken, "01011112222");
        if (!oldAuth.ok) throw new Error("fixture verification failed");
        prisma.__schedules[0]!.primaryEmployeeId = 8;
        prisma.__schedules[0]!.primaryEmployee = { id: 8, name: "QA-Next caregiver", phone: "010-3333-4444", deletedAt: null };

        expect(await svc.resolveLink(first.linkToken)).toBeNull();
        expect(await svc.resolveAccess(oldAuth.accessToken)).toBeNull();
        for (const phone of [params.expectedPhone, "01033334444"]) {
            expect(await svc.verifyPhoneAndMintAccess(first.linkToken, phone)).toEqual({ ok: false, reason: "verification_failed" });
        }
        await expect(svc.issueLink(params)).rejects.toMatchObject({ response: { code: "SERVICE_RECORD_WRITE_TARGET_CHANGED" } });
        const next = { ...params, employeeId: 8, expectedPhone: "01033334444" };
        const second = await svc.issueLink(next);
        expect(second.linkToken).not.toBe(first.linkToken);
        expect(await svc.issueLink(next)).toEqual(second);
        expect(await svc.resolveLink(first.linkToken)).toBeNull();
        expect(await svc.verifyPhoneAndMintAccess(second.linkToken, params.expectedPhone)).toMatchObject({ ok: false });
        expect(await svc.verifyPhoneAndMintAccess(second.linkToken, next.expectedPhone)).toMatchObject({ ok: true });
    });

    it("a replaced assignee cannot recover the old URL and a new employee receives a separate URL", async () => {
        const { prisma, svc } = setup();
        const params = { branchId: BRANCH, scheduleId: 10, employeeId: 7, serviceRecordCaseId: CASE, expectedPhone: "01011112222", expiresAt: future() };
        const first = await svc.issueLink(params);
        const auth = await svc.verifyPhoneAndMintAccess(first.linkToken, params.expectedPhone);
        if (!auth.ok) throw new Error("fixture verification failed");
        prisma.__schedules[0]!.replaced = true;
        prisma.__schedules.push({ ...prisma.__schedules[0]!, id: 11, replaced: false, primaryEmployeeId: 8,
            primaryEmployee: { id: 8, name: "QA-Next caregiver", phone: "01033334444", deletedAt: null } });
        expect(await svc.resolveAccess(auth.accessToken)).toBeNull();
        expect(await svc.resolveLink(first.linkToken)).toBeNull();
        for (const phone of [params.expectedPhone, "01033334444"]) {
            expect(await svc.verifyPhoneAndMintAccess(first.linkToken, phone)).toMatchObject({ ok: false });
        }
        await svc.revokeForSchedule(10);
        await expect(svc.issueLink(params)).rejects.toMatchObject({ response: { code: "SERVICE_RECORD_WRITE_TARGET_CHANGED" } });
        const next = { ...params, scheduleId: 11, employeeId: 8, expectedPhone: "01033334444" };
        const resend = await svc.issueLink(next);
        expect(resend.linkToken).not.toBe(first.linkToken);
        expect(await svc.issueLink(next)).toEqual(resend);
        expect(prisma.__rows).toHaveLength(2);
        expect(await svc.resolveLink(first.linkToken)).toBeNull();
        expect(await svc.verifyPhoneAndMintAccess(resend.linkToken, params.expectedPhone)).toMatchObject({ ok: false });
        const nextAuth = await svc.verifyPhoneAndMintAccess(resend.linkToken, next.expectedPhone);
        if (!nextAuth.ok) throw new Error("fresh verification failed");
        expect(await svc.resolveAccess(nextAuth.accessToken)).toMatchObject({ scheduleId: 11, employeeId: 8 });
    });

    it("rejects an old session and old phone as soon as the registered phone changes", async () => {
        const { prisma, svc } = setup();
        const first = await svc.issueLink({ branchId: BRANCH, scheduleId: 10, employeeId: 7, expectedPhone: "01011112222", expiresAt: future() });
        const auth = await svc.verifyPhoneAndMintAccess(first.linkToken, "01011112222");
        prisma.__schedules[0]!.primaryEmployee.phone = "01033334444";
        if (auth.ok) expect(await svc.resolveAccess(auth.accessToken)).toBeNull();
        expect(await svc.verifyPhoneAndMintAccess(first.linkToken, "01011112222")).toMatchObject({ ok: false });
        expect(await svc.verifyPhoneAndMintAccess(first.linkToken, "01033334444")).toMatchObject({ ok: true });
    });

    it("does not reset a locked challenge on resend; explicit reset retains the URL", async () => {
        const { prisma, svc } = setup();
        const params = { branchId: BRANCH, scheduleId: 10, employeeId: 7, expectedPhone: "01011112222", expiresAt: future() };
        const first = await svc.issueLink(params);
        for (let i = 0; i < 5; i++) await svc.verifyPhoneAndMintAccess(first.linkToken, "wrong");
        expect(await svc.issueLink(params)).toEqual(first);
        expect(prisma.__rows[0].lockedAt).not.toBeNull();
        expect(await svc.issueLink({ ...params, resetChallenge: true })).toEqual(first);
        expect(prisma.__rows[0].lockedAt).toBeNull();
        expect(await svc.verifyPhoneAndMintAccess(first.linkToken, params.expectedPhone)).toMatchObject({ ok: true });
    });

    it("rejects a branch mismatch and refuses access when no current assignment remains", async () => {
        const { prisma, svc } = setup();
        const params = { branchId: BRANCH, scheduleId: 10, employeeId: 7, expectedPhone: "01011112222", expiresAt: future() };
        await expect(svc.issueLink({ ...params, branchId: OTHER_BRANCH })).rejects.toMatchObject({ response: { code: "SERVICE_RECORD_WRITE_TARGET_CHANGED" } });
        const first = await svc.issueLink(params);
        const auth = await svc.verifyPhoneAndMintAccess(first.linkToken, params.expectedPhone);
        prisma.__schedules[0]!.replaced = true;
        expect(await svc.resolveLink(first.linkToken)).toBeNull();
        expect(await svc.verifyPhoneAndMintAccess(first.linkToken, params.expectedPhone)).toMatchObject({ ok: false });
        if (auth.ok) expect(await svc.resolveAccess(auth.accessToken)).toBeNull();
    });

    it("reuses the active link for the same provider and extends its expiry without clearing verification", async () => {
        const { prisma, svc } = setup();
        const firstExpiry = future();
        const { linkToken } = await svc.issueLink({
            branchId: BRANCH,
            scheduleId: 10,
            employeeId: 7,
            expectedPhone: "010-1111-2222",
            expiresAt: firstExpiry,
        });
        await svc.verifyPhoneAndMintAccess(linkToken, "01011112222");
        const verifiedAt = prisma.__rows[0].verifiedAt;
        const accessTokenHash = prisma.__rows[0].accessTokenHash;
        prisma.__rows[0].expiresAt = new Date(Date.now() - 1000);
        const extendedExpiry = new Date(firstExpiry.getTime() + 24 * 60 * 60 * 1000);

        await expect(svc.reuseActiveLink({
            branchId: BRANCH,
            scheduleId: 10,
            employeeId: 7,
            expectedPhone: "01011112222",
            expiresAt: extendedExpiry,
        })).resolves.toEqual({ linkToken });

        expect(prisma.__rows).toHaveLength(1);
        expect(prisma.__rows[0]).toMatchObject({
            linkTokenHash: linkToken,
            active: true,
            revokedAt: null,
            verifiedAt,
            accessTokenHash,
            expiresAt: extendedExpiry,
        });
    });

    it("does not reuse a link after the provider identity changes or the token is revoked", async () => {
        const { svc } = setup();
        await svc.issueLink({
            branchId: BRANCH,
            scheduleId: 10,
            employeeId: 7,
            expectedPhone: "010-1111-2222",
            expiresAt: future(),
        });

        await expect(svc.reuseActiveLink({
            branchId: BRANCH,
            scheduleId: 10,
            employeeId: 8,
            expectedPhone: "010-1111-2222",
            expiresAt: future(),
        })).resolves.toBeNull();
        await expect(svc.reuseActiveLink({
            branchId: BRANCH,
            scheduleId: 10,
            employeeId: 7,
            expectedPhone: "010-9999-9999",
            expiresAt: future(),
        })).resolves.toBeNull();

        await svc.revokeForSchedule(10);

        await expect(svc.reuseActiveLink({
            branchId: BRANCH,
            scheduleId: 10,
            employeeId: 7,
            expectedPhone: "010-1111-2222",
            expiresAt: future(),
        })).resolves.toBeNull();
    });

    it("does not return a link when it is revoked between lookup and expiry extension", async () => {
        const { prisma, svc } = setup();
        await svc.issueLink({
            branchId: BRANCH,
            scheduleId: 10,
            employeeId: 7,
            expectedPhone: "010-1111-2222",
            expiresAt: future(),
        });
        prisma.service_record_token.updateMany.mockResolvedValueOnce({ count: 0 });

        await expect(svc.reuseActiveLink({
            branchId: BRANCH,
            scheduleId: 10,
            employeeId: 7,
            expectedPhone: "010-1111-2222",
            expiresAt: future(),
        })).resolves.toBeNull();
    });

    it("prepares an inactive link that cannot be used before an admin sends it", async () => {
        const { prisma, svc } = setup();
        const prepared = await svc.prepareLink({
            branchId: BRANCH, scheduleId: 10, employeeId: 7, expectedPhone: "010-1111-2222", expiresAt: future(),
        });

        expect(prisma.__rows[0]).toMatchObject({
            branchId: BRANCH,
            scheduleId: 10,
            employeeId: 7,
            active: false,
            revokedAt: null,
        });
        expect(await svc.resolveLink(prepared.linkToken)).toBeNull();
    });

    it("keeps the same URL through preview and activation", async () => {
        const { svc } = setup();
        const previous = await svc.issueLink({
            branchId: BRANCH, scheduleId: 10, employeeId: 7, expectedPhone: "010-1111-2222", expiresAt: future(),
        });
        const prepared = await svc.prepareLink({
            branchId: BRANCH, scheduleId: 10, employeeId: 7, expectedPhone: "010-1111-2222", expiresAt: future(),
        });
        const activatedExpiry = future();

        await expect(svc.activatePreparedLink({
            linkToken: prepared.linkToken,
            branchId: BRANCH,
            scheduleId: 10,
            employeeId: 7,
            expectedPhone: "01011112222",
            expiresAt: activatedExpiry,
        })).resolves.toBe(true);

        expect(prepared.linkToken).toBe(previous.linkToken);
        expect(await svc.resolveLink(previous.linkToken)).toMatchObject({ active: true });
        expect(await svc.resolveLink(prepared.linkToken)).toMatchObject({
            branchId: BRANCH,
            scheduleId: 10,
            employeeId: 7,
            active: true,
            expiresAt: activatedExpiry,
        });
    });

    it("does not activate a prepared link for a different assignment or phone", async () => {
        const { svc } = setup();
        const prepared = await svc.prepareLink({
            branchId: BRANCH, scheduleId: 10, employeeId: 7, expectedPhone: "010-1111-2222", expiresAt: future(),
        });

        await expect(svc.activatePreparedLink({
            linkToken: prepared.linkToken,
            branchId: BRANCH,
            scheduleId: 11,
            employeeId: 7,
            expectedPhone: "010-1111-2222",
            expiresAt: future(),
        })).resolves.toBe(false);
        await expect(svc.activatePreparedLink({
            linkToken: prepared.linkToken,
            branchId: BRANCH,
            scheduleId: 10,
            employeeId: 7,
            expectedPhone: "010-9999-9999",
            expiresAt: future(),
        })).resolves.toBe(false);
        expect(await svc.resolveLink(prepared.linkToken)).toBeNull();
    });

    it("does not activate a token prepared before lockout after the active challenge is locked", async () => {
        const { prisma, svc } = setup();
        const previous = await svc.issueLink({
            branchId: BRANCH, scheduleId: 10, employeeId: 7, expectedPhone: "010-1111-2222", expiresAt: future(),
        });
        const prepared = await svc.prepareLink({
            branchId: BRANCH, scheduleId: 10, employeeId: 7, expectedPhone: "010-1111-2222", expiresAt: future(),
        });

        for (let i = 0; i < 5; i++) {
            await svc.verifyPhoneAndMintAccess(previous.linkToken, "01000000000");
        }

        expect(prisma.__rows[0]).toMatchObject({ active: true, lockedAt: expect.any(Date) });
        await expect(svc.activatePreparedLink({
            linkToken: prepared.linkToken,
            branchId: BRANCH,
            scheduleId: 10,
            employeeId: 7,
            expectedPhone: "01011112222",
            expiresAt: future(),
        })).resolves.toBe(false);

        expect(prisma.__rows[0]).toMatchObject({ active: true, lockedAt: expect.any(Date) });
        expect(prisma.__rows).toHaveLength(1);
        expect(prepared.linkToken).toBe(previous.linkToken);
        expect(await svc.resolveLink(prepared.linkToken)).toBeNull();
    });

    it("locks active assignment rows before activating the persistent link", async () => {
        const { prisma, svc } = setup();
        const previous = await svc.issueLink({
            branchId: BRANCH, scheduleId: 10, employeeId: 7, expectedPhone: "010-1111-2222", expiresAt: future(),
        });
        const prepared = await svc.prepareLink({
            branchId: BRANCH, scheduleId: 10, employeeId: 7, expectedPhone: "010-1111-2222", expiresAt: future(),
        });
        const order: string[] = [];
        const queryRaw = jest.fn(async (query: { sql?: string }) => {
            order.push(query.sql ?? "");
            return [{ lockedAt: null }];
        });
        (prisma as any).$queryRaw = queryRaw;
        const revoke = prisma.service_record_token.updateMany;
        prisma.service_record_token.updateMany = jest.fn(async (args: any) => {
            if (args.data.revokedAt) order.push("revoke");
            return revoke(args);
        });

        await expect(svc.activatePreparedLink({
            linkToken: prepared.linkToken,
            branchId: BRANCH,
            scheduleId: 10,
            employeeId: 7,
            expectedPhone: "01011112222",
            expiresAt: future(),
        })).resolves.toBe(true);

        expect(queryRaw).toHaveBeenCalledTimes(1);
        expect(order[0]).toContain("FOR UPDATE");
        expect(order).toHaveLength(1);
        expect(prepared.linkToken).toBe(previous.linkToken);
        expect(await svc.resolveLink(previous.linkToken)).toMatchObject({ active: true });
        expect(await svc.resolveLink(prepared.linkToken)).toMatchObject({ active: true });
    });
});

describe("caregiver token expiry window", () => {
    it("expires at end + 8 midnight KST", () => {
        const expiresAt = getServiceRecordTokenExpiresAt(new Date("2026-11-17T00:00:00.000Z"));
        expect(expiresAt.toISOString()).toBe("2026-11-24T15:00:00.000Z");
    });

    it.each([
        ["2026-11-24T23:59:59+09:00", true],
        ["2026-11-25T00:00:00+09:00", false],
    ] as const)("is usable at %s: %s", (now, expected) => {
        const token = {
            active: true,
            revokedAt: null,
            verifiedAt: new Date("2026-11-17T00:00:00.000Z"),
            lockedAt: null,
            failedAttempts: 0,
            expiresAt: getServiceRecordTokenExpiresAt(new Date("2026-11-17T00:00:00.000Z")),
        };
        expect(isServiceRecordAccessTokenUsable(token, Date.parse(now))).toBe(expected);
    });
});
