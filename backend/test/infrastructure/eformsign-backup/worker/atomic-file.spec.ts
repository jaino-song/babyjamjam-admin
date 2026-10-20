import { promises as fs } from "node:fs";
import path from "node:path";

import { WorkerError } from "domain/eformsign-backup/worker";
import { publishBytesNoClobber } from "infrastructure/eformsign-backup/worker/atomic-file";

import { makeTestBase, restoreDirectoryModes, snapshotTree } from "./helpers/destination-support";

describe("atomic-file publishBytesNoClobber", () => {
    let base: string;
    let dir: string;
    beforeEach(async () => {
        base = await makeTestBase();
        dir = path.join(base, "dir");
        await fs.mkdir(dir, { mode: 0o700 });
    });
    afterEach(async () => {
        await restoreDirectoryModes(dir);
        await fs.rm(base, { recursive: true, force: true });
    });
    const bytes = Buffer.from('{"synthetic":true}\n');

    it("should create the file with the bytes, mode 0600, and no leftover temp", async () => {
        expect(await publishBytesNoClobber(dir, "a.json", bytes)).toEqual({ disposition: "created" });
        expect(await fs.readFile(path.join(dir, "a.json"))).toEqual(bytes);
        expect((await fs.stat(path.join(dir, "a.json"))).mode & 0o777).toBe(0o600);
        expect(await fs.readdir(dir)).toEqual(["a.json"]);
    });

    it("should reuse an existing file with the same bytes", async () => {
        await publishBytesNoClobber(dir, "a.json", bytes);
        expect(await publishBytesNoClobber(dir, "a.json", bytes)).toEqual({ disposition: "reused" });
        expect(await fs.readdir(dir)).toEqual(["a.json"]);
    });

    it("should refuse different bytes with archive-conflict and leave the original untouched", async () => {
        await publishBytesNoClobber(dir, "a.json", bytes);
        const error = await publishBytesNoClobber(dir, "a.json", Buffer.from("different")).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(WorkerError);
        expect((error as WorkerError).reasonCode).toBe("archive-conflict");
        expect(await fs.readFile(path.join(dir, "a.json"))).toEqual(bytes);
        expect(await fs.readdir(dir)).toEqual(["a.json"]);
    });

    it("should refuse a same-length file with different bytes as a conflict", async () => {
        await publishBytesNoClobber(dir, "a.json", Buffer.from("aaaa"));
        await expect(publishBytesNoClobber(dir, "a.json", Buffer.from("bbbb"))).rejects.toMatchObject({ reasonCode: "archive-conflict" });
    });

    it.each(["", ".", "..", "a/b", "../x", "a\u0000b", "x".repeat(256)])("should reject the name %j", async name => {
        await expect(publishBytesNoClobber(dir, name, bytes)).rejects.toMatchObject({ reasonCode: "invalid-path-segment" });
        expect(await fs.readdir(dir)).toEqual([]);
    });

    it("should refuse a symlink at the final name and not touch its target", async () => {
        await fs.writeFile(path.join(base, "target"), bytes);
        await fs.symlink(path.join(base, "target"), path.join(dir, "a.json"));
        await expect(publishBytesNoClobber(dir, "a.json", bytes)).rejects.toMatchObject({ reasonCode: "archive-unsafe-path" });
        expect(await fs.readFile(path.join(base, "target"))).toEqual(bytes);
        expect(await fs.readdir(dir)).toEqual(["a.json"]);
    });

    it("should refuse a directory path that is a symlink", async () => {
        await fs.mkdir(path.join(base, "real"));
        await fs.symlink(path.join(base, "real"), path.join(base, "link"));
        await expect(publishBytesNoClobber(path.join(base, "link"), "a.json", bytes)).rejects.toBeInstanceOf(WorkerError);
        expect(await fs.readdir(path.join(base, "real"))).toEqual([]);
    });

    it.each(["write", "file-sync", "publish"] as const)("should publish nothing and leave no temp when %s fails", async point => {
        const before = await snapshotTree(base);
        const error = await publishBytesNoClobber(dir, "a.json", bytes, {
            fault: stage => { if (stage === point) throw new Error("private injected error"); },
        }).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(WorkerError);
        expect((error as WorkerError).reasonCode).toBe("archive-unavailable");
        expect((error as Error).message).not.toContain("private");
        expect(await snapshotTree(base)).toEqual(before);
    });

    it("should keep a published file and drop the temp when cleanup or the directory sync fails", async () => {
        for (const point of ["cleanup", "directory-sync"] as const) {
            const name = `${point}.json`;
            await expect(publishBytesNoClobber(dir, name, bytes, {
                fault: stage => { if (stage === point) throw new Error("injected"); },
            })).rejects.toBeInstanceOf(WorkerError);
            expect(await fs.readFile(path.join(dir, name))).toEqual(bytes);
        }
        expect((await fs.readdir(dir)).filter(entry => entry.endsWith(".tmp"))).toEqual([]);
    });

    it("should report a caller-chosen reason code for I/O failures", async () => {
        await expect(publishBytesNoClobber(dir, "a.json", bytes, {
            ioReasonCode: "control-unavailable", fault: () => { throw new Error("x"); },
        })).rejects.toMatchObject({ reasonCode: "control-unavailable" });
    });

    it("should report a missing directory as unavailable", async () => {
        await expect(publishBytesNoClobber(path.join(base, "missing"), "a.json", bytes)).rejects.toMatchObject({
            reasonCode: "archive-unavailable",
        });
    });
});
