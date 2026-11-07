import { createHash } from "node:crypto";
import { types } from "node:util";
import { z } from "zod";
import { EXPORT_ARTIFACT_MAX_BYTES, EXPORT_POLICY_REVISION } from "domain/eformsign-backup/export/constants";
import { EXPORT_ERRORS } from "domain/eformsign-backup/export/errors";
import { MANUAL_BACKUP_LEASE_DURATION_MS, MANUAL_BACKUP_SCOPE_REVISION, manualBackupSnapshotId } from "domain/eformsign-backup/manual-backup-constants";
import {
    MANUAL_CONTROL_CODES, manualControlUuidSchema, manualClaimBodySchema, manualLeaseBodySchema,
    manualCandidatePageSchema, manualValidateBodySchema, manualArtifactBodySchema, manualWriteBodySchema, manualFinishBodySchema,
} from "domain/eformsign-backup/manual-backup-control";
import { canonicalJson } from "domain/eformsign-backup/source-evidence";
import {
    manualExecutionScopeSchema, manualSelectedCandidateSchema, manualDocumentResultDigest, manualAggregateResultDigest,
    type ManualExecutionScope, type ManualSelectedCandidate, type ManualDocumentResult, type ManualAggregateResult,
} from "domain/eformsign-backup/worker/manual-protocol";
import { hex64, identifier, isoUtc } from "domain/eformsign-backup/worker/schema-fields";
import { isWorkerReasonCode, WorkerError } from "domain/eformsign-backup/worker/worker-error";
import { validateExportBaseUrl, type ExportClientOptions, type ArtifactRequest, type SnapshotView } from "./export-client";

const SMALL_JSON = 64 * 1024;
const PAGE_JSON = 1024 * 1024;
const MAX_TIMEOUT = 10_000;
const utc = isoUtc.pipe(z.iso.datetime());
const safeInteger = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const countsSchema = z.strictObject({ total: safeInteger, inaccessible: safeInteger, unknownTemplate: safeInteger,
    policyPending: safeInteger, excludedByPolicy: safeInteger, included: safeInteger }).refine(c =>
    BigInt(c.total) === BigInt(c.inaccessible) + BigInt(c.unknownTemplate) + BigInt(c.policyPending) + BigInt(c.excludedByPolicy) + BigInt(c.included));
/** Shared with the private binding store so persisted claims obey the same response contract. */
export const manualClaimSnapshotSchema = z.strictObject({
    snapshotId: z.string(), status: z.literal("ready"), companyId: identifier,
    scopeRevision: z.literal(MANUAL_BACKUP_SCOPE_REVISION), policyRevision: z.literal(EXPORT_POLICY_REVISION),
    createdAt: utc, readyAt: utc, expiresAt: z.null(), counts: countsSchema,
    coverage: z.strictObject({ status: z.literal("unverified"), reasonCode: z.literal("collection-receipt-unavailable") }),
    backupComplete: z.literal(false),
});
const leaseSchema = z.strictObject({ runId: manualControlUuidSchema, leaseToken: manualControlUuidSchema });
const expirySchema = z.strictObject({ leaseExpiresAt: utc, leaseDurationMs: z.literal(MANUAL_BACKUP_LEASE_DURATION_MS) });
const claimSchema = z.strictObject({ executionScope: manualExecutionScopeSchema, snapshot: manualClaimSnapshotSchema,
    leaseToken: manualControlUuidSchema, leaseExpiresAt: utc, leaseDurationMs: z.literal(MANUAL_BACKUP_LEASE_DURATION_MS) })
    .refine(c => c.snapshot.companyId === c.executionScope.companyId && c.snapshot.snapshotId === manualBackupSnapshotId(c.executionScope));
