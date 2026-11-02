import { z } from "zod";

/**
 * What a failed Drive or OAuth call leaves behind: a kind, the HTTP status, Google's `error.errors[0].reason` and the
 * Retry-After hint. Nothing else, so no body, URL, header or token can reach a log or a ledger through it.
 * Structurally identical to `DriveFailureFacts` of the domain (BJJ-456 contract); `token-rejected` is an OAuth
 * refusal of the refresh grant (`reason` is then the OAuth `error` string).
 */
export interface DriveFailure {
    kind: "network" | "timeout" | "http" | "token-rejected";
    httpStatus: number | null;
    reason: string | null;
    retryAfterSeconds: number | null;
}

export type DriveResult<T> = { ok: true; value: T } | { ok: false; failure: DriveFailure };

export function driveOk<T>(value: T): DriveResult<T> {
    return { ok: true, value };
}

export function driveFail<T = never>(failure: DriveFailure): DriveResult<T> {
    return { ok: false, failure };
}

/** A malformed or impossible answer of an otherwise reachable server: reported as a transient upstream fault. */
export const PROTOCOL_FAILURE: DriveFailure = Object.freeze({ kind: "http", httpStatus: 502, reason: null, retryAfterSeconds: null });

/** Source of bearer tokens; the Drive client only needs `get`. */
export interface DriveTokenProvider {
    get(force?: boolean): Promise<DriveResult<string>>;
}

const RETRY_AFTER_MAX_SECONDS = 7 * 24 * 60 * 60;
const ERROR_BODY_MAX_BYTES = 64 * 1024;
const TOKEN_BODY_MAX_BYTES = 64 * 1024;
const EXPIRY_MARGIN_MS = 60_000;
const OAUTH_REJECTIONS: ReadonlySet<string> = new Set(["invalid_grant", "invalid_client", "unauthorized_client"]);
const OAUTH_ERROR = /^[a-z_]{1,64}$/;

/** `Retry-After` as whole seconds: a non-negative integer or an HTTP date; anything else is no hint. */
export function parseRetryAfter(header: string | null): number | null {
    if (header === null) return null;
    const value = header.trim();
    if (/^\d{1,9}$/.test(value)) return Math.min(Number(value), RETRY_AFTER_MAX_SECONDS);
    const date = Date.parse(value);
    if (!/^[A-Za-z]{3},/.test(value) || Number.isNaN(date)) return null;
    return Math.min(Math.max(0, Math.ceil((date - Date.now()) / 1000)), RETRY_AFTER_MAX_SECONDS);
}

/** A transport error becomes `timeout` (our own deadline) or `network`; the error itself is dropped, it names the host. */
export function failureOfThrown(error: unknown): DriveFailure {
    const name = typeof error === "object" && error !== null ? (error as { name?: unknown }).name : undefined;
    const kind = name === "TimeoutError" || name === "AbortError" ? "timeout" : "network";
    return { kind, httpStatus: null, reason: null, retryAfterSeconds: null };
}

/** Reads at most `limit` bytes of a body. `null` means the body was longer than the limit; a dying body throws. */
export async function readBodyLimited(response: Response, limit: number): Promise<Buffer | null> {
    const reader = response.body?.getReader();
    if (!reader) return Buffer.alloc(0);
    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > limit) { await reader.cancel().catch(() => undefined); return null; }
        chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
}

const tokenResponseSchema = z.object({
    access_token: z.string().min(1).max(8192),
    expires_in: z.number().int().min(0).max(31_536_000),
}).passthrough();

const oauthErrorSchema = z.object({ error: z.string() }).passthrough();

export interface DriveTokenSourceOptions {
    tokenUrl: string;
    clientId: string;
    clientSecret: string;
    refreshToken: string;
    fetchImpl?: typeof fetch;
    now: () => Date;
    requestTimeoutMs: number;
}

/**
 * OAuth refresh-token grant against `tokenUrl`. The access token is cached in memory until 60 s before it expires by the
 * injected clock; concurrent callers share one request; `get(true)` bypasses the cache. A failure carries facts only.
 */
export class DriveTokenSource implements DriveTokenProvider {
    private readonly options: DriveTokenSourceOptions;
    private readonly fetchImpl: typeof fetch;
    private cached: { token: string; validUntil: number } | null = null;
    private inflight: Promise<DriveResult<string>> | null = null;

    constructor(options: DriveTokenSourceOptions) {
        this.options = options;
        this.fetchImpl = options.fetchImpl ?? fetch;
    }

    get(force = false): Promise<DriveResult<string>> {
        if (!force && this.cached && this.options.now().getTime() < this.cached.validUntil) {
            return Promise.resolve(driveOk(this.cached.token));
        }
        if (this.inflight) return this.inflight;
        if (force) this.cached = null; // the token that was just refused must not be served again if the refresh fails
        const pending = this.refresh().finally(() => { this.inflight = null; });
        this.inflight = pending;
        return pending;
    }

    private async refresh(): Promise<DriveResult<string>> {
        const { tokenUrl, clientId, clientSecret, refreshToken, requestTimeoutMs } = this.options;
        let response: Response;
        let body: Buffer | null;
        try {
            response = await this.fetchImpl(tokenUrl, {
                method: "POST", redirect: "manual", signal: AbortSignal.timeout(requestTimeoutMs),
                headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
                body: new URLSearchParams({
                    grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret,
                }).toString(),
            });
            body = await readBodyLimited(response, response.status === 200 ? TOKEN_BODY_MAX_BYTES : ERROR_BODY_MAX_BYTES);
        } catch (error) {
            // Never keep the cause: it names the host and port.
            return driveFail(failureOfThrown(error));
        }
        const status = response.status;
        if (status !== 200) return driveFail(this.rejection(status, body, response.headers.get("retry-after")));
        let parsed: z.infer<typeof tokenResponseSchema> | null = null;
        if (body) {
            try {
                const result = tokenResponseSchema.safeParse(JSON.parse(body.toString("utf8")));
                parsed = result.success ? result.data : null;
            } catch { parsed = null; }
        }
        if (!parsed) return driveFail(PROTOCOL_FAILURE);
        this.cached = {
            token: parsed.access_token,
            validUntil: this.options.now().getTime() + Math.max(0, parsed.expires_in * 1000 - EXPIRY_MARGIN_MS),
        };
        return driveOk(parsed.access_token);
    }

    /** 400/401 naming a dead grant or client is `token-rejected`; any other refusal keeps only its status and retry hint. */
    private rejection(status: number, body: Buffer | null, retryAfter: string | null): DriveFailure {
        if ((status === 400 || status === 401) && body) {
            try {
                const result = oauthErrorSchema.safeParse(JSON.parse(body.toString("utf8")));
                if (result.success && OAUTH_ERROR.test(result.data.error) && OAUTH_REJECTIONS.has(result.data.error)) {
                    return { kind: "token-rejected", httpStatus: status, reason: result.data.error, retryAfterSeconds: null };
                }
            } catch { /* not JSON: an ordinary refusal */ }
        }
        return { kind: "http", httpStatus: status, reason: null, retryAfterSeconds: parseRetryAfter(retryAfter) };
    }
}
