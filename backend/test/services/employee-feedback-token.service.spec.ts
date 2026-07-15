import { EmployeeFeedbackTokenService } from "../../application/services/employee-feedback-token.service";

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
        const { prisma, svc } = setup();
        const { linkToken } = await svc.issueLink({
            branchId: "b1", scheduleId: 10, employeeId: 7, expectedPhone: "010-1111-2222", expiresAt: future(),
        });

        expect(prisma.__rows[0].linkTokenHash).toBe(linkToken);

        // normalized phone compare: "01011112222" must match "010-1111-2222"
        const result = await svc.verifyPhoneAndMintAccess(linkToken, "01011112222");
        expect(result.ok).toBe(true);

        const accessToken = (result as { ok: true; accessToken: string }).accessToken;
        const ctx = await svc.resolveAccess(accessToken);
        expect(ctx).toEqual({ tokenId: expect.any(String), branchId: "b1", scheduleId: 10, employeeId: 7 });
    });

    it("rejects a wrong phone number without limit, and a correct one still works after many wrong tries", async () => {
        const { prisma, svc } = setup();
        const { linkToken } = await svc.issueLink({
            branchId: "b1", scheduleId: 10, employeeId: 7, expectedPhone: "010-1111-2222", expiresAt: future(),
        });

        // No lockout: every wrong attempt just returns wrong_phone, never "locked".
        for (let i = 0; i < 12; i++) {
            expect(await svc.verifyPhoneAndMintAccess(linkToken, "01000000000")).toEqual({ ok: false, reason: "wrong_phone" });
        }
        expect(prisma.__rows[0].failedAttempts).toBe(12); // still counted for audit

        // The correct phone number still mints an access token despite the wrong tries.
        expect(await svc.verifyPhoneAndMintAccess(linkToken, "010-1111-2222")).toMatchObject({ ok: true });
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

    it("prepares an inactive link that cannot be used before an admin sends it", async () => {
        const { prisma, svc } = setup();
        const prepared = await svc.prepareLink({
            branchId: "b1", scheduleId: 10, employeeId: 7, expectedPhone: "010-1111-2222", expiresAt: future(),
        });

        expect(prisma.__rows[0]).toMatchObject({
            branchId: "b1",
            scheduleId: 10,
            employeeId: 7,
            active: false,
            revokedAt: null,
        });
        expect(await svc.resolveLink(prepared.linkToken)).toBeNull();
    });

    it("activates the exact prepared link and revokes the previously active link", async () => {
        const { svc } = setup();
        const previous = await svc.issueLink({
            branchId: "b1", scheduleId: 10, employeeId: 7, expectedPhone: "010-1111-2222", expiresAt: future(),
        });
        const prepared = await svc.prepareLink({
            branchId: "b1", scheduleId: 10, employeeId: 7, expectedPhone: "010-1111-2222", expiresAt: future(),
        });
        const activatedExpiry = future();

        await expect(svc.activatePreparedLink({
            linkToken: prepared.linkToken,
            branchId: "b1",
            scheduleId: 10,
            employeeId: 7,
            expectedPhone: "01011112222",
            expiresAt: activatedExpiry,
        })).resolves.toBe(true);

        expect(await svc.resolveLink(previous.linkToken)).toBeNull();
        expect(await svc.resolveLink(prepared.linkToken)).toMatchObject({
            branchId: "b1",
            scheduleId: 10,
            employeeId: 7,
            active: true,
            expiresAt: activatedExpiry,
        });
    });

    it("does not activate a prepared link for a different assignment or phone", async () => {
        const { svc } = setup();
        const prepared = await svc.prepareLink({
            branchId: "b1", scheduleId: 10, employeeId: 7, expectedPhone: "010-1111-2222", expiresAt: future(),
        });

        await expect(svc.activatePreparedLink({
            linkToken: prepared.linkToken,
            branchId: "b1",
            scheduleId: 11,
            employeeId: 7,
            expectedPhone: "010-1111-2222",
            expiresAt: future(),
        })).resolves.toBe(false);
        await expect(svc.activatePreparedLink({
            linkToken: prepared.linkToken,
            branchId: "b1",
            scheduleId: 10,
            employeeId: 7,
            expectedPhone: "010-9999-9999",
            expiresAt: future(),
        })).resolves.toBe(false);
        expect(await svc.resolveLink(prepared.linkToken)).toBeNull();
    });
});
