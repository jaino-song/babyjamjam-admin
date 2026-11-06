import { z } from "zod";

import { WorkerError } from "domain/eformsign-backup/worker";

import { awaitExecutionSignal, beforeExecutionEffect, checkExecutionSignal, executionChunks, isExecutionFencedError, type ExecutionEffectFence } from "../execution-effect-fence";

import {
    PROTOCOL_FAILURE, driveFail, driveOk, failureOfThrown, parseRetryAfter, readBodyLimited,
    type DriveFailure, type DriveResult, type DriveTokenProvider,
} from "./drive-auth";

export type { DriveFailure, DriveResult } from "./drive-auth";

const FILE_FIELDS = "id,name,mimeType,parents,trashed,size,sha256Checksum,appProperties";
const FOLDER_MIME_TYPE = "application/vnd.google-apps.folder";
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const PAGE_TOKEN_PATTERN = /^[\x21-\x7e]{1,2048}$/;
const APP_PROPERTY_PATTERN = /^[A-Za-z0-9_.:-]{1,124}$/;
const REASON_PATTERN = /^[A-Za-z]{1,64}$/;
const JSON_BODY_MAX_BYTES = 8 * 1024 * 1024;
const ERROR_BODY_MAX_BYTES = 64 * 1024;
const PAGE_SIZE = 1000;
const CHUNK_GRANULARITY = 262144;
const MAX_FIND_PAGES = 100;
/** One call to `uploadResumable` starts at most this many sessions; a session that keeps expiring is not an outage to ride out. */
const MAX_SESSIONS = 3;
/** Consecutive chunk answers that move the server's offset no further than where the chunk began. */
const MAX_STALLS = 3;
const MAX_PROBES = 8;

export interface DriveFile {
    id: string;
    name: string;
    mimeType: string;
    parents: string[];
    trashed: boolean;
    size: number | null;
    sha256Checksum: string | null;
    appProperties: Record<string, string>;
}

const driveFileSchema = z.object({
    id: z.string().regex(ID_PATTERN),
    name: z.string().max(4096),
    mimeType: z.string().max(256),
    parents: z.array(z.string().regex(ID_PATTERN)).max(100).optional(),
    trashed: z.boolean().optional(),
    size: z.union([z.string().regex(/^\d{1,16}$/), z.number().int().min(0)]).optional(),
    sha256Checksum: z.string().regex(/^[0-9a-fA-F]{64}$/).optional(),
    appProperties: z.record(z.string(), z.string()).optional(),
});

function toDriveFile(raw: z.infer<typeof driveFileSchema>): DriveFile {
    return {
        id: raw.id, name: raw.name, mimeType: raw.mimeType, parents: raw.parents ?? [], trashed: raw.trashed ?? false,
        size: raw.size === undefined ? null : Number(raw.size),
        sha256Checksum: raw.sha256Checksum === undefined ? null : raw.sha256Checksum.toLowerCase(),
        appProperties: raw.appProperties ?? {},
    };
}

const errorBodySchema = z.object({
    error: z.object({ errors: z.array(z.object({ reason: z.string() })).optional() }),
});
const listSchema = z.object({ nextPageToken: z.string().optional(), files: z.array(driveFileSchema) });
const generateIdsSchema = z.object({ ids: z.array(z.string().regex(/^[A-Za-z0-9_-]{10,128}$/)) });
const aboutSchema = z.object({ user: z.object({ permissionId: z.string().regex(ID_PATTERN) }) });

/** A body that died after the headers arrived: thrown by the iterable `download` returns, carrying facts only. */
export class DriveTransferError extends Error {
    constructor(readonly failure: DriveFailure) {
        super(failure.kind);
        this.name = "DriveTransferError";
    }
}

export interface DriveClientOptions {
    apiBaseUrl: string;
    uploadBaseUrl: string;
    tokens: DriveTokenProvider;
    /** Test seam; the real client uses the built-in `fetch`. */
    fetchImpl?: typeof fetch;
    requestTimeoutMs: number;
    chunkBytes: number;
}

