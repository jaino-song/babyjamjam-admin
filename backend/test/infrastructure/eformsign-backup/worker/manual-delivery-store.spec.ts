import nodeFs, { linkSync, readdirSync, renameSync, symlinkSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { EXPORT_POLICY_REVISION } from "domain/eformsign-backup/export/constants";
import { MANUAL_BACKUP_LEASE_DURATION_MS, MANUAL_BACKUP_SCOPE_REVISION, manualBackupSnapshotId } from "domain/eformsign-backup/manual-backup-constants";
import { canonicalJson } from "domain/eformsign-backup/source-evidence";
import { WorkerError } from "domain/eformsign-backup/worker/worker-error";
import { ManualDeliveryStore, type ManualDeliveryBinding, type ManualDeliveryStoreOptions } from "infrastructure/eformsign-backup/worker/manual-delivery-store";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const h = (c: string) => c.repeat(64);
const at = "2026-11-06T01:00:00.000Z";
function binding(job = 1, attempt = 1): ManualDeliveryBinding {
    const executionScope = { kind: "manual" as const, jobId: id(job), attemptId: `${id(job)}.attempt-${attempt}`, companyId: "company-1", branchId: id(2), selectionDigest: h("a") };
    return { version: 1, executionScope, snapshot: { snapshotId: manualBackupSnapshotId(executionScope), status: "ready", companyId: executionScope.companyId,
        scopeRevision: MANUAL_BACKUP_SCOPE_REVISION, policyRevision: EXPORT_POLICY_REVISION, createdAt: at, readyAt: at, expiresAt: null,
        counts: { total: 1, inaccessible: 0, unknownTemplate: 0, policyPending: 0, excludedByPolicy: 1, included: 0 },
        coverage: { status: "unverified", reasonCode: "collection-receipt-unavailable" }, backupComplete: false },
    leaseToken: id(3), leaseDurationMs: MANUAL_BACKUP_LEASE_DURATION_MS, leaseExpiresAtUTC: at,
    installationId: "installation-1", credentialFingerprint: h("f"), createdAtUTC: at };
}
const describeLinux = process.platform === "linux" ? describe : describe.skip;
let root: string;
let serial = 0;
beforeAll(async () => { root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "manual-delivery-C3A-"))); await fs.chmod(root, 0o700); });
afterAll(async () => { await fs.rm(root, { recursive: true, force: true }); });
afterEach(() => jest.restoreAllMocks());
async function control(): Promise<string> { const dir = path.join(root, `control-${++serial}`); await fs.mkdir(dir, { mode: 0o700 }); return dir; }
function store(controlPath: string, patch: Partial<ManualDeliveryStoreOptions> = {}) {
    return new ManualDeliveryStore({ controlPath, companyId: "company-1", installationId: "installation-1", credentialFingerprint: h("f"), beforeWrite: async () => undefined, ...patch });
}
function name(controlPath: string, b = binding()): string { return path.join(controlPath, "manual-delivery", b.executionScope.jobId, `${b.executionScope.attemptId}.json`); }
async function seed(controlPath: string, b = binding()) { await fs.mkdir(path.dirname(name(controlPath, b)), { recursive: true, mode: 0o700 }); await fs.writeFile(name(controlPath, b), canonicalJson(b), { mode: 0o600 }); }
async function tree(dir: string): Promise<unknown> {
    const entries = await fs.readdir(dir); const result: Record<string, unknown> = {};
    for (const entry of entries.sort()) {
        const p = path.join(dir, entry); const stat = await fs.lstat(p);
        result[entry] = stat.isDirectory() ? { mode: stat.mode & 0o7777, children: await tree(p) }
            : { mode: stat.mode & 0o7777, ino: stat.ino, bytes: stat.isFile() ? (await fs.readFile(p)).toString("hex") : "nonregular" };
    }
    return result;
}

