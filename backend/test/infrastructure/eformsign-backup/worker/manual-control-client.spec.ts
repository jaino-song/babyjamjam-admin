import { createHash } from "node:crypto";
import http from "node:http";
import { EXPORT_POLICY_REVISION, EXPORT_ARTIFACT_MAX_BYTES } from "domain/eformsign-backup/export/constants";
import { EXPORT_ERRORS } from "domain/eformsign-backup/export/errors";
import { MANUAL_CONTROL_CODES } from "domain/eformsign-backup/manual-backup-control";
import { MANUAL_BACKUP_LEASE_DURATION_MS, MANUAL_BACKUP_SCOPE_REVISION, manualBackupSnapshotId } from "domain/eformsign-backup/manual-backup-constants";
import { canonicalJson } from "domain/eformsign-backup/source-evidence";
import { manualDocumentResultDigest, manualAggregateResultDigest, type ManualDocumentResult, type ManualAggregateResult, type ManualSelectedCandidate } from "domain/eformsign-backup/worker/manual-protocol";
import { WorkerError } from "domain/eformsign-backup/worker/worker-error";
import { ManualControlClient, ManualControlFailure } from "infrastructure/eformsign-backup/worker/manual-control-client";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const h = (c: string) => c.repeat(64);
const TOKEN = `ebx_${"A".repeat(43)}`;
const at = "2026-11-06T01:00:00.000Z";
const scope = { kind: "manual" as const, jobId: id(1), attemptId: `${id(1)}.attempt-1`, companyId: "company-1", branchId: id(2), selectionDigest: h("a") };
const lease = { runId: scope.jobId, leaseToken: id(3) };
const snapshot = { snapshotId: manualBackupSnapshotId(scope), status: "ready", companyId: scope.companyId,
    scopeRevision: MANUAL_BACKUP_SCOPE_REVISION, policyRevision: EXPORT_POLICY_REVISION, createdAt: at, readyAt: at, expiresAt: null,
    counts: { total: 1, inaccessible: 0, unknownTemplate: 0, policyPending: 0, excludedByPolicy: 1, included: 0 },
    coverage: { status: "unverified", reasonCode: "collection-receipt-unavailable" }, backupComplete: false };
const claim = { executionScope: scope, snapshot, leaseToken: lease.leaseToken, leaseExpiresAt: at, leaseDurationMs: MANUAL_BACKUP_LEASE_DURATION_MS };
const candidate: ManualSelectedCandidate = { ordinal: 1, documentId: "opaque/doc?x", classification: "excluded_by_policy", reasons: [], statusType: "003", documentKind: "contract", metadataRevision: h("b"), artifacts: [] };
const observation = { destinationIdentity: null, destinationRevision: null, state: "metadata_only" as const, manifestStatus: "not_required" as const, artifacts: [], reasons: [] };
const result: ManualDocumentResult = { receiptId: id(4), runId: id(5), scope, documentId: candidate.documentId, classification: candidate.classification,
    expectedArtifactIdentities: [], observedAtSequence: 1, local: observation, drive: observation, reasons: [] };
const aggregate: ManualAggregateResult = { receiptId: id(6), runId: id(5), scope, status: "partial", coverage: "unverified", backupComplete: false,
    documentResultCount: 1, documentResultsDigest: h("d"), counts: { selected: 1, localVerified: 0, driveVerified: 0, metadataOnly: 1, attention: 0 }, reasons: [] };
const PDF = Buffer.from("%PDF-1.4\nstatic synthetic bytes\n%%EOF\n");
const artifact = { artifactIdentity: h("f"), sha256: createHash("sha256").update(PDF).digest("hex"), byteLength: PDF.length };
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const artifactHeaders = () => ({ "content-length": String(artifact.byteLength), "x-artifact-identity": artifact.artifactIdentity,
    "x-content-sha256": artifact.sha256, "content-type": "application/octet-stream" });
function client(fetchImpl: typeof fetch, requestTimeoutMs = 1000) {
    return new ManualControlClient({ baseUrl: "https://example.invalid/custom/internal/eformsign-backup/v1/", token: TOKEN,
        companyId: scope.companyId, requestTimeoutMs, fetchImpl });
}
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
async function collect(stream: AsyncIterable<Uint8Array>): Promise<Buffer> { const chunks: Uint8Array[] = []; for await (const chunk of stream) chunks.push(chunk); return Buffer.concat(chunks); }
async function bounded<T>(promise: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("test bounded guard")), 1000); })]); }
    finally { clearTimeout(timer); }
}