const pageSchema = z.strictObject({ items: z.array(manualSelectedCandidateSchema).max(100), nextCursor: safeInteger.nullable() });
const acceptedSchema = z.strictObject({ accepted: z.literal(true) });
const validSchema = z.strictObject({ valid: z.literal(true) });
const errorSchema = z.strictObject({ code: z.string(), requestId: manualControlUuidSchema.optional() });
const knownCodes = new Set<string>([...MANUAL_CONTROL_CODES, ...Object.keys(EXPORT_ERRORS)]);
const artifactSchema = z.strictObject({ artifactIdentity: hex64, sha256: hex64,
    byteLength: safeInteger.min(1).max(EXPORT_ARTIFACT_MAX_BYTES) });

export interface ManualLease { runId: string; leaseToken: string }
export interface ManualClaim {
    executionScope: ManualExecutionScope; snapshot: SnapshotView; leaseToken: string;
    leaseExpiresAtUTC: string; leaseDurationMs: typeof MANUAL_BACKUP_LEASE_DURATION_MS;
}
export class ManualControlFailure extends Error {
    constructor(readonly httpStatus: number, readonly code: string) { super(code); this.name = "ManualControlFailure"; }
}
function invalid(): never { throw new WorkerError("export-response-invalid"); }
function responseFailure(error: unknown): WorkerError | ManualControlFailure {
    try {
        if (error instanceof ManualControlFailure) {
            const status = error.httpStatus;
            const code = error.code;
            if (status === 0 && (code === "NETWORK" || code === "ABORTED")) return new ManualControlFailure(0, code);
            if (Number.isInteger(status) && status >= 100 && status <= 599
                && (code === "UNKNOWN_ERROR" || knownCodes.has(code))) return new ManualControlFailure(status, code);
        }
        if (error instanceof WorkerError) {
            const reason = error.reasonCode;
            if (isWorkerReasonCode(reason)) return new WorkerError(reason);
        }
    } catch { /* Even classification can invoke a throwing accessor or Proxy trap. */ }
    return new WorkerError("export-response-invalid");
}
function responseStatus(response: Response): number {
    const status = response.status;
    if (!Number.isInteger(status) || status < 100 || status > 599) invalid();
    return status;
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
    try { const result = schema.safeParse(JSON.parse(canonicalJson(value))); if (result.success) return result.data; } catch { /* No accessor details. */ }
    return invalid();
}
function encode(value: unknown): string {
    try { const body = canonicalJson(value); if (Buffer.byteLength(body) <= SMALL_JSON) return body; } catch { /* Code only. */ }
    return invalid();
}
const cancelledResponses = new WeakSet<Response>();
/** Cancellation is issued once and never awaited: hostile transports may never settle cleanup. */
function cancellation(reader: ReadableStreamDefaultReader<Uint8Array>, response: Response): () => void {
    let issued = false;
    return () => {
        if (issued) return;
        issued = true;
        cancelledResponses.add(response);
        try { void Promise.resolve(reader.cancel()).catch(() => undefined); } catch { /* Discard transport details. */ }
        try { reader.releaseLock(); } catch { /* A pending read may still own the lock. */ }
    };
}
function cancelBody(response: Response): void {
    try {
        if (cancelledResponses.has(response)) return;
        cancelledResponses.add(response);
        void Promise.resolve(response.body?.cancel()).catch(() => undefined);
    } catch { /* Even a malformed response or throwing body accessor is never reflected. */ }
}
function bodyReader(response: Response, reason: "export-response-invalid" | "artifact-integrity"): ReadableStreamDefaultReader<Uint8Array> {
    try { const reader = response.body?.getReader(); if (reader) return reader; }
    catch { cancelBody(response); invalid(); }
    cancelBody(response);
    throw new WorkerError(reason);
}
/** Own race bounds even fetch/read implementations which ignore AbortSignal. */
class RequestLifetime {
    readonly controller = new AbortController();
    private timer: ReturnType<typeof setTimeout> | undefined;
    private readonly aborted: Promise<never>;
    private rejectAbort!: (error: ManualControlFailure) => void;
    private readonly callerAbort = () => this.abort();
    constructor(private readonly caller: AbortSignal | undefined, timeout: number) {
        this.aborted = new Promise<never>((_, reject) => { this.rejectAbort = reject; });
        void this.aborted.catch(() => undefined);
        caller?.addEventListener("abort", this.callerAbort, { once: true });
        if (caller?.aborted) this.abort();
        this.arm(timeout);
    }
    arm(timeout: number): void { this.clearTimer(); this.timer = setTimeout(() => this.abort(), timeout); }
    clearTimer(): void { clearTimeout(this.timer); this.timer = undefined; }
    abort(): void {
        if (this.controller.signal.aborted) return;
        this.rejectAbort(new ManualControlFailure(0, "ABORTED"));
        this.controller.abort();
    }
    check(): void { if (this.controller.signal.aborted) throw new ManualControlFailure(0, "ABORTED"); }
    async race<T>(work: () => Promise<T>): Promise<T> {
        this.check();
        try { return await Promise.race([work(), this.aborted]); }
        catch {
            // A transport may throw any value, including an Error with forged public fields.
            throw new ManualControlFailure(0, this.controller.signal.aborted ? "ABORTED" : "NETWORK");
        }
    }
    dispose(): void { this.clearTimer(); this.caller?.removeEventListener("abort", this.callerAbort); }
}