describe("ManualDeliveryStore platform boundary", () => {
    (process.platform === "linux" ? it.skip : it)("fails closed before any I/O or guard on unsupported platforms, with a pure constructor", async () => {
        const beforeWrite = jest.fn(async () => undefined);
        const open = jest.spyOn(fs, "open"); const lstat = jest.spyOn(fs, "lstat"); const mkdir = jest.spyOn(fs, "mkdir");
        const s = store(path.join(root, "not-created"), { beforeWrite });
        await expect(s.put(binding())).rejects.toMatchObject({ reasonCode: "unsupported-filesystem" });
        await expect(s.list()).rejects.toMatchObject({ reasonCode: "unsupported-filesystem" });
        await expect(s.remove(binding())).rejects.toMatchObject({ reasonCode: "unsupported-filesystem" });
        expect(open).not.toHaveBeenCalled(); expect(lstat).not.toHaveBeenCalled(); expect(mkdir).not.toHaveBeenCalled();
        expect(beforeWrite).not.toHaveBeenCalled();
    });
});

describeLinux("ManualDeliveryStore durable positive paths", () => {
    it("lists a missing namespace without mkdir, guards or writes", async () => {
        const dir = await control(); const beforeWrite = jest.fn(async () => undefined); const s = store(dir, { beforeWrite });
        expect(await s.list()).toEqual([]); expect(await fs.readdir(dir)).toEqual([]); expect(beforeWrite).not.toHaveBeenCalled();
        await s.remove(binding()); expect(await fs.readdir(dir)).toEqual([]); expect(beforeWrite).not.toHaveBeenCalled();
    });
    it("puts private canonical bytes, reopens, reuses exact duplicates and removes only the full binding", async () => {
        const dir = await control(); const b = binding(); const beforeWrite = jest.fn(async () => undefined);
        const points: string[] = []; const s = store(dir, { beforeWrite, fault: point => { points.push(point); } });
        await s.put(b);
        expect(points).toEqual(["write", "file-sync", "publish", "cleanup", "directory-sync"]);
        expect(beforeWrite).toHaveBeenCalledTimes(14); // All directly owned mutations and the atomic publication get fresh pre/post proofs.
        const file = name(dir); const stat = await fs.lstat(file);
        expect(stat.mode & 0o7777).toBe(0o600); expect(stat.uid).toBe(process.getuid!());
        for (const p of [dir, path.join(dir, "manual-delivery"), path.dirname(file)]) expect((await fs.lstat(p)).mode & 0o7777).toBe(0o700);
        const bytes = await fs.readFile(file, "utf8"); expect(bytes).toBe(canonicalJson(b));
        expect(bytes).not.toContain("ebx_"); expect(Object.keys(JSON.parse(bytes)).sort()).toEqual(Object.keys(b).sort());
        await s.put(JSON.parse(JSON.stringify(b))); expect((await fs.lstat(file)).ino).toBe(stat.ino);
        expect(await store(dir).list()).toEqual([b]); const listed = await s.list(); listed[0]!.leaseToken = id(90);
        expect(await s.list()).toEqual([b]);
        await expect(s.remove({ ...b, leaseToken: id(4) })).rejects.toThrow("control-unavailable"); expect(await fs.readFile(file, "utf8")).toBe(bytes);
        await s.remove(b); await s.remove(b); expect(await s.list()).toEqual([]);
        expect((await fs.lstat(path.dirname(file))).isDirectory()).toBe(true);
    });
    it("allows the operating-system temporary ancestor alias while pinning the owned root", async () => {
        const dir = await control(); const alias = path.join(os.tmpdir(), path.basename(root), path.basename(dir));
        expect(await fs.realpath(alias)).toBe(dir);
        const s = store(alias); await s.put(binding()); expect(await s.list()).toEqual([binding()]);
    });
    it("returns all 105 records in code-unit job/attempt order without a page cap", async () => {
        const dir = await control(); const records = Array.from({ length: 105 }, (_, n) => binding(1 + Math.floor(n / 21), n % 21 + 1));
        for (const b of records.reverse()) await seed(dir, b);
        const actual = await store(dir).list(); expect(actual).toHaveLength(105);
        expect(actual.map(b => name(dir, b))).toEqual(records.map(b => name(dir, b)).sort());
    });
    it("normalizes input and options before awaiting a lock callback so mutation cannot redirect the file", async () => {
        const dir = await control(); const original = binding(); const input = JSON.parse(JSON.stringify(original));
        let release!: () => void; let started!: () => void;
        const entered = new Promise<void>(resolve => { started = resolve; }); const pending = new Promise<void>(resolve => { release = resolve; });
        let first = true;
        const options: ManualDeliveryStoreOptions = { controlPath: dir, companyId: "company-1", installationId: "installation-1", credentialFingerprint: h("f"), beforeWrite: async () => { if (first) { first = false; started(); await pending; } } };
        const s = new ManualDeliveryStore(options); const operation = s.put(input); await entered;
        input.executionScope.jobId = id(99); input.executionScope.attemptId = "../../escape"; input.leaseToken = id(99); input.snapshot.counts.total = 999;
        options.controlPath = root; options.beforeWrite = async () => { throw new Error("mutated"); };
        release(); await operation; expect(await s.list()).toEqual([original]); expect(await fs.readFile(name(dir), "utf8")).toBe(canonicalJson(original));
    });
});

