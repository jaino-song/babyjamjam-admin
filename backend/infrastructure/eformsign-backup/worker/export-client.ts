import { createHash } from "node:crypto";
import { constants, promises as fs } from "node:fs";

import { z } from "zod";

import { EXPORT_ARTIFACT_MAX_BYTES, EXPORT_POLICY_REVISION, EXPORT_SCOPE_REVISION } from "domain/eformsign-backup/export/constants";
import { WorkerError } from "domain/eformsign-backup/worker";

/** Contract W6: `ebx_` plus 43 base64url characters; one trailing newline is tolerated. */
const TOKEN_PATTERN = /^ebx_[A-Za-z0-9_-]{43}$/;
const TOKEN_FILE_MAX_BYTES = 256;
const JSON_BODY_MAX_BYTES = 8 * 1024 * 1024;
const ERROR_BODY_MAX_BYTES = 64 * 1024;
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["127.0.0.1", "localhost", "[::1]"]);
const HEX64 = /^[0-9a-f]{64}$/;
const SNAPSHOT_ID = /^[A-Za-z0-9-]{1,64}$/;
const ERROR_CODE = /^[A-Z][A-Z_]{0,63}$/;
const UNKNOWN_ERROR = "UNKNOWN_ERROR";
const NETWORK = "NETWORK";
const RETRY_AFTER_MAX_SECONDS = 7 * 24 * 60 * 60;

/** Reads the token file (contract W6). Every refusal is `token-file-invalid`; no path or content reaches the error. */
export async function readTokenFile(tokenPath: string): Promise<string> {
    if (typeof tokenPath !== "string" || !tokenPath.startsWith("/")) throw new WorkerError("token-file-invalid");
    let file: import("node:fs/promises").FileHandle | undefined;
    try {
        file = await fs.open(tokenPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        const stat = await file.stat();
        if (!stat.isFile() || (stat.mode & 0o777) !== 0o600 || stat.uid !== process.getuid?.() || stat.size > TOKEN_FILE_MAX_BYTES) {
            throw new WorkerError("token-file-invalid");
        }
        const buffer = Buffer.alloc(stat.size);
        let filled = 0;
        while (filled < buffer.length) {
            const { bytesRead } = await file.read(buffer, filled, buffer.length - filled, filled);
            if (bytesRead === 0) break;
            filled += bytesRead;
        }
        const text = buffer.subarray(0, filled).toString("utf8");
        const token = text.endsWith("\n") ? text.slice(0, -1) : text;
        if (!TOKEN_PATTERN.test(token)) throw new WorkerError("token-file-invalid");
        return token;
    } catch {
        throw new WorkerError("token-file-invalid");
    } finally {
        try { await file?.close(); } catch { /* nothing left to report */ }
    }
}

/** `https:` only; `http:` solely for a loopback host (contract W6). No credentials, query or fragment. Returns the base without a trailing slash. */
export function validateExportBaseUrl(raw: string): string {
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        throw new WorkerError("export-base-url-invalid");
    }
    const schemeOk = url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname));
    if (!schemeOk || url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") {
        throw new WorkerError("export-base-url-invalid");
    }
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

/**
 * A non-2xx answer of the export API, or no answer at all (`httpStatus` 0, `code` `NETWORK`). It carries the
 * status, the error code and the retry hints only: never the body, the URL, the headers or the token.
 */
export class ExportFailure extends Error {
    constructor(
        readonly httpStatus: number,
        readonly code: string,
        readonly retryable: boolean,
        readonly retryAfterSeconds: number | null,
    ) {
        super(code);
        this.name = "ExportFailure";
    }
}

const countsSchema = z.object({
    total: z.number().int().min(0), inaccessible: z.number().int().min(0), unknownTemplate: z.number().int().min(0),
    policyPending: z.number().int().min(0), excludedByPolicy: z.number().int().min(0), included: z.number().int().min(0),
});
const snapshotSchema = z.object({
    snapshotId: z.string().regex(SNAPSHOT_ID),
    status: z.enum(["building", "ready", "failed"]),
    companyId: z.string().min(1).max(256),
    scopeRevision: z.string().min(1).max(64),
    policyRevision: z.string().min(1).max(64),
    createdAt: z.string().min(1),
    readyAt: z.string().nullable(),
    expiresAt: z.string().nullable(),
    counts: countsSchema,
    coverage: z.object({ status: z.string(), reasonCode: z.string() }),
    backupComplete: z.boolean(),
});
const candidateSchema = z.object({
    ordinal: z.number().int().min(1),
    documentId: z.string().min(1).max(1024),
    classification: z.enum(["inaccessible", "unknown_template", "policy_pending", "excluded_by_policy", "included"]),
    reasons: z.array(z.string()),
    statusType: z.string(),
    documentKind: z.string().nullable(),
    metadataRevision: z.string().regex(HEX64),
    artifacts: z.array(z.object({
        fileType: z.enum(["document", "audit_trail"]),
        artifactIdentity: z.string().regex(HEX64),
        sha256: z.string().regex(HEX64),
        byteSize: z.number().int().min(0),
    })).max(2),
});
const candidatePageSchema = z.object({
    snapshotId: z.string().regex(SNAPSHOT_ID),
    items: z.array(candidateSchema).max(100),
    nextCursor: z.string().min(1).max(2048).nullable(),
});
const errorBodySchema = z.object({
    code: z.string().regex(ERROR_CODE),
    retryable: z.boolean().optional(),
    retryAfterSeconds: z.number().int().min(0).optional(),
});