export interface UploadMeta {
    id: string;
    name: string;
    parentId: string;
    mimeType: string;
    appProperties?: Record<string, string>;
}

function requireId(value: string): string {
    if (typeof value !== "string" || !ID_PATTERN.test(value)) throw new WorkerError("internal");
    return value;
}

function trimBase(url: string): string {
    return url.replace(/\/+$/, "");
}

/**
 * Re-readable view of the bytes of one upload. `open(offset)` is called again only when the server's offset differs from
 * where the open stream stands. Before the last chunk is released the stream is read to its end, so a source that checks
 * itself at the end (length, sha256) fails before the final request can complete the file.
 */
class ByteSource {
    private iterator: AsyncIterator<Uint8Array> | null = null;
    private carry: Buffer = Buffer.alloc(0);
    private position = 0;

    constructor(private readonly open: (offset: number) => AsyncIterable<Uint8Array>, private readonly total: number, private readonly effectFence?: ExecutionEffectFence) {}

    async take(offset: number, length: number): Promise<Buffer> {
        checkExecutionSignal(this.effectFence);
        if (length === 0 && this.total > 0) return Buffer.alloc(0); // everything is already held by the server; nothing left to read
        if (this.iterator === null || offset !== this.position) {
            await this.close();
            checkExecutionSignal(this.effectFence);
            this.iterator = executionChunks(this.open(offset), this.effectFence)[Symbol.asyncIterator]();
            this.position = offset;
        }
        const iterator = this.iterator;
        const parts: Buffer[] = [];
        let got = 0;
        if (this.carry.length > 0) {
            const used = Math.min(length, this.carry.length);
            parts.push(this.carry.subarray(0, used));
            this.carry = this.carry.subarray(used);
            got = used;
        }
        while (got < length) {
            const next = await iterator.next();
            if (next.done) throw new WorkerError("artifact-integrity");
            const chunk = Buffer.from(next.value);
            const need = length - got;
            if (chunk.length > need) {
                parts.push(chunk.subarray(0, need));
                this.carry = chunk.subarray(need);
                got = length;
            } else {
                parts.push(chunk);
                got += chunk.length;
            }
        }
        this.position = offset + length;
        if (this.position === this.total) {
            if (this.carry.length > 0) throw new WorkerError("artifact-integrity");
            const tail = await iterator.next();
            if (!tail.done) throw new WorkerError("artifact-integrity");
            this.iterator = null;
        }
        return Buffer.concat(parts);
    }

    async close(abandon = false): Promise<void> {
        const iterator = this.iterator;
        this.iterator = null;
        this.carry = Buffer.alloc(0);
        try {
            const closing = (async () => iterator?.return?.())();
            if (abandon || this.effectFence?.signal.aborted) void closing.catch(() => undefined);
            else await awaitExecutionSignal(this.effectFence, closing);
        } catch (error) {
            if (isExecutionFencedError(error)) throw error;
            // Ordinary source cleanup failures still abandon the source.
        }
    }
}

type Accept = (status: number) => boolean;
const ACCEPT_2XX: Accept = status => status >= 200 && status < 300;

/**
 * Google Drive v3 over `fetch`: just the calls the backup needs, every one returning facts on failure and never a body, a
 * URL, a header or a token. A 401 refreshes the access token once (forced) and repeats the request once.
 */
export class DriveClient {
    private readonly apiBase: string;
    private readonly uploadBase: string;
    private readonly uploadOrigin: string;
    private readonly tokens: DriveTokenProvider;
    private readonly fetchImpl: typeof fetch;
    private readonly timeoutMs: number;
    private readonly chunkBytes: number;

    constructor(options: DriveClientOptions) {
        this.apiBase = trimBase(options.apiBaseUrl);
        this.uploadBase = trimBase(options.uploadBaseUrl);
        try {
            this.uploadOrigin = new URL(this.uploadBase).origin;
        } catch {
            throw new WorkerError("config-invalid");
        }
        this.tokens = options.tokens;
        this.fetchImpl = options.fetchImpl ?? fetch;
        this.timeoutMs = options.requestTimeoutMs;
        // Drive takes every non-final chunk of a resumable upload in multiples of 256 KiB.
        if (!Number.isSafeInteger(options.chunkBytes) || options.chunkBytes < CHUNK_GRANULARITY || options.chunkBytes % CHUNK_GRANULARITY !== 0) {
            throw new WorkerError("config-invalid");
        }
        this.chunkBytes = options.chunkBytes;
    }