describeLinux("ManualDeliveryStore exact lock boundaries", () => {
    it("rejects a first proof failure with zero owned mutations", async () => {
        const dir = await control(); const beforeWrite = jest.fn(async () => { throw new Error("private-lock-proof"); });
        await expect(store(dir, { beforeWrite }).put(binding())).rejects.toThrow("control-unavailable");
        expect(await fs.readdir(dir)).toEqual([]); expect(beforeWrite).toHaveBeenCalledTimes(1);
    });
    it("refuses before helper invocation without file effects when the publication proof fails", async () => {
        const dir = await control(); await seed(dir, binding(2)); // Target's directory exists; no mkdir is needed.
        await fs.mkdir(path.dirname(name(dir)), { mode: 0o700 });
        const initial = await tree(dir); const fault = jest.fn();
        await expect(store(dir, { beforeWrite: async () => { throw new Error("lost"); }, fault }).put(binding())).rejects.toThrow("control-unavailable");
        expect(fault).not.toHaveBeenCalled(); expect(await tree(dir)).toEqual(initial);
    });
    it.each(["write", "file-sync", "publish", "cleanup", "directory-sync"] as const)("refuses on mid-helper lock loss at %s while retaining private evidence", async point => {
        const dir = await control(); let held = true; let calls = 0;
        const s = store(dir, { beforeWrite: async () => { calls++; if (!held) throw new Error("lost"); }, fault: p => { if (p === point) held = false; } });
        await expect(s.put(binding())).rejects.toThrow("control-unavailable");
        expect(calls).toBe(14); // The synchronous fault is not an async guard; helper may complete.
        expect(await store(dir).list()).toEqual([binding()]); expect((await fs.lstat(name(dir))).mode & 0o7777).toBe(0o600);
        expect(await fs.readdir(path.dirname(name(dir)))).toEqual([path.basename(name(dir))]);
        const bytes = await fs.readFile(name(dir)); await expect(s.remove(binding())).rejects.toThrow("control-unavailable"); expect(await fs.readFile(name(dir))).toEqual(bytes);
    });
    it("requires a post-helper proof before reporting success and a fresh proof for the next transition", async () => {
        const dir = await control(); let calls = 0;
        const s = store(dir, { beforeWrite: async () => { if (++calls === 14) throw new Error("post-publication-loss"); } });
        await expect(s.put(binding())).rejects.toThrow("control-unavailable"); expect(await store(dir).list()).toEqual([binding()]);
        let held = true; const guard = jest.fn(async () => { if (!held) throw new Error("lost-again"); }); const s2 = store(dir, { beforeWrite: guard });
        await s2.put(binding()); const before = await tree(dir); held = false;
        await expect(s2.remove(binding())).rejects.toThrow("control-unavailable"); expect(await tree(dir)).toEqual(before);
        expect(guard).toHaveBeenCalledTimes(7);
    });
    it("guards every directly owned mkdir and fsync independently", async () => {
        for (const refusal of [2, 3, 4, 5, 6, 7, 8]) {
            const dir = await control(); let count = 0;
            await expect(store(dir, { beforeWrite: async () => { if (++count === refusal) throw new Error("lost"); } }).put(binding())).rejects.toThrow("control-unavailable");
            expect(count).toBe(refusal); expect(await fs.readdir(dir)).toEqual(["manual-delivery"]);
            expect(await fs.stat(name(dir)).catch(() => null)).toBeNull();
        }
    });
    it.each(["mkdir", "unlink", "fsync"] as const)("refuses success if a lock is lost during the directly owned %s", async mutation => {
        const dir = await control(); if (mutation !== "mkdir") await seed(dir);
        let held = true;
        if (mutation === "mkdir") {
            const original = fs.mkdir.bind(fs);
            jest.spyOn(fs, "mkdir").mockImplementation((async (...args: any[]) => {
                const result = await (original as any)(...args); held = false; return result;
            }) as typeof fs.mkdir);
        } else if (mutation === "unlink") {
            const nodeFsUnlink = nodeFs.unlinkSync.bind(nodeFs);
            jest.spyOn(nodeFs, "unlinkSync").mockImplementation(file => { nodeFsUnlink(file); held = false; });
        } else {
            const original = fs.open.bind(fs);
            jest.spyOn(fs, "open").mockImplementation(async (...args) => {
                const handle = await original(...args);
                if (await fs.realpath(String(args[0])) === path.dirname(name(dir))) {
                    const sync = handle.sync.bind(handle);
                    jest.spyOn(handle, "sync").mockImplementation(async () => { await sync(); held = false; });
                }
                return handle;
            });
        }
        const s = store(dir, { beforeWrite: async () => { if (!held) throw new Error("lock lost inside mutation"); } });
        await expect(mutation === "mkdir" ? s.put(binding()) : s.remove(binding())).rejects.toThrow("control-unavailable");
        expect(held).toBe(false); expect(await fs.lstat(name(dir)).catch(() => null)).toBeNull();
        expect((await fs.lstat(path.join(dir, "manual-delivery"))).mode & 0o7777).toBe(0o700);
    });
    it("does not unlink after a lost fresh proof, and preserves removal evidence when the parent fsync proof fails", async () => {
        for (const refusal of [1, 2, 3, 4, 5]) {
            const dir = await control(); await seed(dir); let count = 0;
            const s = store(dir, { beforeWrite: async () => { if (++count === refusal) throw new Error("lost"); } });
            await expect(s.remove(binding())).rejects.toThrow("control-unavailable"); expect(count).toBe(refusal);
            expect(await fs.stat(name(dir)).catch(() => null)).toEqual(refusal < 3 ? expect.anything() : null);
            expect((await fs.stat(path.dirname(name(dir)))).isDirectory()).toBe(true);
        }
    });
});