describe("ManualControlClient positive protocol", () => {
    it("performs every operation over an owned loopback HTTP listener with the configured prefix and canonical private bodies", async () => {
        const seen: { url: string; body: Record<string, unknown>; raw: string }[] = [];
        const server = http.createServer(async (req, res) => {
            const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
            const raw = Buffer.concat(chunks).toString("utf8"); const body = JSON.parse(raw);
            seen.push({ url: req.url!, body, raw });
            if (req.method !== "POST" || req.headers.authorization !== `Bearer ${TOKEN}`) { res.writeHead(400).end(); return; }
            if (req.url?.endsWith("/artifact")) { res.writeHead(200, artifactHeaders()); res.end(PDF); return; }
            const payload = req.url?.endsWith("/claim") ? claim : req.url?.endsWith("/renew") ? { leaseExpiresAt: at, leaseDurationMs: 180000 }
                : req.url?.endsWith("/candidates") ? { items: [candidate], nextCursor: 1 } : req.url?.endsWith("/validate") ? { valid: true } : { accepted: true };
            res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(payload));
        });
        await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
        try {
            const address = server.address(); if (!address || typeof address === "string") throw new Error("test listener");
            const c = new ManualControlClient({ baseUrl: `http://127.0.0.1:${address.port}/retained/internal/eformsign-backup/v1`, token: TOKEN, companyId: scope.companyId, requestTimeoutMs: 1000 });
            const claimed = await c.claim(); expect(claimed).toEqual({ executionScope: scope, snapshot, leaseToken: lease.leaseToken, leaseExpiresAtUTC: at, leaseDurationMs: 180000 });
            expect(await c.renew(lease)).toEqual({ leaseExpiresAtUTC: at, leaseDurationMs: 180000 });
            expect(await c.listCandidates(lease, { afterOrdinal: 0, limit: 1 })).toEqual({ items: [candidate], nextCursor: 1 });
            await c.validate(lease); await c.validate(lease, candidate.documentId);
            expect(await collect(await c.openArtifact(lease, candidate.documentId, artifact))).toEqual(PDF);
            await c.writeDocumentResults(lease, [{ payload: result, digest: manualDocumentResultDigest(result) }]);
            await c.finish(lease, aggregate, manualAggregateResultDigest(aggregate));
            expect(seen).toHaveLength(8);
            for (const request of seen) {
                expect(request.url).toMatch(/^\/retained\/internal\/eformsign-backup\/v1\/manual-runs\//);
                expect(request.url).not.toContain(lease.leaseToken); expect(request.url).not.toContain("?");
                expect(request.body["companyId"]).toBe(scope.companyId); expect(request.raw).toBe(canonicalJson(request.body));
                expect(request.body["leaseToken"]).toBe(request.url.endsWith("/claim") ? undefined : lease.leaseToken);
            }
            expect(seen.find(r => r.url.endsWith("/artifact"))?.body).toEqual({ companyId: scope.companyId, leaseToken: lease.leaseToken, documentId: candidate.documentId, artifactIdentity: artifact.artifactIdentity });
        } finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
    });
    it("refuses an actual HTTP redirect without making a second authenticated request", async () => {
        const seen: string[] = [];
        const server = http.createServer((req, res) => {
            seen.push(req.url!); res.writeHead(302, { Location: "/redirect-target" }); res.end();
        });
        await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
        try {
            const address = server.address(); if (!address || typeof address === "string") throw new Error("test listener");
            const c = new ManualControlClient({ baseUrl: `http://127.0.0.1:${address.port}/prefix`, token: TOKEN, companyId: scope.companyId, requestTimeoutMs: 1000 });
            await expect(c.claim()).rejects.toMatchObject({ httpStatus: 0, code: "NETWORK" });
            expect(seen).toEqual(["/prefix/manual-runs/claim"]);
        } finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
    });
    it("returns null for an empty queue and never enumerates or serializes the bearer", async () => {
        const fetcher = jest.fn(async () => json(null)); const c = client(fetcher);
        expect(await c.claim()).toBeNull(); expect(fetcher).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(c)).not.toContain(TOKEN); expect(Object.values(c)).not.toContain(TOKEN);
        expect(Object.getOwnPropertyNames(c)).not.toContain("token");
        expect(fetcher.mock.calls[0]).toHaveLength(2);
        expect((fetcher.mock.calls as unknown as [string, RequestInit][])[0]![1].redirect).toBe("error");
    });
});

