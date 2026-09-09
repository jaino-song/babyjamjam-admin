import { Prisma } from "@prisma/client";
import { readFile, stat } from "node:fs/promises";

import { FileStorageObjectNotFoundError, type FileStoragePort } from "domain/ports/file-storage.port";

import {
    assertApprovedPdfSha256,
    assertNoExternalRateLimitStore,
    assertOwnedStoragePath,
    assertPhase0TargetConfig,
    assertReceiptLinkMetadataUnchanged,
    compareAndSwapReceiptLinkPointer,
    createPhase0CleanupManifest,
    createPhase0StoragePrefix,
    deleteAndVerifyOwnedStorageObjects,
    PHASE0_DEV_DATABASE_REF,
    PHASE0_POOLER_DATABASE_HOST,
    PHASE0_PRODUCTION_DATABASE_REF,
    ReceiptLinkRefreshCasConflictError,
    removePhase0CleanupManifest,
    sanitizePhase0Error,
    sha256Bytes,
    trackOwnedStoragePath,
    type ReceiptLinkRefreshRowSnapshot,
} from "./receipt-link-refresh.live.helper";

function snapshot(overrides: Partial<ReceiptLinkRefreshRowSnapshot> = {}): ReceiptLinkRefreshRowSnapshot {
    return {
        id: "fixture-token",
        branchId: "fixture-branch",
        clientId: 10,
        eformsignDocId: 20,
        jobId: null,
        linkTokenHash: "link-hash",
        accessTokenHash: "access-hash",
        expectedBirthdayHash: "birthday-hash",
        verifiedAt: new Date("2026-09-08T00:00:00.000Z"),
        failedAttempts: 0,
        lockedAt: null,
        expiresAt: new Date("2026-10-08T00:00:00.000Z"),
        active: true,
        revokedAt: null,
        storagePath: "phase0-receipt-refresh/00000000-0000-4000-8000-000000000000/before.png",
        contentSha256: "a".repeat(64),
        byteSize: 12,
        source: "manual",
        createdBy: null,
        createdAt: new Date("2026-09-08T00:00:00.000Z"),
        ...overrides,
    };
}