    async generateIds(count: number, effectFence?: ExecutionEffectFence): Promise<DriveResult<string[]>> {
        await beforeExecutionEffect(effectFence);
        if (!Number.isSafeInteger(count) || count < 1 || count > 1000) throw new WorkerError("internal");
        const response = await this.send("GET", `${this.apiBase}/drive/v3/files/generateIds?count=${count}&space=drive`, undefined, undefined, undefined, undefined, effectFence);
        if (!response.ok) return response;
        const body = await this.json(response.value, generateIdsSchema, effectFence);
        if (!body.ok) return body;
        return body.value.ids.length === count ? driveOk(body.value.ids) : driveFail(PROTOCOL_FAILURE);
    }

    async createFolder(meta: { id: string; name: string; parentId: string; appProperties?: Record<string, string> }, effectFence?: ExecutionEffectFence): Promise<DriveResult<DriveFile>> {
        await beforeExecutionEffect(effectFence);
        requireId(meta.id);
        requireId(meta.parentId);
        const response = await this.send("POST", `${this.apiBase}/drive/v3/files?fields=${encodeURIComponent(FILE_FIELDS)}`,
            { "Content-Type": "application/json; charset=UTF-8" },
            JSON.stringify({
                id: meta.id, name: meta.name, mimeType: FOLDER_MIME_TYPE, parents: [meta.parentId],
                ...(meta.appProperties ? { appProperties: meta.appProperties } : {}),
            }), undefined, undefined, effectFence);
        return response.ok ? this.file(response.value, effectFence) : response;
    }

    /** `ok(null)` for a file Drive does not know (404); a trashed file is returned with `trashed: true`. */
    async getFile(id: string, effectFence?: ExecutionEffectFence): Promise<DriveResult<DriveFile | null>> {
        await beforeExecutionEffect(effectFence);
        requireId(id);
        const response = await this.send("GET", `${this.apiBase}/drive/v3/files/${id}?fields=${encodeURIComponent(FILE_FIELDS)}`,
            {}, undefined, status => ACCEPT_2XX(status) || status === 404, undefined, effectFence);
        if (!response.ok) return response;
        if (response.value.status === 404) {
            await this.discard(response.value, effectFence);
            return driveOk(null);
        }
        return this.file(response.value, effectFence);
    }

    /** One page of the untrashed children of a folder. */
    async listChildren(parentId: string, pageToken?: string, effectFence?: ExecutionEffectFence): Promise<DriveResult<{ files: DriveFile[]; nextPageToken: string | null }>> {
        await beforeExecutionEffect(effectFence);
        requireId(parentId);
        return this.listPage(`'${parentId}' in parents and trashed=false`, pageToken, effectFence);
    }

    /** Every untrashed folder carrying the app property, across all pages. */
    async findFolders(query: { appPropertyKey: string; appPropertyValue: string }, effectFence?: ExecutionEffectFence): Promise<DriveResult<DriveFile[]>> {
        await beforeExecutionEffect(effectFence);
        if (!APP_PROPERTY_PATTERN.test(query.appPropertyKey) || !APP_PROPERTY_PATTERN.test(query.appPropertyValue)) throw new WorkerError("internal");
        const q = `mimeType='${FOLDER_MIME_TYPE}' and trashed=false and appProperties has { key='${query.appPropertyKey}' and value='${query.appPropertyValue}' }`;
        const found: DriveFile[] = [];
        let pageToken: string | undefined;
        for (let page = 0; page < MAX_FIND_PAGES; page += 1) {
            const result = await this.listPage(q, pageToken, effectFence);
            if (!result.ok) return result;
            found.push(...result.value.files);
            if (result.value.nextPageToken === null) return driveOk(found);
            pageToken = result.value.nextPageToken;
        }
        return driveFail(PROTOCOL_FAILURE);
    }

