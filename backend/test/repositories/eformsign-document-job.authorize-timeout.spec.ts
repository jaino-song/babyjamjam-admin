import { SbEformsignDocumentJobRepository } from "infrastructure/database/repositories/sb.eformsign-document-job.repository";
import type { PrismaService } from "infrastructure/database/prisma.service";

describe("authorizeForDispatch transaction timeout", () => {
    it("sets the same explicit 20 second timeout as retry and cancel", async () => {
        const queryRaw = jest.fn().mockResolvedValue([]);
        const transaction = jest.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
            callback({ $queryRaw: queryRaw }));
        const repository = new SbEformsignDocumentJobRepository({ $transaction: transaction } as unknown as PrismaService);
        await expect(repository.authorizeForDispatch({
            jobId: "00000000-0000-4000-8000-000000000001",
            leaseToken: "00000000-0000-4000-8000-000000000099",
            expectedContext: null,
        })).resolves.toEqual({ kind: "lost", reason: "job_not_found" });
        expect(transaction).toHaveBeenCalledTimes(1);
        expect(transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 20000 });
        expect(queryRaw).toHaveBeenCalledTimes(1);
    });
});
