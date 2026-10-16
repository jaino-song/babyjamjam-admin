import { PrismaClient } from "@prisma/client";
import { EformsignBackupCollectionWriter } from "application/services/eformsign-backup-collection-writer.service";
import { SbEformsignBackupCollectionRepository } from "infrastructure/database/repositories/sb.eformsign-backup-collection.repository";
import { documentIdSetDigest } from "domain/eformsign-backup/collection-receipt";

function assertTarget(databaseUrl = process.env["DATABASE_URL"], directUrl = process.env["DIRECT_URL"]): void {
    if (!databaseUrl || !directUrl || databaseUrl !== directUrl
        || !/^postgresql:\/\/[A-Za-z0-9_.-]+@(localhost|127\.0\.0\.1)(:\d+)?\/[A-Za-z0-9_]*throwaway[A-Za-z0-9_]*$/.test(databaseUrl)) {
        throw new Error("Refusing collection real-DB spec: matching local throwaway targets required");
    }
}
describe("collection real-DB target guard", () => {
    it("refuses missing, mismatched and non-disposable targets", () => {
        const url = "postgresql://test@localhost/throwaway_collection";
        expect(() => assertTarget(url, url)).not.toThrow();
        for (const [a, b] of [["", ""], [url, "other"], ["postgresql://test@remote/throwaway_collection", "postgresql://test@remote/throwaway_collection"],
            ["postgresql://test@localhost/production", "postgresql://test@localhost/production"]]) {
            expect(() => assertTarget(a, b)).toThrow("Refusing");
        }
    });
});

const describeReal = process.env["HOLIDAY_REVIEW_REAL_DB"] === "1" ? describe : describe.skip;
describeReal("collection ledger (real PostgreSQL; requires generated additive migration)", () => {
    let prisma: PrismaClient;
    const ids: string[] = [];
    beforeAll(async () => { assertTarget(); prisma = new PrismaClient(); await prisma.$connect(); });
    afterAll(async () => {
        if (!prisma) return;
        await prisma.eformsign_backup_collection_page.deleteMany({ where: { runId: { in: ids } } });
        await prisma.eformsign_backup_collection_run.deleteMany({ where: { id: { in: ids } } });
        await prisma.$disconnect();
    });
    it("commits six scans, deduplicates a page, and forbids late append/finalize", async () => {
        const base = new SbEformsignBackupCollectionRepository(prisma as never);
        const repository = { begin: async (run: Parameters<typeof base.begin>[0]) => { ids.push(run.id); await base.begin(run); },
            append: base.append.bind(base), finish: base.finish.bind(base) };
        const session = await new EformsignBackupCollectionWriter(repository).begin({ configuredCompanyId: "company-test",
            trigger: "operator-backfill", lockMode: "approved-unlocked" });
        const page = { documentType: "01" as const, pass: 1 as const, ordinal: 0, startOffset: 0, requestedLimit: 100,
            returnedCount: 0, totalCount: 0, terminal: true, outcome: "succeeded" as const, failureCode: null };
        await session.page(page); await session.page(page);
        for (const documentType of ["01", "03", "04"] as const) for (const pass of [1, 2] as const) {
            await session.page({ ...page, documentType, pass });
            await session.scan({ documentType, pass, distinctIdCount: 0, documentIdSetSha256: documentIdSetDigest([]) });
        }
        expect((await session.finish("succeeded")).observedScan).toBe("complete");
        expect(await prisma.eformsign_backup_collection_page.count({ where: { runId: ids[0] } })).toBe(6);
        await expect(base.append(ids[0]!, page, { isHealthy: () => true })).rejects.toThrow();
        const run = await prisma.eformsign_backup_collection_run.findUniqueOrThrow({ where: { id: ids[0]! }, select: { outcome: true, scanSummary: true } });
        expect(run.outcome).toBe("completed");
        expect((run.scanSummary as { assessment: { observedScan: string } }).assessment.observedScan).toBe("incomplete");
    });
    it("leaves a crashed started run incomplete without guessing counts", async () => {
        const base = new SbEformsignBackupCollectionRepository(prisma as never);
        let id = "";
        await new EformsignBackupCollectionWriter({
            begin: async run => { id = run.id; ids.push(id); await base.begin(run); },
            append: base.append.bind(base), finish: base.finish.bind(base),
        }).begin({ configuredCompanyId: null, trigger: "reconciliation", lockMode: "valkey" });
        const run = await prisma.eformsign_backup_collection_run.findUniqueOrThrow({ where: { id },
            select: { outcome: true, configuredCompanyId: true, scanSummary: true } });
        expect(run.outcome).toBe("started");
        expect(run.configuredCompanyId).toBeNull();
        const summary = run.scanSummary as { scans: Array<{ distinctIdCount: number | null }> };
        expect(summary.scans).toHaveLength(6);
        expect(summary.scans.every(scan => scan.distinctIdCount === null)).toBe(true);
    });

    it("rolls back timed-out complete finalize while failure-marker storage is unavailable", async () => {
        const repository = new SbEformsignBackupCollectionRepository(prisma as never);
        let id = "";
        let summary!: Parameters<typeof repository.begin>[0]["scanSummary"];
        await new EformsignBackupCollectionWriter({
            begin: async run => { id = run.id; summary = run.scanSummary; ids.push(id); await repository.begin(run); },
            append: repository.append.bind(repository), finish: repository.finish.bind(repository),
        }).begin({ configuredCompanyId: "company-test", trigger: "reconciliation", lockMode: "valkey" });
        let acquired!: () => void;
        let release!: () => void;
        const locked = new Promise<void>(resolve => { acquired = resolve; });
        const released = new Promise<void>(resolve => { release = resolve; });
        const holder = prisma.$transaction(async tx => {
            await tx.eformsign_backup_collection_run.update({ where: { id }, data: { revision: { increment: 1 } } });
            acquired();
            await released;
        }, { timeout: 10_000 });
        await locked;
        try {
            await expect(repository.finish({ id, outcome: "completed", finishedAt: new Date(), failureCode: null,
                scanSummary: summary }, { isHealthy: () => true })).rejects.toThrow();
        } finally { release(); await holder; }
        expect(await prisma.eformsign_backup_collection_run.findUniqueOrThrow({ where: { id }, select: { outcome: true } }))
            .toEqual({ outcome: "started" });
    }, 15_000);
});