    async about(effectFence?: ExecutionEffectFence): Promise<DriveResult<{ permissionId: string }>> {
        await beforeExecutionEffect(effectFence);
        const response = await this.send("GET", `${this.apiBase}/drive/v3/about?fields=${encodeURIComponent("user(permissionId)")}`, undefined, undefined, undefined, undefined, effectFence);
        if (!response.ok) return response;
        const body = await this.json(response.value, aboutSchema, effectFence);
        return body.ok ? driveOk({ permissionId: body.value.user.permissionId }) : body;
    }

    /**
     * Uploads `byteLength` bytes as the file `meta.id`. The session URL never leaves this function. `open(offset)` supplies the
     * bytes from `offset` on and is called again whenever the server's offset is not where the open stream stands; an error it
     * throws (a source that fails its own integrity check, say) is not a Drive failure and propagates.
     */
    async uploadResumable(
        meta: UploadMeta, open: (offset: number) => AsyncIterable<Uint8Array>, byteLength: number, effectFence?: ExecutionEffectFence,
    ): Promise<DriveResult<DriveFile>> {
        await beforeExecutionEffect(effectFence);
        requireId(meta.id);
        requireId(meta.parentId);
        if (!Number.isSafeInteger(byteLength) || byteLength < 0) throw new WorkerError("internal");
        const source = new ByteSource(open, byteLength, effectFence);
        const budget = { probes: 0 };
        let fenced = false;
        try {
            for (let session = 0; session < MAX_SESSIONS; session += 1) {
                const started = await this.startSession(meta, byteLength, effectFence);
                if (!started.ok) return started;
                const outcome = await this.runSession(started.value, byteLength, source, budget, effectFence);
                if (outcome !== "expired") return outcome;
            }
            return driveFail(PROTOCOL_FAILURE);
        } catch (error) {
            fenced = isExecutionFencedError(error);
            throw error;
        } finally {
            await source.close(fenced);
        }
    }

    /** Streams the content of a file. Headers are checked here; a body that dies later throws `DriveTransferError`. */
    async download(id: string, effectFence?: ExecutionEffectFence): Promise<DriveResult<AsyncIterable<Uint8Array>>> {
        await beforeExecutionEffect(effectFence);
        requireId(id);
        // `requestTimeoutMs` bounds the response headers only; the body gets an idle timeout.
        const controller = new AbortController();
        const headerTimer = setTimeout(() => controller.abort(), this.timeoutMs);
        let response: DriveResult<Response>;
        try {
            response = await this.send("GET", `${this.apiBase}/drive/v3/files/${id}?alt=media`,
                { "Accept-Encoding": "identity" }, undefined, status => status === 200, controller.signal, effectFence);
        } finally {
            clearTimeout(headerTimer);
        }
        if (!response.ok) return response;
        return driveOk(this.stream(response.value, controller, effectFence));
    }

    private async listPage(q: string, pageToken: string | undefined, effectFence?: ExecutionEffectFence): Promise<DriveResult<{ files: DriveFile[]; nextPageToken: string | null }>> {
        if (pageToken !== undefined && !PAGE_TOKEN_PATTERN.test(pageToken)) throw new WorkerError("internal");
        const query = `q=${encodeURIComponent(q)}&pageSize=${PAGE_SIZE}&fields=${encodeURIComponent(`nextPageToken,files(${FILE_FIELDS})`)}`
            + (pageToken === undefined ? "" : `&pageToken=${encodeURIComponent(pageToken)}`);
        const response = await this.send("GET", `${this.apiBase}/drive/v3/files?${query}`, undefined, undefined, undefined, undefined, effectFence);
        if (!response.ok) return response;
        const body = await this.json(response.value, listSchema, effectFence);
        if (!body.ok) return body;
        return driveOk({ files: body.value.files.map(toDriveFile), nextPageToken: body.value.nextPageToken ?? null });
    }