describe("ManualControlClient strict refusal", () => {
    it.each([
        { token: "secret" }, { token: `${TOKEN}\n` }, { companyId: "../company" }, { requestTimeoutMs: 0 }, { requestTimeoutMs: NaN },
    ])("rejects bad configuration without reflecting it: %j", patch => {
        expect(() => new ManualControlClient({ baseUrl: "https://example.invalid", token: TOKEN, companyId: scope.companyId, requestTimeoutMs: 1000, ...patch })).toThrow("config-invalid");
    });
    it.each(["http://external.invalid/x", "https://user:secret@example.invalid/x", "https://example.invalid/x?secret=y", "bad"])("rejects unsafe URL %s", baseUrl => {
        expect(() => new ManualControlClient({ baseUrl, token: TOKEN, companyId: scope.companyId, requestTimeoutMs: 1000 })).toThrow("export-base-url-invalid");
    });
    it.each([
        (v: any) => { v.extra = true; }, (v: any) => { v.executionScope.extra = true; }, (v: any) => { v.executionScope.jobId = "../../x"; },
        (v: any) => { v.executionScope.companyId = v.snapshot.companyId = "other"; }, (v: any) => { v.snapshot.snapshotId = "other"; },
        (v: any) => { v.snapshot.status = "building"; }, (v: any) => { v.snapshot.scopeRevision = "old"; }, (v: any) => { v.snapshot.policyRevision = "old"; },
        (v: any) => { v.snapshot.counts.total = 2; }, (v: any) => { v.snapshot.counts.included = -1; }, (v: any) => { v.snapshot.counts.total = Number.MAX_SAFE_INTEGER + 1; },
        (v: any) => { v.snapshot.counts.extra = 0; }, (v: any) => { v.snapshot.expiresAt = at; }, (v: any) => { v.snapshot.createdAt = "bad"; },
        (v: any) => { v.snapshot.readyAt = null; }, (v: any) => { v.snapshot.coverage.reasonCode = "verified"; }, (v: any) => { v.snapshot.backupComplete = true; },
        (v: any) => { v.leaseToken = "bad"; }, (v: any) => { v.leaseDurationMs = 180001; }, (v: any) => { v.leaseExpiresAt = "2026-11-06T01:00:00+09:00"; },
    ])("rejects malformed claims without validator details %#", async mutate => {
        const bad = clone(claim); mutate(bad);
        await expect(client(async () => json(bad)).claim()).rejects.toMatchObject({ reasonCode: "export-response-invalid" });
    });
    it("rejects getters and hidden unknown keys without invoking accessors", () => {
        const c = client(async () => json(null)); let accessed = false;
        const input = { ...lease };
        Object.defineProperty(input, "leaseToken", { enumerable: true, get() { accessed = true; throw new Error(TOKEN); } });
        expect(() => c.renew(input)).toThrow("export-response-invalid"); expect(accessed).toBe(false);
        expect(() => c.renew(Object.defineProperty({ ...lease }, "hidden", { value: TOKEN }))).toThrow("export-response-invalid");
    });
    it("validates all request shapes synchronously with zero HTTP and recomputes result digests", () => {
        const fetcher = jest.fn(async () => json(null)); const c = client(fetcher);
        const actions = [
            () => c.renew({ ...lease, extra: true } as any), () => c.validate({ ...lease, runId: "../x" }), () => c.validate(lease, "\0secret"),
            () => c.listCandidates(lease, { afterOrdinal: -1, limit: 1 }), () => c.listCandidates(lease, { afterOrdinal: 0, limit: 101 }),
            () => c.listCandidates(lease, { afterOrdinal: 0, limit: 1, extra: true } as any),
            () => c.openArtifact(lease, "doc", { ...artifact, extra: true } as any), () => c.openArtifact(lease, "doc", { ...artifact, byteLength: 0 }),
            () => c.openArtifact(lease, "doc", { ...artifact, byteLength: EXPORT_ARTIFACT_MAX_BYTES + 1 }), () => c.openArtifact(lease, "doc", { ...artifact, sha256: "A".repeat(64) }),
            () => c.writeDocumentResults(lease, []), () => c.writeDocumentResults(lease, Array(101).fill({ payload: result, digest: manualDocumentResultDigest(result) })),
            () => c.writeDocumentResults(lease, [{ payload: result, digest: h("e") }]),
            () => c.writeDocumentResults(lease, [{ payload: result, digest: manualDocumentResultDigest(result) }, { payload: result, digest: manualDocumentResultDigest(result) }]),
            () => c.finish(lease, aggregate, h("e")), () => c.finish(lease, { ...aggregate, scope: { ...scope, companyId: "other" } }, h("e")),
            () => c.renew(Object.defineProperty({}, "runId", { get() { throw new Error(TOKEN); } }) as any),
        ];
        for (const action of actions) expect(action).toThrow("export-response-invalid");
        const wrongWorker = { ...result, runId: id(99), documentId: "other" };
        expect(() => c.writeDocumentResults(lease, [{ payload: result, digest: manualDocumentResultDigest(result) }, { payload: wrongWorker, digest: manualDocumentResultDigest(wrongWorker) }])).toThrow("export-response-invalid");
        const items = Array.from({ length: 100 }, (_, i) => { const payload = { ...result, receiptId: id(100 + i), documentId: `doc-${i}`, reasons: Array.from({ length: 64 }, (_, n) => `reason-${n}-${"r".repeat(100)}`) }; return { payload, digest: manualDocumentResultDigest(payload) }; });
        expect(() => c.writeDocumentResults(lease, items)).toThrow("export-response-invalid");
        expect(fetcher).not.toHaveBeenCalled();
    });
    it("rejects correctly digested cross-job/company reports before HTTP", () => {
        const fetcher = jest.fn(async () => json({ accepted: true })); const c = client(fetcher);
        for (const wrongScope of [{ ...scope, companyId: "other" }, { ...scope, jobId: id(90), attemptId: `${id(90)}.attempt-1` }]) {
            const doc = { ...result, scope: wrongScope }; const report = { ...aggregate, scope: wrongScope };
            expect(() => c.writeDocumentResults(lease, [{ payload: doc, digest: manualDocumentResultDigest(doc) }])).toThrow("export-response-invalid");
            expect(() => c.finish(lease, report, manualAggregateResultDigest(report))).toThrow("export-response-invalid");
        }
        expect(fetcher).not.toHaveBeenCalled();
    });
    it("counts private lease keys in the exact 64 KiB request ceiling", async () => {
        const fetcher = jest.fn(async () => json({ accepted: true })); const c = client(fetcher);
        const payloads = Array.from({ length: 8 }, (_, n) => ({ ...result, documentId: `doc-${n}`, receiptId: id(100 + n),
            reasons: Array.from({ length: 64 }, (_, r) => `r${String(r).padStart(2, "0")}-`) }));
        const makeItems = () => payloads.map(payload => ({ payload, digest: manualDocumentResultDigest(payload) }));
        const bodyLength = () => Buffer.byteLength(canonicalJson({ companyId: scope.companyId, leaseToken: lease.leaseToken, items: makeItems() }));
        let remaining = 65536 - bodyLength();
        for (const payload of payloads) for (let i = 0; i < payload.reasons.length; i++) {
            const added = Math.min(remaining, 120); payload.reasons[i] += "a".repeat(added); remaining -= added;
        }
        expect(remaining).toBe(0); expect(bodyLength()).toBe(65536);
        await c.writeDocumentResults(lease, makeItems()); expect(fetcher).toHaveBeenCalledTimes(1);
        const last = payloads.at(-1)!; last.reasons[63] += "x";
        expect(bodyLength()).toBe(65537); expect(() => c.writeDocumentResults(lease, makeItems())).toThrow("export-response-invalid");
        expect(Buffer.byteLength(canonicalJson({ items: makeItems() }))).toBeLessThan(65536); expect(fetcher).toHaveBeenCalledTimes(1);
    });
    it.each([
        { items: [{ ...candidate, ordinal: 2 }], nextCursor: null }, { items: [candidate, { ...candidate, ordinal: 2 }], nextCursor: 2 },
        { items: [candidate], nextCursor: 0 }, { items: [], nextCursor: 1 }, { items: [candidate], nextCursor: 2 },
        { items: [candidate], nextCursor: null, extra: true }, { items: [{ ...candidate, extra: true }], nextCursor: null },
    ])("rejects malformed pages %#", async page => {
        await expect(client(async () => json(page)).listCandidates(lease, { afterOrdinal: 0, limit: 100 })).rejects.toMatchObject({ reasonCode: "export-response-invalid" });
    });
    it("rejects a page larger than requested, wrong validate/accept replies, and bad renewal lifetime", async () => {
        await expect(client(async () => json({ items: [candidate, { ...candidate, ordinal: 2, documentId: "doc-2" }], nextCursor: null })).listCandidates(lease, { afterOrdinal: 0, limit: 1 })).rejects.toThrow("export-response-invalid");
        await expect(client(async () => json({ valid: true, secret: TOKEN })).validate(lease)).rejects.toThrow("export-response-invalid");
        await expect(client(async () => json({ leaseExpiresAt: at, leaseDurationMs: 1 })).renew(lease)).rejects.toThrow("export-response-invalid");
        await expect(client(async () => json({ accepted: false })).finish(lease, aggregate, manualAggregateResultDigest(aggregate))).rejects.toThrow("export-response-invalid");
    });
    it.each([...new Set([...MANUAL_CONTROL_CODES, ...Object.keys(EXPORT_ERRORS)])])("keeps only the allowlisted error code %s and status without retry", async code => {
        const fetcher = jest.fn(async () => json({ code, requestId: id(9) }, 409));
        await expect(client(fetcher).claim()).rejects.toMatchObject({ httpStatus: 409, code }); expect(fetcher).toHaveBeenCalledTimes(1);
    });
    it.each([{ code: TOKEN }, { code: "LEASE_LOST", message: TOKEN }, { code: "LEASE_LOST", requestId: TOKEN }, { raw: TOKEN }])("redacts untrusted error responses %#", async body => {
        const error = await client(async () => json(body, 503)).claim().catch(e => e);
        expect(error).toBeInstanceOf(ManualControlFailure); expect(error).toMatchObject({ httpStatus: 503, code: "UNKNOWN_ERROR" });
        expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain(TOKEN);
    });
    it("does not trust an exception forged as a control failure by fetch", async () => {
        const error = await client(async () => { throw new ManualControlFailure(599, TOKEN); }).claim().catch(e => e);
        expect(error).toMatchObject({ httpStatus: 0, code: "NETWORK" });
        expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain(TOKEN);
    });
    it("sanitizes network causes, malformed JSON and response byte ceilings", async () => {
        const fetcher = jest.fn(async () => { throw new Error(`Authorization Bearer ${TOKEN} https://secret.invalid`); });
        const error = await client(fetcher).claim().catch(e => e); expect(error).toMatchObject({ httpStatus: 0, code: "NETWORK" });
        expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain(TOKEN); expect(fetcher).toHaveBeenCalledTimes(1);
        for (const raw of ["{", `"${"x".repeat(65536)}"`]) await expect(client(async () => new Response(raw)).claim()).rejects.toThrow("export-response-invalid");
        await expect(client(async () => new Response("x".repeat(1024 * 1024 + 1))).listCandidates(lease, { afterOrdinal: 0, limit: 100 })).rejects.toThrow("export-response-invalid");
        await expect(client(async () => new Response("x".repeat(65537), { status: 500 })).claim()).rejects.toMatchObject({ httpStatus: 500, code: "UNKNOWN_ERROR" });
    });
});