describeLinux("ManualDeliveryStore unsafe namespace refusal", () => {
    it.each([
        (b: any) => { b.extra = "secret"; }, (b: any) => { b.leaseToken = "bad"; }, (b: any) => { b.version = 2; },
        (b: any) => { b.leaseDurationMs = 1; }, (b: any) => { b.createdAtUTC = "bad"; }, (b: any) => { b.leaseExpiresAtUTC = "bad"; },
        (b: any) => { b.installationId = "other"; }, (b: any) => { b.credentialFingerprint = h("e"); },
        (b: any) => { b.executionScope.companyId = b.snapshot.companyId = "other"; },
        (b: any) => { b.executionScope.attemptId = "../../escape"; }, (b: any) => { b.executionScope.jobId = "../escape"; },
        (b: any) => { b.snapshot.snapshotId = "wrong"; }, (b: any) => { b.snapshot.counts.total = 2; }, (b: any) => { b.snapshot.counts.total = Number.MAX_SAFE_INTEGER + 1; },
        (b: any) => { b.snapshot.scopeRevision = "old"; }, (b: any) => { b.snapshot.policyRevision = "old"; }, (b: any) => { b.snapshot.backupComplete = true; },
        (b: any) => { b.snapshot.coverage.extra = true; }, (b: any) => { b.snapshot.expiresAt = at; }, (b: any) => { b.snapshot.readyAt = null; },
        (b: any) => { Object.defineProperty(b, "secret", { enumerable: true, get() { throw new Error("private-value"); } }); },
    ])("rejects invalid binding %# before any proof or mutation", async mutate => {
        const dir = await control(); const b = binding(); mutate(b); const beforeWrite = jest.fn(async () => undefined); const s = store(dir, { beforeWrite });
        await expect(s.put(b)).rejects.toThrow("control-unavailable"); await expect(s.remove(b)).rejects.toThrow("control-unavailable");
        expect(await fs.readdir(dir)).toEqual([]); expect(beforeWrite).not.toHaveBeenCalled();
    });
    it("never overwrites a conflicting capability and sanitizes failure details", async () => {
        const dir = await control(); const s = store(dir); await s.put(binding()); const before = await tree(dir);
        const error = await s.put({ ...binding(), leaseToken: id(4) }).catch(e => e);
        expect(error.reasonCode).toBe("control-unavailable"); expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain(dir);
        expect(JSON.stringify(error)).not.toContain(id(4)); expect(await tree(dir)).toEqual(before);
    });
    it.each(["root-mode", "root-symlink", "namespace-mode", "namespace-symlink", "job-mode", "job-symlink", "file-mode", "file-symlink", "file-directory", "oversize", "unknown-root", "unknown-job", "noncanonical"])("fails closed and retains evidence for %s", async kind => {
        const dir = await control(); await seed(dir); const file = name(dir); let target = dir;
        if (kind === "root-mode") await fs.chmod(dir, 0o755);
        if (kind === "root-symlink") { target = `${dir}-link`; await fs.symlink(dir, target); }
        if (kind === "namespace-mode") await fs.chmod(path.join(dir, "manual-delivery"), 0o755);
        if (kind === "namespace-symlink") { const p = path.join(dir, "manual-delivery"); await fs.rename(p, `${p}-original`); await fs.symlink(`${p}-original`, p); }
        if (kind === "job-mode") await fs.chmod(path.dirname(file), 0o755);
        if (kind === "job-symlink") { await fs.rename(path.dirname(file), `${path.dirname(file)}-original`); await fs.symlink(`${path.dirname(file)}-original`, path.dirname(file)); }
        if (kind === "file-mode") await fs.chmod(file, 0o644);
        if (kind === "file-symlink") { await fs.rename(file, `${file}-original`); await fs.symlink(`${file}-original`, file); }
        if (kind === "file-directory") { await fs.unlink(file); await fs.mkdir(file, { mode: 0o700 }); }
        if (kind === "oversize") await fs.writeFile(file, Buffer.alloc(65537));
        if (kind === "unknown-root") await fs.writeFile(path.join(dir, "manual-delivery", "unknown"), "old incomplete evidence", { mode: 0o600 });
        if (kind === "unknown-job") await fs.writeFile(path.join(path.dirname(file), ".atomic-old.tmp"), "old incomplete evidence", { mode: 0o600 });
        if (kind === "noncanonical") await fs.writeFile(file, JSON.stringify(binding()));
        const before = await tree(dir); const s = store(target);
        await expect(s.list()).rejects.toThrow("control-unavailable"); await expect(s.put(binding())).rejects.toThrow("control-unavailable"); await expect(s.remove(binding())).rejects.toThrow("control-unavailable");
        expect(await tree(dir)).toEqual(before);
    });
    it("rejects a wrong owner using the same UID boundary on root and file", async () => {
        const dir = await control(); await seed(dir); const actualUid = process.getuid!(); jest.spyOn(process, "getuid").mockReturnValue(actualUid + 1);
        await expect(store(dir).list()).rejects.toThrow("control-unavailable");
    });
    it("pins root and descendant inodes and refuses replacement after an earlier read", async () => {
        for (const replace of ["root", "namespace", "job"]) {
            const dir = await control(); await seed(dir); const s = store(dir); await s.list();
            const p = replace === "root" ? dir : replace === "namespace" ? path.join(dir, "manual-delivery") : path.dirname(name(dir));
            await fs.rename(p, `${p}-replaced`); await fs.mkdir(p, { mode: 0o700 });
            const before = await tree(dir); await expect(s.list()).rejects.toThrow("control-unavailable"); await expect(s.put(binding())).rejects.toThrow("control-unavailable"); expect(await tree(dir)).toEqual(before);
        }
    });
    it("detects directory or exact-file replacement inside a lock guard before publishing/unlinking", async () => {
        for (const operation of ["put", "remove"] as const) {
            const dir = await control(); await seed(dir); const file = name(dir); let changed = false;
            const s = store(dir, { beforeWrite: async () => {
                if (changed) return; changed = true;
                await fs.rename(file, `${file}-evidence`); await fs.writeFile(file, canonicalJson(binding()), { mode: 0o600 });
            } });
            await expect(s[operation](binding())).rejects.toThrow("control-unavailable");
            expect(await fs.readFile(file, "utf8")).toBe(canonicalJson(binding())); expect(await fs.readFile(`${file}-evidence`, "utf8")).toBe(canonicalJson(binding()));
        }
        const dir = await control(); const namespace = path.join(dir, "manual-delivery"); await fs.mkdir(namespace, { mode: 0o700 });
        let changed = false;
        await expect(store(dir, { beforeWrite: async () => { if (!changed) { changed = true; await fs.rename(namespace, `${namespace}-old`); await fs.mkdir(namespace, { mode: 0o700 }); } } }).put(binding())).rejects.toThrow("control-unavailable");
        expect(await fs.readdir(namespace)).toEqual([]);
    });
    it("detects replacement and growth during a bounded full read, and always closes the file", async () => {
        for (const fault of ["replace", "grow", "read-error"]) {
            const dir = await control(); await seed(dir); const file = name(dir); const originalOpen = fs.open.bind(fs);
            let close: jest.SpyInstance | undefined; let once = false;
            const spy = jest.spyOn(fs, "open").mockImplementation(async (...args) => {
                const handle = await originalOpen(...args);
                if (await fs.realpath(String(args[0])) === file && !once) {
                    once = true; close = jest.spyOn(handle, "close");
                    if (fault === "replace") { await fs.rename(file, `${file}-old`); await fs.writeFile(file, canonicalJson(binding()), { mode: 0o600 }); }
                    else {
                        const originalRead = handle.read.bind(handle);
                        jest.spyOn(handle, "read").mockImplementation((...readArgs: any[]) => {
                            if (fault === "read-error") return Promise.reject(new Error("synthetic private read error"));
                            return fs.appendFile(file, "x").then(() => (originalRead as any)(...readArgs));
                        });
                    }
                }
                return handle;
            });
            try { await expect(store(dir).list()).rejects.toThrow("control-unavailable"); expect(close).toHaveBeenCalledTimes(1); }
            finally { spy.mockRestore(); }
            expect(await fs.lstat(file)).toBeDefined();
        }
    });
    it("rejects a binding file owner mismatch without changing a valid root", async () => {
        const dir = await control(); await seed(dir); const file = name(dir); const original = fs.lstat.bind(fs);
        jest.spyOn(fs, "lstat").mockImplementation((async (...args: any[]) => {
            const stat = await (original as any)(...args);
            if (await fs.realpath(String(args[0])) === file) Object.defineProperty(stat, "uid", { value: process.getuid!() + 1 });
            return stat;
        }) as typeof fs.lstat);
        await expect(store(dir).list()).rejects.toThrow("control-unavailable");
        expect((await original(dir)).uid).toBe(process.getuid!());
    });
    it("refuses a nonregular FIFO without blocking on open", async () => {
        const dir = await control(); await seed(dir); await fs.unlink(name(dir));
        const { execFileSync } = await import("node:child_process");
        execFileSync("mkfifo", ["-m", "600", name(dir)]);
        await expect(store(dir).list()).rejects.toThrow("control-unavailable");
    });
});