    private async startSession(meta: UploadMeta, byteLength: number, effectFence?: ExecutionEffectFence): Promise<DriveResult<string>> {
        const response = await this.send("POST",
            `${this.uploadBase}/upload/drive/v3/files?uploadType=resumable&fields=${encodeURIComponent(FILE_FIELDS)}`,
            {
                "Content-Type": "application/json; charset=UTF-8",
                "X-Upload-Content-Type": meta.mimeType,
                "X-Upload-Content-Length": String(byteLength),
            },
            JSON.stringify({
                id: meta.id, name: meta.name, parents: [meta.parentId], mimeType: meta.mimeType,
                ...(meta.appProperties ? { appProperties: meta.appProperties } : {}),
            }), undefined, undefined, effectFence);
        if (!response.ok) return response;
        await this.discard(response.value, effectFence);
        const location = response.value.headers.get("location");
        if (location === null) return driveFail(PROTOCOL_FAILURE);
        try {
            const url = new URL(location, `${this.uploadBase}/`);
            // The session URL is a capability and carries the bearer token: it must stay on the upload origin.
            if (url.origin !== this.uploadOrigin) return driveFail(PROTOCOL_FAILURE);
            return driveOk(url.toString());
        } catch {
            return driveFail(PROTOCOL_FAILURE);
        }
    }

    /** Drives one session to its end: the file, a failure, or `"expired"` when Drive no longer knows the session. */
    private async runSession(
        sessionUrl: string, total: number, source: ByteSource, budget: { probes: number }, effectFence?: ExecutionEffectFence,
    ): Promise<DriveResult<DriveFile> | "expired"> {
        const accept: Accept = status => status === 200 || status === 201 || status === 308 || status === 404 || status === 410;
        let offset = 0;
        let stalls = 0;
        let probing = false;
        let lastNetwork: DriveFailure | null = null;
        while (true) {
            let result: DriveResult<Response>;
            const began = offset;
            if (probing) {
                if (budget.probes >= MAX_PROBES) return driveFail(lastNetwork ?? PROTOCOL_FAILURE);
                budget.probes += 1;
                result = await this.send("PUT", sessionUrl, { "Content-Range": `bytes */${total}` }, Buffer.alloc(0), accept, undefined, effectFence);
            } else {
                const length = Math.min(this.chunkBytes, total - offset);
                const chunk = await source.take(offset, length);
                const range = length === 0 ? `bytes */${total}` : `bytes ${offset}-${offset + length - 1}/${total}`;
                result = await this.send("PUT", sessionUrl, { "Content-Range": range }, chunk, accept, undefined, effectFence);
            }
            if (!result.ok) {
                if (!probing && (result.failure.kind === "network" || result.failure.kind === "timeout")) {
                    // The chunk may or may not have arrived: ask the server where it stands.
                    lastNetwork = result.failure;
                    probing = true;
                    continue;
                }
                return result;
            }
            const response = result.value;
            if (response.status === 200 || response.status === 201) return this.file(response, effectFence);
            if (response.status === 404 || response.status === 410) {
                await this.discard(response, effectFence);
                return "expired";
            }
            // 308: no `Range` means the server holds nothing, otherwise `bytes=0-N` means it holds N+1 bytes.
            await this.discard(response, effectFence);
            const range = response.headers.get("range");
            let next = 0;
            if (range !== null) {
                const held = /^bytes=0-(\d{1,16})$/.exec(range.trim());
                if (!held) return driveFail(PROTOCOL_FAILURE);
                next = Number(held[1]) + 1;
            }
            if (next > total) return driveFail(PROTOCOL_FAILURE);
            if (!probing) {
                stalls = next <= began ? stalls + 1 : 0;
                if (stalls > MAX_STALLS) return driveFail(PROTOCOL_FAILURE);
            }
            probing = false;
            offset = next;
        }
    }

