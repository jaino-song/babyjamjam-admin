import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

// Same opt-in and target guard as the other test/prisma real-DB specs: nothing
// connects unless both URLs identify the same loopback throwaway database.
const describeReal = process.env["HOLIDAY_REVIEW_REAL_DB"] === "1" ? describe : describe.skip;

function assertThrowawayTarget(databaseUrl = process.env["DATABASE_URL"], directUrl = process.env["DIRECT_URL"]): void {
    if (!databaseUrl || !directUrl) throw new Error("Refusing real-DB spec without DATABASE_URL and DIRECT_URL");
    if (databaseUrl !== directUrl) throw new Error("Refusing real-DB spec: DATABASE_URL and DIRECT_URL differ");
    if (!/^postgresql:\/\/[A-Za-z0-9_.-]+@(localhost|127\.0\.0\.1)(:\d+)?\/[A-Za-z0-9_]*throwaway[A-Za-z0-9_]*$/.test(databaseUrl)) {
        throw new Error("Refusing real-DB spec: target must be a loopback throwaway database");
    }
}

const BACKEND_DIR = resolve(__dirname, "../..");
const MIGRATION = "prisma/migrations/20260829130000_add_canonical_phone_identity/migration.sql";
const VERIFY = "prisma/scripts/verify-canonical-phone-duplicates.sql";
const INDEX_NAME = "client_branch_phone_normalized_key";

interface RunResult {
    status: number | null;
    output: string;
}

