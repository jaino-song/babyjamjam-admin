import { promises as fs } from "node:fs";
import path from "node:path";

import { WorkerError } from "domain/eformsign-backup/worker";
import {
    FS_TYPE_EXT4, FS_TYPE_XFS, NFS_SUPER_MAGIC, SUPPORTED_FS_TYPES, assertSupportedFilesystem, createRealFsProbe, hasRoom,
    isMountPoint,
} from "infrastructure/eformsign-backup/worker/fs-probe";

import { makeTestBase, probeFor } from "./helpers/destination-support";

describe("fs-probe", () => {
    let base: string;
    beforeAll(async () => { base = await makeTestBase(); });
    afterAll(async () => { await fs.rm(base, { recursive: true, force: true }); });

    describe("allowlist", () => {
        it("should allow exactly ext4 and xfs, with the documented magic numbers", () => {
            expect(FS_TYPE_EXT4).toBe(0xef53);
            expect(FS_TYPE_XFS).toBe(0x58465342);
            expect(NFS_SUPER_MAGIC).toBe(0x6969);
            expect([...SUPPORTED_FS_TYPES].sort()).toEqual([FS_TYPE_EXT4, FS_TYPE_XFS].sort());
        });
        it.each([["ext4", FS_TYPE_EXT4], ["xfs", FS_TYPE_XFS]])("should accept %s", async (_name, type) => {
            await expect(assertSupportedFilesystem(probeFor({ type }), "/x")).resolves.toBeUndefined();
        });
        it.each([["nfs", NFS_SUPER_MAGIC], ["btrfs", 0x9123683e], ["fuse", 0x65735546], ["cifs", 0xff534d42]])(
            "should reject %s as unsupported-filesystem", async (_name, type) => {
                await expect(assertSupportedFilesystem(probeFor({ type }), "/x")).rejects.toMatchObject({
                    reasonCode: "unsupported-filesystem",
                });
            });
        it("should report a statfs failure as the caller's unavailable code without leaking the path", async () => {
            const probe = { statfs: async () => { throw new Error("EIO /secret/path"); }, readProcLocks: async () => "" };
            const error = await assertSupportedFilesystem(probe, "/secret/path").catch((e: unknown) => e);
            expect(error).toBeInstanceOf(WorkerError);
            expect((error as WorkerError).reasonCode).toBe("archive-unavailable");
            expect(JSON.stringify(error)).not.toContain("secret");
            expect((error as Error).message).not.toContain("secret");
            await expect(assertSupportedFilesystem(probe, "/x", "control-unavailable")).rejects.toMatchObject({
                reasonCode: "control-unavailable",
            });
        });
    });

    describe("hasRoom", () => {
        const MIB = 1024 * 1024;
        it("should need bytes plus the byte reserve and more free inodes than the inode reserve", async () => {
            // 100 blocks of 4096 = 409600 bytes available.
            const probe = (over: object) => probeFor({ bavail: 100, bsize: 4096, ffree: 50, ...over });
            expect(await hasRoom(probe({}), "/x", 309_600, 100_000, 10)).toBe(true);
            expect(await hasRoom(probe({}), "/x", 309_601, 100_000, 10)).toBe(false);
            expect(await hasRoom(probe({ ffree: 11 }), "/x", 0, 0, 10)).toBe(true);
            expect(await hasRoom(probe({ ffree: 10 }), "/x", 0, 0, 10)).toBe(false);
            expect(await hasRoom(probe({ ffree: 5 }), "/x", 0, 0, 10)).toBe(false);
        });
        it("should not overflow for bigint block counts and huge filesystems", async () => {
            const probe = probeFor({ bavail: 2n ** 40n, bsize: 4096, ffree: 10 ** 9 });
            expect(await hasRoom(probe, "/x", 64 * MIB, MIB, 1000)).toBe(true);
        });
        it("should treat a statfs failure as unavailable", async () => {
            const probe = { statfs: async () => { throw new Error("boom"); }, readProcLocks: async () => "" };
            await expect(hasRoom(probe, "/x", 1, 1, 1)).rejects.toMatchObject({ reasonCode: "archive-unavailable" });
        });
    });

    describe("real probe", () => {
        it("should return a statfs shape for an existing directory", async () => {
            const info = await createRealFsProbe().statfs(base);
            expect(typeof info.type).toBe("number");
            expect(info.bsize).toBeGreaterThan(0);
            expect(Number(info.bavail)).toBeGreaterThanOrEqual(0);
            expect(info.ffree).toBeGreaterThanOrEqual(0);
        });
        it("should read /proc/locks as text", async () => {
            expect(typeof await createRealFsProbe().readProcLocks()).toBe("string");
        });
    });

    describe("isMountPoint", () => {
        it("should be false for a plain subdirectory and true for /proc and /", async () => {
            const dir = path.join(base, "plain");
            await fs.mkdir(dir);
            expect(await isMountPoint(dir)).toBe(false);
            expect(await isMountPoint("/proc")).toBe(true);
            expect(await isMountPoint("/")).toBe(true);
        });
        it("should reject a missing path", async () => {
            await expect(isMountPoint(path.join(base, "missing"))).rejects.toBeInstanceOf(WorkerError);
        });
    });
});
