import { promises as fs } from "node:fs";

import { artifactIdentity } from "domain/eformsign-backup/source-evidence";
import { artifactKey, runKey } from "domain/eformsign-backup/worker";
import { executionChunks, ExecutionFencedError, type ExecutionEffectFence } from "infrastructure/eformsign-backup/execution-effect-fence";
import { LocalArtifactArchive, type ArchiveFaultPoint } from "infrastructure/eformsign-backup/local-artifact-archive";
import { publishBytesNoClobber } from "infrastructure/eformsign-backup/worker/atomic-file";

import { makeArchive, makeDestination, makeTestBase, publishInput, snapshotTree, streamOf, type ArchiveFixture } from "./helpers/destination-support";
import { buildMinimalPdf } from "./helpers/pdf-fixture-minimal";

const RUN_ID = "3f2b8c1e-5d4a-4b6c-9e7f-1a2b3c4d5e6f";
const pdf = buildMinimalPdf("fence");
const input = publishInput(pdf);
const claim = { companyId: input.companyId, documentId: input.documentId, artifactKind: input.artifactType,
    contentSha256: input.sha256, byteLength: input.byteLength };
const jsonKey = runKey({ companyId: "C001", runId: RUN_ID });

function authority(): { controller: AbortController; fence: ExecutionEffectFence } {
    const controller = new AbortController();
    return { controller, fence: { signal: controller.signal, assertActive: async () => undefined } };
}

async function bounded<T>(pending: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([pending, new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => reject(new Error("archive settlement guard")), 500);
        })]);
    } finally { clearTimeout(timer); }
}