export type SnapshotView = z.infer<typeof snapshotSchema>;
export type CandidateView = z.infer<typeof candidateSchema>;
export type CandidatePageView = z.infer<typeof candidatePageSchema>;

/** What the candidate promised about the bytes; the download is checked against all of it. */
export interface ArtifactRequest {
    artifactIdentity: string;
    sha256: string;
    byteLength: number;
}

export interface ExportClientOptions {
    baseUrl: string;
    token: string;
    companyId: string;
    requestTimeoutMs: number;
    /** Test seam; the real client uses the built-in `fetch`. */
    fetchImpl?: typeof fetch;
}

function invalidResponse(): never {
    throw new WorkerError("export-response-invalid");
}

function retryAfterOf(value: unknown): number | null {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? Math.min(value, RETRY_AFTER_MAX_SECONDS) : null;
}

/** Reads at most `limit` bytes of a response body; a longer body is cut off and reported as `null`, a dying one as a network failure. */
async function readLimited(response: Response, limit: number): Promise<Buffer | null> {
    const reader = response.body?.getReader();
    if (!reader) return Buffer.alloc(0);
    const chunks: Buffer[] = [];
    let total = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > limit) { await reader.cancel().catch(() => undefined); return null; }
            chunks.push(Buffer.from(value));
        }
    } catch {
        throw new ExportFailure(0, NETWORK, true, null);
    }
    return Buffer.concat(chunks);
}

/** Client of the BJJ-454 machine export API (BJJ-454 contract 3). One request in flight is the caller's rule. */
export class ExportClient {
    private readonly baseUrl: string;
    private readonly token: string;
    private readonly companyId: string;
    private readonly timeoutMs: number;
    private readonly fetchImpl: typeof fetch;

    constructor(options: ExportClientOptions) {
        this.baseUrl = validateExportBaseUrl(options.baseUrl);
        this.token = options.token;
        this.companyId = options.companyId;
        this.timeoutMs = options.requestTimeoutMs;
        this.fetchImpl = options.fetchImpl ?? fetch;
    }

    async createSnapshot(idempotencyKey: string): Promise<SnapshotView> {
        const response = await this.send("POST", "/snapshots", {
            "Idempotency-Key": idempotencyKey, "Content-Type": "application/json",
        }, JSON.stringify({
            companyId: this.companyId, scopeRevision: EXPORT_SCOPE_REVISION, policyRevision: EXPORT_POLICY_REVISION,
        }));
        return this.parseJson(response, snapshotSchema, 202);
    }

    async getSnapshot(snapshotId: string): Promise<SnapshotView> {
        const response = await this.send("GET", `/snapshots/${this.snapshotSegment(snapshotId)}`);
        return this.parseJson(response, snapshotSchema, 200);
    }

    async listCandidates(snapshotId: string, cursor: string | null): Promise<CandidatePageView> {
        const query = cursor === null ? "limit=100" : `cursor=${encodeURIComponent(cursor)}&limit=100`;
        const response = await this.send("GET", `/snapshots/${this.snapshotSegment(snapshotId)}/candidates?${query}`);
        return this.parseJson(response, candidatePageSchema, 200);
    }

