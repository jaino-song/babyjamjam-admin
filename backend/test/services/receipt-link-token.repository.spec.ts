import { checkWriteArgs } from "infrastructure/database/tenant-isolation.extension";
import { SbReceiptLinkTokenRepository } from "infrastructure/database/repositories/sb.receipt-link-token.repository";
import { runSystemScope } from "infrastructure/tenant/run-system-scope";

jest.mock("infrastructure/tenant/run-system-scope", () => ({
    runSystemScope: jest.fn((fn: () => unknown) => fn()),
}));

const mockedRunSystemScope = runSystemScope as jest.Mock;

const BASE_ROW = {
    id: "tok-1",
    eformsignDocId: 1,
    accessTokenHash: null,
    expectedBirthdayHash: "hash",
    verifiedAt: null,
    failedAttempts: 0,
    lockedAt: null,
    expiresAt: new Date("2026-10-03T00:00:00.000Z"),
    active: true,
    storagePath: "receipts/b/1/a.png",
    branch: { name: "인천 아이미래로" },
    client: { name: "김산모" },
};

interface FakeTx {
    $executeRaw: jest.Mock;
    $queryRaw: jest.Mock;
    receipt_link_token: {
        findUnique: jest.Mock;
        update: jest.Mock;
        findFirst: jest.Mock;
        findMany: jest.Mock;
        create: jest.Mock;
        upsert: jest.Mock;
        updateMany: jest.Mock;
        deleteMany: jest.Mock;
    };
}

function makeFakePrisma() {
    const receipt_link_token = {
        findUnique: jest.fn(),
        update: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        upsert: jest.fn(),
        updateMany: jest.fn(),
        deleteMany: jest.fn(),
    };
    const tx: FakeTx = { receipt_link_token, $executeRaw: jest.fn(), $queryRaw: jest.fn() };
    const $transaction = jest.fn(async (arg: unknown) => {
        if (typeof arg === "function") {
            return (arg as (tx: FakeTx) => unknown)(tx);
        }
        return Promise.all(arg as Promise<unknown>[]);
    });
    const $queryRaw = jest.fn();
    return { receipt_link_token, $transaction, $queryRaw, __tx: tx };
}

