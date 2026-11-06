import { createHash } from "node:crypto";

import { artifactKey } from "domain/eformsign-backup/worker";
import { ExecutionFencedError, type ExecutionEffectFence } from "infrastructure/eformsign-backup/execution-effect-fence";
import { driveOk, type DriveTokenProvider } from "infrastructure/eformsign-backup/worker/drive-auth";
import { DriveClient, DriveTransferError } from "infrastructure/eformsign-backup/worker/drive-client";
import { DriveDestination, type DriveNodeLedger } from "infrastructure/eformsign-backup/worker/drive-destination";

const BASE = "http://127.0.0.1:9"; // No listener: every request is answered by the injected fetch.
const CHUNK = 262144;
const ID = "SyntheticFile00001";
const PARENT = "SyntheticParent0001";
const meta = { id: ID, name: "doc.pdf", parentId: PARENT, mimeType: "application/pdf" };
const bytes = Buffer.from("synthetic bytes");
const sha256 = createHash("sha256").update(bytes).digest("hex");
const key = artifactKey({ companyId: "C001", documentId: "D001", artifactType: "document", sha256 });
const remote = { id: ID, name: `${sha256}.pdf`, mimeType: "application/pdf", parents: [PARENT],
    trashed: false, size: String(bytes.length), sha256Checksum: sha256 };
const expectFile = { name: remote.name, parentFileId: PARENT, mimeType: remote.mimeType, sha256, byteLength: bytes.length };
const input = { relativeKey: key, sha256, byteLength: bytes.length, artifactIdentity: "a".repeat(64) };
const binding = { rootFolderId: PARENT, rootName: "archive", rootParentId: "root", bindingId: "binding", installationId: "install", archiveId: "archive" };
const json = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), { status });
const open = (offset: number): AsyncIterable<Uint8Array> => (async function* () { yield bytes.subarray(offset); })();
function authority(): { controller: AbortController; fence: ExecutionEffectFence } {
    const controller = new AbortController();
    return { controller, fence: { signal: controller.signal, assertActive: async () => undefined } };
}
function setup(reply: typeof fetch, tokens: DriveTokenProvider = { get: async () => driveOk("synthetic-token") }, timeout = 1000): DriveClient {
    return new DriveClient({ apiBaseUrl: BASE, uploadBaseUrl: BASE, tokens, fetchImpl: reply, requestTimeoutMs: timeout, chunkBytes: CHUNK });
}
function ledger(initial: ReturnType<DriveNodeLedger["current"]> = null): DriveNodeLedger & { reserve: jest.Mock; created: jest.Mock } {
    const records = new Map<string, NonNullable<ReturnType<DriveNodeLedger["current"]>>>();
    return {
        current: nodeKey => records.get(nodeKey) ?? initial,
        reserve: jest.fn(async (kind, nodeKey, fileId, parentFileId) => { records.set(nodeKey, { kind, fileId, parentFileId, status: "reserved" }); }),
        created: jest.fn(async (nodeKey, fileId) => {
            const current = records.get(nodeKey) ?? initial;
            if (current) records.set(nodeKey, { ...current, fileId, status: "created" });
        }),
    };
}
async function collect(source: AsyncIterable<unknown>): Promise<void> { for await (const part of source) { void part; } }