/** Unregistered manual-control transport. It never retries, renews autonomously, or starts artifact work. */
export class ManualControlClient {
    #token: string;
    private readonly baseUrl: string;
    private readonly companyId: string;
    private readonly timeout: number;
    private readonly fetchImpl: typeof fetch;
    constructor(options: ExportClientOptions) {
        let base: string;
        try { base = validateExportBaseUrl(options.baseUrl); } catch { throw new WorkerError("export-base-url-invalid"); }
        try {
            if (!/^ebx_[A-Za-z0-9_-]{43}$/.test(options.token) || typeof options.token !== "string"
                || !identifier.safeParse(options.companyId).success || !Number.isSafeInteger(options.requestTimeoutMs)
                || options.requestTimeoutMs <= 0 || (options.fetchImpl !== undefined && typeof options.fetchImpl !== "function")) throw 0;
            this.#token = options.token; this.companyId = options.companyId;
            this.timeout = Math.min(options.requestTimeoutMs, MAX_TIMEOUT); this.fetchImpl = options.fetchImpl ?? fetch;
        } catch { throw new WorkerError("config-invalid"); }
        this.baseUrl = `${base}/manual-runs`;
    }
    claim(signal?: AbortSignal): Promise<ManualClaim | null> {
        const body = encode(parse(manualClaimBodySchema, { companyId: this.companyId }));
        return this.json("/claim", body, claimSchema.refine(c => c.executionScope.companyId === this.companyId).nullable(), SMALL_JSON, signal).then(result => {
            if (result === null) return null;
            const { leaseExpiresAt, ...rest } = result;
            return { ...rest, leaseExpiresAtUTC: leaseExpiresAt };
        });
    }
    renew(lease: ManualLease, signal?: AbortSignal): Promise<{ leaseExpiresAtUTC: string; leaseDurationMs: typeof MANUAL_BACKUP_LEASE_DURATION_MS }> {
        const target = this.lease(lease);
        return this.json(`/${target.runId}/renew`, encode(parse(manualLeaseBodySchema, target.body)), expirySchema, SMALL_JSON, signal)
            .then(r => ({ leaseExpiresAtUTC: r.leaseExpiresAt, leaseDurationMs: r.leaseDurationMs }));
    }
    listCandidates(lease: ManualLease, options: { afterOrdinal: number; limit: number }, signal?: AbortSignal): Promise<{ items: ManualSelectedCandidate[]; nextCursor: number | null }> {
        const target = this.lease(lease);
        const page = parse(z.strictObject({ afterOrdinal: safeInteger, limit: safeInteger.min(1).max(100) }), options);
        const body = encode(parse(manualCandidatePageSchema, { ...target.body, ...page }));
        const responseSchema = pageSchema.refine(result => {
            const last = result.items.at(-1)?.ordinal;
            return result.items.length <= page.limit && result.items.every((c, i) => c.ordinal === page.afterOrdinal + i + 1)
                && new Set(result.items.map(c => c.documentId)).size === result.items.length
                && (result.nextCursor === null || (last !== undefined && result.nextCursor === last && last > page.afterOrdinal));
        });
        return this.json(`/${target.runId}/candidates`, body, responseSchema, PAGE_JSON, signal);
    }
    validate(lease: ManualLease, documentId?: string, signal?: AbortSignal): Promise<void> {
        const target = this.lease(lease);
        const body = encode(parse(manualValidateBodySchema, { ...target.body, ...(documentId === undefined ? {} : { documentId }) }));
        return this.json(`/${target.runId}/validate`, body, validSchema, SMALL_JSON, signal).then(() => undefined);
    }
    writeDocumentResults(lease: ManualLease, items: { payload: ManualDocumentResult; digest: string }[], signal?: AbortSignal): Promise<void> {
        const target = this.lease(lease);
        const request = parse(manualWriteBodySchema, { ...target.body, items });
        try {
            if (new Set(request.items.map(i => i.payload.documentId)).size !== request.items.length
                || request.items.some(i => i.payload.runId !== request.items[0]?.payload.runId
                    || i.payload.scope.jobId !== target.runId || i.payload.scope.companyId !== this.companyId
                    || manualDocumentResultDigest(i.payload) !== i.digest)) invalid();
        } catch { invalid(); }
        return this.json(`/${target.runId}/document-results`, encode(request), acceptedSchema, SMALL_JSON, signal).then(() => undefined);
    }
    finish(lease: ManualLease, payload: ManualAggregateResult, digest: string, signal?: AbortSignal): Promise<void> {
        const target = this.lease(lease);
        const request = parse(manualFinishBodySchema, { ...target.body, payload, digest });
        try {
            if (request.payload.scope.jobId !== target.runId || request.payload.scope.companyId !== this.companyId
                || manualAggregateResultDigest(request.payload) !== request.digest) invalid();
        } catch { invalid(); }
        return this.json(`/${target.runId}/finish`, encode(request), acceptedSchema, SMALL_JSON, signal).then(() => undefined);
    }
    openArtifact(lease: ManualLease, documentId: string, expected: ArtifactRequest, signal?: AbortSignal): Promise<AsyncIterable<Uint8Array>> {
        const target = this.lease(lease);
        const artifact = parse(artifactSchema, expected);
        const body = encode(parse(manualArtifactBodySchema, { ...target.body, documentId, artifactIdentity: artifact.artifactIdentity }));
        return this.artifact(`/${target.runId}/artifact`, body, artifact, signal);
    }
    private lease(value: ManualLease) {
        const lease = parse(leaseSchema, value);
        return { runId: lease.runId, body: { companyId: this.companyId, leaseToken: lease.leaseToken } };
    }
    private async send(path: string, body: string, life: RequestLifetime): Promise<Response> {
        return life.race(() => this.fetchImpl(`${this.baseUrl}${path}`, { method: "POST", redirect: "error",
            headers: { Authorization: `Bearer ${this.#token}`, "Content-Type": "application/json", "Accept-Encoding": "identity" },
            body, signal: life.controller.signal,
        }).then(response => { if (life.controller.signal.aborted) cancelBody(response); return response; }));
    }
    private async readJson(response: Response, limit: number, life: RequestLifetime,
        reader = bodyReader(response, "export-response-invalid")): Promise<unknown> {
        const cancel = cancellation(reader, response);
        let complete = false;
        try {
            const parts: Buffer[] = []; let total = 0;
            while (true) {
                const chunk = await life.race(() => reader.read());
                if (chunk.done) break;
                if (!types.isUint8Array(chunk.value)) invalid();
                total += chunk.value.byteLength;
                if (total > limit) invalid();
                parts.push(Buffer.from(chunk.value));
            }
            try { const result: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(parts, total))); complete = true; return result; }
            catch { invalid(); }
        } finally {
            if (!complete) { life.abort(); cancel(); }
            else reader.releaseLock();
        }
    }
    private async failure(response: Response, status: number, life: RequestLifetime): Promise<never> {
        // Metadata access is outside the malformed-error-JSON fallback. A throwing body/getReader
        // accessor must reach the public sanitizing catch, rather than become a server error code.
        const reader = bodyReader(response, "export-response-invalid");
        let code = "UNKNOWN_ERROR";
        try {
            const parsed = errorSchema.safeParse(await this.readJson(response, SMALL_JSON, life, reader));
            if (parsed.success && knownCodes.has(parsed.data.code)) code = parsed.data.code;
        } catch (error) {
            const safe = responseFailure(error);
            if (safe instanceof ManualControlFailure) throw safe;
        }
        throw new ManualControlFailure(status, code);
    }
    private async json<T>(path: string, body: string, schema: z.ZodType<T>, limit: number, signal?: AbortSignal): Promise<T> {
        const life = new RequestLifetime(signal, this.timeout);
        let response: Response | undefined;
        try {
            response = await this.send(path, body, life);
            const status = responseStatus(response);
            if (status < 200 || status >= 300) return await this.failure(response, status, life);
            return parse(schema, await this.readJson(response, limit, life));
        } catch (error) { life.abort(); if (response) cancelBody(response); throw responseFailure(error); } finally { life.dispose(); }
    }
    private async artifact(path: string, body: string, expected: ArtifactRequest, signal?: AbortSignal): Promise<AsyncIterable<Uint8Array>> {
        const life = new RequestLifetime(signal, this.timeout);
        let response: Response | undefined;
        let reader: ReadableStreamDefaultReader<Uint8Array>;
        try {
            response = await this.send(path, body, life);
            const status = responseStatus(response);
            if (status < 200 || status >= 300) return await this.failure(response, status, life);
            if (status !== 200 || response.headers.get("content-length") !== String(expected.byteLength)
                || response.headers.get("x-artifact-identity") !== expected.artifactIdentity
                || response.headers.get("x-content-sha256") !== expected.sha256 || !response.body) {
                cancelBody(response); throw new WorkerError("artifact-integrity");
            }
            reader = bodyReader(response, "artifact-integrity");
        } catch (error) { life.abort(); if (response) cancelBody(response); life.dispose(); throw responseFailure(error); }
        life.clearTimer();
        const cancel = cancellation(reader, response);
        const hash = createHash("sha256");
        let total = 0; let ended = false; let reading = false;
        const cleanup = (abort: boolean) => {
            if (ended) return;
            ended = true;
            life.controller.signal.removeEventListener("abort", onAbort);
            try {
                if (abort) { life.abort(); cancel(); } else reader.releaseLock();
            } catch { /* Cleanup must not replace the verified result with transport details. */ }
            finally { life.dispose(); }
        };
        const onAbort = () => { cancel(); life.dispose(); };
        life.controller.signal.addEventListener("abort", onAbort, { once: true });
        const iterator: AsyncIterableIterator<Uint8Array> = {
            [Symbol.asyncIterator]() { return this; },
            next: async () => {
                if (ended) return { done: true, value: undefined };
                life.check();
                if (reading) invalid();
                reading = true; life.arm(this.timeout);
                try {
                    const chunk = await life.race(() => reader.read());
                    if (chunk.done) {
                        if (total !== expected.byteLength || hash.digest("hex") !== expected.sha256) throw new WorkerError("artifact-integrity");
                        cleanup(false); return { done: true, value: undefined };
                    }
                    if (!types.isUint8Array(chunk.value)) throw new WorkerError("artifact-integrity");
                    total += chunk.value.byteLength;
                    if (total > expected.byteLength) throw new WorkerError("artifact-integrity");
                    hash.update(chunk.value);
                    return { done: false, value: chunk.value };
                } catch (error) { cleanup(true); throw responseFailure(error); }
                finally { reading = false; life.clearTimer(); }
            },
            return: async () => { cleanup(true); return { done: true, value: undefined }; },
            throw: async () => { cleanup(true); throw new ManualControlFailure(0, "ABORTED"); },
        };
        return iterator;
    }
}
