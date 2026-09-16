import type { BjjUIMessage } from "@babyjamjam/shared";

import { PrismaAgentSessionRepository } from "./prisma-agent-session.repository";

describe("PrismaAgentSessionRepository", () => {
    const owner = { userId: "user-a", branchId: "branch-a" };

    it("reads an owned archived or expired session for restore without live predicates or writes", async () => {
        const expiresAt = new Date("2026-01-01T00:00:00.000Z");
        const archivedAt = new Date("2026-01-02T00:00:00.000Z");
        const prisma = {
            agent_session: {
                findFirst: jest.fn().mockResolvedValue({
                    id: "session-a",
                    ...owner,
                    locale: "ko",
                    title: null,
                    summary: null,
                    selectedEntities: {},
                    model: "stub",
                    agentVersion: "v1",
                    createdAt: new Date("2025-12-01T00:00:00.000Z"),
                    updatedAt: new Date("2025-12-01T00:00:00.000Z"),
                    expiresAt,
                    archivedAt,
                    messages: [],
                }),
            },
        };
        const repository = new PrismaAgentSessionRepository(prisma as never);

        await expect(repository.findOwnedForRestore("session-a", owner)).resolves.toMatchObject({
            id: "session-a",
            ...owner,
            expiresAt,
            archivedAt,
        });
        expect(prisma.agent_session.findFirst).toHaveBeenCalledWith({
            where: { id: "session-a", ...owner },
            include: { messages: true },
        });
    });

    it("blocks physical deletion while a nonterminal action exists", async () => {
        const prisma = {
            agent_session: {
                deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
                findFirst: jest.fn().mockResolvedValue({ id: "session-a" }),
            },
        };
        const repository = new PrismaAgentSessionRepository(prisma as never);

        await expect(repository.deleteOwned("session-a", owner)).resolves.toBe("blocked");
        expect(prisma.agent_session.deleteMany).toHaveBeenCalledWith({
            where: {
                id: "session-a",
                ...owner,
                actions: {
                    none: {
                        OR: [
                            { userId: owner.userId, branchId: owner.branchId, status: { in: ["executing", "uncertain"] } },
                            {
                                userId: owner.userId,
                                branchId: owner.branchId,
                                status: { in: ["proposed", "approved"] },
                                expiresAt: { gt: expect.any(Date) },
                            },
                            {
                                userId: owner.userId,
                                branchId: owner.branchId,
                                status: { in: ["succeeded", "failed", "uncertain", "rejected", "expired", "cancelled"] },
                                resultPartPersistedAt: null,
                            },
                        ],
                    },
                },
            },
        });
    });

    it("projects principal metadata out of transactional owner query scopes", async () => {
        const ownerWithRoles = { ...owner, globalRole: "admin", branchRole: "manager" };
        const actionFindFirst = jest.fn().mockResolvedValue(null);
        const sessionDeleteMany = jest.fn().mockResolvedValue({ count: 1 });
        const transactionClient = {
            $queryRaw: jest.fn().mockResolvedValue([{ id: "session-a" }]),
            agent_session: { deleteMany: sessionDeleteMany },
            agent_task: { findFirst: jest.fn().mockResolvedValue(null) },
            agent_action: { findFirst: actionFindFirst },
        };
        const prisma = {
            agent_task: { findFirst: jest.fn() },
            $transaction: jest.fn().mockImplementation(async (callback: (client: typeof transactionClient) => Promise<unknown>) => callback(transactionClient)),
        };
        const repository = new PrismaAgentSessionRepository(prisma as never);

        await expect(repository.deleteOwned("session-a", ownerWithRoles)).resolves.toBe("deleted");

        const actionWhere = actionFindFirst.mock.calls[0]?.[0].where;
        expect(actionWhere).toEqual(expect.objectContaining({
            sessionId: "session-a",
            userId: owner.userId,
            branchId: owner.branchId,
        }));
        expect(actionWhere).not.toHaveProperty("globalRole");
        expect(actionWhere).not.toHaveProperty("branchRole");
        expect(sessionDeleteMany).toHaveBeenCalledWith({
            where: { id: "session-a", userId: owner.userId, branchId: owner.branchId },
        });
    });

    it("preserves an explicit title and assigns deterministic message timestamps", async () => {
        const transaction = jest.fn().mockImplementation(async (operations: Array<Promise<unknown>>) => Promise.all(operations));
        const prisma = {
            agent_session: {
                findFirst: jest.fn().mockResolvedValue({ id: "session-a", title: "직접 지정한 제목" }),
                update: jest.fn().mockResolvedValue({}),
                updateMany: jest.fn().mockResolvedValue({ count: 0 }),
            },
            agent_message: { createMany: jest.fn().mockResolvedValue({ count: 2 }) },
            $transaction: transaction,
        };
        const repository = new PrismaAgentSessionRepository(prisma as never);
        const messages = [
            { id: "user-message", role: "user", parts: [{ type: "text", text: "첫 질문" }] },
            { id: "assistant-message", role: "assistant", parts: [{ type: "text", text: "첫 답변" }] },
        ] as BjjUIMessage[];

        await repository.appendMessages("session-a", owner, messages);

        const data = prisma.agent_message.createMany.mock.calls[0][0].data as Array<{ createdAt: Date }>;
        const [first, second] = data;
        if (!first || !second) throw new Error("Expected both messages to be persisted");
        expect(second.createdAt.getTime()).toBeGreaterThan(first.createdAt.getTime());
        // Exactly one session write: the branch-pinned updatedAt touch. An
        // explicit title must never be overwritten, so no write carries `title`.
        expect(prisma.agent_session.updateMany).toHaveBeenCalledTimes(1);
        expect(prisma.agent_session.updateMany).toHaveBeenCalledWith({
            where: { id: "session-a", ...owner },
            data: { updatedAt: expect.any(Date) },
        });
        expect(prisma.agent_session.update).not.toHaveBeenCalled();
    });

    it.each(["proposed", "approved"])("does not block deletion for an expired %s action", async () => {
        const now = new Date("2026-08-04T00:00:00.000Z");
        jest.useFakeTimers().setSystemTime(now);
        try {
            const prisma = {
                agent_session: {
                    deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
                    findFirst: jest.fn(),
                },
            };
            const repository = new PrismaAgentSessionRepository(prisma as never);

            await expect(repository.deleteOwned("session-a", owner)).resolves.toBe("deleted");

            const where = prisma.agent_session.deleteMany.mock.calls[0]?.[0].where;
            expect(where.actions.none.OR).toEqual([
                { userId: owner.userId, branchId: owner.branchId, status: { in: ["executing", "uncertain"] } },
                {
                    userId: owner.userId,
                    branchId: owner.branchId,
                    status: { in: ["proposed", "approved"] },
                    expiresAt: { gt: now },
                },
                {
                    userId: owner.userId,
                    branchId: owner.branchId,
                    status: { in: ["succeeded", "failed", "uncertain", "rejected", "expired", "cancelled"] },
                    resultPartPersistedAt: null,
                },
            ]);
        } finally {
            jest.useRealTimers();
        }
    });

    it.each(["executing", "uncertain"])("always blocks deletion for %s regardless of expiry", async () => {
        const prisma = {
            agent_session: {
                deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
                findFirst: jest.fn().mockResolvedValue({ id: "session-a" }),
            },
        };
        const repository = new PrismaAgentSessionRepository(prisma as never);

        await expect(repository.deleteOwned("session-a", owner)).resolves.toBe("blocked");

        expect(prisma.agent_session.deleteMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                actions: {
                    none: {
                        OR: expect.arrayContaining([
                            { userId: owner.userId, branchId: owner.branchId, status: { in: ["executing", "uncertain"] } },
                        ]),
                    },
                },
            }),
        }));
    });

    it.each(["succeeded", "failed", "uncertain"] as const)("blocks owned deletion while a %s result part is not persisted", async (status) => {
        const prisma = {
            agent_session: {
                deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
                findFirst: jest.fn().mockResolvedValue({ id: "session-a" }),
            },
        };
        const repository = new PrismaAgentSessionRepository(prisma as never);

        await expect(repository.deleteOwned("session-a", owner)).resolves.toBe("blocked");

        const where = prisma.agent_session.deleteMany.mock.calls[0]?.[0].where;
        expect(where.actions.none.OR).toEqual(expect.arrayContaining([
            expect.objectContaining({
                userId: owner.userId,
                branchId: owner.branchId,
                status: { in: expect.arrayContaining([status]) },
                resultPartPersistedAt: null,
            }),
        ]));
    });

    it("allows owned deletion once every terminal result part is persisted", async () => {
        const prisma = {
            agent_session: {
                deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
                findFirst: jest.fn(),
            },
        };
        const repository = new PrismaAgentSessionRepository(prisma as never);

        await expect(repository.deleteOwned("session-a", owner)).resolves.toBe("deleted");
        expect(prisma.agent_session.findFirst).not.toHaveBeenCalled();
        expect(prisma.agent_session.deleteMany.mock.calls[0]?.[0].where.actions.none.OR).toEqual(expect.arrayContaining([
            expect.objectContaining({ resultPartPersistedAt: null }),
        ]));
    });

    it("does not let a mismatched owner action block or identify an owned session", async () => {
        const prisma = {
            agent_session: {
                deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
                findFirst: jest.fn().mockResolvedValue(null),
            },
        };
        const repository = new PrismaAgentSessionRepository(prisma as never);

        await expect(repository.deleteOwned("session-a", owner)).resolves.toBe("not_found");
        expect(prisma.agent_session.findFirst).toHaveBeenCalledWith({ where: { id: "session-a", ...owner }, select: { id: true } });
        expect(prisma.agent_session.deleteMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                userId: owner.userId,
                branchId: owner.branchId,
                actions: expect.objectContaining({
                    none: expect.objectContaining({
                        OR: expect.arrayContaining([
                            expect.objectContaining({ userId: owner.userId, branchId: owner.branchId }),
                        ]),
                    }),
                }),
            }),
        }));
    });

    it("uses the captured expiry time for cleanup and ignores expired approval actions", async () => {
        const now = new Date("2026-08-04T00:00:00.000Z");
        const prisma = {
            agent_session: {
                deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
            },
        };
        const repository = new PrismaAgentSessionRepository(prisma as never);

        await expect(repository.deleteExpired(now)).resolves.toBe(2);
        expect(prisma.agent_session.deleteMany).toHaveBeenCalledWith({
            where: {
                expiresAt: { lte: now },
                actions: {
                    none: {
                        OR: [
                            { status: { in: ["executing", "uncertain"] } },
                            { status: { in: ["proposed", "approved"] }, expiresAt: { gt: now } },
                            { status: { in: ["succeeded", "failed", "uncertain", "rejected", "expired", "cancelled"] }, resultPartPersistedAt: null },
                        ],
                    },
                },
            },
        });
    });

    it.each(["succeeded", "failed", "uncertain"] as const)("retains expired sessions while a %s terminal result part is pending", async (status) => {
        const now = new Date("2026-08-04T00:00:00.000Z");
        const prisma = {
            agent_session: {
                deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
            },
        };
        const repository = new PrismaAgentSessionRepository(prisma as never);

        await expect(repository.deleteExpired(now)).resolves.toBe(0);

        const where = prisma.agent_session.deleteMany.mock.calls[0]?.[0].where;
        expect(where.actions.none.OR).toEqual(expect.arrayContaining([
            expect.objectContaining({
                status: { in: expect.arrayContaining([status]) },
                resultPartPersistedAt: null,
            }),
        ]));
    });

    it("allows retention cleanup after terminal result parts are persisted", async () => {
        const now = new Date("2026-08-04T00:00:00.000Z");
        const prisma = {
            agent_session: {
                deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
            },
        };
        const repository = new PrismaAgentSessionRepository(prisma as never);

        await expect(repository.deleteExpired(now)).resolves.toBe(2);
        expect(prisma.agent_session.deleteMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                actions: {
                    none: expect.objectContaining({
                        OR: expect.arrayContaining([
                            expect.objectContaining({ resultPartPersistedAt: null }),
                        ]),
                    }),
                },
            }),
        }));
    });

    it("upserts a scoped result message without changing its createdAt", async () => {
        const message = {
            id: "agent-action-result:action-a",
            role: "assistant",
            parts: [{ type: "data-action-result", data: { actionId: "action-a", status: "succeeded" } }],
        } as BjjUIMessage;
        const prisma = {
            agent_session: {
                findFirst: jest.fn().mockResolvedValue({ id: "session-a" }),
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
            agent_message: {
                findFirst: jest.fn().mockResolvedValue({ id: message.id, createdAt: new Date("2026-08-03T00:00:00.000Z") }),
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
                create: jest.fn(),
            },
        };
        (prisma as typeof prisma & { $transaction: jest.Mock }).$transaction = jest.fn()
            .mockImplementation(async (callback: (transaction: typeof prisma) => Promise<unknown>) => callback(prisma));
        const repository = new PrismaAgentSessionRepository(prisma as never);

        await expect(repository.upsertActionResultMessage("session-a", owner, message)).resolves.toBe(true);
        expect(prisma.agent_message.create).not.toHaveBeenCalled();
        expect(prisma.agent_message.updateMany).toHaveBeenCalledWith({
            where: { id: message.id, sessionId: "session-a" },
            data: { role: "assistant", parts: message.parts },
        });
        expect(prisma.agent_session.updateMany).toHaveBeenCalledWith({
            where: { id: "session-a", ...owner },
            data: { updatedAt: expect.any(Date), summary: null },
        });
    });

    it("does not mutate messages when the session owner does not match", async () => {
        const message = { id: "agent-action-result:action-a", role: "assistant", parts: [] } as BjjUIMessage;
        const prisma = {
            agent_session: { findFirst: jest.fn().mockResolvedValue(null), updateMany: jest.fn() },
            agent_message: {
                findFirst: jest.fn(),
                updateMany: jest.fn(),
                create: jest.fn(),
            },
        };
        (prisma as typeof prisma & { $transaction: jest.Mock }).$transaction = jest.fn()
            .mockImplementation(async (callback: (transaction: typeof prisma) => Promise<unknown>) => callback(prisma));
        const repository = new PrismaAgentSessionRepository(prisma as never);

        await expect(repository.upsertActionResultMessage("session-a", owner, message)).resolves.toBe(false);
        expect(prisma.agent_message.findFirst).not.toHaveBeenCalled();
        expect(prisma.agent_message.updateMany).not.toHaveBeenCalled();
        expect(prisma.agent_message.create).not.toHaveBeenCalled();
    });

    it("converges a concurrent deterministic insert through an owner-scoped update", async () => {
        const message = { id: "agent-action-result:action-a", role: "assistant", parts: [] } as BjjUIMessage;
        const prisma = {
            agent_session: {
                findFirst: jest.fn().mockResolvedValue({ id: "session-a" }),
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
            agent_message: {
                findFirst: jest.fn().mockResolvedValue(null),
                create: jest.fn().mockRejectedValue({ code: "P2002" }),
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
        };
        (prisma as typeof prisma & { $transaction: jest.Mock }).$transaction = jest.fn()
            .mockImplementation(async (callback: (transaction: typeof prisma) => Promise<unknown>) => callback(prisma));
        const repository = new PrismaAgentSessionRepository(prisma as never);

        await expect(repository.upsertActionResultMessage("session-a", owner, message)).resolves.toBe(true);
        expect(prisma.agent_message.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: message.id, sessionId: "session-a" },
        }));
        expect(prisma.agent_session.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: "session-a", ...owner },
            data: { updatedAt: expect.any(Date), summary: null },
        }));
    });

    it("creates a deterministic result message and invalidates compacted summary atomically", async () => {
        const message = {
            id: "agent-action-result:action-b",
            role: "assistant",
            parts: [{ type: "data-action-result", data: { actionId: "action-b", status: "failed" } }],
        } as BjjUIMessage;
        const prisma = {
            agent_session: {
                findFirst: jest.fn().mockResolvedValue({ id: "session-a" }),
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            },
            agent_message: {
                findFirst: jest.fn().mockResolvedValue(null),
                create: jest.fn().mockResolvedValue({ id: message.id, createdAt: new Date() }),
                updateMany: jest.fn(),
            },
        };
        (prisma as typeof prisma & { $transaction: jest.Mock }).$transaction = jest.fn()
            .mockImplementation(async (callback: (transaction: typeof prisma) => Promise<unknown>) => callback(prisma));
        const repository = new PrismaAgentSessionRepository(prisma as never);

        await expect(repository.upsertActionResultMessage("session-a", owner, message, "trace-a")).resolves.toBe(true);
        expect(prisma.agent_message.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                id: message.id,
                sessionId: "session-a",
                traceId: "trace-a",
            }),
        });
        expect(prisma.agent_session.updateMany).toHaveBeenCalledWith({
            where: { id: "session-a", ...owner },
            data: { updatedAt: expect.any(Date), summary: null },
        });
    });

    it("does not overwrite a deterministic message id owned by another session", async () => {
        const message = { id: "agent-action-result:shared", role: "assistant", parts: [] } as BjjUIMessage;
        const prisma = {
            agent_session: {
                findFirst: jest.fn().mockResolvedValue({ id: "session-a" }),
                updateMany: jest.fn(),
            },
            agent_message: {
                findFirst: jest.fn().mockResolvedValue(null),
                create: jest.fn().mockRejectedValue({ code: "P2002" }),
                updateMany: jest.fn().mockResolvedValue({ count: 0 }),
            },
        };
        (prisma as typeof prisma & { $transaction: jest.Mock }).$transaction = jest.fn()
            .mockImplementation(async (callback: (transaction: typeof prisma) => Promise<unknown>) => callback(prisma));
        const repository = new PrismaAgentSessionRepository(prisma as never);

        await expect(repository.upsertActionResultMessage("session-a", owner, message)).resolves.toBe(false);
        expect(prisma.agent_session.updateMany).not.toHaveBeenCalled();
        expect(prisma.agent_message.updateMany).toHaveBeenCalledWith({
            where: { id: message.id, sessionId: "session-a" },
            data: { role: "assistant", parts: message.parts },
        });
    });

    it.each([
        ["proposed", true],
        ["approved", true],
        ["executing", false],
        ["uncertain", false],
    ])("archives only when %s action is not blocking (%s)", async (status, shouldArchive) => {
        const prisma = {
            agent_session: {
                updateMany: jest.fn().mockResolvedValue({ count: shouldArchive ? 1 : 0 }),
                findFirst: jest.fn().mockResolvedValue({ id: "session-a" }),
            },
            agent_action: {
                findFirst: jest.fn().mockResolvedValue(shouldArchive ? null : { id: "action-a", status }),
            },
        };
        (prisma as typeof prisma & { $transaction: jest.Mock; $queryRaw: jest.Mock }).$transaction = jest.fn()
            .mockImplementation(async (callback: (transaction: typeof prisma) => Promise<unknown>) => callback(prisma));
        (prisma as typeof prisma & { $queryRaw: jest.Mock }).$queryRaw = jest.fn().mockResolvedValue([{ id: "session-a" }]);
        const repository = new PrismaAgentSessionRepository(prisma as never);

        const result = await repository.archiveOwned("session-a", owner, new Date("2026-08-04T00:00:00.000Z"));
        expect(result).toBe(shouldArchive ? "archived" : "blocked");
        if (shouldArchive) expect(prisma.agent_session.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: "session-a", ...owner, archivedAt: null },
        }));
        else expect(prisma.agent_session.updateMany).not.toHaveBeenCalled();
    });

    it("uses the archive-time expiry boundary and owner scope for approval blockers", async () => {
        const prisma = {
            agent_session: {
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
                findFirst: jest.fn(),
            },
            agent_action: { findFirst: jest.fn().mockResolvedValue(null) },
        };
        (prisma as typeof prisma & { $transaction: jest.Mock; $queryRaw: jest.Mock }).$transaction = jest.fn()
            .mockImplementation(async (callback: (transaction: typeof prisma) => Promise<unknown>) => callback(prisma));
        (prisma as typeof prisma & { $queryRaw: jest.Mock }).$queryRaw = jest.fn().mockResolvedValue([{ id: "session-a" }]);
        const repository = new PrismaAgentSessionRepository(prisma as never);

        await expect(repository.archiveOwned("session-a", owner, new Date("2026-08-04T00:00:00.000Z"))).resolves.toBe("archived");
        const sessionLockQuery = (prisma as typeof prisma & { $queryRaw: jest.Mock }).$queryRaw.mock.calls[0]?.[0] as { sql?: string };
        expect(sessionLockQuery.sql).toEqual(expect.stringContaining('"user_id" = CAST(? AS uuid)'));
        expect(sessionLockQuery.sql).toEqual(expect.stringContaining('"branch_id" = CAST(? AS uuid)'));
        expect(prisma.agent_action.findFirst).toHaveBeenCalledWith({
            where: {
                sessionId: "session-a",
                ...owner,
                OR: [
                    { ...owner, status: { in: ["executing", "uncertain"] } },
                    { ...owner, status: { in: ["proposed", "approved"] }, expiresAt: { gt: expect.any(Date) } },
                    {
                        ...owner,
                        status: { in: ["succeeded", "failed", "uncertain", "rejected", "expired", "cancelled"] },
                        resultPartPersistedAt: null,
                    },
                ],
            },
            select: { id: true },
        });
    });

    it("blocks archive while a terminal action result part is pending", async () => {
        const prisma = {
            agent_session: {
                updateMany: jest.fn(),
                findFirst: jest.fn(),
            },
            agent_action: {
                findFirst: jest.fn().mockResolvedValue({ id: "action-a", status: "succeeded", resultPartPersistedAt: null }),
            },
        };
        (prisma as typeof prisma & { $transaction: jest.Mock; $queryRaw: jest.Mock }).$transaction = jest.fn()
            .mockImplementation(async (callback: (transaction: typeof prisma) => Promise<unknown>) => callback(prisma));
        (prisma as typeof prisma & { $queryRaw: jest.Mock }).$queryRaw = jest.fn().mockResolvedValue([{ id: "session-a" }]);
        const repository = new PrismaAgentSessionRepository(prisma as never);

        await expect(repository.archiveOwned("session-a", owner, new Date("2026-08-04T00:00:00.000Z"))).resolves.toBe("blocked");
        expect(prisma.agent_session.updateMany).not.toHaveBeenCalled();
        expect(prisma.agent_action.findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({
                OR: expect.arrayContaining([
                    expect.objectContaining({
                        status: { in: ["succeeded", "failed", "uncertain", "rejected", "expired", "cancelled"] },
                        resultPartPersistedAt: null,
                    }),
                ]),
            }),
        }));
    });

    it("allows archive once a terminal action result part is persisted", async () => {
        const prisma = {
            agent_session: {
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
                findFirst: jest.fn(),
            },
            agent_action: { findFirst: jest.fn().mockResolvedValue(null) },
        };
        (prisma as typeof prisma & { $transaction: jest.Mock; $queryRaw: jest.Mock }).$transaction = jest.fn()
            .mockImplementation(async (callback: (transaction: typeof prisma) => Promise<unknown>) => callback(prisma));
        (prisma as typeof prisma & { $queryRaw: jest.Mock }).$queryRaw = jest.fn().mockResolvedValue([{ id: "session-a" }]);
        const repository = new PrismaAgentSessionRepository(prisma as never);

        await expect(repository.archiveOwned("session-a", owner, new Date("2026-08-04T00:00:00.000Z"))).resolves.toBe("archived");
        expect(prisma.agent_session.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            data: { archivedAt: expect.any(Date) },
        }));
    });

    it("blocks archive for a dangling task action link", async () => {
        const tx = {
            $queryRaw: jest.fn().mockResolvedValue([{ id: "session-a" }]),
            agent_session: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
            agent_task: {
                findFirst: jest.fn().mockResolvedValue(null),
                findMany: jest.fn().mockResolvedValue([{
                    id: "task-a", sessionId: "session-a", userId: owner.userId, branchId: owner.branchId, activeActionId: "missing-action",
                }]),
            },
            agent_action: {
                findFirst: jest.fn().mockResolvedValue(null),
                findMany: jest.fn().mockResolvedValue([]),
            },
        };
        const prisma = {
            $transaction: jest.fn().mockImplementation(async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)),
        };
        const repository = new PrismaAgentSessionRepository(prisma as never);

        await expect(repository.archiveOwned("session-a", owner, new Date("2026-08-04T00:00:00.000Z"))).resolves.toBe("blocked");
        expect(tx.agent_session.updateMany).not.toHaveBeenCalled();
    });

    it("allows archive for a terminal persisted action with matching forward and reverse links", async () => {
        const tx = {
            $queryRaw: jest.fn().mockResolvedValue([{ id: "session-a" }]),
            agent_session: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
            agent_task: {
                findFirst: jest.fn().mockResolvedValue(null),
                findMany: jest.fn().mockResolvedValue([{
                    id: "task-a", sessionId: "session-a", userId: owner.userId, branchId: owner.branchId, activeActionId: "action-a",
                }]),
            },
            agent_action: {
                findFirst: jest.fn().mockResolvedValue(null),
                findMany: jest.fn().mockResolvedValue([{
                    id: "action-a", taskId: "task-a", sessionId: "session-a", userId: owner.userId, branchId: owner.branchId,
                    status: "succeeded", expiresAt: new Date("2026-08-01T00:00:00.000Z"), resultPartPersistedAt: new Date("2026-08-02T00:00:00.000Z"),
                }]),
            },
        };
        const prisma = {
            $transaction: jest.fn().mockImplementation(async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)),
        };
        const repository = new PrismaAgentSessionRepository(prisma as never);

        await expect(repository.archiveOwned("session-a", owner, new Date("2026-08-04T00:00:00.000Z"))).resolves.toBe("archived");
        expect(tx.agent_session.updateMany).toHaveBeenCalledTimes(1);
    });

    it("blocks owner deletion for reverse evidence from another scope", async () => {
        const tx = {
            $queryRaw: jest.fn().mockResolvedValue([{ id: "session-a" }]),
            agent_session: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
            agent_task: {
                findFirst: jest.fn().mockResolvedValue(null),
                findMany: jest.fn().mockResolvedValue([{
                    id: "task-a", sessionId: "session-a", userId: owner.userId, branchId: owner.branchId, activeActionId: null,
                }]),
            },
            agent_action: {
                findFirst: jest.fn().mockResolvedValue(null),
                findMany: jest.fn().mockResolvedValue([{
                    id: "action-foreign", taskId: "task-a", sessionId: "session-a", userId: "user-b", branchId: owner.branchId,
                    status: "succeeded", expiresAt: new Date("2026-08-01T00:00:00.000Z"), resultPartPersistedAt: new Date("2026-08-02T00:00:00.000Z"),
                }]),
            },
        };
        const prisma = {
            agent_task: { findFirst: jest.fn() },
            $transaction: jest.fn().mockImplementation(async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)),
        };
        const repository = new PrismaAgentSessionRepository(prisma as never);

        await expect(repository.deleteOwned("session-a", owner)).resolves.toBe("blocked");
        expect(tx.agent_session.deleteMany).not.toHaveBeenCalled();
    });

    it("allows owner deletion for a settled matching action link", async () => {
        const tx = {
            $queryRaw: jest.fn().mockResolvedValue([{ id: "session-a" }]),
            agent_session: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
            agent_task: {
                findFirst: jest.fn().mockResolvedValue(null),
                findMany: jest.fn().mockResolvedValue([{
                    id: "task-a", sessionId: "session-a", userId: owner.userId, branchId: owner.branchId, activeActionId: "action-a",
                }]),
            },
            agent_action: {
                findFirst: jest.fn().mockResolvedValue(null),
                findMany: jest.fn().mockResolvedValue([{
                    id: "action-a", taskId: "task-a", sessionId: "session-a", userId: owner.userId, branchId: owner.branchId,
                    status: "failed", expiresAt: new Date("2026-08-01T00:00:00.000Z"), resultPartPersistedAt: new Date("2026-08-02T00:00:00.000Z"),
                }]),
            },
        };
        const prisma = {
            agent_task: { findFirst: jest.fn() },
            $transaction: jest.fn().mockImplementation(async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)),
        };
        const repository = new PrismaAgentSessionRepository(prisma as never);

        await expect(repository.deleteOwned("session-a", owner)).resolves.toBe("deleted");
        expect(tx.agent_session.deleteMany).toHaveBeenCalledWith({
            where: { id: "session-a", userId: owner.userId, branchId: owner.branchId },
        });
    });

    it("treats an absent or wrong-owner session as not found without leaking details", async () => {
        const prisma = {
            agent_session: { updateMany: jest.fn(), findFirst: jest.fn() },
            agent_action: { findFirst: jest.fn() },
        };
        (prisma as typeof prisma & { $transaction: jest.Mock; $queryRaw: jest.Mock }).$transaction = jest.fn()
            .mockImplementation(async (callback: (transaction: typeof prisma) => Promise<unknown>) => callback(prisma));
        (prisma as typeof prisma & { $queryRaw: jest.Mock }).$queryRaw = jest.fn().mockResolvedValue([]);
        const repository = new PrismaAgentSessionRepository(prisma as never);

        await expect(repository.archiveOwned("session-a", owner, new Date())).resolves.toBe("not_found");
        expect(prisma.agent_action.findFirst).not.toHaveBeenCalled();
    });

    it("blocks archive and owner deletion while a retained nonterminal task exists", async () => {
        const tx = {
            $queryRaw: jest.fn().mockResolvedValue([{ id: "session-a" }]),
            agent_session: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
            agent_action: { findFirst: jest.fn().mockResolvedValue(null) },
            agent_task: { findFirst: jest.fn().mockResolvedValue({ id: "task-a" }) },
        };
        const prisma = {
            $transaction: jest.fn().mockImplementation(async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)),
            agent_task: { findFirst: jest.fn() },
            agent_session: { updateMany: jest.fn(), deleteMany: jest.fn(), findFirst: jest.fn() },
        };
        const repository = new PrismaAgentSessionRepository(prisma as never);

        await expect(repository.archiveOwned("session-a", owner, new Date("2026-08-04T00:00:00.000Z"))).resolves.toBe("blocked");
        await expect(repository.deleteOwned("session-a", owner)).resolves.toBe("blocked");
        expect(tx.agent_session.updateMany).not.toHaveBeenCalled();
        expect(tx.agent_session.deleteMany).not.toHaveBeenCalled();
    });

    it("retains an expired session during guarded cleanup while a retained task remains", async () => {
        const now = new Date("2026-08-04T00:00:00.000Z");
        const tx = {
            $queryRaw: jest.fn()
                .mockResolvedValueOnce([{ id: "session-a", userId: owner.userId, branchId: owner.branchId }])
                .mockResolvedValueOnce([{ id: "task-a" }])
                .mockResolvedValueOnce([]),
            agent_session: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
            agent_action: { findFirst: jest.fn().mockResolvedValue(null) },
            agent_task: { findFirst: jest.fn().mockResolvedValue({ id: "task-a" }) },
        };
        const prisma = {
            $transaction: jest.fn().mockImplementation(async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)),
            agent_task: { findFirst: jest.fn() },
            agent_session: { deleteMany: jest.fn() },
        };
        const repository = new PrismaAgentSessionRepository(prisma as never);

        await expect(repository.deleteExpired(now)).resolves.toBe(0);
        expect(tx.agent_session.deleteMany).not.toHaveBeenCalled();
    });

    it("retains an expired session when a task has a dangling active action link", async () => {
        const now = new Date("2026-08-04T00:00:00.000Z");
        const tx = {
            $queryRaw: jest.fn()
                .mockResolvedValueOnce([{ id: "session-a", userId: owner.userId, branchId: owner.branchId }])
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([]),
            agent_session: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
            agent_action: {
                findFirst: jest.fn().mockResolvedValue(null),
                findMany: jest.fn().mockResolvedValue([]),
            },
            agent_task: {
                findFirst: jest.fn().mockResolvedValue(null),
                findMany: jest.fn().mockResolvedValue([{
                    id: "task-a", sessionId: "session-a", userId: owner.userId, branchId: owner.branchId,
                    activeActionId: "missing-action",
                }]),
            },
        };
        const prisma = {
            $transaction: jest.fn().mockImplementation(async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx)),
            agent_task: { findFirst: jest.fn() },
            agent_session: { deleteMany: jest.fn() },
        };
        const repository = new PrismaAgentSessionRepository(prisma as never);

        await expect(repository.deleteExpired(now)).resolves.toBe(0);
        expect(tx.agent_session.deleteMany).not.toHaveBeenCalled();
        expect(tx.agent_task.findMany).toHaveBeenCalled();
        expect(tx.agent_action.findMany).toHaveBeenCalled();
    });

    it("unarchives only the owned session and permits expired sessions", async () => {
        const prisma = {
            agent_session: {
                updateMany: jest.fn().mockResolvedValue({ count: 1 }),
                findFirst: jest.fn(),
            },
        };
        const repository = new PrismaAgentSessionRepository(prisma as never);

        await expect(repository.unarchiveOwned("session-a", owner)).resolves.toBe("unarchived");
        expect(prisma.agent_session.updateMany).toHaveBeenCalledWith({
            where: { id: "session-a", ...owner, archivedAt: { not: null } },
            data: { archivedAt: null },
        });
    });
});
