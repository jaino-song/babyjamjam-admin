import { promises as fs } from "node:fs";
import path from "node:path";

import { WorkerError } from "domain/eformsign-backup/worker";
import type { FsProbe } from "infrastructure/eformsign-backup/worker/fs-probe";
import { assertLockHeld, decodeDevice, lockGuard, parseProcLocks, verifyLockHeld } from "infrastructure/eformsign-backup/worker/lock";

import { lockedProbe, makeBase } from "./helpers/runner-support";

/** Kernel dev_t -> `st_dev` as glibc/Node encode it (the inverse of the decoding under test). */
function encodeDev(major: number, minor: number): number {
    return Number((BigInt(minor) & 0xffn) | ((BigInt(major) & 0xfffn) << 8n) | ((BigInt(minor) & ~0xffn) << 12n) | ((BigInt(major) & ~0xfffn) << 32n));
}

const FIXTURE = [
    "1: OFDLCK ADVISORY  READ -1 103:02:1187568 1073741826 1073742335",
    "2: POSIX  ADVISORY  WRITE 1719 00:1d:2844 0 0",
    "3: FLOCK  ADVISORY  WRITE 425696 103:02:430199 0 EOF",
    "4: FLOCK  ADVISORY  READ 77 103:02:5 0 EOF",
    "5: -> FLOCK  ADVISORY  WRITE 88 103:02:430199 0 EOF",
    "6: FLOCK  ADVISORY  WRITE 2027110 0a:0b:356752 0 EOF",
    "garbage line",
    "",
].join("\n");

describe("parseProcLocks", () => {
    it("should return only FLOCK WRITE holders, reading major and minor as hex and the inode as decimal", () => {
        expect(parseProcLocks(FIXTURE)).toEqual([
            { pid: 425696, major: 0x103, minor: 0x02, inode: 430199 },
            { pid: 2027110, major: 0x0a, minor: 0x0b, inode: 356752 },
        ]);
    });

    it("should ignore POSIX, OFDLCK, READ locks, blocked waiters and malformed lines", () => {
        expect(parseProcLocks("1: POSIX  ADVISORY  WRITE 1 00:1d:2 0 0\n2: OFDLCK ADVISORY  WRITE -1 00:1d:2 0 0\n3: -> FLOCK ADVISORY WRITE 5 00:1d:2 0 EOF\nnonsense")).toEqual([]);
    });
});

describe("decodeDevice", () => {
    it("should decode a plain Linux st_dev (66306 is 259:2)", () => {
        expect(decodeDevice(66306)).toEqual({ major: 259, minor: 2 });
    });

    it.each([[8, 1], [0x103, 0x02], [0x1234, 0x123], [0xfff, 0xfffff], [0x2fff, 0x1ff]])(
        "should round-trip major=%i minor=%i through the new_encode_dev layout", (major, minor) => {
            expect(decodeDevice(encodeDev(major, minor))).toEqual({ major, minor });
        });

    it("should accept a bigint", () => {
        expect(decodeDevice(BigInt(encodeDev(0x1234, 0x123)))).toEqual({ major: 0x1234, minor: 0x123 });
    });
});

describe("assertLockHeld", () => {
    let base: string;
    let lock: string;
    beforeAll(async () => {
        base = await makeBase("bjj455-lock-");
        lock = path.join(base, "worker.lock");
        await fs.writeFile(lock, "", { mode: 0o600 });
    });
    afterAll(async () => { await fs.rm(base, { recursive: true, force: true }); });

    const probeWith = (text: string): FsProbe => ({
        statfs: async () => ({ type: 0xef53, bavail: 1, bsize: 1, ffree: 1 }),
        readProcLocks: async () => text,
    });
    async function lineFor(file: string, pid: number, kind = "FLOCK", mode = "WRITE"): Promise<string> {
        const stat = await fs.stat(file);
        const { major, minor } = decodeDevice(stat.dev);
        return `1: ${kind}  ADVISORY  ${mode} ${pid} ${major.toString(16).padStart(2, "0")}:${minor.toString(16).padStart(2, "0")}:${stat.ino} 0 EOF\n`;
    }
    const lockNotHeld = { reasonCode: "lock-not-held" };

    it("should resolve when /proc/locks shows this pid holding a FLOCK WRITE on the lock file", async () => {
        await expect(assertLockHeld(lock, probeWith(await lineFor(lock, 4242)), 4242)).resolves.toBeUndefined();
        await expect(assertLockHeld(lock, lockedProbe(lock))).resolves.toBeUndefined();
    });

    it.each([
        ["another pid", async () => lineFor(lock, 4243)],
        ["a POSIX lock", async () => lineFor(lock, 4242, "POSIX")],
        ["a READ lock", async () => lineFor(lock, 4242, "FLOCK", "READ")],
        ["no lock at all", async () => ""],
        ["another inode", async () => (await lineFor(lock, 4242)).replace(/:\d+ 0 EOF/, ":1 0 EOF")],
        ["another device", async () => (await lineFor(lock, 4242)).replace(/WRITE 4242 [0-9a-f]+:/, "WRITE 4242 7f:")],
    ])("should refuse with lock-not-held for %s", async (_name, build) => {
        await expect(assertLockHeld(lock, probeWith(await build()), 4242)).rejects.toMatchObject(lockNotHeld);
    });

    it("should refuse when the lock file is missing, a symlink or not a regular file", async () => {
        await expect(assertLockHeld(path.join(base, "absent.lock"), probeWith(""), 1)).rejects.toMatchObject(lockNotHeld);
        const link = path.join(base, "link.lock");
        await fs.symlink(lock, link);
        await expect(assertLockHeld(link, probeWith(await lineFor(lock, 4242)), 4242)).rejects.toMatchObject(lockNotHeld);
        await expect(assertLockHeld(base, probeWith(await lineFor(base, 4242)), 4242)).rejects.toMatchObject(lockNotHeld);
    });

    it("should refuse with lock-not-held when /proc/locks cannot be read, and never leak the cause", async () => {
        const broken: FsProbe = { statfs: probeWith("").statfs, readProcLocks: async () => { throw new Error(`EACCES ${lock}`); } };
        const error = await assertLockHeld(lock, broken, 1).catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(WorkerError);
        expect((error as WorkerError).message).toBe("lock-not-held");
    });
});