describe("Drive effect fences", () => {
    afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers(); });
    it("blocks every client operation before tokens, fetches or opening a source", async () => {
        const { controller, fence } = authority(); controller.abort("secret");
        const fetcher = jest.fn(async () => json({}));
        const get = jest.fn(async () => driveOk("synthetic-token"));
        const client = setup(fetcher, { get });
        const source = jest.fn(open);
        for (const call of [
            () => client.generateIds(1, fence), () => client.createFolder(meta, fence), () => client.getFile(ID, fence),
            () => client.listChildren(PARENT, undefined, fence), () => client.findFolders({ appPropertyKey: "key", appPropertyValue: "value" }, fence),
            () => client.about(fence), () => client.uploadResumable(meta, source, bytes.length, fence), () => client.download(ID, fence),
        ]) await expect(call()).rejects.toMatchObject({ reason: "aborted", message: "Execution effect fenced" });
        expect(fetcher).not.toHaveBeenCalled(); expect(get).not.toHaveBeenCalled(); expect(source).not.toHaveBeenCalled();
    });
    it("sanitizes guard rejection before token refresh and preserves typed lease loss", async () => {
        const { fence } = authority();
        const fetcher = jest.fn(async () => json({}));
        const get = jest.fn(async () => driveOk("synthetic-token"));
        const client = setup(fetcher, { get });
        fence.assertActive = async () => { throw new Error("private bearer URL"); };
        const error: unknown = await client.about(fence).catch(e => e);
        expect(error).toMatchObject({ message: "Execution effect fenced", reason: "uncertain" });
        expect(error).not.toHaveProperty("cause");
        expect(String(error)).not.toContain("private");
        const typed = new ExecutionFencedError("lease-lost");
        fence.assertActive = async () => { throw typed; };
        await expect(client.about(fence)).rejects.toBe(typed);
        expect(get).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
    });
    it("rechecks authority after token acquisition before any Drive request", async () => {
        const { controller, fence } = authority();
        const fetcher = jest.fn(async () => json({}));
        const get = jest.fn(async () => { controller.abort("private refresh detail"); return driveOk("synthetic-token"); });
        await expect(setup(fetcher, { get }).about(fence)).rejects.toMatchObject({ reason: "aborted" });
        expect(get).toHaveBeenCalledTimes(1); expect(fetcher).not.toHaveBeenCalled();
    });
    it("guards again after token acquisition even without a signal abort", async () => {
        const { fence } = authority();
        const fetcher = jest.fn(async () => json({}));
        let lost = false;
        fence.assertActive = async () => { if (lost) throw new ExecutionFencedError("lease-lost"); };
        const get = jest.fn(async () => { lost = true; return driveOk("synthetic-token"); });
        await expect(setup(fetcher, { get }).about(fence)).rejects.toMatchObject({ reason: "lease-lost" });
        expect(fetcher).not.toHaveBeenCalled();
    });
    it("does not force refresh or repeat a 401 after cancellation", async () => {
        const { controller, fence } = authority();
        const get = jest.fn(async () => driveOk("synthetic-token"));
        const cancelled = jest.fn(() => { controller.abort("private"); });
        const fetcher = jest.fn(async () => new Response(new ReadableStream({ cancel: cancelled }), { status: 401 }));
        await expect(setup(fetcher, { get }).about(fence)).rejects.toMatchObject({ reason: "aborted" });
        expect(get.mock.calls).toHaveLength(1); expect(fetcher).toHaveBeenCalledTimes(1); expect(cancelled).toHaveBeenCalledTimes(1);
    });
    it("settles an ignoring fetch promptly and cancels its late response", async () => {
        const { controller, fence } = authority();
        let started!: () => void;
        const ready = new Promise<void>(resolve => { started = resolve; });
        let finish!: (response: Response) => void;
        const fetcher = jest.fn(() => { started(); return new Promise<Response>(resolve => { finish = resolve; }); });
        const pending = setup(fetcher).about(fence);
        await ready; controller.abort("private");
        await expect(pending).rejects.toBeInstanceOf(ExecutionFencedError);
        const cancelled = jest.fn();
        finish(new Response(new ReadableStream({ cancel: cancelled })));
        await Promise.resolve(); await Promise.resolve();
        expect(cancelled).toHaveBeenCalledTimes(1); expect(fetcher).toHaveBeenCalledTimes(1);
    });
    it.each([200, 503])("cancels a pending JSON/error body at HTTP %s without retry or protocol mapping", async status => {
        const { controller, fence } = authority();
        let reading!: () => void;
        const ready = new Promise<void>(resolve => { reading = resolve; });
        const cancel = jest.fn();
        const fetcher = jest.fn(async () => new Response(new ReadableStream({ pull: () => { reading(); }, cancel }), { status }));
        const pending = setup(fetcher).generateIds(1, fence);
        await ready; controller.abort("private body");
        await expect(pending).rejects.toMatchObject({ reason: "aborted" });
        expect(cancel).toHaveBeenCalledTimes(1); expect(fetcher).toHaveBeenCalledTimes(1);
    });
    it("cancels pending download reads, clears idle timers, and removes owned listeners", async () => {
        jest.useFakeTimers();
        const { controller, fence } = authority();
        const add = jest.spyOn(controller.signal, "addEventListener");
        const remove = jest.spyOn(controller.signal, "removeEventListener");
        const cancel = jest.fn();
        const client = setup(async () => new Response(new ReadableStream({ cancel })));
        const result = await client.download(ID, fence);
        if (!result.ok) throw new Error("expected download");
        const pending = result.value[Symbol.asyncIterator]().next();
        expect(jest.getTimerCount()).toBe(1);
        controller.abort("private");
        await expect(pending).rejects.toBeInstanceOf(ExecutionFencedError);
        expect(cancel).toHaveBeenCalledTimes(1);
        expect(jest.getTimerCount()).toBe(0);
        expect(remove.mock.calls.map(call => call[1])).toEqual(add.mock.calls.map(call => call[1]));
    });
    it("preserves ordinary download idle timeouts without a fence", async () => {
        jest.useFakeTimers();
        const cancel = jest.fn();
        const result = await setup(async () => new Response(new ReadableStream({ cancel })), undefined, 25).download(ID);
        if (!result.ok) throw new Error("expected download");
        const pending = collect(result.value);
        const assertion = expect(pending).rejects.toMatchObject({ failure: { kind: "timeout" } });
        await jest.advanceTimersByTimeAsync(25); await assertion;
        expect(cancel).toHaveBeenCalledTimes(1); expect(jest.getTimerCount()).toBe(0);
    });
    it.each([false, true])("cancels an owned download when aborted between reads (started=%s)", async started => {
        const { controller, fence } = authority();
        const add = jest.spyOn(controller.signal, "addEventListener");
        const remove = jest.spyOn(controller.signal, "removeEventListener");
        const cancel = jest.fn();
        const result = await setup(async () => new Response(new ReadableStream({
            start: stream => { stream.enqueue(bytes); }, cancel,
        }))).download(ID, fence);
        if (!result.ok) throw new Error("expected download");
        const iterator = result.value[Symbol.asyncIterator]();
        if (started) expect((await iterator.next()).value).toEqual(bytes);
        controller.abort("private body");
        await Promise.resolve();
        expect(cancel).toHaveBeenCalledTimes(1);
        await expect(iterator.next()).rejects.toBeInstanceOf(ExecutionFencedError);
        expect(remove).toHaveBeenCalledTimes(add.mock.calls.length);
        expect(remove.mock.calls.map(call => call[1])).toEqual(expect.arrayContaining(add.mock.calls.map(call => call[1])));
    });
    it("releases an owned download returned before its first read", async () => {
        const { fence } = authority();
        const add = jest.spyOn(fence.signal, "addEventListener");
        const remove = jest.spyOn(fence.signal, "removeEventListener");
        const cancel = jest.fn();
        const result = await setup(async () => new Response(new ReadableStream({ cancel }))).download(ID, fence);
        if (!result.ok) throw new Error("expected download");
        await result.value[Symbol.asyncIterator]().return?.();
        expect(cancel).toHaveBeenCalledTimes(1);
        expect(remove.mock.calls.map(call => call[1])).toEqual(add.mock.calls.map(call => call[1]));
    });
    it("keeps request timeouts effective when an active fence is supplied", async () => {
        const { fence } = authority();
        const fetcher: typeof fetch = async (_url, init) => new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("deadline"), { name: "TimeoutError" })), { once: true });
        });
        await expect(setup(fetcher, undefined, 20).about(fence)).resolves.toMatchObject({ ok: false, failure: { kind: "timeout" } });
    });
    it.each(["chunk", "probe", "restart"])("starts no further upload fetch after abort at %s", async mode => {
        const { controller, fence } = authority();
        let puts = 0;
        let pulls = 0;
        const fetcher = jest.fn(async (_url: unknown, init?: RequestInit) => {
            if (init?.method === "POST") return new Response(null, { status: 200, headers: { location: `${BASE}/session` } });
            puts++;
            if (mode === "probe") { controller.abort("private"); throw new Error("lost reply"); }
            return new Response(new ReadableStream({ cancel: () => { controller.abort("private"); } }), {
                status: mode === "restart" ? 410 : 308, headers: { range: `bytes=0-${CHUNK - 1}` },
            });
        });
        const source = () => ({ async *[Symbol.asyncIterator]() { for (let i = 0; i < 3; i++) { pulls++; yield Buffer.alloc(CHUNK); } } });
        await expect(setup(fetcher).uploadResumable(meta, source, CHUNK * 3, fence)).rejects.toMatchObject({ reason: "aborted" });
        expect(fetcher).toHaveBeenCalledTimes(2); expect(puts).toBe(1); expect(pulls).toBe(1);
    });
    it("returns a stalled upload iterator without sending a chunk", async () => {
        const { controller, fence } = authority();
        let started!: () => void;
        const ready = new Promise<void>(resolve => { started = resolve; });
        const returned = jest.fn(async () => ({ done: true as const, value: undefined }));
        const source: AsyncIterable<Uint8Array> = { [Symbol.asyncIterator]: () => ({
            next: () => { started(); return new Promise(() => undefined); }, return: returned,
        }) };
        const fetcher = jest.fn(async () => new Response(null, { headers: { location: `${BASE}/session` } }));
        const pending = setup(fetcher).uploadResumable(meta, () => source, bytes.length, fence);
        await ready; controller.abort("private");
        await expect(pending).rejects.toBeInstanceOf(ExecutionFencedError);
        expect(returned).toHaveBeenCalledTimes(1); expect(fetcher).toHaveBeenCalledTimes(1);
    });
    it("preserves a rejected upload guard while source cleanup is stalled", async () => {
        const { fence } = authority();
        let pulled = false;
        const returned = jest.fn(() => new Promise<IteratorResult<Uint8Array>>(() => undefined));
        const source: AsyncIterable<Uint8Array> = { [Symbol.asyncIterator]: () => ({
            next: async () => { pulled = true; return { done: false, value: Buffer.alloc(CHUNK) }; }, return: returned,
        }) };
        fence.assertActive = async () => { if (pulled) throw new ExecutionFencedError("lease-lost"); };
        const fetcher = jest.fn(async () => new Response(null, { headers: { location: `${BASE}/session` } }));
        const pending = setup(fetcher).uploadResumable(meta, () => source, CHUNK * 2, fence);
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            const outcome = Promise.race([pending, new Promise(resolve => { timer = setTimeout(() => resolve("stalled"), 100); })]);
            await expect(outcome).rejects.toMatchObject({ reason: "lease-lost" });
            expect(returned).toHaveBeenCalledTimes(1); expect(fetcher).toHaveBeenCalledTimes(1);
        } finally { clearTimeout(timer); }
    });
    it("isolates concurrent calls using different fences on the same client", async () => {
        const first = authority(); const second = authority();
        let began!: () => void;
        const ready = new Promise<void>(resolve => { began = resolve; });
        let count = 0;
        const fetcher = jest.fn(async () => {
            if (++count === 1) { began(); return new Promise<Response>(() => undefined); }
            return json({ user: { permissionId: "syntheticUser" } });
        });
        const client = setup(fetcher);
        const pending = client.about(first.fence);
        await ready;
        const other = client.about(second.fence);
        first.controller.abort("private");
        await expect(pending).rejects.toBeInstanceOf(ExecutionFencedError);
        await expect(other).resolves.toEqual({ ok: true, value: { permissionId: "syntheticUser" } });
        expect(fetcher).toHaveBeenCalledTimes(2);
    });
    it("blocks destination entry points, cached folders and reserved IDs before any effect", async () => {
        const { controller, fence } = authority(); controller.abort("private");
        const fetcher = jest.fn(async () => json({}));
        const nodes = ledger({ kind: "folder", fileId: ID, parentFileId: PARENT, status: "created" });
        const destination = new DriveDestination(setup(fetcher), binding);
        for (const call of [
            () => destination.checkRoot(fence), () => destination.ensureFolderChain(key, nodes, fence),
            () => destination.uploadArtifact(input, PARENT, nodes, open, fence),
            () => destination.verifyRemote(ID, expectFile, {}, fence), () => destination.publishJson(key, bytes, nodes, fence),
            () => destination.download(ID, fence), () => collect(destination.listChildren(PARENT, fence)),
        ]) await expect(call()).rejects.toBeInstanceOf(ExecutionFencedError);
        expect(fetcher).not.toHaveBeenCalled(); expect(nodes.reserve).not.toHaveBeenCalled(); expect(nodes.created).not.toHaveBeenCalled();
    });
    it("guards the created-folder fast path even without any remote requests", async () => {
        const { fence } = authority();
        const fetcher = jest.fn(async () => json({}));
        const nodes = ledger({ kind: "folder", fileId: ID, parentFileId: PARENT, status: "created" });
        let checks = 0;
        fence.assertActive = async () => { if (++checks === 3) throw new ExecutionFencedError("lease-lost"); };
        await expect(new DriveDestination(setup(fetcher), binding).ensureFolderChain(key, nodes, fence)).rejects.toMatchObject({ reason: "lease-lost" });
        expect(fetcher).not.toHaveBeenCalled(); expect(nodes.reserve).not.toHaveBeenCalled();
    });
    it("requires authority immediately before a fresh ledger reservation", async () => {
        const { controller, fence } = authority();
        // Abort after the ID body completes: no reservation may begin after this.
        const nodes = ledger();
        const fetcher = jest.fn(async () => json({ ids: [ID] }));
        const client = setup(fetcher);
        fence.assertActive = async () => { if (fetcher.mock.calls.length > 0) controller.abort("private"); };
        await expect(new DriveDestination(client, binding).uploadArtifact(input, PARENT, nodes, open, fence)).rejects.toBeInstanceOf(ExecutionFencedError);
        expect(fetcher).toHaveBeenCalledTimes(1); expect(nodes.reserve).not.toHaveBeenCalled();
    });
    it("propagates abort during remote verification and keeps a reserved identity intact", async () => {
        const { controller, fence } = authority();
        const nodes = ledger({ kind: "file", fileId: ID, parentFileId: PARENT, status: "reserved" });
        let reading!: () => void;
        const ready = new Promise<void>(resolve => { reading = resolve; });
        const cancel = jest.fn();
        const fetcher = jest.fn(async (url: unknown) => String(url).includes("alt=media")
            ? new Response(new ReadableStream({ pull: () => { reading(); }, cancel }))
            : json({ ...remote, sha256Checksum: undefined }));
        const destination = new DriveDestination(setup(fetcher), binding);
        const pending = destination.uploadArtifact(input, PARENT, nodes, open, fence);
        await ready; controller.abort("private");
        await expect(pending).rejects.toBeInstanceOf(ExecutionFencedError);
        expect(nodes.reserve).not.toHaveBeenCalled(); expect(nodes.created).not.toHaveBeenCalled();
        expect(nodes.current(key)?.fileId).toBe(ID); expect(cancel).toHaveBeenCalledTimes(1);
    });
    it("guards a remotely reused file receipt after checksum verification", async () => {
        const { fence } = authority();
        const nodes = ledger({ kind: "file", fileId: ID, parentFileId: PARENT, status: "created" });
        const fetcher = jest.fn(async () => json(remote));
        let checked = false;
        const destination = new DriveDestination(setup(fetcher), binding);
        fence.assertActive = async () => {
            if (checked) throw new ExecutionFencedError("source-changed");
            if (fetcher.mock.calls.length > 0) checked = true;
        };
        await expect(destination.uploadArtifact(input, PARENT, nodes, open, fence)).rejects.toMatchObject({ reason: "source-changed" });
        expect(fetcher).toHaveBeenCalledTimes(1); expect(nodes.reserve).not.toHaveBeenCalled();
    });
    it("retains a lost-response reservation and reuses that ID on the next authorized call", async () => {
        const first = authority(); const next = authority();
        const nodes = ledger();
        let uploaded = false;
        const requested: string[] = [];
        const fetcher = jest.fn(async (url: unknown, init?: RequestInit) => {
            requested.push(`${init?.method} ${String(url)}`);
            if (String(url).includes("generateIds")) return json({ ids: [ID] });
            if (init?.method === "POST") return new Response(null, { headers: { location: `${BASE}/session` } });
            if (init?.method === "PUT") { uploaded = true; first.controller.abort("private lost response"); throw new Error("private"); }
            return uploaded ? json(remote) : new Response(null, { status: 404 });
        });
        const destination = new DriveDestination(setup(fetcher), binding);
        await expect(destination.uploadArtifact(input, PARENT, nodes, open, first.fence)).rejects.toBeInstanceOf(ExecutionFencedError);
        expect(nodes.current(key)).toMatchObject({ fileId: ID, status: "reserved" });
        expect(nodes.created).not.toHaveBeenCalled();
        await expect(destination.uploadArtifact(input, PARENT, nodes, open, next.fence)).resolves.toEqual({ ok: true, value: { fileId: ID } });
        expect(nodes.reserve).toHaveBeenCalledTimes(1); expect(nodes.created).toHaveBeenCalledWith(key, ID);
        expect(requested.filter(request => request.startsWith("PUT"))).toHaveLength(1);
        expect(requested.filter(request => request.includes("generateIds"))).toHaveLength(1);
    });
    it("keeps ordinary dying downloaded bodies as DriveTransferError", async () => {
        const result = await setup(async () => new Response(new ReadableStream({ start: stream => stream.error(new Error("private network")) }))).download(ID);
        if (!result.ok) throw new Error("expected headers");
        await expect(collect(result.value)).rejects.toBeInstanceOf(DriveTransferError);
    });
});
