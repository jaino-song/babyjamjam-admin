import { Prisma } from "@prisma/client";

import { AuthPhoneChallengeRow } from "domain/repositories/auth-phone-challenge.repository.interface";
import { PrismaService } from "infrastructure/database/prisma.service";
import { SbAuthPhoneChallengeRepository } from "infrastructure/database/repositories/sb.auth-phone-challenge.repository";

const NOW = new Date("2026-11-21T03:00:00Z");
const row: AuthPhoneChallengeRow = {
    id: "e1ca2a96-6c2c-451d-af5c-5b40c8370c39",
    purpose: "kakao_link", tokenHash: "a".repeat(64), phone: "01000000000",
    codeHash: "b".repeat(64), attemptCount: 0, userId: null, kakaoId: null,
    email: null, passwordHash: null, name: null,
    createdAt: NOW, expiresAt: new Date(NOW.getTime() + 300_000), consumedAt: null,
};
const limits = {
    shortWindowStart: new Date(NOW.getTime() - 600_000), shortMax: 3,
    dayWindowStart: new Date(NOW.getTime() - 86_400_000), dayMax: 10,
};

describe("SbAuthPhoneChallengeRepository", () => {
    const tx = {
        $executeRaw: jest.fn(),
        auth_phone_challenge: { count: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
    };
    const prisma = {
        $transaction: jest.fn(),
        auth_phone_challenge: { findUnique: jest.fn(), deleteMany: jest.fn(), updateMany: jest.fn() },
    };
    let repository: SbAuthPhoneChallengeRepository;

    beforeEach(() => {
        jest.resetAllMocks();
        jest.useFakeTimers().setSystemTime(NOW);
        prisma.$transaction.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx));
        tx.$executeRaw.mockResolvedValue(1);
        tx.auth_phone_challenge.count.mockResolvedValue(0);
        tx.auth_phone_challenge.create.mockResolvedValue(row);
        tx.auth_phone_challenge.updateMany.mockResolvedValue({ count: 1 });
        prisma.auth_phone_challenge.updateMany.mockResolvedValue({ count: 1 });
        prisma.auth_phone_challenge.deleteMany.mockResolvedValue({ count: 1 });
        repository = new SbAuthPhoneChallengeRepository(prisma as unknown as PrismaService);
    });

    afterEach(() => jest.useRealTimers());

    it("locks the bound phone, counts both windows, then creates on the same transaction client", async () => {
        await expect(repository.createWithinLimits(row, limits)).resolves.toBe("created");
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
        expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
        const query = tx.$executeRaw.mock.calls[0]![0] as Prisma.Sql;
        expect(query.sql.replace(/\s+/g, " ").trim()).toBe("SELECT pg_advisory_xact_lock(hashtextextended('auth_phone_challenge:' || ?, 0))");
        expect(query.values).toEqual([row.phone]);
        expect(query.sql).not.toContain(row.phone);
        expect(tx.auth_phone_challenge.count).toHaveBeenNthCalledWith(1, {
            where: { phone: row.phone, createdAt: { gte: limits.shortWindowStart } },
        });
        expect(tx.auth_phone_challenge.count).toHaveBeenNthCalledWith(2, {
            where: { phone: row.phone, createdAt: { gte: limits.dayWindowStart } },
        });
        expect(tx.auth_phone_challenge.create).toHaveBeenCalledTimes(1);
        expect(tx.auth_phone_challenge.create).toHaveBeenCalledWith({ data: row });
        const lockOrder = tx.$executeRaw.mock.invocationCallOrder[0]!;
        const [shortOrder, dayOrder] = tx.auth_phone_challenge.count.mock.invocationCallOrder;
        const createOrder = tx.auth_phone_challenge.create.mock.invocationCallOrder[0]!;
        expect(lockOrder).toBeLessThan(shortOrder!);
        expect(shortOrder).toBeLessThan(dayOrder!);
        expect(dayOrder).toBeLessThan(createOrder);
    });

    it.each([[3, 0], [4, 0], [0, 10], [0, 11]])("does not insert at or above either limit (%i/%i)", async (shortCount, dayCount) => {
        tx.auth_phone_challenge.count.mockResolvedValueOnce(shortCount).mockResolvedValueOnce(dayCount);
        await expect(repository.createWithinLimits(row, limits)).resolves.toBe("rate_limited");
        expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
        expect(tx.auth_phone_challenge.count).toHaveBeenCalledTimes(2);
        expect(tx.auth_phone_challenge.create).not.toHaveBeenCalled();
    });

    it("can insert just below both limits", async () => {
        tx.auth_phone_challenge.count.mockResolvedValueOnce(2).mockResolvedValueOnce(9);
        await expect(repository.createWithinLimits(row, limits)).resolves.toBe("created");
    });

    it("looks up only the hashed token", async () => {
        prisma.auth_phone_challenge.findUnique.mockResolvedValue(row);
        await expect(repository.findByTokenHash(row.tokenHash)).resolves.toBe(row);
        expect(prisma.auth_phone_challenge.findUnique).toHaveBeenCalledWith({ where: { tokenHash: row.tokenHash } });
        prisma.auth_phone_challenge.findUnique.mockResolvedValue(null);
        await expect(repository.findByTokenHash("missing")).resolves.toBeNull();
    });

    it.each([0, 1])("atomically registers a bounded attempt outside a caller transaction (count=%i)", async (count) => {
        prisma.auth_phone_challenge.updateMany.mockResolvedValue({ count });
        await expect(repository.registerAttempt(row.id, 5)).resolves.toBe(count === 1);
        expect(prisma.auth_phone_challenge.updateMany).toHaveBeenCalledWith({
            where: { id: row.id, consumedAt: null, attemptCount: { lt: 5 } },
            data: { attemptCount: { increment: 1 } },
        });
        expect(tx.auth_phone_challenge.updateMany).not.toHaveBeenCalled();
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("clears the code hash and linking data of unconsumed rows, preserving decoy behavior and rate-limit evidence", async () => {
        await expect(repository.invalidate(row.id)).resolves.toBeUndefined();
        expect(prisma.auth_phone_challenge.updateMany).toHaveBeenCalledWith({
            where: { id: row.id, consumedAt: null }, data: { codeHash: null, email: null, passwordHash: null, name: null, kakaoId: null },
        });
        expect(prisma.auth_phone_challenge.deleteMany).not.toHaveBeenCalled();
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it.each([0, 1])("consumes only unexpired rows within the supplied transaction and clears linking data (count=%i)", async (count) => {
        tx.auth_phone_challenge.updateMany.mockResolvedValue({ count });
        await expect(repository.consumeWithinTx(tx as unknown as Prisma.TransactionClient, row.id)).resolves.toBe(count === 1);
        expect(tx.auth_phone_challenge.updateMany).toHaveBeenCalledWith({
            where: { id: row.id, consumedAt: null, expiresAt: { gt: NOW } },
            data: { consumedAt: NOW, email: null, passwordHash: null, name: null, kakaoId: null },
        });
        expect(prisma.auth_phone_challenge.updateMany).not.toHaveBeenCalled();
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("deletes only rows strictly older than the retention cutoff", async () => {
        await expect(repository.deleteCreatedBefore(limits.dayWindowStart)).resolves.toBeUndefined();
        expect(prisma.auth_phone_challenge.deleteMany).toHaveBeenCalledWith({
            where: { createdAt: { lt: limits.dayWindowStart } },
        });
    });
});