    private stream(response: Response, controller: AbortController, effectFence?: ExecutionEffectFence): AsyncIterable<Uint8Array> {
        if (!effectFence) return this.streamBody(response, controller);
        // Own the body immediately: an async generator alone cannot cancel before its first next(), or between pulls.
        const reader = response.body?.getReader();
        let finished = false;
        const finish = (cancel: boolean): Promise<void> => {
            if (finished) return Promise.resolve();
            finished = true;
            effectFence.signal.removeEventListener("abort", abort);
            const closing = cancel ? (async () => {
                try { await reader?.cancel(); } catch { /* cancellation cannot expose source details */ }
            })() : undefined;
            reader?.releaseLock();
            return closing ?? Promise.resolve();
        };
        const abort = (): void => {
            controller.abort();
            void finish(true);
        };
        effectFence.signal.addEventListener("abort", abort, { once: true });
        if (effectFence.signal.aborted) abort();
        if (!reader) void finish(false);
        const iterator: AsyncIterableIterator<Uint8Array> = {
            [Symbol.asyncIterator]() { return this; },
            next: async () => {
                checkExecutionSignal(effectFence);
                if (finished || !reader) {
                    await finish(false);
                    return { done: true, value: undefined };
                }
                try {
                    const chunk = await this.readIdle(reader, controller, effectFence);
                    checkExecutionSignal(effectFence);
                    if (chunk.done) await finish(false);
                    return chunk;
                } catch (error) {
                    void finish(true);
                    if (isExecutionFencedError(error)) throw error;
                    checkExecutionSignal(effectFence);
                    throw new DriveTransferError(failureOfThrown(error));
                }
            },
            return: async () => {
                const closing = finish(true);
                if (!effectFence.signal.aborted) await awaitExecutionSignal(effectFence, closing);
                return { done: true, value: undefined };
            },
        };
        return iterator;
    }

    private async *streamBody(response: Response, controller: AbortController): AsyncGenerator<Uint8Array> {
        const reader = response.body?.getReader();
        if (!reader) return;
        let finished = false;
        try {
            while (true) {
                let chunk: ReadableStreamReadResult<Uint8Array>;
                try {
                    chunk = await this.readIdle(reader, controller);
                } catch (error) {
                    throw new DriveTransferError(failureOfThrown(error));
                }
                if (chunk.done) break;
                yield chunk.value;
            }
            finished = true;
        } finally {
            if (!finished) await reader.cancel().catch(() => undefined);
        }
    }