    /**
     * Resolves once the response headers agree with the candidate (status 200, `Content-Length`,
     * `X-Content-Sha256`, `X-Artifact-Identity`); the returned stream then re-checks length and sha256 while it is
     * read, stops as soon as more bytes than announced arrive, and fails with `artifact-integrity` on excess bytes or a length/sha256 mismatch at a clean end; a dropped connection is a `NETWORK` `ExportFailure`.
     */
    async openArtifact(snapshotId: string, artifact: ArtifactRequest): Promise<AsyncIterable<Uint8Array>> {
        const segment = this.snapshotSegment(snapshotId);
        if (!HEX64.test(artifact.artifactIdentity) || !HEX64.test(artifact.sha256)
            || !Number.isSafeInteger(artifact.byteLength) || artifact.byteLength < 0) invalidResponse();
        if (artifact.byteLength > EXPORT_ARTIFACT_MAX_BYTES) throw new WorkerError("artifact-too-large");
        const signal = AbortSignal.timeout(this.timeoutMs);
        const response = await this.send("GET", `/snapshots/${segment}/artifacts/${artifact.artifactIdentity}`,
            { "Accept-Encoding": "identity" }, undefined, signal);
        if (response.status !== 200) {
            await response.body?.cancel().catch(() => undefined);
            invalidResponse();
        }
        const length = response.headers.get("content-length");
        if (length === null || !/^\d+$/.test(length) || Number(length) !== artifact.byteLength
            || response.headers.get("x-content-sha256") !== artifact.sha256
            || response.headers.get("x-artifact-identity") !== artifact.artifactIdentity) {
            await response.body?.cancel().catch(() => undefined);
            throw new WorkerError("artifact-integrity");
        }
        return this.stream(response, artifact);
    }

    private async *stream(response: Response, artifact: ArtifactRequest): AsyncGenerator<Uint8Array> {
        const reader = response.body?.getReader();
        if (!reader) throw new WorkerError("artifact-integrity");
        const hash = createHash("sha256");
        let count = 0;
        let finished = false;
        try {
            while (true) {
                let chunk: ReadableStreamReadResult<Uint8Array>;
                try {
                    chunk = await reader.read();
                } catch {
                    // A reset, a premature close or our own timeout is a network failure (retry_wait), never an integrity error.
                    throw new ExportFailure(0, NETWORK, true, null);
                }
                if (chunk.done) break;
                count += chunk.value.byteLength;
                if (count > artifact.byteLength) throw new WorkerError("artifact-integrity");
                hash.update(chunk.value);
                yield chunk.value;
            }
            if (count !== artifact.byteLength || hash.digest("hex") !== artifact.sha256) throw new WorkerError("artifact-integrity");
            finished = true;
        } finally {
            if (!finished) await reader.cancel().catch(() => undefined);
        }
    }

    private snapshotSegment(snapshotId: string): string {
        if (typeof snapshotId !== "string" || !SNAPSHOT_ID.test(snapshotId)) invalidResponse();
        return snapshotId;
    }

    private async send(
        method: "GET" | "POST", path: string, headers: Record<string, string> = {}, body?: string,
        signal: AbortSignal = AbortSignal.timeout(this.timeoutMs),
    ): Promise<Response> {
        let response: Response;
        try {
            response = await this.fetchImpl(`${this.baseUrl}${path}`, {
                method, body, signal, redirect: "manual",
                headers: { Authorization: `Bearer ${this.token}`, ...headers },
            });
        } catch {
            // Never keep the cause: it names the host and port.
            throw new ExportFailure(0, NETWORK, true, null);
        }
        if (response.status >= 200 && response.status < 300) return response;
        throw await this.failureOf(response);
    }

    /** Status, error code and retry hints only. The body is parsed, never echoed. */
    private async failureOf(response: Response): Promise<ExportFailure> {
        const status = response.status;
        const bytes = await readLimited(response, ERROR_BODY_MAX_BYTES).catch(() => null);
        let parsed: z.infer<typeof errorBodySchema> | null = null;
        if (bytes) {
            try {
                const result = errorBodySchema.safeParse(JSON.parse(bytes.toString("utf8")));
                parsed = result.success ? result.data : null;
            } catch { parsed = null; }
        }
        const headerRetry = response.headers.get("retry-after");
        const retryAfter = retryAfterOf(parsed?.retryAfterSeconds)
            ?? (headerRetry !== null && /^\d{1,9}$/.test(headerRetry) ? retryAfterOf(Number(headerRetry)) : null);
        const retryable = parsed?.retryable ?? (status === 429 || status >= 500);
        return new ExportFailure(status, parsed?.code ?? UNKNOWN_ERROR, retryable, retryAfter);
    }

    private async parseJson<T>(response: Response, schema: z.ZodType<T>, expectedStatus: number): Promise<T> {
        if (response.status !== expectedStatus) {
            await response.body?.cancel().catch(() => undefined);
            invalidResponse();
        }
        const bytes = await readLimited(response, JSON_BODY_MAX_BYTES);
        if (!bytes) invalidResponse();
        let value: unknown;
        try { value = JSON.parse(bytes.toString("utf8")); } catch { invalidResponse(); }
        const result = schema.safeParse(value);
        if (!result.success) invalidResponse();
        return result.data;
    }
}
