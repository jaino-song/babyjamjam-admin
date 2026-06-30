import {
    EmployeeFeedbackTokenService,
    MAX_DOB_ATTEMPTS,
} from "../../application/services/employee-feedback-token.service";

/** Minimal in-memory fake of the prisma employee_feedback_token delegate. */
function makePrismaMock() {
    const rows: any[] = [];
    let seq = 0;
    return {
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
                    if (r.scheduleId === where.scheduleId && (where.active === undefined || r.active === where.active)) {
                        Object.assign(r, data);
                        count++;
                    }
                }
                return { count };
            }),
        },
    };
}

const future = () => new Date(Date.now() + 15 * 24 * 60 * 60 * 1000);

describe("EmployeeFeedbackTokenService", () => {
    function setup() {
        const prisma = makePrismaMock();
        const svc = new EmployeeFeedbackTokenService(prisma as any);
        return { prisma, svc };
    }

    it("issues a link, then a correct DOB mints an access token that resolves to the assignment context", async () => {
        const { svc } = setup();
        const { linkToken } = await svc.issueLink({
            branchId: "b1", scheduleId: 10, employeeId: 7, expectedDob: "900101", expiresAt: future(),
        });

        // normalized DOB compare: "90-01-01" must match "900101"
        const result = await svc.verifyDobAndMintAccess(linkToken, "90-01-01");
        expect(result.ok).toBe(true);

        const accessToken = (result as { ok: true; accessToken: string }).accessToken;
        const ctx = await svc.resolveAccess(accessToken);
        expect(ctx).toEqual({ tokenId: expect.any(String), branchId: "b1", scheduleId: 10, employeeId: 7 });
    });

    it("rejects a wrong DOB, counts down attempts, and locks after MAX_DOB_ATTEMPTS", async () => {
        const { svc } = setup();
        const { linkToken } = await svc.issueLink({
            branchId: "b1", scheduleId: 10, employeeId: 7, expectedDob: "900101", expiresAt: future(),
        });

        for (let i = 1; i < MAX_DOB_ATTEMPTS; i++) {
            const r = await svc.verifyDobAndMintAccess(linkToken, "000000");
            expect(r).toMatchObject({ ok: false, reason: "wrong_dob", attemptsLeft: MAX_DOB_ATTEMPTS - i });
        }
        // the MAX-th wrong attempt locks
        expect(await svc.verifyDobAndMintAccess(linkToken, "000000")).toMatchObject({ ok: false, reason: "locked" });
        // a correct DOB no longer works once locked
        expect(await svc.verifyDobAndMintAccess(linkToken, "900101")).toMatchObject({ ok: false, reason: "locked" });
    });

    it("treats an expired token as unusable for both link resolution and access", async () => {
        const { prisma, svc } = setup();
        const { linkToken } = await svc.issueLink({
            branchId: "b1", scheduleId: 10, employeeId: 7, expectedDob: "900101", expiresAt: future(),
        });
        const verify = await svc.verifyDobAndMintAccess(linkToken, "900101");
        const accessToken = (verify as { ok: true; accessToken: string }).accessToken;

        // force expiry
        prisma.__rows[0].expiresAt = new Date(Date.now() - 1000);

        expect(await svc.resolveLink(linkToken)).toBeNull();
        expect(await svc.resolveAccess(accessToken)).toBeNull();
    });

    it("revokes by schedule (replacement/termination) so the old access stops working", async () => {
        const { svc } = setup();
        const { linkToken } = await svc.issueLink({
            branchId: "b1", scheduleId: 10, employeeId: 7, expectedDob: "900101", expiresAt: future(),
        });
        const accessToken = (
            (await svc.verifyDobAndMintAccess(linkToken, "900101")) as { ok: true; accessToken: string }
        ).accessToken;

        await svc.revokeForSchedule(10);

        expect(await svc.resolveAccess(accessToken)).toBeNull();
        expect(await svc.resolveLink(linkToken)).toBeNull();
    });

    it("re-issuing a link for the same schedule revokes the prior link", async () => {
        const { svc } = setup();
        const first = await svc.issueLink({
            branchId: "b1", scheduleId: 10, employeeId: 7, expectedDob: "900101", expiresAt: future(),
        });
        await svc.issueLink({
            branchId: "b1", scheduleId: 10, employeeId: 8, expectedDob: "880312", expiresAt: future(),
        });

        // the first (now-replaced) provider's link is dead
        expect(await svc.resolveLink(first.linkToken)).toBeNull();
    });
});
