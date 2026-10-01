import { NotificationAgentCapabilitiesProvider } from "./notification-agent-capabilities.provider";

/**
 * resolveNotificationTarget (BJJ-357 follow-up) now gates on
 * userRepository.findApprovedByIdInBranch before trusting a membership/owner
 * match. Tests that exercise inspect/revalidate/executeApprovedTarget need a
 * fresh stub per test (never shared, to avoid cross-test mock leakage); tests
 * that never reach resolveNotificationTarget (classifyOutcome, reconcile)
 * pass `{} as never` since the constructor param is unused there.
 */
function userRepositoryStub(result: unknown) {
    return { findApprovedByIdInBranch: jest.fn().mockResolvedValue(result) };
}

const context = {
    actionId: "action-1",
    sessionId: "session-1",
    traceId: "trace-1",
    locale: "ko",
    principal: { userId: "user-1", branchId: "branch-1", globalRole: "admin", branchRole: "admin" },
};

describe("NotificationAgentCapabilitiesProvider", () => {
    const targetUserId = "11111111-1111-4111-8111-111111111111";
    const member = {
        id: "membership-1",
        role: "admin",
        joinedAt: new Date("2026-08-04T00:00:00.000Z"),
        user: { name: "홍길동", phone: "010-1234-5678", email: "member@example.com" },
    };
    const branchOwner = {
        ownerId: "owner-1",
        owner: { name: "김대표", phone: null, email: "owner@example.com" },
    };
    it.each(["disabled", "no-subscriptions", "failed"])("classifies %s delivery as a failed action", (status) => {
        const provider = new NotificationAgentCapabilitiesProvider({} as never, {} as never, {} as never);
        const capability = provider.getCapabilities()[0]!;

        expect(capability.classifyOutcome?.({ status, subscriptions: 2, delivered: 1, failed: 1 })).toEqual(
            expect.objectContaining({ status: "failed" }),
        );
    });

    it.each(["partial", "uncertain"])("classifies %s delivery as uncertain", (status) => {
        const provider = new NotificationAgentCapabilitiesProvider({} as never, {} as never, {} as never);
        const capability = provider.getCapabilities()[0]!;

        expect(capability.classifyOutcome?.({ status, subscriptions: 3, delivered: 2, failed: 1 })).toEqual(
            expect.objectContaining({ status: "uncertain" }),
        );
    });

    it("classifies complete delivery as success", () => {
        const provider = new NotificationAgentCapabilitiesProvider({} as never, {} as never, {} as never);
        const capability = provider.getCapabilities()[0]!;

        expect(capability.classifyOutcome?.({ status: "delivered", subscriptions: 2, delivered: 2, failed: 0 })).toEqual({ status: "succeeded" });
    });

    it("preserves a persisted partial outcome during reconciliation", async () => {
        const prisma = { notification: { findFirst: jest.fn().mockResolvedValue({
            id: 9,
            data: { providerOutcome: { status: "partial", subscriptions: 2, delivered: 1, failed: 1 } },
        }) } };
        const provider = new NotificationAgentCapabilitiesProvider({} as never, prisma as never, {} as never);
        const capability = provider.getCapabilities()[0]!;

        await expect(capability.reconcile?.(context, {}, null)).resolves.toEqual({
            status: "uncertain",
            reason: "Persisted Web Push outcome remains uncertain",
        });
    });

    it("keeps a notification without a persisted provider outcome uncertain", async () => {
        const prisma = { notification: { findFirst: jest.fn().mockResolvedValue({ id: 10, data: { agentActionId: "action-1" } }) } };
        const provider = new NotificationAgentCapabilitiesProvider({} as never, prisma as never, {} as never);
        const capability = provider.getCapabilities()[0]!;

        await expect(capability.reconcile?.(context, {}, null)).resolves.toEqual({
            status: "uncertain",
            reason: "Persisted Web Push outcome remains uncertain",
        });
    });

    it("resolves a branch member into a masked human-verifiable approval snapshot and summary", async () => {
        const prisma = {
            user_branch: { findFirst: jest.fn().mockResolvedValue(member) },
            branch: { findUnique: jest.fn().mockResolvedValue(branchOwner) },
        };
        const provider = new NotificationAgentCapabilitiesProvider(
            {} as never, prisma as never, userRepositoryStub({ id: targetUserId }) as never,
        );
        const capability = provider.getCapabilities()[0]!;

        const inspection = await capability.inspect!(context, { userId: targetUserId, title: "테스트", body: "본문" });
        const serialized = JSON.stringify(inspection);

        expect(inspection.targetSnapshot).toEqual({ userId: targetUserId, name: "홍길동", maskedContact: "010-****-5678" });
        expect(inspection.summary).toContain("홍길동");
        expect(inspection.summary).toContain("010-****-5678");
        expect(serialized).not.toContain("010-1234-5678");
        expect(serialized).not.toContain("member@example.com");
    });

    it("resolves a branch owner with a masked email when no member row exists", async () => {
        const prisma = {
            user_branch: { findFirst: jest.fn().mockResolvedValue(null) },
            branch: { findUnique: jest.fn().mockResolvedValue({ ...branchOwner, ownerId: targetUserId }) },
        };
        const provider = new NotificationAgentCapabilitiesProvider(
            {} as never, prisma as never, userRepositoryStub({ id: targetUserId }) as never,
        );
        const capability = provider.getCapabilities()[0]!;

        const inspection = await capability.inspect!(context, { userId: targetUserId, title: "테스트", body: "본문" });

        expect(inspection.targetSnapshot).toEqual({ userId: targetUserId, name: "김대표", maskedContact: "o***@example.com" });
        expect(inspection.summary).toContain("김대표");
        expect(inspection.summary).toContain("o***@example.com");
    });

    it("rejects a user who is neither a member nor the branch owner", async () => {
        const prisma = {
            user_branch: { findFirst: jest.fn().mockResolvedValue(null) },
            branch: { findUnique: jest.fn().mockResolvedValue(branchOwner) },
        };
        // Approved so the rejection below is attributable to the membership/owner
        // check, not the approval gate — that gate has its own tests further down.
        const provider = new NotificationAgentCapabilitiesProvider(
            {} as never, prisma as never, userRepositoryStub({ id: targetUserId }) as never,
        );
        const capability = provider.getCapabilities()[0]!;

        await expect(capability.inspect!(context, { userId: targetUserId, title: "테스트", body: "본문" }))
            .rejects.toThrow("outside the current branch");
    });

    it("rejects a pending (non-owner) branch member, same error path as a non-member (BJJ-357 follow-up)", async () => {
        const prisma = {
            user_branch: { findFirst: jest.fn().mockResolvedValue(member) },
            branch: { findUnique: jest.fn().mockResolvedValue(branchOwner) },
        };
        const userRepository = userRepositoryStub(null);
        const provider = new NotificationAgentCapabilitiesProvider({} as never, prisma as never, userRepository as never);
        const capability = provider.getCapabilities()[0]!;

        await expect(capability.inspect!(context, { userId: targetUserId, title: "테스트", body: "본문" }))
            .rejects.toThrow("outside the current branch");
        expect(userRepository.findApprovedByIdInBranch).toHaveBeenCalledWith(targetUserId, context.principal.branchId);
    });

    it("rejects a rejected branch member, same error path as a non-member (BJJ-357 follow-up)", async () => {
        const prisma = {
            user_branch: { findFirst: jest.fn().mockResolvedValue(member) },
            branch: { findUnique: jest.fn().mockResolvedValue(branchOwner) },
        };
        const provider = new NotificationAgentCapabilitiesProvider(
            {} as never, prisma as never, userRepositoryStub(null) as never,
        );
        const capability = provider.getCapabilities()[0]!;

        await expect(capability.inspect!(context, { userId: targetUserId, title: "테스트", body: "본문" }))
            .rejects.toThrow("outside the current branch");
    });

    it("resolves a pending-approval owner via the branch-owner fallback, matching the login rule (BJJ-357 follow-up)", async () => {
        const prisma = {
            user_branch: { findFirst: jest.fn().mockResolvedValue(null) },
            branch: { findUnique: jest.fn().mockResolvedValue({ ...branchOwner, ownerId: targetUserId }) },
        };
        // Owners bypass approvalStatus per the login rule (auth.service.ts /
        // auth-session.service.ts assertUserApproved) — findApprovedByIdInBranch
        // itself implements that OR, so a truthy result here simulates a
        // pending-approval owner being let through.
        const provider = new NotificationAgentCapabilitiesProvider(
            {} as never, prisma as never, userRepositoryStub({ id: targetUserId }) as never,
        );
        const capability = provider.getCapabilities()[0]!;

        const inspection = await capability.inspect!(context, { userId: targetUserId, title: "테스트", body: "본문" });

        expect(inspection.targetSnapshot).toMatchObject({ userId: targetUserId, name: "김대표" });
    });

    it.each([
        ["name", { name: "변경된 이름" }],
        ["phone", { phone: "010-9876-5432" }],
        ["email", { email: "changed@example.com" }],
    ])("invalidates approval when the target %s changes", async (_field, change) => {
        const findMember = jest.fn().mockResolvedValue(member);
        const prisma = {
            user_branch: { findFirst: findMember },
            branch: { findUnique: jest.fn().mockResolvedValue(branchOwner) },
        };
        const provider = new NotificationAgentCapabilitiesProvider(
            {} as never, prisma as never, userRepositoryStub({ id: targetUserId }) as never,
        );
        const capability = provider.getCapabilities()[0]!;
        const inspection = await capability.inspect!(context, { userId: targetUserId, title: "테스트", body: "본문" });

        findMember.mockResolvedValue({ ...member, user: { ...member.user, ...change } });
        await expect(capability.revalidate!(context, { userId: targetUserId, title: "테스트", body: "본문" }, inspection.targetVersion!))
            .resolves.toEqual(expect.objectContaining({ valid: false }));
    });

    it("requires the approved membership version at the atomic execution boundary", async () => {
        const prisma = {
            $transaction: jest.fn(),
            notification: { findFirst: jest.fn().mockResolvedValue(null) },
            user_branch: { findFirst: jest.fn().mockResolvedValue(member) },
            branch: { findUnique: jest.fn().mockResolvedValue(branchOwner) },
            user: { findUnique: jest.fn().mockResolvedValue({ approvalStatus: "approved", role: "admin" }) },
            agent_action: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        };
        prisma.$transaction.mockImplementation(async (callback: (transaction: typeof prisma) => Promise<unknown>) => callback(prisma));
        const sendNotification = { executeWithOutcome: jest.fn() };
        const provider = new NotificationAgentCapabilitiesProvider(
            sendNotification as never, prisma as never, userRepositoryStub({ id: targetUserId }) as never,
        );
        const capability = provider.getCapabilities()[0]!;
        const expected = await capability.inspect!(context, { userId: targetUserId, title: "테스트", body: "본문" });

        prisma.user_branch.findFirst.mockResolvedValue({ ...member, role: "user" });
        await expect(capability.executeApprovedTarget!(context, { userId: targetUserId, title: "테스트", body: "본문" }, expected.targetVersion!))
            .rejects.toThrow("membership changed");
        expect(sendNotification.executeWithOutcome).not.toHaveBeenCalled();
    });

    it("stages membership authorization before invoking the notification provider", async () => {
        const prisma = {
            $transaction: jest.fn(),
            notification: { findFirst: jest.fn().mockResolvedValue(null) },
            user_branch: { findFirst: jest.fn().mockResolvedValue(member) },
            branch: { findUnique: jest.fn().mockResolvedValue(branchOwner) },
            user: { findUnique: jest.fn().mockResolvedValue({ approvalStatus: "approved", role: "admin" }) },
            agent_action: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        };
        prisma.$transaction.mockImplementation(async (callback: (transaction: typeof prisma) => Promise<unknown>) => callback(prisma));
        const sendNotification = {
            executeWithOutcome: jest.fn().mockResolvedValue({
                status: "delivered", notification: { id: 8 }, subscriptions: 1, delivered: 1, failed: 0,
            }),
        };
        const provider = new NotificationAgentCapabilitiesProvider(
            sendNotification as never, prisma as never, userRepositoryStub({ id: targetUserId }) as never,
        );
        const capability = provider.getCapabilities()[0]!;
        const expected = await capability.inspect!(context, { userId: targetUserId, title: "테스트", body: "본문" });

        await expect(capability.executeApprovedTarget!(context, { userId: targetUserId, title: "테스트", body: "본문" }, expected.targetVersion!))
            .resolves.toEqual({ status: "delivered", notificationId: 8, subscriptions: 1, delivered: 1, failed: 0 });
        expect(prisma.agent_action.updateMany.mock.invocationCallOrder[0]).toBeLessThan(sendNotification.executeWithOutcome.mock.invocationCallOrder[0]!);
        expect(JSON.stringify(prisma.agent_action.updateMany.mock.calls)).not.toContain("010-1234-5678");
        expect(JSON.stringify(prisma.agent_action.updateMany.mock.calls)).not.toContain("member@example.com");
    });

    it("locks the user row before user_branch and branch when staging the approved target (m1, matches reject()'s lock order)", async () => {
        const prisma = {
            $transaction: jest.fn(),
            $queryRawUnsafe: jest.fn().mockResolvedValue(undefined),
            notification: { findFirst: jest.fn().mockResolvedValue(null) },
            user_branch: { findFirst: jest.fn().mockResolvedValue(member) },
            branch: { findUnique: jest.fn().mockResolvedValue(branchOwner) },
            user: { findUnique: jest.fn().mockResolvedValue({ approvalStatus: "approved", role: "admin" }) },
            agent_action: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        };
        prisma.$transaction.mockImplementation(async (callback: (transaction: typeof prisma) => Promise<unknown>) => callback(prisma));
        const sendNotification = {
            executeWithOutcome: jest.fn().mockResolvedValue({
                status: "delivered", notification: { id: 12 }, subscriptions: 1, delivered: 1, failed: 0,
            }),
        };
        const provider = new NotificationAgentCapabilitiesProvider(
            sendNotification as never, prisma as never, userRepositoryStub({ id: targetUserId }) as never,
        );
        const capability = provider.getCapabilities()[0]!;
        const expected = await capability.inspect!(context, { userId: targetUserId, title: "테스트", body: "본문" });

        await expect(capability.executeApprovedTarget!(context, { userId: targetUserId, title: "테스트", body: "본문" }, expected.targetVersion!))
            .resolves.toEqual({ status: "delivered", notificationId: 12, subscriptions: 1, delivered: 1, failed: 0 });

        // $queryRawUnsafe calls on the same mock preserve await order, so array
        // index doubles as call order: user must be locked first, then
        // user_branch, then branch (consistent with UserService.reject).
        expect(prisma.$queryRawUnsafe).toHaveBeenCalledTimes(3);
        const calls = prisma.$queryRawUnsafe.mock.calls;
        expect(calls[0]?.[0]).toContain('FROM "user"');
        expect(calls[0]?.[0]).not.toContain("user_branch");
        expect(calls[1]?.[0]).toContain('FROM "user_branch"');
        expect(calls[2]?.[0]).toContain('FROM "branch"');
    });

    it("fails the final approval check (no send) when a member became rejected/pending after inspect (BJJ-357 follow-up)", async () => {
        const prisma = {
            $transaction: jest.fn(),
            notification: { findFirst: jest.fn().mockResolvedValue(null) },
            user_branch: { findFirst: jest.fn().mockResolvedValue(member) },
            branch: { findUnique: jest.fn().mockResolvedValue(branchOwner) },
            user: { findUnique: jest.fn().mockResolvedValue({ approvalStatus: "approved", role: "admin" }) },
            agent_action: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        };
        prisma.$transaction.mockImplementation(async (callback: (transaction: typeof prisma) => Promise<unknown>) => callback(prisma));
        const sendNotification = { executeWithOutcome: jest.fn() };
        const provider = new NotificationAgentCapabilitiesProvider(
            sendNotification as never, prisma as never, userRepositoryStub({ id: targetUserId }) as never,
        );
        const capability = provider.getCapabilities()[0]!;
        const expected = await capability.inspect!(context, { userId: targetUserId, title: "테스트", body: "본문" });

        // Approved at inspect time; rejected (non-owner) by the time the
        // execution transaction re-reads the locked user row.
        prisma.user.findUnique.mockResolvedValue({ approvalStatus: "rejected", role: "admin" });
        await expect(capability.executeApprovedTarget!(context, { userId: targetUserId, title: "테스트", body: "본문" }, expected.targetVersion!))
            .rejects.toThrow("membership changed");
        expect(sendNotification.executeWithOutcome).not.toHaveBeenCalled();
    });

    it("still succeeds for a global owner with pending approvalStatus at the atomic execution boundary (BJJ-357 follow-up)", async () => {
        const prisma = {
            $transaction: jest.fn(),
            notification: { findFirst: jest.fn().mockResolvedValue(null) },
            user_branch: { findFirst: jest.fn().mockResolvedValue(null) },
            branch: { findUnique: jest.fn().mockResolvedValue({ ...branchOwner, ownerId: targetUserId }) },
            user: { findUnique: jest.fn().mockResolvedValue({ approvalStatus: "pending", role: "owner" }) },
            agent_action: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        };
        prisma.$transaction.mockImplementation(async (callback: (transaction: typeof prisma) => Promise<unknown>) => callback(prisma));
        const sendNotification = {
            executeWithOutcome: jest.fn().mockResolvedValue({
                status: "delivered", notification: { id: 11 }, subscriptions: 1, delivered: 1, failed: 0,
            }),
        };
        const provider = new NotificationAgentCapabilitiesProvider(
            sendNotification as never, prisma as never, userRepositoryStub({ id: targetUserId }) as never,
        );
        const capability = provider.getCapabilities()[0]!;
        const expected = await capability.inspect!(context, { userId: targetUserId, title: "테스트", body: "본문" });

        await expect(capability.executeApprovedTarget!(context, { userId: targetUserId, title: "테스트", body: "본문" }, expected.targetVersion!))
            .resolves.toEqual({ status: "delivered", notificationId: 11, subscriptions: 1, delivered: 1, failed: 0 });
        expect(sendNotification.executeWithOutcome).toHaveBeenCalled();
    });
});