describe("ManualControlClient abort and stream ownership", () => {
    afterEach(() => jest.useRealTimers());
    it("honors pre-abort without calling fetch", async () => {
        const controller = new AbortController(); controller.abort(); const fetcher = jest.fn(async () => json(null));
        await expect(client(fetcher).claim(controller.signal)).rejects.toMatchObject({ httpStatus: 0, code: "ABORTED" }); expect(fetcher).not.toHaveBeenCalled();
    });
    it("settles promptly when fetch ignores abort and consumes a late rejection", async () => {
        const started = deferred<void>(); const pending = deferred<Response>(); const controller = new AbortController();
        const unhandled: unknown[] = []; const listener = (error: unknown) => unhandled.push(error); process.on("unhandledRejection", listener);
        try {
            const operation = client(() => { started.resolve(); return pending.promise; }).claim(controller.signal);
            await started.promise; controller.abort();
            await expect(bounded(operation)).rejects.toMatchObject({ code: "ABORTED" }); pending.reject(new Error(TOKEN));
            await new Promise(resolve => setImmediate(resolve)); expect(unhandled).toEqual([]);
        } finally { process.off("unhandledRejection", listener); }
    });
    it("caps the header and full JSON body timeout at ten seconds even for ignored abort", async () => {
        jest.useFakeTimers();
        const started = deferred<void>();
        const operation = client(() => { started.resolve(); return new Promise(() => undefined); }, 60000).claim();
        const check = expect(operation).rejects.toMatchObject({ code: "ABORTED" }); await started.promise;
        await jest.advanceTimersByTimeAsync(10000); await check; expect(jest.getTimerCount()).toBe(0);
        const reading = deferred<void>();
        const body = new ReadableStream<Uint8Array>({ pull() { reading.resolve(); return new Promise(() => undefined); }, cancel() { return new Promise(() => undefined); } });
        const bodyOperation = client(async () => new Response(body), 60000).claim(); const bodyCheck = expect(bodyOperation).rejects.toMatchObject({ code: "ABORTED" });
        await reading.promise; await jest.advanceTimersByTimeAsync(10000); await bodyCheck; expect(jest.getTimerCount()).toBe(0);
    });
    it("cancels a late response after the ignored fetch settles following abort", async () => {
        const started = deferred<void>(); const pending = deferred<Response>(); const controller = new AbortController(); const cancel = jest.fn();
        const operation = client(() => { started.resolve(); return pending.promise; }).claim(controller.signal);
        await started.promise; controller.abort(); await expect(bounded(operation)).rejects.toMatchObject({ code: "ABORTED" });
        pending.resolve(new Response(new ReadableStream({ cancel }))); await new Promise(resolve => setImmediate(resolve));
        expect(cancel).toHaveBeenCalledTimes(1);
    });
    it("aborts a stalled JSON read, cancels once, and never waits for ignored cancellation", async () => {
        const started = deferred<void>(); const controller = new AbortController(); const cancel = jest.fn(() => new Promise<void>(() => undefined));
        const body = new ReadableStream<Uint8Array>({ pull() { started.resolve(); return new Promise(() => undefined); }, cancel });
        const operation = client(async () => new Response(body)).claim(controller.signal); await started.promise; controller.abort();
        await expect(bounded(operation)).rejects.toMatchObject({ code: "ABORTED" }); expect(cancel).toHaveBeenCalledTimes(1);
    });
    it.each(["content-length", "x-artifact-identity", "x-content-sha256"])("rejects incorrect %s before yielding", async name => {
        const headers = artifactHeaders(); headers[name as keyof typeof headers] = "bad";
        const cancel = jest.fn(); const body = new ReadableStream<Uint8Array>({ cancel });
        await expect(client(async () => new Response(body, { headers })).openArtifact(lease, "doc", artifact)).rejects.toThrow("artifact-integrity"); expect(cancel).toHaveBeenCalledTimes(1);
    });
    it.each([Buffer.from("x"), Buffer.alloc(PDF.length, 65), Buffer.concat([PDF, Buffer.from("x")])])("rejects wrong EOF size/hash or an oversized first chunk %#", async bytes => {
        const stream = await client(async () => new Response(bytes, { headers: artifactHeaders() })).openArtifact(lease, "doc", artifact);
        let yielded = 0; await expect((async () => { for await (const chunk of stream) yielded += chunk.length; })()).rejects.toThrow("artifact-integrity");
        if (bytes.length > PDF.length) expect(yielded).toBe(0);
    });
    it("bounds idle body reads and consumes late transport rejection without duplicate cancel", async () => {
        jest.useFakeTimers(); const started = deferred<void>(); const late = deferred<ReadableStreamReadResult<Uint8Array>>();
        const cancel = jest.fn(() => new Promise<void>(() => undefined)); const releaseLock = jest.fn();
        const reader = { read: () => { started.resolve(); return late.promise; }, cancel, releaseLock };
        const response = { status: 200, headers: new Headers(artifactHeaders()), body: { getReader: () => reader } } as unknown as Response;
        const stream = await client(async () => response, 50).openArtifact(lease, "doc", artifact);
        const operation = collect(stream); const check = expect(operation).rejects.toMatchObject({ code: "ABORTED" }); await started.promise;
        await jest.advanceTimersByTimeAsync(50); await check; late.reject(new Error(TOKEN)); await Promise.resolve();
        expect(cancel).toHaveBeenCalledTimes(1); expect(releaseLock).toHaveBeenCalledTimes(1); expect(jest.getTimerCount()).toBe(0);
    });
    it("cancels early return and throw once, including return before the first read and late abort during stalled cleanup", async () => {
        for (const mode of ["before", "return", "throw"] as const) {
            const controller = new AbortController(); const cancelStarted = deferred<void>();
            const cancel = jest.fn(() => { cancelStarted.resolve(); return new Promise<void>(() => undefined); });
            const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(PDF); }, cancel });
            const stream = await client(async () => new Response(body, { headers: artifactHeaders() })).openArtifact(lease, "doc", artifact, controller.signal);
            const iterator = stream[Symbol.asyncIterator](); if (mode !== "before") expect((await iterator.next()).value).toEqual(PDF);
            const operation = mode === "throw" ? iterator.throw!(new Error(TOKEN)).catch(e => e) : iterator.return!();
            await cancelStarted.promise; controller.abort(); await bounded(operation); expect(cancel).toHaveBeenCalledTimes(1);
        }
    });
    it("rejects locked or non-byte success streams with code-only errors and removes caller listeners", async () => {
        for (const isArtifact of [false, true]) {
            for (const locked of [false, true]) {
                const controller = new AbortController(); const remove = jest.spyOn(controller.signal, "removeEventListener");
                const body = new ReadableStream({ start(c) { c.enqueue(TOKEN); c.close(); } });
                const response = new Response(body, { headers: artifactHeaders() }); const reader = locked ? body.getReader() : null;
                const c = client(async () => response);
                try {
                    const operation = isArtifact ? c.openArtifact(lease, "doc", artifact, controller.signal).then(collect) : c.claim(controller.signal);
                    await expect(operation).rejects.toMatchObject({ reasonCode: isArtifact && !locked ? "artifact-integrity" : "export-response-invalid" });
                    expect(remove).toHaveBeenCalledTimes(1);
                } finally { if (reader) { await reader.cancel(); reader.releaseLock(); } }
            }
        }
    });
    it("handles body read errors and abort while a read is pending without leaking causes", async () => {
        const body = new ReadableStream<Uint8Array>({ pull(c) { c.error(new Error(TOKEN)); } });
        await expect(collect(await client(async () => new Response(body, { headers: artifactHeaders() })).openArtifact(lease, "doc", artifact))).rejects.toMatchObject({ code: "NETWORK" });
        const started = deferred<void>(); const controller = new AbortController(); const cancel = jest.fn(() => new Promise<void>(() => undefined));
        const stalled = new ReadableStream<Uint8Array>({ pull() { started.resolve(); return new Promise(() => undefined); }, cancel });
        const stream = await client(async () => new Response(stalled, { headers: artifactHeaders() })).openArtifact(lease, "doc", artifact, controller.signal);
        const operation = collect(stream); await started.promise; controller.abort();
        await expect(bounded(operation)).rejects.toMatchObject({ code: "ABORTED" }); expect(cancel).toHaveBeenCalledTimes(1);
    });
    it("removes caller listeners after JSON completion and EOF without retaining mutable request references", async () => {
        const controller = new AbortController(); const add = jest.spyOn(controller.signal, "addEventListener"); const remove = jest.spyOn(controller.signal, "removeEventListener");
        await client(async () => json(claim)).claim(controller.signal);
        expect(add).toHaveBeenCalledTimes(1); expect(remove).toHaveBeenCalledTimes(1);
        await collect(await client(async () => new Response(PDF, { headers: artifactHeaders() })).openArtifact(lease, "doc", artifact, controller.signal));
        expect(add).toHaveBeenCalledTimes(2); expect(remove).toHaveBeenCalledTimes(2);
        const mutable = clone(artifact); const c = client(async () => new Response(PDF, { headers: artifactHeaders() }));
        const operation = c.openArtifact(lease, "doc", mutable); mutable.sha256 = h("0"); mutable.byteLength = 1;
        expect(await collect(await operation)).toEqual(PDF);
    });
});

