import { createHash, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import http from "node:http";
import path from "node:path";

import { WorkerError } from "domain/eformsign-backup/worker";
import { ExportClient, ExportFailure, readTokenFile } from "infrastructure/eformsign-backup/worker/export-client";

import { FakeExportServer, sendJson } from "./helpers/destination-fake-export-server";
import { makeTestBase, sha256Of } from "./helpers/destination-support";

const TOKEN = `ebx_${randomBytes(32).toString("base64url")}`;
const SNAPSHOT_ID = "7c1f6f0e-2a3b-4c5d-8e9f-0a1b2c3d4e5f";
const IDENTITY = "a".repeat(64);
const COUNTS = { total: 2, inaccessible: 0, unknownTemplate: 0, policyPending: 0, excludedByPolicy: 1, included: 1 };
const SNAPSHOT = {
    snapshotId: SNAPSHOT_ID, status: "ready", companyId: "C001", scopeRevision: "2026-10-19-company-all-docs",
    policyRevision: "2026-10-18-completed-pdf-audit", createdAt: "2026-10-19T00:00:00.000Z",
    readyAt: "2026-10-19T00:00:00.000Z", expiresAt: "2026-10-20T00:00:00.000Z", counts: COUNTS,
    coverage: { status: "unverified", reasonCode: "collection-receipt-unavailable" }, backupComplete: false,
};
const CANDIDATE = {
    ordinal: 1, documentId: "D001", classification: "included", reasons: [], statusType: "003", documentKind: "contract",
    metadataRevision: "b".repeat(64),
    artifacts: [{ fileType: "document", artifactIdentity: IDENTITY, sha256: "c".repeat(64), byteSize: 10 }],
};

describe("readTokenFile", () => {
    let base: string;
    beforeAll(async () => { base = await makeTestBase(); });
    afterAll(async () => { await fs.rm(base, { recursive: true, force: true }); });
    async function tokenFile(name: string, content: string, mode = 0o600): Promise<string> {
        const file = path.join(base, name);
        await fs.writeFile(file, content, { mode });
        await fs.chmod(file, mode);
        return file;
    }

    it("should return the token, with or without one trailing newline", async () => {
        expect(await readTokenFile(await tokenFile("ok1", TOKEN))).toBe(TOKEN);
        expect(await readTokenFile(await tokenFile("ok2", `${TOKEN}\n`))).toBe(TOKEN);
    });
    it.each([
        ["mode 0644", TOKEN, 0o644],
        ["mode 0640", TOKEN, 0o640],
        ["mode 0400", TOKEN, 0o400],
        ["wrong prefix", TOKEN.replace("ebx_", "abc_"), 0o600],
        ["short token", TOKEN.slice(0, -1), 0o600],
        ["long token", `${TOKEN}A`, 0o600],
        ["two newlines", `${TOKEN}\n\n`, 0o600],
        ["leading space", ` ${TOKEN}`, 0o600],
        ["empty", "", 0o600],
    ])("should reject %s with only a reason code", async (name, content, mode) => {
        const file = await tokenFile(`bad-${name.replace(/\W/g, "")}`, content, mode);
        const error = await readTokenFile(file).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(WorkerError);
        expect((error as WorkerError).reasonCode).toBe("token-file-invalid");
        const dump = JSON.stringify(error, Object.getOwnPropertyNames(error));
        expect(dump).not.toContain(TOKEN);
        expect(dump).not.toContain(base);
    });
    it("should reject a symlink, a directory, a relative path and a missing file", async () => {
        const real = await tokenFile("real", TOKEN);
        await fs.symlink(real, path.join(base, "link"));
        await fs.mkdir(path.join(base, "dir"), { mode: 0o600 });
        for (const file of [path.join(base, "link"), path.join(base, "dir"), "relative-token", path.join(base, "missing")]) {
            await expect(readTokenFile(file)).rejects.toMatchObject({ reasonCode: "token-file-invalid" });
        }
    });
});

describe("ExportClient base URL", () => {
    const make = (baseUrl: string) => new ExportClient({ baseUrl, token: TOKEN, companyId: "C001", requestTimeoutMs: 1000 });
    it.each([
        "https://backup.example.com/internal/eformsign-backup/v1", "http://127.0.0.1:8080/x", "http://localhost:3000/x", "http://[::1]:3000/x",
    ])("should accept %s", url => { expect(() => make(url)).not.toThrow(); });
    it.each([
        "http://example.com/internal/eformsign-backup/v1", "http://127.0.0.1.example.com/x", "http://10.0.0.5/x", "ftp://127.0.0.1/x",
        "file:///etc/passwd", "not a url", "", "https://user:pass@example.com/x", "https://example.com/x?a=b", "https://example.com/x#frag",
    ])("should reject %j with export-base-url-invalid", url => {
        let error: unknown;
        try { make(url); } catch (e) { error = e; }
        expect(error).toBeInstanceOf(WorkerError);
        expect((error as WorkerError).reasonCode).toBe("export-base-url-invalid");
        expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain("pass");
    });
});

describe("ExportClient against a fake export server", () => {
    let server: FakeExportServer;
    let client: ExportClient;
    beforeEach(async () => {
        server = new FakeExportServer();
        const baseUrl = await server.start();
        client = new ExportClient({ baseUrl, token: TOKEN, companyId: "C001", requestTimeoutMs: 2000 });
    });
    afterEach(async () => { await server.stop(); });

    function dumpOf(error: unknown): string {
        return `${String(error)}\n${(error as Error).stack ?? ""}\n${JSON.stringify(error, Object.getOwnPropertyNames(error))}`;
    }

    describe("requests", () => {
        it("should POST the snapshot with bearer auth, idempotency key and the fixed body", async () => {
            server.handler = (_req, res) => sendJson(res, 202, SNAPSHOT);
            const snapshot = await client.createSnapshot("run-key-1");
            expect(snapshot.snapshotId).toBe(SNAPSHOT_ID);
            expect(snapshot.status).toBe("ready");
            expect(snapshot.counts).toEqual(COUNTS);
            const [request] = server.requests;
            expect(request).toMatchObject({ method: "POST", url: "/internal/eformsign-backup/v1/snapshots" });
            expect(request!.headers["authorization"]).toBe(`Bearer ${TOKEN}`);
            expect(request!.headers["idempotency-key"]).toBe("run-key-1");
            expect(request!.headers["content-type"]).toContain("application/json");
            expect(JSON.parse(request!.body)).toEqual({
                companyId: "C001", scopeRevision: "2026-10-19-company-all-docs", policyRevision: "2026-10-18-completed-pdf-audit",
            });
        });
        it("should GET a snapshot without an idempotency key", async () => {
            server.handler = (_req, res) => sendJson(res, 200, SNAPSHOT);
            expect((await client.getSnapshot(SNAPSHOT_ID)).snapshotId).toBe(SNAPSHOT_ID);
            expect(server.requests[0]).toMatchObject({ method: "GET", url: `/internal/eformsign-backup/v1/snapshots/${SNAPSHOT_ID}` });
            expect(server.requests[0]!.headers["idempotency-key"]).toBeUndefined();
        });
        it("should list candidates with limit 100 and an encoded cursor", async () => {
            server.handler = (_req, res) => sendJson(res, 200, { snapshotId: SNAPSHOT_ID, items: [CANDIDATE], nextCursor: "abc_-" });
            const page = await client.listCandidates(SNAPSHOT_ID, null);
            expect(page.items).toHaveLength(1);
            expect(page.items[0]!.artifacts[0]!.byteSize).toBe(10);
            expect(page.nextCursor).toBe("abc_-");
            expect(server.requests[0]!.url).toBe(`/internal/eformsign-backup/v1/snapshots/${SNAPSHOT_ID}/candidates?limit=100`);
            await client.listCandidates(SNAPSHOT_ID, "a+b/c=");
            expect(server.requests[1]!.url).toContain(`cursor=${encodeURIComponent("a+b/c=")}&limit=100`);
        });
        it.each([
            ["snapshot without status", (res: http.ServerResponse) => sendJson(res, 200, { ...SNAPSHOT, status: "weird" })],
            ["snapshot not an object", (res: http.ServerResponse) => sendJson(res, 200, [])],
            ["not JSON", (res: http.ServerResponse) => { res.writeHead(200, { "Content-Type": "text/plain" }); res.end("hello"); }],
            ["wrong counts type", (res: http.ServerResponse) => sendJson(res, 200, { ...SNAPSHOT, counts: { total: "x" } })],
        ])("should reject a 200 body that is %s with export-response-invalid", async (_name, respond) => {
            server.handler = (_req, res) => respond(res);
            const error = await client.getSnapshot(SNAPSHOT_ID).catch((e: unknown) => e);
            expect(error).toBeInstanceOf(WorkerError);
            expect((error as WorkerError).reasonCode).toBe("export-response-invalid");
        });
        it("should reject an invalid candidate item", async () => {
            server.handler = (_req, res) => sendJson(res, 200, {
                snapshotId: SNAPSHOT_ID, items: [{ ...CANDIDATE, metadataRevision: "short" }], nextCursor: null,
            });
            await expect(client.listCandidates(SNAPSHOT_ID, null)).rejects.toMatchObject({ reasonCode: "export-response-invalid" });
        });
        it("should not follow a redirect with the token", async () => {
            server.handler = (_req, res) => { res.writeHead(302, { Location: "http://127.0.0.1:1/steal" }); res.end(); };
            const error = await client.getSnapshot(SNAPSHOT_ID).catch((e: unknown) => e);
            expect(error).toBeInstanceOf(ExportFailure);
            expect(server.requests).toHaveLength(1);
        });
    });

    describe("error mapping (contract section 5)", () => {
        const rows: Array<[string, number, boolean, number | undefined]> = [
            ["UNAUTHORIZED", 401, false, undefined], ["NOT_FOUND", 404, false, undefined],
            ["INVALID_REQUEST", 400, false, undefined], ["INVALID_CURSOR", 400, false, undefined],
            ["CURSOR_PARAMETER_MISMATCH", 400, false, undefined], ["UNSUPPORTED_REVISION", 400, false, undefined],
            ["IDEMPOTENCY_CONFLICT", 409, false, undefined], ["SNAPSHOT_NOT_READY", 409, true, undefined],
            ["SNAPSHOT_FAILED", 409, false, undefined], ["SNAPSHOT_EXPIRED", 410, false, undefined],
            ["ARTIFACT_PENDING", 409, true, 60], ["MIRROR_MISSING", 409, true, undefined],
            ["VERSION_CHANGED", 409, false, undefined], ["ARTIFACT_TOO_LARGE", 409, false, undefined],
            ["CONSISTENCY_CONFLICT", 409, false, undefined], ["SOURCE_REMOVED", 410, false, undefined],
            ["RATE_LIMITED", 429, true, 5], ["EXPORT_UNAVAILABLE", 503, true, undefined], ["INTERNAL", 500, true, undefined],
        ];
        it.each(rows)("should map %s (HTTP %i) on an artifact download", async (code, status, retryable, retryAfter) => {
            server.handler = (_req, res) => sendJson(res, status, {
                code, retryable, requestId: "rid-1", ...(retryAfter === undefined ? {} : { retryAfterSeconds: retryAfter }),
                detail: "SECRET-BODY-TEXT customer name",
            });
            const error = await client.openArtifact(SNAPSHOT_ID, { artifactIdentity: IDENTITY, sha256: "c".repeat(64), byteLength: 10 })
                .catch((e: unknown) => e);
            expect(error).toBeInstanceOf(ExportFailure);
            const failure = error as ExportFailure;
            expect({ httpStatus: failure.httpStatus, code: failure.code, retryable: failure.retryable, retryAfterSeconds: failure.retryAfterSeconds })
                .toEqual({ httpStatus: status, code, retryable, retryAfterSeconds: retryAfter ?? null });
            const dump = dumpOf(error);
            for (const secret of ["SECRET-BODY-TEXT", TOKEN, IDENTITY, "/internal/eformsign-backup", "127.0.0.1", SNAPSHOT_ID]) {
                expect(dump).not.toContain(secret);
            }
        });
        it("should map the same codes on the JSON routes", async () => {
            server.handler = (_req, res) => sendJson(res, 429, { code: "RATE_LIMITED", retryable: true, requestId: "r", retryAfterSeconds: 5 });
            for (const call of [() => client.createSnapshot("k"), () => client.getSnapshot(SNAPSHOT_ID), () => client.listCandidates(SNAPSHOT_ID, null)]) {
                await expect(call()).rejects.toMatchObject({ httpStatus: 429, code: "RATE_LIMITED", retryAfterSeconds: 5 });
            }
        });
        it("should use the Retry-After header when the body has no retryAfterSeconds", async () => {
            server.handler = (_req, res) => sendJson(res, 429, { code: "RATE_LIMITED", retryable: true, requestId: "r" }, { "Retry-After": "12" });
            await expect(client.getSnapshot(SNAPSHOT_ID)).rejects.toMatchObject({ retryAfterSeconds: 12 });
        });
        it("should not trust an unparseable error body: code UNKNOWN_ERROR, retryable by status class", async () => {
            server.handler = (_req, res) => { res.writeHead(502, { "Content-Type": "text/html" }); res.end("<html>SECRET-HTML</html>"); };
            const error = await client.getSnapshot(SNAPSHOT_ID).catch((e: unknown) => e) as ExportFailure;
            expect(error).toMatchObject({ httpStatus: 502, code: "UNKNOWN_ERROR", retryable: true, retryAfterSeconds: null });
            expect(dumpOf(error)).not.toContain("SECRET-HTML");
            server.handler = (_req, res) => { res.writeHead(418); res.end("teapot"); };
            expect(await client.getSnapshot(SNAPSHOT_ID).catch((e: unknown) => e)).toMatchObject({ httpStatus: 418, retryable: false });
        });
        it("should reject an error code that is not an upper-case word", async () => {
            server.handler = (_req, res) => sendJson(res, 400, { code: "bad code <script>", retryable: false, requestId: "r" });
            const error = await client.getSnapshot(SNAPSHOT_ID).catch((e: unknown) => e) as ExportFailure;
            expect(error.code).toBe("UNKNOWN_ERROR");
            expect(dumpOf(error)).not.toContain("script");
        });
        it("should report a refused connection as a NETWORK failure without the URL or token", async () => {
            await server.stop();
            const error = await client.getSnapshot(SNAPSHOT_ID).catch((e: unknown) => e) as ExportFailure;
            expect(error).toBeInstanceOf(ExportFailure);
            expect(error).toMatchObject({ httpStatus: 0, code: "NETWORK", retryable: true, retryAfterSeconds: null });
            const dump = dumpOf(error);
            expect(dump).not.toContain(TOKEN);
            expect(dump).not.toContain("127.0.0.1");
            server = new FakeExportServer(); // keep afterEach's stop() valid
            await server.start();
        });
        it("should time out a hung response as a NETWORK failure", async () => {
            server.handler = () => new Promise(() => undefined);
            const quick = new ExportClient({ baseUrl: await restartedBase(server), token: TOKEN, companyId: "C001", requestTimeoutMs: 150 });
            const error = await quick.getSnapshot(SNAPSHOT_ID).catch((e: unknown) => e) as ExportFailure;
            expect(error).toMatchObject({ httpStatus: 0, code: "NETWORK", retryable: true });
            expect(dumpOf(error)).not.toContain(TOKEN);
        });
    });

    describe("openArtifact", () => {
        const pdfBytes = Buffer.from("synthetic artifact bytes ".repeat(100));
        const request = { artifactIdentity: IDENTITY, sha256: sha256Of(pdfBytes), byteLength: pdfBytes.length };
        function serve(overrides: { headers?: Record<string, string | undefined>; body?: Buffer; status?: number } = {}) {
            server.handler = (_req, res) => {
                const body = overrides.body ?? pdfBytes;
                const headers: Record<string, string> = {
                    "Content-Type": "application/pdf", "Content-Length": String(body.length), "X-Artifact-Identity": IDENTITY,
                    "X-Content-Sha256": sha256Of(pdfBytes),
                };
                for (const [key, value] of Object.entries(overrides.headers ?? {})) {
                    if (value === undefined) delete headers[key]; else headers[key] = value;
                }
                res.writeHead(overrides.status ?? 200, headers);
                res.end(body);
            };
        }
        async function drain(iterable: AsyncIterable<Uint8Array>): Promise<Buffer> {
            const chunks: Buffer[] = [];
            for await (const chunk of iterable) chunks.push(Buffer.from(chunk));
            return Buffer.concat(chunks);
        }

        it("should stream the exact bytes and send the bearer token to the artifact route", async () => {
            serve();
            const bytes = await drain(await client.openArtifact(SNAPSHOT_ID, request));
            expect(bytes.equals(pdfBytes)).toBe(true);
            expect(server.requests[0]).toMatchObject({
                method: "GET", url: `/internal/eformsign-backup/v1/snapshots/${SNAPSHOT_ID}/artifacts/${IDENTITY}`,
            });
            expect(server.requests[0]!.headers["authorization"]).toBe(`Bearer ${TOKEN}`);
        });
        it.each([
            ["wrong X-Content-Sha256", { headers: { "X-Content-Sha256": "d".repeat(64) } }],
            ["missing X-Content-Sha256", { headers: { "X-Content-Sha256": undefined } }],
            ["wrong X-Artifact-Identity", { headers: { "X-Artifact-Identity": "e".repeat(64) } }],
            ["Content-Length differing from the candidate", { body: Buffer.concat([pdfBytes, Buffer.from("xx")]) }],
            ["a shorter body announced honestly", { body: pdfBytes.subarray(0, 50) }],
        ])("should refuse a 200 with %s as artifact-integrity", async (_name, overrides) => {
            serve(overrides);
            const error = await client.openArtifact(SNAPSHOT_ID, request).then(drain).catch((e: unknown) => e);
            expect(error).toBeInstanceOf(WorkerError);
            expect((error as WorkerError).reasonCode).toBe("artifact-integrity");
            expect(dumpOf(error)).not.toContain(TOKEN);
        });
        it("should refuse a body whose bytes hash differently from the announced sha256", async () => {
            const tampered = Buffer.from(pdfBytes);
            tampered[3] = tampered[3]! ^ 0xff;
            serve({ body: tampered });
            const error = await client.openArtifact(SNAPSHOT_ID, request).then(drain).catch((e: unknown) => e);
            expect(error).toMatchObject({ reasonCode: "artifact-integrity" });
        });
        it("should refuse a truncated connection as artifact-integrity", async () => {
            server.handler = (_req, res) => {
                res.writeHead(200, {
                    "Content-Length": String(pdfBytes.length), "X-Artifact-Identity": IDENTITY, "X-Content-Sha256": sha256Of(pdfBytes),
                });
                res.write(pdfBytes.subarray(0, 100));
                setTimeout(() => res.destroy(), 20);
            };
            const error = await client.openArtifact(SNAPSHOT_ID, request).then(drain).catch((e: unknown) => e);
            expect(error).toMatchObject({ reasonCode: "artifact-integrity" });
        });
        it("should refuse a candidate larger than 64 MiB before sending any request", async () => {
            const error = await client.openArtifact(SNAPSHOT_ID, { ...request, byteLength: 64 * 1024 * 1024 + 1 }).catch((e: unknown) => e);
            expect(error).toMatchObject({ reasonCode: "artifact-too-large" });
            expect(server.requests).toHaveLength(0);
        });
        it("should reject a malformed identity or snapshot id before any request", async () => {
            await expect(client.openArtifact(SNAPSHOT_ID, { ...request, artifactIdentity: "../x" })).rejects.toBeInstanceOf(WorkerError);
            await expect(client.openArtifact("../x", request)).rejects.toBeInstanceOf(WorkerError);
            expect(server.requests).toHaveLength(0);
        });
    });
});

describe("ExportClient stream limits with an injected fetch", () => {
    const body = Buffer.from("0123456789".repeat(50));
    const request = { artifactIdentity: IDENTITY, sha256: createHash("sha256").update(body).digest("hex"), byteLength: body.length };
    function clientWith(respond: () => Response): ExportClient {
        return new ExportClient({
            baseUrl: "http://127.0.0.1:1/x", token: TOKEN, companyId: "C001", requestTimeoutMs: 1000,
            fetchImpl: (async () => respond()) as unknown as typeof fetch,
        });
    }
    function headers(length: number): Record<string, string> {
        return { "Content-Length": String(length), "X-Artifact-Identity": IDENTITY, "X-Content-Sha256": request.sha256 };
    }

    it("should abort as soon as more bytes than announced arrive", async () => {
        let cancelled = false;
        const longer = Buffer.concat([body, Buffer.from("EXTRA-BYTES")]);
        const stream = new ReadableStream<Uint8Array>({
            start(controller) { controller.enqueue(longer.subarray(0, 200)); controller.enqueue(longer.subarray(200)); },
            cancel() { cancelled = true; },
        });
        const iterable = await clientWith(() => new Response(stream, { status: 200, headers: headers(body.length) }))
            .openArtifact(SNAPSHOT_ID, request);
        const seen: number[] = [];
        const error = await (async () => { for await (const chunk of iterable) seen.push(chunk.byteLength); })().catch((e: unknown) => e);
        expect(error).toMatchObject({ reasonCode: "artifact-integrity" });
        expect(seen.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(body.length);
        expect(cancelled).toBe(true);
    });
    it("should refuse a stream that ends before the announced length", async () => {
        const iterable = await clientWith(() => new Response(body.subarray(0, 100), { status: 200, headers: headers(body.length) }))
            .openArtifact(SNAPSHOT_ID, request);
        const error = await (async () => { for await (const chunk of iterable) void chunk; })().catch((e: unknown) => e);
        expect(error).toMatchObject({ reasonCode: "artifact-integrity" });
    });
    it("should accept the exact stream", async () => {
        const iterable = await clientWith(() => new Response(body, { status: 200, headers: headers(body.length) })).openArtifact(SNAPSHOT_ID, request);
        const chunks: Buffer[] = [];
        for await (const chunk of iterable) chunks.push(Buffer.from(chunk));
        expect(Buffer.concat(chunks).equals(body)).toBe(true);
    });
});

async function restartedBase(server: FakeExportServer): Promise<string> {
    await server.stop();
    return server.start();
}