describe("local effect fences", () => {
    let base: string;
    let fixture: ArchiveFixture;
    beforeEach(async () => { base = await makeTestBase(); fixture = await makeArchive(base); });
    afterEach(async () => { jest.restoreAllMocks(); await fs.rm(base, { recursive: true, force: true }); });

    function primitive(fault?: (point: ArchiveFaultPoint) => void): LocalArtifactArchive {
        return new LocalArtifactArchive({ rootPath: fixture.root, expectedDevice: fixture.dev, expectedInode: fixture.ino, maxBytes: pdf.length }, fault);
    }
    describe.each([false, true])("producer failures (fenced=%s)", fenced => {
        it.each([
            ["reject", "never"], ["reject", "reject"], ["reject", "throw"],
            ["throw", "never"], ["throw", "reject"], ["throw", "throw"],
        ] as const)("fails safely after next %s without invoking return %s", async (pullFailure, cleanupFailure) => {
            const { controller, fence } = authority();
            const sourceError = new Error("private producer detail");
            let finishCleanup: ((value: IteratorResult<Uint8Array>) => void) | undefined;
            const returned = jest.fn((): Promise<IteratorResult<Uint8Array>> => {
                if (cleanupFailure === "throw") throw new Error("private cleanup detail");
                if (cleanupFailure === "reject") return Promise.reject(new Error("private cleanup detail"));
                return new Promise(resolve => { finishCleanup = resolve; });
            });
            let pulls = 0;
            const next = jest.fn((): Promise<IteratorResult<Uint8Array>> => {
                if (++pulls === 1) return Promise.resolve({ done: false, value: pdf.subarray(0, 10) });
                if (pullFailure === "throw") throw sourceError;
                return Promise.reject(sourceError);
            });
            const source = { [Symbol.asyncIterator]: () => ({ next, return: returned }) };
            const unhandled = jest.fn();
            process.on("unhandledRejection", unhandled);
            const opened = jest.spyOn(fs, "open");
            const writes = jest.fn();
            const archive = primitive(point => { if (point === "write") writes(); });
            const before = await snapshotTree(base);
            const pending = archive.archive(claim, source, fenced ? { effectFence: fence } : undefined);
            try {
                await expect(bounded(pending))
                    .resolves.toEqual({ ok: false, error: "ARCHIVE_FAILED" });
                expect(next).toHaveBeenCalledTimes(2);
                expect(writes).toHaveBeenCalledTimes(1);
                expect(returned).not.toHaveBeenCalled();
                expect(await snapshotTree(base)).toEqual(before);
                expect(opened).toHaveBeenCalled();
                for (const result of opened.mock.results) {
                    if (result.type === "return") {
                        const handle = await result.value;
                        await expect(handle.stat()).rejects.toMatchObject({ code: "EBADF" });
                    }
                }
                controller.abort("late private reason");
                await new Promise<void>(resolve => setImmediate(resolve));
                expect(next).toHaveBeenCalledTimes(2);
                expect(returned).not.toHaveBeenCalled();
                expect(unhandled).not.toHaveBeenCalled();
            } finally {
                finishCleanup?.({ done: true, value: undefined });
                try { await pending; }
                finally { process.off("unhandledRejection", unhandled); }
            }
        });
        it.each(["reject", "throw"])("preserves the original next %s error", async failure => {
            const error = new Error("private producer detail");
            const returned = jest.fn(async (): Promise<IteratorResult<number>> => { throw new Error("private cleanup detail"); });
            const iterator = executionChunks({ [Symbol.asyncIterator]: () => ({
                next: (): Promise<IteratorResult<number>> => {
                    if (failure === "throw") throw error;
                    return Promise.reject(error);
                }, return: returned,
            }) }, fenced ? authority().fence : undefined);
            await expect(bounded(iterator.next())).rejects.toBe(error);
            expect(returned).not.toHaveBeenCalled();
        });
    });
    it.each([false, true])("preserves consumer body failure through rejecting cleanup (fenced=%s)", async fenced => {
        const error = new Error("consumer body failure");
        const returned = jest.fn(async (): Promise<IteratorResult<number>> => { throw new Error("private cleanup detail"); });
        const next = jest.fn(async () => ({ done: false as const, value: 1 }));
        const pending = (async () => {
            for await (const value of executionChunks({ [Symbol.asyncIterator]: () => ({ next, return: returned }) },
                fenced ? authority().fence : undefined)) {
                expect(value).toBe(1);
                throw error;
            }
        })();
        await expect(bounded(pending)).rejects.toBe(error);
        expect(next).toHaveBeenCalledTimes(1);
        expect(returned).toHaveBeenCalledTimes(1);
    });
    it.each([false, true])("awaits source cleanup on consumer break (fenced=%s)", async fenced => {
        let cleanupStarted!: () => void;
        const started = new Promise<void>(resolve => { cleanupStarted = resolve; });
        let finishCleanup!: (value: IteratorResult<number>) => void;
        const cleanup = new Promise<IteratorResult<number>>(resolve => { finishCleanup = resolve; });
        const returned = jest.fn(() => { cleanupStarted(); return cleanup; });
        const next = jest.fn(async () => ({ done: false as const, value: 1 }));
        let settled = false;
        const pending = (async () => {
            for await (const value of executionChunks({ [Symbol.asyncIterator]: () => ({ next, return: returned }) },
                fenced ? authority().fence : undefined)) {
                expect(value).toBe(1);
                break;
            }
            settled = true;
        })();
        try {
            await bounded(started);
            expect(settled).toBe(false);
            finishCleanup({ done: true, value: undefined });
            await bounded(pending);
            expect(returned).toHaveBeenCalledTimes(1);
            expect(next).toHaveBeenCalledTimes(1);
        } finally {
            finishCleanup({ done: true, value: undefined });
            await pending;
        }
    });
    it.each(["created", "reused"] as const)("archives actual bytes with an active fence (%s)", async disposition => {
        const archive = primitive();
        const artifactId = artifactIdentity(claim);
        const relativeKey = `${artifactId}.bin`;
        const path = `${fixture.root}/${relativeKey}`;
        if (disposition === "reused") {
            await expect(archive.archive(claim, streamOf(pdf))).resolves.toMatchObject({ ok: true, disposition: "created" });
        }
        const previous = disposition === "reused" ? await fs.lstat(path) : undefined;
        const { fence } = authority();
        const assertActive = jest.fn(async () => undefined);
        fence.assertActive = assertActive;
        await expect(archive.archive(claim, streamOf(pdf), { effectFence: fence })).resolves.toEqual({
            ok: true, artifactId, relativeKey, contentSha256: input.sha256, byteLength: pdf.length, disposition,
        });
        expect(assertActive).toHaveBeenCalled();
        expect(await fs.readFile(path)).toEqual(pdf);
        const stat = await fs.lstat(path);
        expect(stat.isFile()).toBe(true);
        expect(stat.mode & 0o777).toBe(0o600);
        expect(stat.uid).toBe(process.getuid?.());
        expect(stat.nlink).toBe(1);
        if (previous) expect({ dev: stat.dev, ino: stat.ino }).toEqual({ dev: previous.dev, ino: previous.ino });
        expect((await fs.readdir(fixture.root)).sort()).toEqual([".bjj-backup", relativeKey].sort());
    });
    it.each(["created", "reused"] as const)("atomically publishes actual bytes with an active fence (%s)", async disposition => {
        const bytes = Buffer.from('{"synthetic":true}\n');
        const path = `${fixture.root}/record.json`;
        if (disposition === "reused") {
            await expect(publishBytesNoClobber(fixture.root, "record.json", bytes)).resolves.toEqual({ disposition: "created" });
        }
        const previous = disposition === "reused" ? await fs.lstat(path) : undefined;
        const { fence } = authority();
        const assertActive = jest.fn(async () => undefined);
        fence.assertActive = assertActive;
        await expect(publishBytesNoClobber(fixture.root, "record.json", bytes, { effectFence: fence })).resolves.toEqual({ disposition });
        expect(assertActive).toHaveBeenCalled();
        expect(await fs.readFile(path)).toEqual(bytes);
        const stat = await fs.lstat(path);
        expect(stat.isFile()).toBe(true);
        expect(stat.mode & 0o777).toBe(0o600);
        expect(stat.uid).toBe(process.getuid?.());
        expect(stat.nlink).toBe(1);
        if (previous) expect({ dev: stat.dev, ino: stat.ino }).toEqual({ dev: previous.dev, ino: previous.ino });
        expect((await fs.readdir(fixture.root)).sort()).toEqual([".bjj-backup", "record.json"]);
    });
    it("blocks every public mutation before directories, temps, source pulls or renames", async () => {
        const { controller, fence } = authority();
        controller.abort("secret");
        const before = await snapshotTree(base);
        const destination = makeDestination(fixture);
        const source = { [Symbol.asyncIterator]: jest.fn(() => streamOf(pdf)[Symbol.asyncIterator]()) };
        const staging = { path: `${base}/absent`, dev: fixture.dev, ino: fixture.ino };
        for (const attempt of [
            () => primitive().archive(claim, source, { effectFence: fence }),
            () => publishBytesNoClobber(fixture.root, "record.json", Buffer.from("{}"), { effectFence: fence }),
            () => destination.publishArtifact(input, source, fence),
            () => destination.publishJson(jsonKey, Buffer.from("{}"), fence),
            () => destination.ensureStaging(base, fence),
            () => destination.stageArtifact(staging, input, source, fence),
            () => destination.quarantineCorrupt(artifactKey(input), RUN_ID, fence),
        ]) await expect(attempt()).rejects.toMatchObject({ reason: "aborted", message: "Execution effect fenced" });
        expect(source[Symbol.asyncIterator]).not.toHaveBeenCalled();
        expect(await snapshotTree(base)).toEqual(before);
    });
    it("preserves typed guard errors and hides untyped guard details through destination catches", async () => {
        const { fence } = authority();
        const typed = new ExecutionFencedError("lease-lost");
        fence.assertActive = async () => { throw typed; };
        await expect(makeDestination(fixture).publishArtifact(input, streamOf(pdf), fence)).rejects.toBe(typed);
        fence.assertActive = async () => { throw new Error("secret document URL"); };
        await expect(makeDestination(fixture).publishJson(jsonKey, Buffer.from("{}"), fence))
            .rejects.toMatchObject({ reason: "uncertain", message: "Execution effect fenced" });
        expect(await fs.readdir(fixture.root)).toEqual([".bjj-backup"]);
    });
    it("discards a chunk returned after abort, stops further pulls and cleans the accepted first write", async () => {
        const { controller, fence } = authority();
        let pulls = 0;
        let writes = 0;
        const returned = jest.fn(async () => ({ done: true as const, value: undefined }));
        const source: AsyncIterable<Uint8Array> = { [Symbol.asyncIterator]: () => ({
            next: async () => {
                pulls++;
                if (pulls === 2) {
                    const temp = (await fs.readdir(fixture.root)).find(name => name.endsWith(".tmp"));
                    expect(await fs.readFile(`${fixture.root}/${temp}`)).toEqual(pdf.subarray(0, 10));
                    controller.abort("private");
                }
                return { done: false, value: pdf.subarray(0, 10) };
            }, return: returned,
        }) };
        await expect(primitive(point => { if (point === "write") writes++; }).archive(claim, source, { effectFence: fence }))
            .rejects.toBeInstanceOf(ExecutionFencedError);
        expect(pulls).toBe(2);
        expect(writes).toBe(1);
        expect(returned).toHaveBeenCalledTimes(1);
        expect(await fs.readdir(fixture.root)).toEqual([".bjj-backup"]);
    });
    it("settles a stalled local source on abort and invokes return", async () => {
        const { controller, fence } = authority();
        let started!: () => void;
        const ready = new Promise<void>(resolve => { started = resolve; });
        const returned = jest.fn(async () => ({ done: true as const, value: undefined }));
        const source: AsyncIterable<Uint8Array> = { [Symbol.asyncIterator]: () => ({
            next: () => { started(); return new Promise(() => undefined); }, return: returned,
        }) };
        const pending = primitive().archive(claim, source, { effectFence: fence });
        await ready;
        controller.abort("private");
        await expect(pending).rejects.toMatchObject({ reason: "aborted" });
        expect(returned).toHaveBeenCalledTimes(1);
        expect(await fs.readdir(fixture.root)).toEqual([".bjj-backup"]);
    });
    it.each<ArchiveFaultPoint>(["write", "file-sync", "publish"])("checks abort immediately after the archive %s fault callback", async point => {
        const { controller, fence } = authority();
        await expect(primitive(at => { if (at === point) controller.abort("secret"); }).archive(claim, streamOf(pdf), { effectFence: fence }))
            .rejects.toBeInstanceOf(ExecutionFencedError);
        expect(await fs.readdir(fixture.root)).toEqual([".bjj-backup"]);
    });
    it.each<ArchiveFaultPoint>(["cleanup", "directory-sync"])("retains an already linked archive after abort at %s", async point => {
        const { controller, fence } = authority();
        await expect(primitive(at => { if (at === point) controller.abort(); }).archive(claim, streamOf(pdf), { effectFence: fence }))
            .rejects.toBeInstanceOf(ExecutionFencedError);
        expect(await fs.readFile(`${fixture.root}/${artifactIdentity(claim)}.bin`)).toEqual(pdf);
        expect((await fs.readdir(fixture.root)).filter(name => name.endsWith(".tmp"))).toEqual([]);
    });
    it("guards an existing final receipt and preserves its bytes", async () => {
        await expect(primitive().archive(claim, streamOf(pdf))).resolves.toMatchObject({ ok: true });
        const { controller, fence } = authority();
        let syncs = 0;
        await expect(primitive(at => { if (at === "file-sync" && ++syncs === 2) controller.abort(); })
            .archive(claim, streamOf(pdf), { effectFence: fence })).rejects.toBeInstanceOf(ExecutionFencedError);
        expect(await fs.readFile(`${fixture.root}/${artifactIdentity(claim)}.bin`)).toEqual(pdf);
        expect((await fs.readdir(fixture.root)).filter(name => name.endsWith(".tmp"))).toEqual([]);
    });
    it.each<ArchiveFaultPoint>(["write", "file-sync", "publish"])("prevents atomic JSON commit after abort at %s", async point => {
        const { controller, fence } = authority();
        await expect(publishBytesNoClobber(fixture.root, "record.json", Buffer.from("{}"), {
            effectFence: fence, fault: at => { if (at === point) controller.abort(); },
        })).rejects.toBeInstanceOf(ExecutionFencedError);
        expect(await fs.readdir(fixture.root)).toEqual([".bjj-backup"]);
    });
    it("retains already published atomic bytes but refuses a success receipt after loss", async () => {
        const { controller, fence } = authority();
        await expect(publishBytesNoClobber(fixture.root, "record.json", Buffer.from("{}"), {
            effectFence: fence, fault: at => { if (at === "cleanup") controller.abort(); },
        })).rejects.toBeInstanceOf(ExecutionFencedError);
        expect(await fs.readFile(`${fixture.root}/record.json`, "utf8")).toBe("{}");
        expect((await fs.readdir(fixture.root)).filter(name => name.endsWith(".tmp"))).toEqual([]);
    });
    it("guards atomic reuse after comparison and preserves the existing object", async () => {
        await fs.writeFile(`${fixture.root}/record.json`, "{}", { mode: 0o600 });
        const { fence } = authority();
        let calls = 0;
        fence.assertActive = async () => { if (++calls === 3) throw new ExecutionFencedError("lease-lost"); };
        await expect(publishBytesNoClobber(fixture.root, "record.json", Buffer.from("{}"), { effectFence: fence }))
            .rejects.toMatchObject({ reason: "lease-lost" });
        expect(await fs.readFile(`${fixture.root}/record.json`, "utf8")).toBe("{}");
    });
    it("propagates archive and JSON commit aborts through destination catches", async () => {
        for (const json of [false, true]) {
            const { controller, fence } = authority();
            const destination = makeDestination(fixture, {}, undefined, at => { if (at === "publish") controller.abort(); });
            await expect(json ? destination.publishJson(jsonKey, Buffer.from("{}"), fence)
                : destination.publishArtifact(input, streamOf(pdf), fence)).rejects.toBeInstanceOf(ExecutionFencedError);
        }
        expect((await snapshotTree(base)).some(line => line.includes(".tmp|") || line.includes(".pdf|") || line.includes(`${RUN_ID}.json|`))).toBe(false);
    });
    it("guards staging and quarantine without moving or deleting an existing artifact", async () => {
        const destination = makeDestination(fixture);
        await destination.publishArtifact(input, streamOf(pdf));
        const staging = await destination.ensureStaging(base);
        if (!staging.ok) throw new Error("staging setup failed");
        const { controller, fence } = authority();
        const guarded = makeDestination(fixture, {}, undefined, at => { if (at === "publish") controller.abort(); });
        await expect(guarded.stageArtifact(staging.root, input, streamOf(pdf), fence)).rejects.toBeInstanceOf(ExecutionFencedError);
        const before = await snapshotTree(base);
        await expect(destination.quarantineCorrupt(artifactKey(input), RUN_ID, fence)).rejects.toBeInstanceOf(ExecutionFencedError);
        expect(await snapshotTree(base)).toEqual(before);
        expect(await fs.readFile(`${fixture.root}/${artifactKey(input)}`)).toEqual(pdf);
    });
    it("allows explicit control writes without a fence after an unrelated fence is lost", async () => {
        const { controller } = authority();
        controller.abort();
        await expect(publishBytesNoClobber(fixture.root, "checkpoint.json", Buffer.from("{}"))).resolves.toEqual({ disposition: "created" });
    });
});