describe("lockGuard (the re-check before every ledger write)", () => {
    let base: string;
    beforeEach(async () => { base = await makeBase("bjj455-lockguard-"); });
    afterEach(async () => { await fs.rm(base, { recursive: true, force: true }); });

    const lockNotHeld = { reasonCode: "lock-not-held" };
    async function lineFor(file: string, pid: number): Promise<string> {
        const stat = await fs.stat(file);
        const { major, minor } = decodeDevice(stat.dev);
        return `1: FLOCK  ADVISORY  WRITE ${pid} ${major.toString(16).padStart(2, "0")}:${minor.toString(16).padStart(2, "0")}:${stat.ino} 0 EOF\n`;
    }
    const probeWith = (text: string): FsProbe => ({
        statfs: async () => ({ type: 0xef53, bavail: 1, bsize: 1, ffree: 1 }),
        readProcLocks: async () => text,
    });

    it("should resolve while the path is still the verified inode and /proc/locks still lists this pid on it", async () => {
        const lock = path.join(base, "worker.lock");
        await fs.writeFile(lock, "", { mode: 0o600 });
        const probe = probeWith(await lineFor(lock, 4242));
        const held = await verifyLockHeld(lock, probe, 4242);
        const stat = await fs.lstat(lock);
        expect(held).toEqual({ dev: stat.dev, ino: stat.ino });
        const guard = lockGuard(lock, probe, held, 4242);
        await expect(guard()).resolves.toBeUndefined();
        await expect(guard()).resolves.toBeUndefined();
    });

    it("should fail when the lock path was replaced by a new inode, even though /proc/locks still lists this pid on the old one", async () => {
        const lock = path.join(base, "worker.lock");
        await fs.writeFile(lock, "", { mode: 0o600 });
        const probe = probeWith(await lineFor(lock, 4242));
        const guard = lockGuard(lock, probe, await verifyLockHeld(lock, probe, 4242), 4242);
        // Keep the old inode alive under another name so the replacement cannot reuse its number.
        await fs.rename(lock, path.join(base, "worker.lock.old"));
        await fs.writeFile(lock, "", { mode: 0o600 });
        expect((await fs.stat(lock)).ino).not.toBe((await fs.stat(path.join(base, "worker.lock.old"))).ino);
        await expect(guard()).rejects.toMatchObject(lockNotHeld);
    });

    it("should fail when the lock file was deleted", async () => {
        const lock = path.join(base, "worker.lock");
        await fs.writeFile(lock, "", { mode: 0o600 });
        const probe = probeWith(await lineFor(lock, 4242));
        const guard = lockGuard(lock, probe, await verifyLockHeld(lock, probe, 4242), 4242);
        await fs.rm(lock);
        await expect(guard()).rejects.toMatchObject(lockNotHeld);
    });

    it("should fail when the path became a symlink to the verified inode", async () => {
        const lock = path.join(base, "worker.lock");
        await fs.writeFile(lock, "", { mode: 0o600 });
        const probe = probeWith(await lineFor(lock, 4242));
        const guard = lockGuard(lock, probe, await verifyLockHeld(lock, probe, 4242), 4242);
        await fs.rename(lock, path.join(base, "elsewhere.lock"));
        await fs.symlink(path.join(base, "elsewhere.lock"), lock);
        await expect(guard()).rejects.toMatchObject(lockNotHeld);
    });

    it("should fail when /proc/locks no longer lists this pid on the verified inode, and never leak the cause", async () => {
        const lock = path.join(base, "worker.lock");
        await fs.writeFile(lock, "", { mode: 0o600 });
        const held = await verifyLockHeld(lock, probeWith(await lineFor(lock, 4242)), 4242);
        await expect(lockGuard(lock, probeWith(await lineFor(lock, 4243)), held, 4242)()).rejects.toMatchObject(lockNotHeld);
        await expect(lockGuard(lock, probeWith(""), held, 4242)()).rejects.toMatchObject(lockNotHeld);
        const broken: FsProbe = { statfs: probeWith("").statfs, readProcLocks: async () => { throw new Error(`EACCES ${lock}`); } };
        const error = await lockGuard(lock, broken, held, 4242)().catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(WorkerError);
        expect((error as WorkerError).message).toBe("lock-not-held");
    });

    it("verifyLockHeld should refuse exactly where assertLockHeld refuses", async () => {
        const lock = path.join(base, "worker.lock");
        await fs.writeFile(lock, "", { mode: 0o600 });
        await expect(verifyLockHeld(lock, probeWith(""), 4242)).rejects.toMatchObject(lockNotHeld);
        await expect(verifyLockHeld(path.join(base, "absent.lock"), probeWith(""), 1)).rejects.toMatchObject(lockNotHeld);
    });
});