describeLinux("ManualDeliveryStore actual atomic fault seams", () => {
    it.each(["write", "file-sync", "publish", "cleanup", "directory-sync"] as const)("retains existing binding under %s failure and never clobbers", async point => {
        const dir = await control(); await seed(dir); const before = await fs.readFile(name(dir)); const inode = (await fs.stat(name(dir))).ino;
        const s = store(dir, { fault: p => { if (p === point) throw new Error(`synthetic private error ${dir}`); } });
        await expect(s.put(binding())).rejects.toThrow("control-unavailable");
        expect(await fs.readFile(name(dir))).toEqual(before); expect((await fs.stat(name(dir))).ino).toBe(inode);
        expect(await store(dir).list()).toEqual([binding()]);
    });
    it.each(["write", "file-sync", "publish", "cleanup", "directory-sync"] as const)("preserves partial durable evidence for new publication failing at %s", async point => {
        const dir = await control(); const s = store(dir, { fault: p => { if (p === point) throw new Error("fault"); } });
        await expect(s.put(binding())).rejects.toThrow("control-unavailable");
        expect(await store(dir).list()).toEqual(["cleanup", "directory-sync"].includes(point) ? [binding()] : []);
        expect(await fs.readdir(path.dirname(name(dir)))).toEqual(["cleanup", "directory-sync"].includes(point) ? [path.basename(name(dir))] : []);
    });
    it("maps actual helper ENOSPC failures to control-space without retaining causes", async () => {
        const dir = await control(); const s = store(dir, { fault: () => { throw Object.assign(new Error(`private ${dir}`), { code: "ENOSPC" }); } });
        const error = await s.put(binding()).catch(e => e); expect(error.reasonCode).toBe("control-space");
        expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain(dir); expect(await store(dir).list()).toEqual([]);
    });
});