describe("receipt-link-refresh live helper guards", () => {
    it("allows only the configured dev database and storage project", () => {
        expect(() => assertPhase0TargetConfig({
            databaseUrl: `postgresql://postgres.${PHASE0_DEV_DATABASE_REF}:password@${PHASE0_POOLER_DATABASE_HOST}:6543/postgres`,
            directUrl: `postgresql://postgres.${PHASE0_DEV_DATABASE_REF}:password@${PHASE0_POOLER_DATABASE_HOST}:5432/postgres`,
            storageUrl: `https://${PHASE0_DEV_DATABASE_REF}.supabase.co`,
        })).not.toThrow();

        expect(() => assertPhase0TargetConfig({
            databaseUrl: `postgresql://postgres.${PHASE0_PRODUCTION_DATABASE_REF}:password@${PHASE0_POOLER_DATABASE_HOST}:5432/postgres`,
            storageUrl: `https://${PHASE0_DEV_DATABASE_REF}.supabase.co`,
        })).toThrow(/production project/);
        expect(() => assertPhase0TargetConfig({
            databaseUrl: `postgresql://postgres.${PHASE0_DEV_DATABASE_REF}:password@other-project.example:5432/postgres`,
            storageUrl: `https://${PHASE0_DEV_DATABASE_REF}.supabase.co`,
        })).toThrow(/outside the approved dev project/);
        expect(() => assertPhase0TargetConfig({
            databaseUrl: `postgresql://postgres.${PHASE0_DEV_DATABASE_REF}:password@${PHASE0_POOLER_DATABASE_HOST}:5432/postgres`,
            storageUrl: "https://other-project.supabase.co",
        })).toThrow(/outside the approved storage endpoint/);
        expect(() => assertPhase0TargetConfig({
            connectionMode: "direct",
            databaseUrl: `postgresql://postgres.${PHASE0_DEV_DATABASE_REF}:password@${PHASE0_POOLER_DATABASE_HOST}:5432/postgres`,
            storageUrl: `https://${PHASE0_DEV_DATABASE_REF}.supabase.co`,
        })).toThrow(/selected database URL/);
        expect(() => assertPhase0TargetConfig({
            databaseUrl: `postgresql://wrong-user:password@${PHASE0_POOLER_DATABASE_HOST}:5432/postgres`,
            storageUrl: `https://${PHASE0_DEV_DATABASE_REF}.supabase.co`,
        })).toThrow(/approved dev project/);
    });

    it("refuses an external rate-limit store", () => {
        expect(() => assertNoExternalRateLimitStore(undefined)).not.toThrow();
        expect(() => assertNoExternalRateLimitStore("  ")).not.toThrow();
        expect(() => assertNoExternalRateLimitStore("redis://valkey.example")).toThrow(/external/);
    });

    it("checks approved PDF hashes without exposing the PDF body", () => {
        const body = Buffer.from("phase0-pdf-fixture");
        const hash = sha256Bytes(body);
        expect(assertApprovedPdfSha256(body, hash, "baseline")).toBe(hash);
        expect(() => assertApprovedPdfSha256(body, "0".repeat(64), "revised")).toThrow(/approved fixture/);
    });

    it("creates fresh UUID prefixes and rejects paths outside the run allowlist", () => {
        const prefix = createPhase0StoragePrefix("00000000-0000-4000-8000-000000000000");
        expect(prefix).toBe("phase0-receipt-refresh/00000000-0000-4000-8000-000000000000");
        expect(() => assertOwnedStoragePath(`${prefix}/before.png`, prefix)).not.toThrow();
        expect(() => assertOwnedStoragePath(`${prefix}/after.png`, prefix)).not.toThrow();
        expect(() => assertOwnedStoragePath(`${prefix}/other.png`, prefix)).toThrow(/outside/);
        expect(() => assertOwnedStoragePath("phase0-receipt-refresh/other-run/before.png", prefix)).toThrow(/outside/);
        expect(() => assertOwnedStoragePath(
            "phase0-receipt-refresh/other-run/before.png",
            "phase0-receipt-refresh/other-run",
        )).toThrow(/outside/);
        expect(() => createPhase0StoragePrefix("not-a-uuid")).toThrow(/run id/);

        const tracked: string[] = [];
        trackOwnedStoragePath(tracked, `${prefix}/before.png`, prefix);
        trackOwnedStoragePath(tracked, `${prefix}/before.png`, prefix);
        expect(tracked).toEqual([`${prefix}/before.png`]);
    });

    it("persists a 0700/0600 owned cleanup manifest without credentials or image bytes", async () => {
        const runId = "00000000-0000-4000-8000-000000000000";
        const prefix = createPhase0StoragePrefix(runId);
        const ownedStoragePaths = [`${prefix}/before.png`, `${prefix}/after.png`];
        const manifest = await createPhase0CleanupManifest(runId, prefix, ownedStoragePaths);
        try {
            expect((await stat(manifest.directory)).mode & 0o777).toBe(0o700);
            expect((await stat(manifest.filePath)).mode & 0o777).toBe(0o600);
            const contents = JSON.parse(await readFile(manifest.filePath, "utf8")) as Record<string, unknown>;
            expect(contents).toEqual({ runId, prefix, ownedStoragePaths });
            expect(contents).not.toHaveProperty("accessToken");
            expect(contents).not.toHaveProperty("contentSha256");
        } finally {
            await removePhase0CleanupManifest(manifest);
        }
        await expect(stat(manifest.filePath)).rejects.toMatchObject({ code: "ENOENT" });
    });

    it("updates exactly the three pointer fields only when every ownership/hash guard matches", async () => {
        const updateMany = jest.fn().mockResolvedValue({ count: 1 });
        const client = {
            receipt_link_token: { updateMany },
        } as unknown as Pick<Prisma.TransactionClient, "receipt_link_token">;
        await compareAndSwapReceiptLinkPointer(client, {
            id: "token-id",
            branchId: "branch-id",
            eformsignDocId: 12,
            expectedStoragePath: "phase0-receipt-refresh/run/before.png",
            expectedContentSha256: "a".repeat(64),
            expectedByteSize: 10,
            nextStoragePath: "phase0-receipt-refresh/run/after.png",
            nextContentSha256: "b".repeat(64),
            nextByteSize: 20,
        });

        expect(updateMany).toHaveBeenCalledTimes(1);
        expect(updateMany.mock.calls[0]?.[0]).toEqual({
            where: {
                id: "token-id",
                branchId: "branch-id",
                eformsignDocId: 12,
                storagePath: "phase0-receipt-refresh/run/before.png",
                contentSha256: "a".repeat(64),
                byteSize: 10,
            },
            data: {
                storagePath: "phase0-receipt-refresh/run/after.png",
                contentSha256: "b".repeat(64),
                byteSize: 20,
            },
        });
    });

    it("returns a typed conflict and performs no write when the CAS precondition is stale", async () => {
        const updateMany = jest.fn().mockResolvedValue({ count: 0 });
        const client = {
            receipt_link_token: { updateMany },
        } as unknown as Pick<Prisma.TransactionClient, "receipt_link_token">;
        await expect(compareAndSwapReceiptLinkPointer(client, {
            id: "token-id",
            branchId: "branch-id",
            eformsignDocId: 12,
            expectedStoragePath: "phase0-receipt-refresh/run/before.png",
            expectedContentSha256: "0".repeat(64),
            expectedByteSize: 10,
            nextStoragePath: "phase0-receipt-refresh/run/after.png",
            nextContentSha256: "b".repeat(64),
            nextByteSize: 20,
        })).rejects.toBeInstanceOf(ReceiptLinkRefreshCasConflictError);
        expect(updateMany).toHaveBeenCalledTimes(1);
    });

    it("detects any metadata change while allowing the three pointer fields to change", () => {
        const before = snapshot();
        const pointerChanged = snapshot({
            storagePath: "phase0-receipt-refresh/00000000-0000-4000-8000-000000000000/after.png",
            contentSha256: "b".repeat(64),
            byteSize: 20,
        });
        expect(() => assertReceiptLinkMetadataUnchanged(before, pointerChanged)).not.toThrow();
        expect(() => assertReceiptLinkMetadataUnchanged(before, snapshot({ active: false }))).toThrow(/metadata changed/);
    });

    it("attempts cleanup for every owned path even when one delete reports an uncertain failure", async () => {
        const prefix = createPhase0StoragePrefix("00000000-0000-4000-8000-000000000000");
        const firstPath = `${prefix}/before.png`;
        const secondPath = `${prefix}/after.png`;
        const deleteCalls: string[] = [];
        const downloadCalls: string[] = [];
        const storage = {
            delete: jest.fn(async (path: string) => {
                deleteCalls.push(path);
                if (path === firstPath) throw new Error("uncertain");
            }),
            download: jest.fn(async (path: string) => {
                downloadCalls.push(path);
                throw new FileStorageObjectNotFoundError(path, "download");
            }),
        } as unknown as FileStoragePort;

        await expect(deleteAndVerifyOwnedStorageObjects(storage, prefix, [firstPath, secondPath]))
            .rejects.toThrow(/cleanup or absence/);
        expect(deleteCalls).toEqual([firstPath, secondPath]);
        expect(downloadCalls).toEqual([firstPath, secondPath]);
    });

    it("uses provider metadata as the absence authority when a cached download would still succeed", async () => {
        const prefix = createPhase0StoragePrefix("00000000-0000-4000-8000-000000000000");
        const paths = [`${prefix}/before.png`, `${prefix}/after.png`];
        const storage = {
            delete: jest.fn().mockResolvedValue(undefined),
            download: jest.fn().mockResolvedValue(Buffer.from("cached")),
        } as unknown as FileStoragePort;

        await deleteAndVerifyOwnedStorageObjects(storage, prefix, paths, async () => []);

        expect(storage.delete).toHaveBeenCalledTimes(paths.length);
        expect(storage.download).not.toHaveBeenCalled();
    });

    it("fails closed after attempting every delete when metadata absence cannot be verified", async () => {
        const prefix = createPhase0StoragePrefix("00000000-0000-4000-8000-000000000000");
        const paths = [`${prefix}/before.png`, `${prefix}/after.png`];
        const storage = {
            delete: jest.fn().mockResolvedValue(undefined),
            download: jest.fn(),
        } as unknown as FileStoragePort;

        await expect(deleteAndVerifyOwnedStorageObjects(
            storage,
            prefix,
            paths,
            async () => {
                throw new Error("metadata unavailable");
            },
        )).rejects.toThrow(/cleanup or absence/);
        expect(storage.delete).toHaveBeenCalledTimes(paths.length);
        expect(storage.download).not.toHaveBeenCalled();
    });

    it("sanitizes unexpected errors so credentials never enter a proof failure", () => {
        const secret = "efr_sensitive_link_token";
        expect(sanitizePhase0Error(new Error(secret))).toBe("phase0 receipt-link refresh proof failed");
        expect(sanitizePhase0Error(new ReceiptLinkRefreshCasConflictError())).not.toContain(secret);
    });
});
