import {
    EmployeeFeedbackTokenService,
    MAX_PHONE_ATTEMPTS,
} from "../../application/services/employee-feedback-token.service";

/** Minimal in-memory fake of the prisma employee_feedback_token delegate. */
function makePrismaMock() {
    const rows: any[] = [];
    let seq = 0;
    const prisma = {
        __rows: rows,
        employee_feedback_token: {
            create: jest.fn(async ({ data }: any) => {
                const row = {
                    id: `id${++seq}`,
                    active: true,
                    revokedAt: null,
                    verifiedAt: null,
                    failedAttempts: 0,
                    accessTokenHash: null,
                    ...data,
                };
                rows.push(row);
                return row;
            }),
            findUnique: jest.fn(async ({ where }: any) => {
                if (where.linkTokenHash) return rows.find((r) => r.linkTokenHash === where.linkTokenHash) ?? null;
                if (where.accessTokenHash) return rows.find((r) => r.accessTokenHash === where.accessTokenHash) ?? null;
                if (where.id) return rows.find((r) => r.id === where.id) ?? null;
                return null;
            }),
            update: jest.fn(async ({ where, data }: any) => {
                const row = rows.find((r) => r.id === where.id);
                for (const k of Object.keys(data)) {
                    const v = data[k];
                    if (v && typeof v === "object" && "increment" in v) row[k] = (row[k] ?? 0) + v.increment;
                    else row[k] = v;
                }
                return row;
            }),
            updateMany: jest.fn(async ({ where, data }: any) => {
                let count = 0;
                for (const r of rows) {
                    const scheduleMatches = where.scheduleId === undefined || r.scheduleId === where.scheduleId;
                    const orMatches = !where.OR || where.OR.some((clause: any) => (
                        (clause.scheduleId !== undefined && r.scheduleId === clause.scheduleId)
                        || (clause.serviceRecordCaseId !== undefined && r.serviceRecordCaseId === clause.serviceRecordCaseId)
                    ));
                    if (scheduleMatches && orMatches && (where.active === undefined || r.active === where.active)) {
                        Object.assign(r, data);
                        count++;
                    }
                }
                return { count };
            }),
        },
    };
    return Object.assign(prisma, {
        $transaction: jest.fn(async (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma)),
    });
}

const future = () => new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);

describe("EmployeeFeedbackTokenService", () => {
    function setup() {
        const prisma = makePrismaMock();
        const svc = new EmployeeFeedbackTokenService(prisma as any);
        return { prisma, svc };
    }

    it("issues a link, then a correct phone number mints an access token that resolves to the assignment context", async () => {
        const { svc } = setup();
        const { linkToken } = await svc.issueLink({
            branchId: "b1", scheduleId: 10, employeeId: 7, expectedPhone: "010-1111-2222", expiresAt: future(),
        });

        // normalized phone compare: "01011112222" must match "010-1111-2222"
        const result = await svc.verifyPhoneAndMintAccess(linkToken, "01011112222");
        expect(result.ok).toBe(true);

        const accessToken = (result as { ok: true; accessToken: string }).accessToken;
        const ctx = await svc.resolveAccess(accessToken);
        expect(ctx).toEqual({ tokenId: expect.any(String), branchId: "b1", scheduleId: 10, employeeId: 7 });
    });

    it("rejects a wrong phone number, counts down attempts, and locks after MAX_PHONE_ATTEMPTS", async () => {
        const { svc } = setup();
        const { linkToken } = await svc.issueLink({
            branchId: "b1", scheduleId: 10, employeeId: 7, expectedPhone: "010-1111-2222", expiresAt: future(),
        });

        for (let i = 1; i < MAX_PHONE_ATTEMPTS; i++) {
            const r = await svc.verifyPhoneAndMintAccess(linkToken, "01000000000");
            expect(r).toMatchObject({ ok: false, reason: "wrong_phone", attemptsLeft: MAX_PHONE_ATTEMPTS - i });
        }
        // the MAX-th wrong attempt locks
        expect(await svc.verifyPhoneAndMintAccess(linkToken, "01000000000")).toMatchObject({ ok: false, reason: "locked" });
        // a correct phone number no longer works once locked
        expect(await svc.verifyPhoneAndMintAccess(linkToken, "010-1111-2222")).toMatchObject({ ok: false, reason: "locked" });
    });

    it("treats an expired token as unusable for both link resolution and access", async () => {
        const { prisma, svc } = setup();
        const { linkToken } = await svc.issueLink({
            branchId: "b1", scheduleId: 10, employeeId: 7, expectedPhone: "010-1111-2222", expiresAt: future(),
        });
        const verify = await svc.verifyPhoneAndMintAccess(linkToken, "01011112222");
        const accessToken = (verify as { ok: true; accessToken: string }).accessToken;

        // force expiry
        prisma.__rows[0].expiresAt = new Date(Date.now() - 1000);

        expect(await svc.resolveLink(linkToken)).toBeNull();
        expect(await svc.resolveAccess(accessToken)).toBeNull();
    });

    it("revokes by schedule (replacement/termination) so the old access stops working", async () => {
        const { svc } = setup();
        const { linkToken } = await svc.issueLink({
            branchId: "b1", scheduleId: 10, employeeId: 7, expectedPhone: "010-1111-2222", expiresAt: future(),
        });
        const accessToken = (
            (await svc.verifyPhoneAndMintAccess(linkToken, "01011112222")) as { ok: true; accessToken: string }
        ).accessToken;

        await svc.revokeForSchedule(10);

        expect(await svc.resolveAccess(accessToken)).toBeNull();
        expect(await svc.resolveLink(linkToken)).toBeNull();
    });

    it("re-issuing a link for the same schedule revokes the prior link", async () => {
        const { svc } = setup();
        const first = await svc.issueLink({
            branchId: "b1", scheduleId: 10, employeeId: 7, expectedPhone: "010-1111-2222", expiresAt: future(),
        });
        await svc.issueLink({
            branchId: "b1", scheduleId: 10, employeeId: 8, expectedPhone: "010-3333-4444", expiresAt: future(),
        });

        // the first (now-replaced) provider's link is dead
        expect(await svc.resolveLink(first.linkToken)).toBeNull();
    });
});