describeLinux("ManualDeliveryStore pinned descriptor regressions", () => {
    it("publishes only inside the original pinned job when the actual publish fault redirects the job path", async () => {
        const dir = await control(); const file = name(dir); const job = path.dirname(file); const retained = `${job}-retained`;
        const outside = path.join(root, `outside-${++serial}`); await fs.mkdir(outside, { mode: 0o755 });
        let temp!: string;
        const s = store(dir, { fault: point => {
            if (point !== "publish") return;
            renameSync(job, retained);
            temp = readdirSync(retained).find(entry => entry.startsWith(".atomic-"))!;
            // The attack creates the matching helper temp leaf outside before redirecting the path.
            linkSync(path.join(retained, temp), path.join(outside, temp));
            symlinkSync(outside, job);
        } });
        await expect(s.put(binding())).rejects.toThrow("control-unavailable");
        expect(await fs.readdir(outside)).toEqual([temp]);
        expect(await fs.lstat(path.join(outside, path.basename(file))).catch(() => null)).toBeNull();
        expect(await fs.readdir(retained)).toEqual([path.basename(file)]);
        expect(await fs.readFile(path.join(retained, path.basename(file)), "utf8")).toBe(canonicalJson(binding()));
        expect((await fs.stat(retained)).mode & 0o7777).toBe(0o700);
        expect((await fs.stat(path.join(retained, path.basename(file)))).mode & 0o7777).toBe(0o600);
    });
    it.each(["root", "namespace"] as const)("keeps publication pinned when %s is replaced at the helper publish point", async level => {
        const dir = await control(); const file = name(dir);
        const target = level === "root" ? dir : path.join(dir, "manual-delivery");
        const retained = `${target}-retained`; const outside = path.join(root, `outside-${++serial}`);
        await fs.mkdir(outside, { mode: 0o755 });
        await expect(store(dir, { fault: point => {
            if (point === "publish") { renameSync(target, retained); symlinkSync(outside, target); }
        } }).put(binding())).rejects.toThrow("control-unavailable");
        expect(await fs.readdir(outside)).toEqual([]);
        const evidence = path.join(retained, path.relative(target, file));
        expect(await fs.readFile(evidence, "utf8")).toBe(canonicalJson(binding()));
        expect(await fs.readdir(path.dirname(evidence))).toEqual([path.basename(evidence)]);
    });
    it.each(["root", "namespace", "job"] as const)("refuses list/remove after %s is redirected during the binding open, without reading or deleting outside", async level => {
        for (const operation of ["list", "remove"] as const) {
            const dir = await control(); await seed(dir); const file = name(dir);
            const target = level === "root" ? dir : level === "namespace" ? path.join(dir, "manual-delivery") : path.dirname(file);
            const retained = `${target}-retained`; const outside = path.join(root, `outside-${++serial}`);
            await fs.mkdir(outside, { mode: 0o755 });
            const outsideFile = path.join(outside, path.relative(target, file));
            await fs.mkdir(path.dirname(outsideFile), { recursive: true, mode: 0o700 });
            await fs.writeFile(outsideFile, canonicalJson({ ...binding(), leaseToken: id(88) }), { mode: 0o600 });
            const before = await tree(outside); const original = fs.open.bind(fs); let attacked = false;
            const spy = jest.spyOn(fs, "open").mockImplementation(async (...args) => {
                if (!attacked && await fs.realpath(String(args[0])) === file) {
                    attacked = true; await fs.rename(target, retained); await fs.symlink(outside, target);
                }
                return original(...args);
            });
            try {
                const s = store(dir);
                await expect(operation === "list" ? s.list() : s.remove(binding())).rejects.toThrow("control-unavailable");
            } finally { spy.mockRestore(); }
            expect(attacked).toBe(true); expect(await tree(outside)).toEqual(before);
            expect(await fs.readFile(path.join(retained, path.relative(target, file)), "utf8")).toBe(canonicalJson(binding()));
        }
    });
    it("preserves a valid lease changed in place by the second removal guard on the same inode", async () => {
        const dir = await control(); await seed(dir); const file = name(dir); const inode = (await fs.lstat(file)).ino;
        const changed = { ...binding(), leaseToken: id(77) }; let guards = 0;
        const s = store(dir, { beforeWrite: async () => {
            if (++guards === 2) await fs.writeFile(file, canonicalJson(changed));
        } });
        await expect(s.remove(binding())).rejects.toThrow("control-unavailable");
        expect(guards).toBe(2); expect((await fs.lstat(file)).ino).toBe(inode);
        expect(await fs.readFile(file, "utf8")).toBe(canonicalJson(changed));
        await s.remove(changed); expect(await s.list()).toEqual([]);
    });
    it.each(["code-getter", "reason-getter", "proxy", "revoked-proxy", "ENOSPC"])("sanitizes %s guard failures without poisoning the next queued operation", async kind => {
        const dir = await control(); const secret = "synthetic-private-classification-detail";
        let error: unknown;
        if (kind === "code-getter") error = Object.defineProperty(new WorkerError("control-space"), "code", { get() { throw new Error(secret); } });
        if (kind === "reason-getter") error = Object.defineProperty(new WorkerError("control-space"), "reasonCode", { get() { throw new Error(secret); } });
        if (kind === "proxy") error = new Proxy({}, { get() { throw new Error(secret); }, getPrototypeOf() { throw new Error(secret); } });
        if (kind === "revoked-proxy") { const proxy = Proxy.revocable({}, {}); proxy.revoke(); error = proxy.proxy; }
        if (kind === "ENOSPC") error = { code: "ENOSPC", message: secret };
        let fail = true;
        const s = store(dir, { beforeWrite: async () => { if (fail) { fail = false; throw error; } } });
        const failed = s.put(binding()).catch(value => value);
        const next = s.put(binding());
        const result = await failed;
        expect(result).toMatchObject({ reasonCode: kind === "ENOSPC" ? "control-space" : "control-unavailable" });
        expect(result).not.toBe(error); expect(JSON.stringify(result, Object.getOwnPropertyNames(result))).not.toContain(secret);
        await next; expect(await s.list()).toEqual([binding()]);
    });
    it("holds every directory descriptor through helper cleanup and closes every acquired handle on success and refusal", async () => {
        const original = fs.open.bind(fs);
        const handles: { close: jest.SpyInstance; fd: number }[] = [];
        jest.spyOn(fs, "open").mockImplementation(async (...args) => {
            const handle = await original(...args); handles.push({ close: jest.spyOn(handle, "close"), fd: handle.fd }); return handle;
        });
        const dir = await control();
        const s = store(dir, { fault: point => {
            if (point === "cleanup") {
                // Root, namespace, job and helper directory must still be open at cleanup.
                expect(handles.filter(h => !h.close.mock.calls.length)).toHaveLength(4);
            }
        } });
        await s.put(binding()); await s.list(); await s.remove(binding());
        await expect(store(await control(), { beforeWrite: async () => { throw new Error("lost"); } }).put(binding())).rejects.toThrow("control-unavailable");
        for (const handle of handles) expect(handle.close).toHaveBeenCalledTimes(1);
    });
    it("closes the synchronous removal descriptor after a failed final read and after a successful retry", async () => {
        const dir = await control(); await seed(dir); const before = await fs.readFile(name(dir));
        const open = nodeFs.openSync.bind(nodeFs); const read = nodeFs.readSync.bind(nodeFs); const close = nodeFs.closeSync.bind(nodeFs);
        const opened: number[] = []; const closed: number[] = []; let fail = true;
        jest.spyOn(nodeFs, "openSync").mockImplementation((...args) => {
            const fd = open(...args); if (String(args[0]).startsWith("/proc/self/fd/")) opened.push(fd); return fd;
        });
        // File readSync has multiple overloads; forward the untouched native arguments in this fault seam.
        jest.spyOn(nodeFs, "readSync").mockImplementation((...args: any[]) => {
            if (opened.includes(args[0]) && fail) { fail = false; throw new Error("synthetic private sync read"); }
            return (read as any)(...args);
        });
        jest.spyOn(nodeFs, "closeSync").mockImplementation(fd => { if (opened.includes(fd)) closed.push(fd); close(fd); });
        const s = store(dir);
        await expect(s.remove(binding())).rejects.toThrow("control-unavailable");
        expect(await fs.readFile(name(dir))).toEqual(before); expect(closed).toEqual(opened); expect(opened).toHaveLength(1);
        await s.remove(binding()); expect(await s.list()).toEqual([]);
        expect(opened).toHaveLength(2); expect(closed).toEqual(opened);
    });
});