    /** One body read under an idle timeout, armed only while the read is pending. */
    private async readIdle(reader: ReadableStreamDefaultReader<Uint8Array>, controller: AbortController, effectFence?: ExecutionEffectFence): Promise<ReadableStreamReadResult<Uint8Array>> {
        let timer: NodeJS.Timeout | undefined;
        const idle = new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => {
                controller.abort();
                reject(Object.assign(new Error("idle-timeout"), { name: "TimeoutError" }));
            }, this.timeoutMs);
        });
        try {
            checkExecutionSignal(effectFence);
            // The fenced stream owns cancellation through its abort listener and finish().
            return await awaitExecutionSignal(effectFence, Promise.race([reader.read(), idle]));
        } finally {
            clearTimeout(timer);
        }
    }

    /** One authenticated request. A 401 gets one forced token refresh and one repeat; a refused refresh is returned unchanged. */
    private async send(
        method: "GET" | "POST" | "PUT", url: string, headers: Record<string, string> = {}, body?: string | Buffer,
        accept: Accept = ACCEPT_2XX, signal?: AbortSignal, effectFence?: ExecutionEffectFence,
    ): Promise<DriveResult<Response>> {
        for (let attempt = 0; attempt < 2; attempt += 1) {
            await beforeExecutionEffect(effectFence);
            let token: DriveResult<string>;
            try {
                checkExecutionSignal(effectFence);
                token = await this.tokens.get(attempt === 1);
            } catch (error) { checkExecutionSignal(effectFence); throw error; }
            await beforeExecutionEffect(effectFence);
            if (!token.ok) return token;
            let response: Response;
            try {
                const requestSignal = signal ?? AbortSignal.timeout(this.timeoutMs);
                const combined = effectFence ? AbortSignal.any([requestSignal, effectFence.signal]) : requestSignal;
                checkExecutionSignal(effectFence);
                const pending = this.fetchImpl(url, {
                    method, redirect: "manual", signal: combined,
                    headers: { Authorization: `Bearer ${token.value}`, ...headers },
                    body: body as BodyInit | undefined,
                });
                response = await awaitExecutionSignal(effectFence, pending, () => {
                    void pending.then(late => late.body?.cancel().catch(() => undefined), () => undefined);
                });
            } catch (error) {
                if (isExecutionFencedError(error)) throw error;
                checkExecutionSignal(effectFence);
                // Never keep the cause: it names the host and port.
                return driveFail(failureOfThrown(error));
            }
            if (response.status === 401 && attempt === 0) {
                await this.discard(response, effectFence);
                continue;
            }
            if (accept(response.status)) return driveOk(response);
            return driveFail(await this.failureOf(response, effectFence));
        }
        return driveFail(PROTOCOL_FAILURE);
    }

    private async discard(response: Response, effectFence?: ExecutionEffectFence): Promise<void> {
        await awaitExecutionSignal(effectFence, response.body?.cancel().catch(() => undefined) ?? Promise.resolve());
    }

    private async readBody(response: Response, limit: number, effectFence?: ExecutionEffectFence): Promise<Buffer | null> {
        if (!effectFence) return readBodyLimited(response, limit);
        const reader = response.body?.getReader();
        const cancel = (): void => { void reader?.cancel().catch(() => undefined); };
        const chunks: Buffer[] = [];
        let total = 0;
        try {
            checkExecutionSignal(effectFence);
            if (!reader) return Buffer.alloc(0);
            while (true) {
                checkExecutionSignal(effectFence);
                const part = await awaitExecutionSignal(effectFence, reader.read(), cancel);
                checkExecutionSignal(effectFence);
                if (part.done) return Buffer.concat(chunks);
                total += part.value.byteLength;
                if (total > limit) { cancel(); return null; }
                chunks.push(Buffer.from(part.value));
            }
        } finally {
            cancel();
            reader?.releaseLock();
        }
    }

    /** Status, Google's `reason` and the retry hint only. The body is parsed, never echoed. */
    private async failureOf(response: Response, effectFence?: ExecutionEffectFence): Promise<DriveFailure> {
        let reason: string | null = null;
        try {
            const bytes = await this.readBody(response, ERROR_BODY_MAX_BYTES, effectFence);
            checkExecutionSignal(effectFence);
            if (bytes) {
                const result = errorBodySchema.safeParse(JSON.parse(bytes.toString("utf8")));
                const candidate = result.success ? result.data.error.errors?.[0]?.reason : undefined;
                reason = candidate !== undefined && REASON_PATTERN.test(candidate) ? candidate : null;
            }
        } catch (error) {
            if (isExecutionFencedError(error)) throw error;
            checkExecutionSignal(effectFence);
            reason = null;
        }
        return { kind: "http", httpStatus: response.status, reason, retryAfterSeconds: parseRetryAfter(response.headers.get("retry-after")) };
    }

    private async json<T>(response: Response, schema: z.ZodType<T>, effectFence?: ExecutionEffectFence): Promise<DriveResult<T>> {
        let bytes: Buffer | null;
        try {
            bytes = await this.readBody(response, JSON_BODY_MAX_BYTES, effectFence);
            checkExecutionSignal(effectFence);
        } catch (error) {
            if (isExecutionFencedError(error)) throw error;
            checkExecutionSignal(effectFence);
            return driveFail(failureOfThrown(error));
        }
        if (!bytes) return driveFail(PROTOCOL_FAILURE);
        let value: unknown;
        try { value = JSON.parse(bytes.toString("utf8")); } catch { return driveFail(PROTOCOL_FAILURE); }
        const result = schema.safeParse(value);
        return result.success ? driveOk(result.data) : driveFail(PROTOCOL_FAILURE);
    }

    private async file(response: Response, effectFence?: ExecutionEffectFence): Promise<DriveResult<DriveFile>> {
        const body = await this.json(response, driveFileSchema, effectFence);
        return body.ok ? driveOk(toDriveFile(body.value)) : body;
    }
}
