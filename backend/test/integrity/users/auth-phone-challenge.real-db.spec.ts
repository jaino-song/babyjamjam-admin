import { randomInt, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";

import type { AuthPhoneChallengeRow } from "domain/repositories/auth-phone-challenge.repository.interface";
import { SbAuthPhoneChallengeRepository } from "infrastructure/database/repositories/sb.auth-phone-challenge.repository";
import { closeIntegrityPrisma, createIntegrityPrisma, describeReal } from "../helpers/real-db";
import type { IntegrityPrisma } from "../helpers/real-db";
import { invariant } from "../helpers/known-defect";
import { sha256Hex, waitUntilBlocked, waitUntilBlockedCount } from "./users-local.helpers";

describeReal("phone challenge limits (real PostgreSQL)", () => {
    let handle: IntegrityPrisma;
    let repository: SbAuthPhoneChallengeRepository;
    const phones = new Set<string>();

    beforeAll(async () => {
        // createIntegrityPrisma guards the target here, never during import.
        handle = await createIntegrityPrisma();
        repository = new SbAuthPhoneChallengeRepository(handle.service);
    });

    afterEach(async () => {
        if (!handle) return;
        await handle.raw.auth_phone_challenge.deleteMany({ where: { phone: { in: [...phones] } } });
        phones.clear();
    });

    afterAll(async () => {
        if (!handle) return;
        try {
            // Retry cleanup if an afterEach failed, before disconnecting both clients.
            await handle.raw.auth_phone_challenge.deleteMany({ where: { phone: { in: [...phones] } } });
        } finally {
            await closeIntegrityPrisma(handle);
        }
    });

    function newPhone(): string {
        let phone: string;
        do {
            phone = `010${String(randomInt(100_000_000)).padStart(8, "0")}`;
        } while (phones.has(phone));
        phones.add(phone);
        return phone;
    }

    function challenge(phone: string, createdAt = new Date()): AuthPhoneChallengeRow {
        return {
            id: randomUUID(), purpose: "kakao_link", tokenHash: sha256Hex(randomUUID()), phone,
            codeHash: sha256Hex(randomUUID()), attemptCount: 0, userId: null, kakaoId: null,
            email: null, passwordHash: null, name: null, createdAt,
            expiresAt: new Date(Date.now() + 300_000), consumedAt: null,
        };
    }

    function limits(now = new Date()) {
        return {
            shortWindowStart: new Date(now.getTime() - 600_000), shortMax: 3,
            dayWindowStart: new Date(now.getTime() - 86_400_000), dayMax: 10,
        };
    }

    invariant("SI-USER-15", "five concurrent creates admit exactly three for one phone", async () => {
        const phone = newPhone();
        const window = limits();
        const rows = Array.from({ length: 5 }, () => challenge(phone));
        expect(new Set(rows.map((row) => row.id)).size).toBe(5);
        expect(new Set(rows.map((row) => row.tokenHash)).size).toBe(5);
        const results = await Promise.allSettled(rows.map((row) => repository.createWithinLimits(row, window)));
        expect(results.filter((result) => result.status === "rejected")).toEqual([]);
        expect(results.filter((result) => result.status === "fulfilled" && result.value === "created")).toHaveLength(3);
        expect(results.filter((result) => result.status === "fulfilled" && result.value === "rate_limited")).toHaveLength(2);
        expect(await handle.raw.auth_phone_challenge.count({ where: { phone } })).toBe(3);
    });

    invariant("SI-USER-16", "the phone advisory lock blocks only that phone's create", async () => {
        const phone = newPhone();
        const otherPhone = newPhone();
        const window = limits();
        let pending: Promise<PromiseSettledResult<"created" | "rate_limited">[]> | undefined;
        let result: PromiseSettledResult<"created" | "rate_limited">[] | undefined;
        let completed = false;
        try {
            await handle.raw.$transaction(async (holderTx) => {
                // Same prefix, concatenation and hash seed as createWithinLimits.
                // Cast void to text so Prisma can deserialize the lock query.
                await holderTx.$queryRaw`
                    SELECT pg_advisory_xact_lock(hashtextextended('auth_phone_challenge:' || ${phone}, 0))::text
                `;
                // Finish the independent phone before starting the blocked call:
                // no extra work delays release once its wait is observed.
                for (let index = 0; index < window.shortMax; index += 1) {
                    await expect(repository.createWithinLimits(challenge(otherPhone), window)).resolves.toBe("created");
                }
                expect(await handle.raw.auth_phone_challenge.count({ where: { phone: otherPhone } })).toBe(3);
                expect(await handle.raw.auth_phone_challenge.count({ where: { phone } })).toBe(0);
                pending = Promise.allSettled([
                    repository.createWithinLimits(challenge(phone), window).finally(() => { completed = true; }),
                ]);
                await waitUntilBlocked(handle.raw, /pg_advisory_xact_lock[\s\S]*auth_phone_challenge:/, 3_000);
                expect(completed).toBe(false);
                // Return immediately: repository transactions have the default 5s timeout.
            }, { timeout: 30_000 });
        } finally {
            // Also drain the contender after a failed observation/holder rollback.
            if (pending) result = await pending;
        }
        expect(result).toEqual([{ status: "fulfilled", value: "created" }]);
        expect(completed).toBe(true);
        expect(await handle.raw.auth_phone_challenge.count({ where: { phone } })).toBe(1);
        expect(await handle.raw.auth_phone_challenge.count({ where: { phone: otherPhone } })).toBe(3);
    });

    invariant("SI-USER-17", "ten older challenges exhaust the day limit with an empty short window", async () => {
        const phone = newPhone();
        const now = new Date();
        const window = limits(now);
        const createdAt = new Date(now.getTime() - 60 * 60 * 1000);
        await handle.raw.auth_phone_challenge.createMany({
            data: Array.from({ length: 10 }, () => challenge(phone, createdAt)),
        });
        expect(await handle.raw.auth_phone_challenge.count({
            where: { phone, createdAt: { gte: window.shortWindowStart } },
        })).toBe(0);
        expect(await handle.raw.auth_phone_challenge.count({
            where: { phone, createdAt: { gte: window.dayWindowStart } },
        })).toBe(10);
        await expect(repository.createWithinLimits(challenge(phone), window)).resolves.toBe("rate_limited");
        expect(await handle.raw.auth_phone_challenge.count({ where: { phone } })).toBe(10);
    });

    invariant("SI-USER-18", "eight concurrent attempts increment exactly five times", async () => {
        const row = await handle.raw.auth_phone_challenge.create({ data: challenge(newPhone()) });
        const results = await Promise.allSettled(Array.from({ length: 8 }, () => repository.registerAttempt(row.id, 5)));
        expect(results.filter((result) => result.status === "rejected")).toEqual([]);
        expect(results.filter((result) => result.status === "fulfilled" && result.value)).toHaveLength(5);
        expect(results.filter((result) => result.status === "fulfilled" && !result.value)).toHaveLength(3);
        const after = await handle.raw.auth_phone_challenge.findUniqueOrThrow({ where: { id: row.id } });
        expect(after.attemptCount).toBe(5);
    });

    invariant("SI-USER-19", "two concurrent consumptions have one winner and consumed rows refuse reuse", async () => {
        const row = await handle.raw.auth_phone_challenge.create({ data: challenge(newPhone()) });
        let pending: Promise<PromiseSettledResult<boolean>[]> | undefined;
        let results: PromiseSettledResult<boolean>[] | undefined;
        try {
            await handle.raw.$transaction(async (holderTx) => {
                await holderTx.$queryRaw(Prisma.sql`
                    SELECT "id" FROM "auth_phone_challenge" WHERE "id" = CAST(${row.id} AS UUID) FOR UPDATE
                `);
                pending = Promise.allSettled(Array.from({ length: 2 }, () => handle.service.$transaction(
                    (tx) => repository.consumeWithinTx(tx, row.id),
                )));
                await waitUntilBlockedCount(handle.raw, /UPDATE[\s\S]*?"auth_phone_challenge"/, 2, 3_000);
            }, { timeout: 30_000 });
        } finally {
            if (pending) results = await pending;
        }
        expect(results).toBeDefined();
        expect(results).toHaveLength(2);
        expect(results).toEqual(expect.arrayContaining([
            { status: "fulfilled", value: true }, { status: "fulfilled", value: false },
        ]));
        const after = await handle.raw.auth_phone_challenge.findUniqueOrThrow({ where: { id: row.id } });
        expect(after.consumedAt).not.toBeNull();
        await expect(handle.service.$transaction((tx) => repository.consumeWithinTx(tx, row.id))).resolves.toBe(false);
    });

    invariant("SI-USER-20", "invalidation clears the code without consumption or removing limit evidence", async () => {
        const phone = newPhone();
        const window = limits();
        const rows = Array.from({ length: 3 }, () => challenge(phone));
        for (const row of rows) {
            await expect(repository.createWithinLimits(row, window)).resolves.toBe("created");
        }
        const row = rows[0]!;
        expect(row.codeHash).not.toBeNull();
        await repository.invalidate(row.id);
        const after = await handle.raw.auth_phone_challenge.findUniqueOrThrow({ where: { id: row.id } });
        expect(after.codeHash).toBeNull();
        expect(after.consumedAt).toBeNull();
        expect(after.createdAt).toEqual(row.createdAt);
        await expect(repository.createWithinLimits(challenge(phone), window)).resolves.toBe("rate_limited");
        expect(await handle.raw.auth_phone_challenge.count({ where: { phone } })).toBe(3);
    });
});