describe("SbReceiptLinkTokenRepository", () => {
    beforeEach(() => jest.clearAllMocks());

    // F2 audit fix: incrementFailedAttempts (a read-then-decide-then-write sequence prone to a
    // concurrent-guess race — see receipt-link-token.service.ts) was replaced by
    // reserveVerificationAttempt, one atomic raw statement. Covered in depth in
    // test/repositories/receipt-link-token.repository.spec.ts; this assertion just keeps this
    // file's "every cross-branch method wraps runSystemScope exactly once" survey accurate.
    it("wraps findByLinkTokenHash, update, and reserveVerificationAttempt in runSystemScope exactly once each", async () => {
        const prisma = makeFakePrisma();
        const repository = new SbReceiptLinkTokenRepository(prisma as never);

        prisma.receipt_link_token.findUnique.mockResolvedValue(BASE_ROW);
        await repository.findByLinkTokenHash("hash");
        expect(mockedRunSystemScope).toHaveBeenCalledTimes(1);

        mockedRunSystemScope.mockClear();
        prisma.receipt_link_token.update.mockResolvedValue(BASE_ROW);
        await repository.update("tok-1", { verifiedAt: new Date() });
        expect(mockedRunSystemScope).toHaveBeenCalledTimes(1);

        mockedRunSystemScope.mockClear();
        prisma.$queryRaw.mockResolvedValue([
            { failedAttempts: 1, lockedAt: null, expectedBirthdayHash: "hash", wasLocked: false },
        ]);
        await repository.reserveVerificationAttempt("tok-1", new Date(), 30 * 60 * 1000, 5);
        expect(mockedRunSystemScope).toHaveBeenCalledTimes(1);
    });

    it("does NOT wrap createOrRefreshContractLink in runSystemScope, and branch-pins the expiry refresh without revoking old URLs", async () => {
        const prisma = makeFakePrisma();
        const repository = new SbReceiptLinkTokenRepository(prisma as never);
        prisma.receipt_link_token.upsert.mockResolvedValue(BASE_ROW);

        const now = new Date();
        await repository.createOrRefreshContractLink(
            {
                branchId: "11111111-1111-1111-1111-111111111111",
                clientId: 7,
                eformsignDocId: 1,
                jobId: null,
                linkTokenHash: "h",
                expectedBirthdayHash: "h2",
                expiresAt: new Date(),
                storagePath: "receipts/b/1/a.png",
                contentSha256: "sha",
                byteSize: 10,
                source: "auto_trigger",
                createdBy: null,
                createdAt: now,
            },
            now,
        );

        expect(mockedRunSystemScope).not.toHaveBeenCalled();
        expect(checkWriteArgs("upsert", prisma.receipt_link_token.upsert.mock.calls[0]?.[0], "11111111-1111-1111-1111-111111111111")).toBeNull();
        expect(prisma.receipt_link_token.updateMany).toHaveBeenCalledWith({
            where: { clientId: 7, branchId: "11111111-1111-1111-1111-111111111111" },
            data: { expiresAt: expect.any(Date), expectedBirthdayHash: "h2" },
        });
    });

    it("refreshes the birthday and retains changed images for expiry cleanup", async () => {
        const prisma = makeFakePrisma();
        const repository = new SbReceiptLinkTokenRepository(prisma as never);
        prisma.receipt_link_token.findUnique.mockResolvedValue({ ...BASE_ROW, contentSha256: "old-sha", byteSize: 25 });
        prisma.receipt_link_token.upsert.mockResolvedValue(BASE_ROW);
        const data = {
            branchId: "11111111-1111-1111-1111-111111111111", clientId: 7, eformsignDocId: 1, jobId: null,
            linkTokenHash: "stable-hash", expectedBirthdayHash: "corrected-birthday", expiresAt: new Date("2026-09-24T15:00:00Z"),
            storagePath: "receipts/b/1/new.png", contentSha256: "new-sha", byteSize: 50,
            source: "manual" as const, createdBy: null, createdAt: new Date(),
        };
        await repository.createOrRefreshContractLink(data, data.createdAt);
        expect(prisma.receipt_link_token.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining({ expectedBirthdayHash: "corrected-birthday" }) }));
        expect(prisma.receipt_link_token.create).toHaveBeenCalledWith({ data: expect.objectContaining({
            storagePath: BASE_ROW.storagePath, contentSha256: "old-sha", byteSize: 25,
            active: false, revokedAt: null, jobId: null, expiresAt: data.expiresAt,
            linkTokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        }) });
        expect(prisma.receipt_link_token.create.mock.invocationCallOrder[0]).toBeLessThan(prisma.receipt_link_token.upsert.mock.invocationCallOrder[0]!);
    });

    it("uses locked current client fields instead of the render-time snapshot", async () => {
        const prisma = makeFakePrisma();
        const repository = new SbReceiptLinkTokenRepository(prisma as never);
        prisma.receipt_link_token.upsert.mockResolvedValue(BASE_ROW);
        const latest = { birthday: "910202", endDate: new Date("2026-10-01T00:00:00Z") };
        prisma.__tx.$queryRaw.mockResolvedValue([latest]);
        const expiresAt = new Date("2026-10-15T15:00:00Z");
        const refresh = jest.fn(() => ({ expectedBirthdayHash: "latest-hash", expiresAt }));
        await repository.createOrRefreshContractLink({
            branchId: "11111111-1111-1111-1111-111111111111", clientId: 7, eformsignDocId: 1,
            jobId: null, linkTokenHash: "stable", expectedBirthdayHash: "stale-hash",
            expiresAt: BASE_ROW.expiresAt, storagePath: BASE_ROW.storagePath, contentSha256: "sha",
            byteSize: 10, source: "manual", createdBy: null, createdAt: new Date(),
        }, new Date(), refresh);
        expect(refresh).toHaveBeenCalledWith(latest);
        const sql = prisma.__tx.$queryRaw.mock.calls[0]?.[0];
        expect(sql.strings.join("")).toContain("FOR UPDATE");
        expect(sql.values).toEqual([7, "11111111-1111-1111-1111-111111111111"]);
        expect(prisma.receipt_link_token.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            data: { expectedBirthdayHash: "latest-hash", expiresAt },
        }));
        expect(prisma.receipt_link_token.upsert).toHaveBeenCalledWith(expect.objectContaining({
            update: expect.objectContaining({ expectedBirthdayHash: "latest-hash", expiresAt }),
        }));
    });

    it("promotes only the frozen active tokens after state proof and current contract checks", async () => {
        const prisma = makeFakePrisma();
        const repository = new SbReceiptLinkTokenRepository(prisma as never);
        const branchId = "11111111-1111-4111-8111-111111111111";
        const caseId = "22222222-2222-4222-8222-222222222222";
        const revisionId = "33333333-3333-4333-8333-333333333333";
        const stateId = "44444444-4444-4444-8444-444444444444";
        const tokenIds = [
            "55555555-5555-4555-8555-555555555555",
            "66666666-6666-4666-8666-666666666666",
        ];
        const now = new Date("2026-09-08T03:00:00.000Z");
        const proof = {
            officialPdfSha256: "a".repeat(64),
            verifiedAt: now.toISOString(),
            pageCount: 1,
            scope: {
                branchId,
                clientId: 7,
                revisionId,
                documentId: "target-document",
                generation: "generation-1",
                mirrorGeneration: "mirror-1",
                templateId: "template-1",
                templateVersion: "v3",
            },
            expected: { serviceStartDate: "2026-08-01", serviceEndDate: "2026-08-14", receivedDate: "2026-08-02", amount: "123000" },
            artifact: { storagePath: "receipts/new.png", contentSha256: "b".repeat(64), byteSize: 9 },
        };
        prisma.__tx.$queryRaw
            .mockResolvedValueOnce([{ eDocId: "target-document" }])
            .mockResolvedValueOnce([{ currentRevisionId: revisionId }])
            .mockResolvedValueOnce([{ id: revisionId }])
            .mockResolvedValueOnce([{
                version: 1,
                operation: "receipt_refresh",
                generation: "generation-1",
                sourceDocumentId: "original-document",
                targetDocumentId: "target-document",
                documentVersion: 3,
                templateId: "template-1",
                templateVersion: "v3",
                mirrorGeneration: "mirror-1",
                outputProof: proof,
                status: "processing",
            }])
            .mockResolvedValueOnce([{ id: 99, documentId: "target-document" }])
            .mockResolvedValueOnce(tokenIds.map((id) => ({
                id,
                eformsignDocId: 42,
                branchId,
                clientId: 7,
                active: true,
                expiresAt: new Date("2026-09-30T00:00:00.000Z"),
            })))
            .mockResolvedValueOnce([{ version: 2 }]);
        prisma.__tx.receipt_link_token.updateMany.mockResolvedValue({ count: tokenIds.length });

        const result = await repository.promoteReceiptRevisionArtifact({
            branchId,
            clientId: 7,
            serviceRecordCaseId: caseId,
            revisionId,
            documentStateId: stateId,
            expectedGeneration: "generation-1",
            expectedStateVersion: 1,
            targetDocumentId: "target-document",
            documentVersion: 3,
            templateId: "template-1",
            templateVersion: "v3",
            mirrorGeneration: "mirror-1",
            eformsignDocId: 42,
            tokenIds,
            storagePath: "receipts/new.png",
            contentSha256: "b".repeat(64),
            byteSize: 9,
            proof,
            now,
        });

        expect(result).toEqual({ disposition: "promoted", tokenIds, stateVersion: 2 });
        expect(prisma.__tx.receipt_link_token.updateMany).toHaveBeenCalledWith({
            where: expect.objectContaining({ id: { in: tokenIds }, active: true }),
            data: { storagePath: "receipts/new.png", contentSha256: "b".repeat(64), byteSize: 9 },
        });
        const updateData = prisma.__tx.receipt_link_token.updateMany.mock.calls[0]?.[0]?.data as Record<string, unknown>;
        expect(updateData).not.toHaveProperty("accessTokenHash");
        expect(updateData).not.toHaveProperty("expiresAt");
    });

    it("returns stale without touching token artifacts when a frozen token is no longer active", async () => {
        const prisma = makeFakePrisma();
        const repository = new SbReceiptLinkTokenRepository(prisma as never);
        const branchId = "11111111-1111-4111-8111-111111111111";
        const caseId = "22222222-2222-4222-8222-222222222222";
        const revisionId = "33333333-3333-4333-8333-333333333333";
        const stateId = "44444444-4444-4444-8444-444444444444";
        const tokenId = "55555555-5555-4555-8555-555555555555";
        const now = new Date("2026-09-08T03:00:00.000Z");
        const proof = {
            officialPdfSha256: "a".repeat(64), verifiedAt: now.toISOString(), pageCount: 1,
            scope: {
                branchId,
                clientId: 7,
                revisionId,
                documentId: "target-document",
                generation: "generation-1",
                mirrorGeneration: "mirror-1",
                templateId: "template-1",
                templateVersion: "v3",
            },
            expected: { serviceStartDate: "2026-08-01", serviceEndDate: "2026-08-14", receivedDate: "2026-08-02", amount: "123000" },
            artifact: { storagePath: "receipts/new.png", contentSha256: "b".repeat(64), byteSize: 9 },
        };
        prisma.__tx.$queryRaw
            .mockResolvedValueOnce([{ eDocId: "target-document" }])
            .mockResolvedValueOnce([{ currentRevisionId: revisionId }])
            .mockResolvedValueOnce([{ id: revisionId }])
            .mockResolvedValueOnce([{
                version: 1, operation: "receipt_refresh", generation: "generation-1", sourceDocumentId: "original-document",
                targetDocumentId: "target-document", documentVersion: 3, templateId: "template-1", templateVersion: "v3",
                mirrorGeneration: "mirror-1", outputProof: proof, status: "processing",
            }])
            .mockResolvedValueOnce([{ id: 99, documentId: "target-document" }])
            .mockResolvedValueOnce([{
                id: tokenId, eformsignDocId: 42, branchId, clientId: 7, active: false,
                expiresAt: new Date("2026-09-30T00:00:00.000Z"),
            }]);

        const result = await repository.promoteReceiptRevisionArtifact({
            branchId, clientId: 7, serviceRecordCaseId: caseId, revisionId, documentStateId: stateId,
            expectedGeneration: "generation-1", expectedStateVersion: 1, targetDocumentId: "target-document",
            documentVersion: 3, templateId: "template-1", templateVersion: "v3", mirrorGeneration: "mirror-1",
            eformsignDocId: 42, tokenIds: [tokenId], storagePath: "receipts/new.png", contentSha256: "b".repeat(64),
            byteSize: 9, proof, now,
        });

        expect(result).toMatchObject({ disposition: "stale" });
        expect(prisma.__tx.receipt_link_token.updateMany).not.toHaveBeenCalled();
    });

    it("fails closed before opening a transaction for a malformed promotion envelope", async () => {
        const prisma = makeFakePrisma();
        const repository = new SbReceiptLinkTokenRepository(prisma as never);

        const result = await repository.promoteReceiptRevisionArtifact({
            targetDocumentId: undefined,
        } as never);

        expect(result).toEqual({ disposition: "stale", tokenIds: [], stateVersion: null });
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("restores a legacy reissued URL with the service-end expiry and requires fresh authentication", async () => {
        const prisma = makeFakePrisma();
        const repository = new SbReceiptLinkTokenRepository(prisma as never);
        prisma.receipt_link_token.findUnique.mockResolvedValue({ ...BASE_ROW, active: false, revokedAt: new Date(),
            accessTokenHash: "old-session", verifiedAt: new Date(), failedAttempts: 3,
            client: { name: "김산모", endDate: new Date("2026-09-10T00:00:00Z") } });
        const row = await repository.findByLinkTokenHash("legacy-hash");
        expect(row).toMatchObject({ active: true, accessTokenHash: null, verifiedAt: null, failedAttempts: 3,
            expiresAt: new Date("2026-09-24T15:00:00Z") });
        expect(prisma.receipt_link_token.update).toHaveBeenCalledWith({ where: { id: "tok-1" }, data: {
            active: true, revokedAt: null, accessTokenHash: null, verifiedAt: null, expiresAt: new Date("2026-09-24T15:00:00Z"),
        } });
    });

    it("does not clean up a link whose service end was extended", async () => {
        const prisma = makeFakePrisma();
        const repository = new SbReceiptLinkTokenRepository(prisma as never);
        prisma.receipt_link_token.findMany.mockResolvedValue([{ ...BASE_ROW, expiresAt: new Date("2026-08-01T00:00:00Z"),
            client: { name: "김산모", endDate: new Date("2026-09-10T00:00:00Z") } }]);
        expect(await repository.findExpired(new Date("2026-09-07T00:00:00Z"))).toEqual([]);
        expect(prisma.receipt_link_token.update).toHaveBeenCalledWith({ where: { id: "tok-1" }, data: { expiresAt: new Date("2026-09-24T15:00:00Z") } });
    });

    it("restores a revoked legacy URL without an end date using its original expiry", async () => {
        const prisma = makeFakePrisma();
        const repository = new SbReceiptLinkTokenRepository(prisma as never);
        prisma.receipt_link_token.findUnique.mockResolvedValue({ ...BASE_ROW, active: false, revokedAt: new Date(),
            accessTokenHash: "former-session", client: { name: "김산모", endDate: null } });
        expect(await repository.findByLinkTokenHash("legacy")).toMatchObject({
            active: true, accessTokenHash: null, expiresAt: BASE_ROW.expiresAt,
        });
    });

    it("selects earlier corrected end dates even when the stored expiry is in the future", async () => {
        const prisma = makeFakePrisma();
        const repository = new SbReceiptLinkTokenRepository(prisma as never);
        const cutoff = new Date("2026-09-25T00:00:00Z");
        prisma.receipt_link_token.findMany.mockResolvedValue([{ ...BASE_ROW,
            client: { name: "김산모", endDate: new Date("2026-09-10T00:00:00Z") } }]);
        expect(await repository.findExpired(cutoff)).toEqual([{ id: BASE_ROW.id,
            storagePath: BASE_ROW.storagePath, eformsignDocId: BASE_ROW.eformsignDocId }]);
        expect(prisma.receipt_link_token.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {
            OR: [
                { client: { endDate: { lt: new Date("2026-09-11T00:00:00Z") } } },
                { client: { endDate: null }, expiresAt: { lt: cutoff } },
            ],
        } }));
    });

    it.each([
        ["2026-09-24T15:00:00.000Z", "2026-09-10T00:00:00Z"],
        ["2026-09-24T15:00:00.001Z", "2026-09-11T00:00:00Z"],
    ])("keeps the strict KST expiry boundary at %s", async (cutoff, endDateCutoff) => {
        const prisma = makeFakePrisma();
        const repository = new SbReceiptLinkTokenRepository(prisma as never);
        prisma.receipt_link_token.findMany.mockResolvedValue([]);
        await repository.findExpired(new Date(cutoff));
        const where = prisma.receipt_link_token.findMany.mock.calls[0]?.[0].where;
        expect(where.OR[0]).toEqual({ client: { endDate: { lt: new Date(endDateCutoff) } } });
    });

    it("atomically rechecks stored and authoritative expiry before deleting stale candidate IDs", async () => {
        jest.useFakeTimers().setSystemTime(new Date("2026-09-25T00:00:00Z"));
        try {
            const prisma = makeFakePrisma();
            const repository = new SbReceiptLinkTokenRepository(prisma as never);
            prisma.receipt_link_token.deleteMany.mockResolvedValue({ count: 0 });
            expect(await repository.deleteByIds(["refreshed-row"])).toBe(0);
            expect(prisma.receipt_link_token.deleteMany).toHaveBeenCalledWith({ where: {
                id: { in: ["refreshed-row"] }, expiresAt: { lt: new Date() },
                OR: [
                    { client: { endDate: { lt: new Date("2026-09-11T00:00:00Z") } } },
                    { client: { endDate: null }, expiresAt: { lt: new Date() } },
                ],
            } });
        } finally { jest.useRealTimers(); }
    });

    it("findActiveByJobId queries by jobId+active, ordered by createdAt desc", async () => {
        const prisma = makeFakePrisma();
        const repository = new SbReceiptLinkTokenRepository(prisma as never);
        prisma.receipt_link_token.findFirst.mockResolvedValue(null);

        await repository.findActiveByJobId("job-9");

        expect(mockedRunSystemScope).not.toHaveBeenCalled();
        expect(prisma.receipt_link_token.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { jobId: "job-9", active: true },
                orderBy: { createdAt: "desc" },
            }),
        );
    });
});