describe("ManualControlClient unexpected response metadata", () => {
    const operations = [
        (c: ManualControlClient) => c.claim(),
        (c: ManualControlClient) => c.renew(lease),
        (c: ManualControlClient) => c.listCandidates(lease, { afterOrdinal: 0, limit: 1 }),
        (c: ManualControlClient) => c.validate(lease),
        (c: ManualControlClient) => c.writeDocumentResults(lease, [{ payload: result, digest: manualDocumentResultDigest(result) }]),
        (c: ManualControlClient) => c.finish(lease, aggregate, manualAggregateResultDigest(aggregate)),
        (c: ManualControlClient) => c.openArtifact(lease, "doc", artifact),
    ];
    it.each(["status", "body"] as const)("sanitizes an actual Response throwing %s getter for every public operation", async property => {
        for (const operation of operations) {
            const response = new Response(PDF, { headers: artifactHeaders() });
            Object.defineProperty(response, property, { get() { throw new Error(`private ${TOKEN} ${lease.leaseToken}`); } });
            const error = await operation(client(async () => response)).catch(value => value);
            expect(error).toBeInstanceOf(WorkerError); expect(error.reasonCode).toBe("export-response-invalid");
            expect(error.message).toBe("export-response-invalid"); expect(error.cause).toBeUndefined();
            expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain(TOKEN);
            expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain(lease.leaseToken);
        }
    });
    it.each(["headers", "header-get", "getReader"])("sanitizes artifact %s metadata failures and cancels once with rejected cleanup consumed", async property => {
        const unhandled: unknown[] = []; const listener = (value: unknown) => unhandled.push(value); process.on("unhandledRejection", listener);
        const cancel = jest.fn(() => Promise.reject(new Error(TOKEN)));
        try {
            const response = new Response(new ReadableStream<Uint8Array>({ cancel }), { headers: artifactHeaders() });
            if (property === "headers") Object.defineProperty(response, "headers", { get() { throw new Error(TOKEN); } });
            if (property === "header-get") Object.defineProperty(response, "headers", { value: { get() { throw new Error(TOKEN); } } });
            if (property === "getReader") Object.defineProperty(response.body!, "getReader", { get() { throw new Error(TOKEN); } });
            const error = await client(async () => response).openArtifact(lease, "doc", artifact).catch(value => value);
            expect(error).toMatchObject({ reasonCode: "export-response-invalid", message: "export-response-invalid" });
            expect(error.cause).toBeUndefined(); expect(cancel).toHaveBeenCalledTimes(1);
            await new Promise(resolve => setImmediate(resolve)); expect(unhandled).toEqual([]);
        } finally { process.off("unhandledRejection", listener); }
    });
    it.each(["code-getter", "status-getter", "reason-getter", "unknown-reason", "proxy", "revoked-proxy"])("makes the error classifier nonthrowing for %s", async kind => {
        let hostile: unknown;
        if (kind === "code-getter") hostile = Object.defineProperty(new ManualControlFailure(409, "LEASE_LOST"), "code", { get() { throw new Error(TOKEN); } });
        if (kind === "status-getter") hostile = Object.defineProperty(new ManualControlFailure(409, "LEASE_LOST"), "httpStatus", { get() { throw new Error(TOKEN); } });
        if (kind === "reason-getter") hostile = Object.defineProperty(new WorkerError("artifact-integrity"), "reasonCode", { get() { throw new Error(TOKEN); } });
        if (kind === "unknown-reason") hostile = Object.defineProperty(new WorkerError("artifact-integrity"), "reasonCode", { value: TOKEN });
        if (kind === "proxy") hostile = new Proxy({}, { getPrototypeOf() { throw new Error(TOKEN); } });
        if (kind === "revoked-proxy") { const p = Proxy.revocable({}, {}); p.revoke(); hostile = p.proxy; }
        for (const isArtifact of [false, true]) {
            const response = new Response(PDF, { headers: artifactHeaders() });
            Object.defineProperty(response, "status", { get() { throw hostile; } });
            const c = client(async () => response);
            const error = await (isArtifact ? c.openArtifact(lease, "doc", artifact) : c.claim()).catch(value => value);
            expect(error).not.toBe(hostile); expect(error).toMatchObject({ reasonCode: "export-response-invalid" });
            expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain(TOKEN);
        }
    });
    it("validates status values, creates fresh known errors, and sanitizes failure-response metadata", async () => {
        for (const status of [NaN, -1, 600, "200"]) {
            const response = json(null); Object.defineProperty(response, "status", { value: status });
            await expect(client(async () => response).claim()).rejects.toThrow("export-response-invalid");
        }
        const response = json({ code: "LEASE_LOST" }, 409);
        Object.defineProperty(response, "body", { get() { throw new Error(TOKEN); } });
        await expect(client(async () => response).claim()).rejects.toThrow("export-response-invalid");
        for (const original of [new WorkerError("artifact-integrity"), new ManualControlFailure(409, "LEASE_LOST")]) {
            Object.defineProperty(original, "cause", { value: TOKEN }); Object.defineProperty(original, "message", { value: TOKEN });
            const bad = json(null); Object.defineProperty(bad, "status", { get() { throw original; } });
            const error = await client(async () => bad).claim().catch(value => value);
            expect(error).not.toBe(original); expect(error.cause).toBeUndefined();
            expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain(TOKEN);
            expect(error.message).toBe(original instanceof WorkerError ? "artifact-integrity" : "LEASE_LOST");
        }
    });
});
