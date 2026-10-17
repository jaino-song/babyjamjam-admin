import { SbEformsignBackupCollectionRepository, COLLECTION_TRANSACTION_OPTIONS } from "infrastructure/database/repositories/sb.eformsign-backup-collection.repository";

const page = { documentType: "01" as const, pass: 1 as const, ordinal: 0, startOffset: 0, requestedLimit: 100,
    returnedCount: 0, totalCount: 0, terminal: true, outcome: "succeeded" as const, failureCode: null };
function setup() {
    const tx = { eformsign_backup_collection_run: { updateMany: jest.fn().mockResolvedValue({ count: 1 }), create: jest.fn() },
        eformsign_backup_collection_page: { findUnique: jest.fn().mockResolvedValue(null), create: jest.fn() } };
    const prisma = { $transaction: jest.fn(async (operation: (value: typeof tx) => Promise<unknown>) => operation(tx)) };
    return { tx, prisma, repository: new SbEformsignBackupCollectionRepository(prisma as never) };
}

describe("SbEformsignBackupCollectionRepository", () => {
    it("uses DB-owned deadlines, a row lock and an idempotent page key", async () => {
        const { tx, prisma, repository } = setup();
        await repository.append("run", page, { isHealthy: () => true });
        tx.eformsign_backup_collection_page.findUnique.mockResolvedValueOnce({ runId: "run", ...page } as never);
        await repository.append("run", page, { isHealthy: () => true });
        expect(tx.eformsign_backup_collection_page.create).toHaveBeenCalledTimes(1);
        expect(prisma.$transaction).toHaveBeenLastCalledWith(expect.any(Function), COLLECTION_TRANSACTION_OPTIONS);
        expect(tx.eformsign_backup_collection_run.updateMany).toHaveBeenCalledWith({ where: { id: "run", outcome: "started" },
            data: { revision: { increment: 1 } } });
    });

    it("rejects conflicting duplicate pages and append after finalization", async () => {
        const { tx, repository } = setup();
        tx.eformsign_backup_collection_page.findUnique.mockResolvedValueOnce({ runId: "run", ...page, totalCount: 1 } as never);
        await expect(repository.append("run", page, { isHealthy: () => true })).rejects.toThrow("conflict");
        tx.eformsign_backup_collection_run.updateMany.mockResolvedValueOnce({ count: 0 });
        await expect(repository.append("run", page, { isHealthy: () => true })).rejects.toThrow("closed");
    });

    it("checks health after acquiring a delayed lock before complete finalize, even without a failure marker", async () => {
        const { tx, repository } = setup();
        let healthy = true;
        tx.eformsign_backup_collection_run.updateMany.mockImplementationOnce(async () => { healthy = false; return { count: 1 }; });
        await expect(repository.finish({ id: "run", outcome: "completed", finishedAt: new Date(), failureCode: null,
            scanSummary: { version: 1, scans: [], assessment: { observedScan: "incomplete", companyCoverage: "unverified", reasons: [] } } },
        { isHealthy: () => healthy })).rejects.toThrow("unhealthy");
        expect(tx.eformsign_backup_collection_run.updateMany).toHaveBeenCalledTimes(1);
    });
});


it("rolls back complete finalization after its deadline even if failure-marker storage is unavailable", async () => {
    const { tx, repository } = setup();
    const now = jest.spyOn(Date, "now").mockReturnValue(0);
    tx.eformsign_backup_collection_run.updateMany.mockImplementationOnce(async () => {
        now.mockReturnValue(COLLECTION_TRANSACTION_OPTIONS.timeout + 1);
        return { count: 1 };
    });
    try {
        await expect(repository.finish({ id: "run", outcome: "completed", finishedAt: new Date(), failureCode: null,
            scanSummary: { version: 1, scans: [], assessment: { observedScan: "incomplete", companyCoverage: "unverified", reasons: [] } } },
        { isHealthy: () => true })).rejects.toThrow("deadline");
        expect(tx.eformsign_backup_collection_run.updateMany).toHaveBeenCalledTimes(1);
    } finally { now.mockRestore(); }
});


it("rejects duplicate finalization using the started-row guard", async () => {
    const { tx, repository } = setup();
    tx.eformsign_backup_collection_run.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(repository.finish({ id: "run", outcome: "completed", finishedAt: new Date(), failureCode: null,
        scanSummary: { version: 1, scans: [], assessment: { observedScan: "incomplete", companyCoverage: "unverified", reasons: [] } } },
    { isHealthy: () => true })).rejects.toThrow("closed");
    expect(tx.eformsign_backup_collection_run.updateMany).toHaveBeenCalledTimes(1);
});