// Runs a SQL file exactly as database-patches.yml does: a child process through
// the real prisma CLI, so the file's own BEGIN/COMMIT and failure semantics apply.
function runPatch(file: string): RunResult {
    const result = spawnSync("./scripts/run-prisma-db-execute.sh", ["--schema", "prisma/schema.prisma", "--file", file], {
        cwd: BACKEND_DIR,
        env: process.env,
        encoding: "utf8",
    });
    return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

function runVerify(): RunResult {
    const result = spawnSync("pnpm", ["exec", "prisma", "db", "execute", "--schema", "prisma/schema.prisma", "--file", VERIFY], {
        cwd: BACKEND_DIR,
        env: process.env,
        encoding: "utf8",
    });
    return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

describe("canonical phone identity migration file (static)", () => {
    const sql = readFileSync(resolve(BACKEND_DIR, MIGRATION), "utf8");

    it("only backfills live clients so tombstones keep their NULL identity", () => {
        const clientBackfill = sql.slice(0, sql.indexOf('UPDATE "public"."client" AS target'));
        expect(clientBackfill).toMatch(/"deleted_at" IS NULL/);
    });
});

describeReal("canonical phone identity migration vs client tombstones (real PostgreSQL)", () => {
    let prisma: PrismaClient;
    let branchIds: string[] = [];

    beforeAll(async () => {
        assertThrowawayTarget();
        prisma = new PrismaClient();
        await prisma.$connect();
    });

    afterAll(async () => {
        await prisma?.$disconnect();
    });

    // CI shares one throwaway DB between specs, so each case owns a unique branch.
    async function newBranch(): Promise<string> {
        const suffix = randomUUID();
        const branch = await prisma.branch.create({ data: { name: `phone tombstone ${suffix}`, slug: `phone-tomb-${suffix}` } });
        branchIds.push(branch.id);
        return branch.id;
    }

    async function insertClient(branchId: string, phone: string | null, phoneNormalized: string | null, deletedAt: Date | null): Promise<number> {
        const row = await prisma.client.create({
            data: { branchId, name: "phone tombstone fixture", voucherClient: false, phone, phoneNormalized, deletedAt },
        });
        return row.id;
    }

    async function snapshot(ids: number[]): Promise<Array<{ id: number; phoneNormalized: string | null; deletedAt: Date | null }>> {
        return prisma.client.findMany({
            where: { id: { in: ids } },
            select: { id: true, phoneNormalized: true, deletedAt: true },
            orderBy: { id: "asc" },
        });
    }

    async function ensureIndex(): Promise<void> {
        await prisma.$executeRawUnsafe(
            `CREATE UNIQUE INDEX IF NOT EXISTS "${INDEX_NAME}" ON "public"."client"("branch_id", "phone_normalized")`,
        );
    }

    afterEach(async () => {
        // Rows from a failed assertion must not poison the next migration replay.
        if (branchIds.length > 0) {
            await prisma.client.deleteMany({ where: { branchId: { in: branchIds } } });
            await prisma.branch.deleteMany({ where: { id: { in: branchIds } } });
            branchIds = [];
        }
        await ensureIndex();
    });

    it("(i) replays over tombstones with NULL keys plus a live row: succeeds twice, tombstones stay NULL, live row unchanged", async () => {
        const branchId = await newBranch();
        const now = new Date();
        const tombA = await insertClient(branchId, "010-3333-4444", null, now);
        const tombB = await insertClient(branchId, "010-3333-4444", null, now);
        const live = await insertClient(branchId, "010-3333-4444", "01033334444", null);
        const before = await snapshot([tombA, tombB, live]);

        for (const attempt of [1, 2]) {
            const run = runPatch(MIGRATION);
            if (run.status !== 0) throw new Error(`attempt ${attempt} exited ${run.status}\n${run.output}`);
            expect(await snapshot([tombA, tombB, live])).toEqual(before);
        }
        const after = await snapshot([tombA, tombB, live]);
        expect(after.filter((row) => row.deletedAt !== null).map((row) => row.phoneNormalized)).toEqual([null, null]);
        expect(after.find((row) => row.id === live)?.phoneNormalized).toBe("01033334444");
    }, 120_000);

    it("(i-b) still backfills a live client whose key is NULL", async () => {
        const branchId = await newBranch();
        const live = await insertClient(branchId, "+82 10-5555-6666", null, null);
        const tomb = await insertClient(branchId, "010-7777-8888", null, new Date());

        const run = runPatch(MIGRATION);
        if (run.status !== 0) throw new Error(`exited ${run.status}\n${run.output}`);
        const after = await snapshot([live, tomb]);
        expect(after.find((row) => row.id === live)?.phoneNormalized).toBe("01055556666");
        expect(after.find((row) => row.id === tomb)?.phoneNormalized).toBeNull();
    }, 120_000);

    it("(ii) with the index present, two live clients whose raw phones normalize alike still abort the file and roll back", async () => {
        const branchId = await newBranch();
        const first = await insertClient(branchId, "010-1111-2222", null, null);
        const second = await insertClient(branchId, "01011112222", null, null);
        const before = await snapshot([first, second]);

        const run = runPatch(MIGRATION);
        expect(run.status).not.toBe(0);
        expect(run.output).toMatch(/Unique constraint failed|23505|P2002/);
        expect(await snapshot([first, second])).toEqual(before);
        const index = await prisma.$queryRaw<Array<{ indexname: string }>>`
            SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'client' AND indexname = ${INDEX_NAME}
        `;
        expect(index).toHaveLength(1);
    }, 120_000);

    it("(iii) first apply (no index yet): live duplicates raise the duplicate-group exception, tombstones do not", async () => {
        const branchId = await newBranch();
        const tombstone = await insertClient(branchId, "010-9999-0000", null, new Date());
        const liveA = await insertClient(branchId, "010-2222-3333", "01022223333", null);
        // Tombstoned twin of a live phone must not be counted as a duplicate on its own.
        const tombTwin = await insertClient(branchId, "010-2222-3333", null, new Date());
        await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "public"."${INDEX_NAME}"`);
        try {
            const clean = runPatch(MIGRATION);
            if (clean.status !== 0) throw new Error(`tombstone-only twin should pass, exited ${clean.status}\n${clean.output}`);
            await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "public"."${INDEX_NAME}"`);

            const liveB = await insertClient(branchId, "010-2222-3333", "01022223333", null);
            const before = await snapshot([tombstone, liveA, tombTwin, liveB]);
            const run = runPatch(MIGRATION);
            expect(run.status).not.toBe(0);
            expect(run.output).toContain("client has duplicate (branch_id, phone_normalized) groups");
            expect(await snapshot([tombstone, liveA, tombTwin, liveB])).toEqual(before);
        } finally {
            await prisma.client.deleteMany({ where: { branchId } });
            await ensureIndex();
        }
    }, 120_000);

    describe("verify-canonical-phone-duplicates.sql pre-check", () => {
        it("passes when only tombstones share a phone with a live client", async () => {
            const branchId = await newBranch();
            await insertClient(branchId, "010-4444-5555", null, new Date());
            await insertClient(branchId, "010-4444-5555", null, new Date());
            await insertClient(branchId, "010-4444-5555", "01044445555", null);

            const run = runVerify();
            if (run.status !== 0) throw new Error(`verify exited ${run.status}\n${run.output}`);
        }, 120_000);

        it("fails for live clients whose stored keys are NULL but whose phones normalize alike", async () => {
            const branchId = await newBranch();
            await insertClient(branchId, "010-1111-2222", null, null);
            await insertClient(branchId, "+82 10 1111 2222", null, null);

            const run = runVerify();
            expect(run.status).not.toBe(0);
            expect(run.output).toContain("client has duplicate (branch_id, phone_normalized) groups");
            expect(run.output).toContain("01011112222");
        }, 120_000);

        it("still fails on duplicate stored keys (index absent so the fixture can exist)", async () => {
            const branchId = await newBranch();
            await prisma.$executeRawUnsafe(`DROP INDEX IF EXISTS "public"."${INDEX_NAME}"`);
            await insertClient(branchId, "010-6666-7777", "01066667777", null);
            await insertClient(branchId, "010-6666-7777", "01066667777", null);
            try {
                const run = runVerify();
                expect(run.status).not.toBe(0);
                expect(run.output).toContain("client has duplicate (branch_id, phone_normalized) groups");
            } finally {
                await prisma.client.deleteMany({ where: { branchId } });
                await ensureIndex();
            }
        }, 120_000);
    });
});
