import { createHash } from "node:crypto";

import { WorkerError } from "domain/eformsign-backup/worker";
import { driveOk } from "infrastructure/eformsign-backup/worker/drive-auth";
import { DriveClient, DriveTransferError, type DriveFile, type DriveResult } from "infrastructure/eformsign-backup/worker/drive-client";

import { driveFaults } from "./helpers/fake-drive-server";
import { bytesFrom, makeDriveClient, startDriveFakes, type DriveHarness } from "./helpers/drive-support";

const CHUNK = 4096;
const SIZE = 10_000; // three chunks: 4096, 4096, 1808
const FILE_MIME = "application/pdf";

function data(length: number): Buffer {
    const out = Buffer.alloc(length);
    for (let index = 0; index < length; index += 1) out[index] = (index * 31 + 7 + (index >> 8)) & 0xff;
    return out;
}
const sha256Of = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

function recording(bytes: Buffer, piece = 1000): { opens: number[]; open: (offset: number) => AsyncIterable<Uint8Array> } {
    const opens: number[] = [];
    return { opens, open: offset => { opens.push(offset); return bytesFrom(bytes, piece)(offset); } };
}

function expectOk<T>(result: DriveResult<T>): T {
    if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.failure)}`);
    return result.value;
}

describe("DriveClient", () => {
    let h: DriveHarness;
    /** A fetch that answers API calls from `reply` and lets the OAuth token endpoint through to the fake. */
    const apiStub = (reply: () => Response): typeof fetch => async (input, init) => (String(input) === h.oauth.tokenUrl ? fetch(input, init) : reply());
    let client: DriveClient;

    beforeEach(async () => {
        h = await startDriveFakes();
        client = makeDriveClient(h, { chunkBytes: CHUNK, requestTimeoutMs: 2000 }).client;
    });
    afterEach(async () => { await h.close(); });

    async function freshId(): Promise<string> { return expectOk(await client.generateIds(1))[0]!; }

    async function upload(bytes: Buffer, source = recording(bytes), name = "doc.pdf"): Promise<{ id: string; result: DriveResult<DriveFile>; opens: number[] }> {
        const id = await freshId();
        const result = await client.uploadResumable(
            { id, name, parentId: h.drive.myDriveId, mimeType: FILE_MIME, appProperties: { bjjKind: "artifact" } }, source.open, bytes.length);
        return { id, result, opens: source.opens };
    }

    describe("calls", () => {
        it("should generate ids, create a folder with a given id, and read it back", async () => {
            const ids = expectOk(await client.generateIds(3));
            expect(ids).toHaveLength(3);
            expect(new Set(ids).size).toBe(3);
            for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{10,128}$/);
            const folder = expectOk(await client.createFolder({ id: ids[0]!, name: "eformsign", parentId: h.drive.myDriveId, appProperties: { bjjBindingId: "b1" } }));
            expect(folder).toEqual({
                id: ids[0], name: "eformsign", mimeType: "application/vnd.google-apps.folder", parents: [h.drive.myDriveId],
                trashed: false, size: null, sha256Checksum: null, appProperties: { bjjBindingId: "b1" },
            });
            expect(expectOk(await client.getFile(ids[0]!))).toEqual(folder);
        });

        it("should report a taken id on create as a 409 and leave the first folder alone", async () => {
            const id = await freshId();
            expectOk(await client.createFolder({ id, name: "one", parentId: h.drive.myDriveId }));
            const second = await client.createFolder({ id, name: "two", parentId: h.drive.myDriveId });
            expect(second).toEqual({ ok: false, failure: { kind: "http", httpStatus: 409, reason: "duplicate", retryAfterSeconds: null } });
            expect(h.drive.node(id)?.name).toBe("one");
        });

        it("should resolve root, answer ok(null) for an unknown id and show a trashed file as trashed", async () => {
            expect(expectOk(await client.getFile("root"))?.id).toBe(h.drive.myDriveId);
            expect(expectOk(await client.getFile("NoSuchFileId0000000"))).toBeNull();
            const id = await freshId();
            expectOk(await client.createFolder({ id, name: "gone", parentId: h.drive.myDriveId }));
            h.drive.trash(id);
            expect(expectOk(await client.getFile(id))?.trashed).toBe(true);
        });

        it("should list the untrashed children page by page", async () => {
            h.drive.pageSizeCap = 2;
            const ids = expectOk(await client.generateIds(5));
            for (const [index, id] of ids.entries()) expectOk(await client.createFolder({ id, name: `f${index}`, parentId: h.drive.myDriveId }));
            h.drive.trash(ids[4]!);
            const seen: string[] = [];
            let token: string | undefined;
            let pages = 0;
            do {
                const page = expectOk(await client.listChildren(h.drive.myDriveId, token));
                seen.push(...page.files.map(file => file.name));
                token = page.nextPageToken ?? undefined;
                pages += 1;
            } while (token);
            expect(seen).toEqual(["f0", "f1", "f2", "f3"]);
            expect(pages).toBe(2);
            expect(h.drive.listCalls).toBe(2);
        });

        it("should find folders by app property across pages and skip trashed ones", async () => {
            h.drive.pageSizeCap = 2;
            const ids = expectOk(await client.generateIds(4));
            for (const [index, id] of ids.entries()) {
                expectOk(await client.createFolder({ id, name: `root${index}`, parentId: h.drive.myDriveId, appProperties: { bjjInstallationId: index === 3 ? "other" : "inst-1" } }));
            }
            h.drive.trash(ids[1]!);
            const found = expectOk(await client.findFolders({ appPropertyKey: "bjjInstallationId", appPropertyValue: "inst-1" }));
            expect(found.map(file => file.name)).toEqual(["root0", "root2"]);
        });

        it("should return the permission id", async () => {
            expect(expectOk(await client.about())).toEqual({ permissionId: h.drive.permissionId });
        });

        it("should download the bytes of a file and refuse a folder", async () => {
            const bytes = data(SIZE);
            const { id } = await upload(bytes);
            const parts: Buffer[] = [];
            for await (const part of expectOk(await client.download(id))) parts.push(Buffer.from(part));
            expect(Buffer.concat(parts).equals(bytes)).toBe(true);
            const folder = await freshId();
            expectOk(await client.createFolder({ id: folder, name: "d", parentId: h.drive.myDriveId }));
            expect(await client.download(folder)).toMatchObject({ ok: false, failure: { httpStatus: 403, reason: "fileNotDownloadable" } });
            expect(await client.download("NoSuchFileId0000000")).toMatchObject({ ok: false, failure: { httpStatus: 404 } });
        });

        it("should refuse ids that are not plain identifiers before any request", async () => {
            await expect(client.getFile("../etc/passwd")).rejects.toBeInstanceOf(WorkerError);
            await expect(client.listChildren("a' or '1'='1")).rejects.toBeInstanceOf(WorkerError);
            expect(h.drive.requests).toHaveLength(0);
        });
    });

    describe("T18: resumable upload", () => {
        it("should upload in chunks and end with the same bytes, size and sha256", async () => {
            const bytes = data(SIZE);
            const { id, result } = await upload(bytes);
            const file = expectOk(result);
            expect(file).toMatchObject({ id, name: "doc.pdf", mimeType: FILE_MIME, parents: [h.drive.myDriveId], size: SIZE, trashed: false, appProperties: { bjjKind: "artifact" } });
            expect(file.sha256Checksum).toBe(sha256Of(bytes));
            expect(sha256Of(h.drive.bytesOf(id)!)).toBe(sha256Of(bytes));
            expect(h.drive.sessionsStarted).toBe(1);
            expect(h.drive.creates).toBe(1);
            expect(h.drive.bytesReceived).toBe(SIZE);
            expect(h.drive.requests.filter(request => request.method === "PUT")).toHaveLength(3);
        });

        it("should upload a file of exactly one chunk and an empty file", async () => {
            const one = data(CHUNK);
            expect(expectOk((await upload(one)).result).size).toBe(CHUNK);
            const empty = await upload(Buffer.alloc(0), recording(Buffer.alloc(0)), "empty.pdf");
            expect(expectOk(empty.result).size).toBe(0);
            expect(h.drive.bytesOf(empty.id)!.length).toBe(0);
        });

        it("should resume at N+1 when a chunk's answer is lost and the probe answers 308 with Range", async () => {
            const bytes = data(SIZE);
            h.drive.addFault({ route: "uploadPut", times: 1, match: request => request.offset === CHUNK, action: driveFaults.lostResponse() });
            const { id, result, opens } = await upload(bytes);
            expectOk(result);
            expect(sha256Of(h.drive.bytesOf(id)!)).toBe(sha256Of(bytes));
            expect(h.drive.bytesReceived).toBe(SIZE); // nothing was sent twice
            expect(opens).toEqual([0]); // the open stream already stood at the server's offset
            expect(h.drive.requests.filter(request => request.method === "PUT")).toHaveLength(4); // 3 chunks + 1 probe
            expect(h.drive.sessionsStarted).toBe(1);
        });

        it("should re-open the source at the server's offset when a chunk never arrived", async () => {
            const bytes = data(SIZE);
            h.drive.addFault({ route: "uploadPut", times: 1, match: request => request.offset === CHUNK, action: driveFaults.dropRequest() });
            const { id, result, opens } = await upload(bytes);
            expectOk(result);
            expect(sha256Of(h.drive.bytesOf(id)!)).toBe(sha256Of(bytes));
            expect(opens).toEqual([0, CHUNK]);
            expect(h.drive.bytesReceived).toBe(SIZE);
        });

        it("should finish when the answer to the last chunk is lost and the probe finds the file complete", async () => {
            const bytes = data(SIZE);
            h.drive.addFault({ route: "uploadPut", times: 1, match: request => request.offset === 2 * CHUNK, action: driveFaults.lostResponse() });
            const { id, result } = await upload(bytes);
            expect(expectOk(result).id).toBe(id);
            expect(h.drive.creates).toBe(1);
            expect(h.drive.uploadsCompleted).toBe(1);
            expect(h.drive.sessionsStarted).toBe(1);
            expect(sha256Of(h.drive.bytesOf(id)!)).toBe(sha256Of(bytes));
        });

        it("should restart at offset 0 when a 308 after a nonzero offset carries no Range", async () => {
            const bytes = data(SIZE);
            h.drive.addFault({ route: "uploadPut", times: 1, match: request => (request.offset ?? 0) > 0, action: driveFaults.dropRangeHeader() });
            const { id, result, opens } = await upload(bytes);
            expectOk(result);
            expect(sha256Of(h.drive.bytesOf(id)!)).toBe(sha256Of(bytes));
            expect(opens).toEqual([0, 0]);
            expect(h.drive.bytesReceived).toBe(CHUNK + CHUNK + SIZE); // chunk 1, chunk 2 (then forgotten), everything again
            expect(h.drive.sessionsStarted).toBe(1);
        });

        it.each([404, 410] as const)("should start a new session with the same id when the session answers %i", async status => {
            const bytes = data(SIZE);
            h.drive.addFault({ route: "uploadPut", times: 1, match: request => request.offset === CHUNK, action: driveFaults.expireSession(status) });
            const { id, result } = await upload(bytes, recording(bytes), "once.pdf");
            expect(expectOk(result).id).toBe(id);
            expect(h.drive.sessionsStarted).toBe(2);
            expect(h.drive.creates).toBe(1);
            expect(h.drive.children(h.drive.myDriveId).filter(node => node.name === "once.pdf")).toHaveLength(1);
            expect(sha256Of(h.drive.bytesOf(id)!)).toBe(sha256Of(bytes));
        });

        it("should give up after three expired sessions and create nothing", async () => {
            const bytes = data(SIZE);
            h.drive.addFault({ route: "uploadPut", times: 3, action: driveFaults.expireSession(404) });
            const { result } = await upload(bytes);
            expect(result.ok).toBe(false);
            expect(h.drive.sessionsStarted).toBe(3);
            expect(h.drive.fileCount()).toBe(0);
        });

        it("should return a 409 from the session start for the caller to compare, with no session left", async () => {
            const id = await freshId();
            h.drive.seed({ id, name: "taken.pdf", mimeType: FILE_MIME, bytes: Buffer.from("x") });
            const bytes = data(SIZE);
            const result = await client.uploadResumable({ id, name: "doc.pdf", parentId: h.drive.myDriveId, mimeType: FILE_MIME }, recording(bytes).open, SIZE);
            expect(result).toEqual({ ok: false, failure: { kind: "http", httpStatus: 409, reason: "duplicate", retryAfterSeconds: null } });
            expect(h.drive.sessionsStarted).toBe(0);
            expect(h.drive.bytesOf(id)!.toString()).toBe("x");
        });

        it("should refresh the token once on a 401 and repeat the request", async () => {
            expectOk(await client.about());
            expect(h.oauth.tokenRequests).toBe(1);
            h.oauth.expireAccessTokens();
            const bytes = data(SIZE);
            expectOk((await upload(bytes)).result);
            expect(h.oauth.tokenRequests).toBe(2);
        });

        it("should return a rejected refresh unchanged and an API 401 after a good refresh as http 401", async () => {
            expectOk(await client.about());
            h.drive.revokeAccess(); // dead refresh token, every access token refused
            expect(await client.getFile("root")).toEqual({
                ok: false, failure: { kind: "token-rejected", httpStatus: 400, reason: "invalid_grant", retryAfterSeconds: null },
            });
            h.oauth.restore();
            h.drive.addFault({ route: "get", action: driveFaults.status(401, "authError") });
            const requestsBefore = h.oauth.tokenRequests;
            expect(await client.getFile("root")).toEqual({ ok: false, failure: { kind: "http", httpStatus: 401, reason: "authError", retryAfterSeconds: null } });
            expect(h.oauth.tokenRequests).toBe(requestsBefore + 2); // the lazy refresh of the dropped token, then ONE forced refresh: no loop
        });

        it("should keep the session URL on the upload origin and never send the token elsewhere", async () => {
            const urls: string[] = [];
            const hostile = makeDriveClient(h, {
                chunkBytes: CHUNK,
                fetchImpl: async (input, init) => {
                    urls.push(String(input));
                    const response = await fetch(input, init);
                    if (response.headers.get("location") === null) return response;
                    const headers = new Headers(response.headers);
                    headers.set("location", "http://evil.invalid/upload?upload_id=stolen");
                    return new Response(null, { status: response.status, headers });
                },
            }).client;
            const id = expectOk(await hostile.generateIds(1))[0]!;
            const bytes = data(SIZE);
            const result = await hostile.uploadResumable({ id, name: "doc.pdf", parentId: h.drive.myDriveId, mimeType: FILE_MIME }, recording(bytes).open, SIZE);
            expect(result).toEqual({ ok: false, failure: { kind: "http", httpStatus: 502, reason: null, retryAfterSeconds: null } });
            expect(urls.some(url => url.includes("evil.invalid"))).toBe(false);
        });

        it("should send no conversion or OCR parameter on any call", async () => {
            const urls: string[] = [];
            const spy = makeDriveClient(h, { chunkBytes: CHUNK, fetchImpl: async (input, init) => { urls.push(String(input)); return fetch(input, init); } }).client;
            const id = expectOk(await spy.generateIds(1))[0]!;
            const bytes = data(SIZE);
            expectOk(await spy.uploadResumable({ id, name: "doc.pdf", parentId: h.drive.myDriveId, mimeType: FILE_MIME }, recording(bytes).open, SIZE));
            expectOk(await spy.getFile(id));
            for await (const part of expectOk(await spy.download(id))) void part;
            expect(urls.length).toBeGreaterThan(5);
            for (const url of urls) expect(url).not.toMatch(/convert|ocr/i);
        });

        it("should use the upload base for the upload and the api base for everything else", async () => {
            const bytes = data(SIZE);
            expectOk((await upload(bytes)).result);
            const uploads = h.drive.requests.filter(request => request.path.startsWith("/up/"));
            const api = h.drive.requests.filter(request => request.path.startsWith("/api/"));
            expect(uploads.length).toBe(4); // start + 3 chunks
            expect(api.length + uploads.length).toBe(h.drive.requests.length);
        });

        it("should fail with artifact-integrity, before the file is completed, when the source is short or long", async () => {
            const bytes = data(SIZE);
            const short = await upload(bytes, { opens: [], open: bytesFrom(bytes.subarray(0, SIZE - 1)) }).catch((e: unknown) => e);
            expect(short).toBeInstanceOf(WorkerError);
            expect((short as WorkerError).reasonCode).toBe("artifact-integrity");
            const long = await upload(bytes, { opens: [], open: bytesFrom(Buffer.concat([bytes, Buffer.from("x")])) }).catch((e: unknown) => e);
            expect((long as WorkerError).reasonCode).toBe("artifact-integrity");
            expect(h.drive.fileCount()).toBe(0);
        });

        it("should let a failure of the source propagate and create nothing", async () => {
            const boom = new WorkerError("artifact-integrity");
            const source = {
                opens: [] as number[],
                open: (): AsyncIterable<Uint8Array> => (async function* () { yield data(CHUNK + 10); throw boom; })(),
            };
            const outcome = await upload(data(SIZE), source).catch((e: unknown) => e);
            expect(outcome).toBe(boom);
            expect(h.drive.fileCount()).toBe(0);
        });
    });

    describe("T23: failure facts", () => {
        it("should carry Retry-After seconds on a 429", async () => {
            h.drive.addFault({ route: "get", times: 1, action: driveFaults.status(429, "rateLimitExceeded", 17) });
            expect(await client.getFile("root")).toEqual({ ok: false, failure: { kind: "http", httpStatus: 429, reason: "rateLimitExceeded", retryAfterSeconds: 17 } });
        });

        it("should read Retry-After given as an HTTP date", async () => {
            h.drive.addFault({ route: "get", times: 1, action: driveFaults.status(503, "backendError", new Date(Date.now() + 120_000).toUTCString()) });
            const result = await client.getFile("root");
            expect(result.ok).toBe(false);
            const seconds = !result.ok ? result.failure.retryAfterSeconds : null;
            expect(seconds).toBeGreaterThanOrEqual(118);
            expect(seconds).toBeLessThanOrEqual(121);
        });

        it.each(["userRateLimitExceeded", "rateLimitExceeded", "sharingRateLimitExceeded", "storageQuotaExceeded", "insufficientFilePermissions"])(
            "should parse the 403 reason %s", async reason => {
                h.drive.addFault({ route: "list", times: 1, action: driveFaults.status(403, reason) });
                expect(await client.listChildren(h.drive.myDriveId)).toEqual({ ok: false, failure: { kind: "http", httpStatus: 403, reason, retryAfterSeconds: null } });
            });

        it("should report a 5xx with its status and reason", async () => {
            h.drive.addFault({ route: "about", times: 1, action: driveFaults.status(503, "backendError") });
            expect(await client.about()).toEqual({ ok: false, failure: { kind: "http", httpStatus: 503, reason: "backendError", retryAfterSeconds: null } });
        });

        it("should drop a reason that is not a plain word", async () => {
            h.drive.addFault({ route: "about", times: 1, action: driveFaults.status(400, "not a reason; DROP TABLE") });
            expect(await client.about()).toEqual({ ok: false, failure: { kind: "http", httpStatus: 400, reason: null, retryAfterSeconds: null } });
        });

        it("should report a dropped connection as network and an unanswered request as timeout", async () => {
            h.drive.addFault({ route: "get", times: 1, action: driveFaults.dropRequest() });
            expect(await client.getFile("root")).toEqual({ ok: false, failure: { kind: "network", httpStatus: null, reason: null, retryAfterSeconds: null } });
            const quick = makeDriveClient(h, { requestTimeoutMs: 100 }).client;
            h.drive.addFault({ route: "get", times: 1, action: driveFaults.stall(400) });
            expect(await quick.getFile("root")).toEqual({ ok: false, failure: { kind: "timeout", httpStatus: null, reason: null, retryAfterSeconds: null } });
        });

        it("should report an unreachable server as network", async () => {
            const lonely = new DriveClient({
                apiBaseUrl: "http://127.0.0.1:1/api", uploadBaseUrl: "http://127.0.0.1:1/up", tokens: { get: async () => driveOk("synthetic-token") },
                requestTimeoutMs: 500, chunkBytes: CHUNK,
            });
            expect(await lonely.getFile("root")).toEqual({ ok: false, failure: { kind: "network", httpStatus: null, reason: null, retryAfterSeconds: null } });
        });

        it("should answer with a transient fault, not a crash, for a success body that is not a file", async () => {
            const odd = makeDriveClient(h, { fetchImpl: apiStub(() => new Response("<html>", { status: 200 })) }).client;
            expect(await odd.about()).toEqual({ ok: false, failure: { kind: "http", httpStatus: 502, reason: null, retryAfterSeconds: null } });
        });

        it("should throw DriveTransferError with facts when a download body dies, and time out an idle one", async () => {
            const dying = makeDriveClient(h, {
                fetchImpl: apiStub(() => new Response(new ReadableStream<Uint8Array>({
                    start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); },
                    pull(controller) { controller.error(new Error("socket reset to 10.0.0.1:443")); },
                }), { status: 200 })),
            }).client;
            const stream = expectOk(await dying.download("SomeFileId0000000"));
            const error = await (async () => { for await (const part of stream) void part; })().catch((e: unknown) => e);
            expect(error).toBeInstanceOf(DriveTransferError);
            expect((error as DriveTransferError).failure).toEqual({ kind: "network", httpStatus: null, reason: null, retryAfterSeconds: null });
            expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain("10.0.0.1");

            const idle = makeDriveClient(h, {
                requestTimeoutMs: 80,
                fetchImpl: apiStub(() => new Response(new ReadableStream<Uint8Array>({ start() { /* never delivers */ } }), { status: 200 })),
            }).client;
            const stalled = expectOk(await idle.download("SomeFileId0000000"));
            const timeout = await (async () => { for await (const part of stalled) void part; })().catch((e: unknown) => e);
            expect((timeout as DriveTransferError).failure.kind).toBe("timeout");
        });
    });

    describe("V11: nothing secret in a failure", () => {
        const CANARY = "CANARY-V11-9d41c07e";

        it("should keep the canary, the session URL and every credential out of every result and every output", async () => {
            const writes: string[] = [];
            const spies = [
                jest.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => { writes.push(String(chunk)); return true; }),
                jest.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => { writes.push(String(chunk)); return true; }),
                jest.spyOn(console, "log").mockImplementation((...args: unknown[]) => { writes.push(args.join(" ")); }),
                jest.spyOn(console, "error").mockImplementation((...args: unknown[]) => { writes.push(args.join(" ")); }),
                jest.spyOn(console, "warn").mockImplementation((...args: unknown[]) => { writes.push(args.join(" ")); }),
            ];
            const results: unknown[] = [];
            try {
                const bytes = data(SIZE);
                const id = await freshId();
                const meta = { id, name: "doc.pdf", parentId: h.drive.myDriveId, mimeType: FILE_MIME };
                h.drive.addFault({ route: "*", action: driveFaults.canary(CANARY) });
                h.oauth.canary = CANARY;

                // Successful calls that carry the canary in headers, body and the session URL.
                results.push(await client.about(), await client.getFile("root"), await client.uploadResumable(meta, recording(bytes).open, SIZE));
                const fileId = await freshId();

                // Failing calls: the canary rides on the error body, WWW-Authenticate and Location.
                const failing = h.drive.addFault({ route: "*", action: driveFaults.status(500, "backendError") });
                results.push(
                    await client.generateIds(2), await client.createFolder({ id: fileId, name: "d", parentId: h.drive.myDriveId }),
                    await client.getFile(id), await client.listChildren(h.drive.myDriveId), await client.about(),
                    await client.findFolders({ appPropertyKey: "k", appPropertyValue: "v" }), await client.download(id),
                    await client.uploadResumable({ ...meta, id: fileId }, recording(bytes).open, SIZE),
                );
                h.drive.faults.splice(h.drive.faults.indexOf(failing), 1);
                h.drive.addFault({ route: "uploadPut", action: driveFaults.status(503, "backendError") });
                results.push(await client.uploadResumable({ ...meta, id: fileId }, recording(bytes).open, SIZE));
                h.drive.clearFaults();
                h.drive.addFault({ route: "*", action: driveFaults.canary(CANARY) });
                h.drive.addFault({ route: "get", action: driveFaults.status(403, "insufficientFilePermissions") });
                results.push(await client.getFile(id));

                // The refresh token dies: the OAuth failure carries the canary too.
                h.oauth.revoke();
                results.push(await client.about(), await client.getFile("root"));
            } finally {
                for (const spy of spies) spy.mockRestore();
            }
            const dump = JSON.stringify(results);
            const forbidden = [
                CANARY, "upload_id", "session-0", "fake-access-token", h.oauth.refreshToken, h.oauth.clientSecret, h.oauth.clientId,
                "127.0.0.1", "Bearer", "fake error",
            ];
            for (const text of forbidden) expect(dump).not.toContain(text);
            expect(results.filter(result => (result as DriveResult<unknown>).ok === false).length).toBeGreaterThanOrEqual(10);
            expect(writes.join("\n")).toBe("");
        });
    });
});
