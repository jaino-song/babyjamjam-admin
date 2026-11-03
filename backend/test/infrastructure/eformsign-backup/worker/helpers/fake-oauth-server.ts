import http from "node:http";
import type { AddressInfo } from "node:net";

export interface OAuthQueuedReply { status: number; json?: unknown; headers?: Record<string, string> }

export interface FakeOAuthOptions {
    clientId?: string;
    clientSecret?: string;
    refreshToken?: string;
    expiresIn?: number;
}

/**
 * A `node:http` stand-in for Google's OAuth token endpoint, bound to 127.0.0.1 on an ephemeral port. Every value it hands
 * out is synthetic. Access tokens it issues are shared with `FakeDriveServer` through `accepts`.
 */
export class FakeOAuthServer {
    readonly clientId: string;
    readonly clientSecret: string;
    refreshToken: string;
    /** `expires_in` of the next answers, in seconds. */
    expiresIn: number;
    /** Text injected into every answer (body field and `WWW-Authenticate`) to prove it never reaches a failure. */
    canary: string | null = null;
    /** Milliseconds every answer is held back (to exercise client timeouts). */
    delayMs = 0;
    tokenRequests = 0;
    /** Form fields of the most recent token request (test inspection only). */
    lastForm: Record<string, string> | null = null;
    private readonly queue: OAuthQueuedReply[] = [];
    private readonly valid = new Set<string>();
    private revoked = false;
    private issuedCount = 0;
    private readonly server: http.Server;
    private readonly sockets = new Set<import("node:net").Socket>();
    private port = 0;

    constructor(options: FakeOAuthOptions = {}) {
        this.clientId = options.clientId ?? "fake-client-id.apps.fake.invalid";
        this.clientSecret = options.clientSecret ?? "fake-client-secret-synthetic-0001";
        this.refreshToken = options.refreshToken ?? "1//fake-refresh-token-synthetic-0001";
        this.expiresIn = options.expiresIn ?? 3600;
        this.server = http.createServer((request, response) => this.handle(request, response));
        this.server.on("connection", socket => { this.sockets.add(socket); socket.on("close", () => this.sockets.delete(socket)); });
    }

    get tokenUrl(): string { return `http://127.0.0.1:${this.port}/token`; }

    async listen(): Promise<void> {
        await new Promise<void>(resolve => this.server.listen(0, "127.0.0.1", resolve));
        this.port = (this.server.address() as AddressInfo).port;
    }

    async close(): Promise<void> {
        for (const socket of this.sockets) socket.destroy();
        await new Promise<void>(resolve => this.server.close(() => resolve()));
    }

    /** The refresh token stops working: the next token request answers `invalid_grant`. */
    revoke(): void { this.revoked = true; this.valid.clear(); }
    restore(): void { this.revoked = false; }

    /** Every access token issued so far is refused by `FakeDriveServer` from now on (a 401), the refresh token still works. */
    expireAccessTokens(): void { this.valid.clear(); }

    /** Answers the next token requests with these replies (first in, first out) instead of the normal grant. */
    enqueue(...replies: OAuthQueuedReply[]): void { this.queue.push(...replies); }

    accepts(token: string): boolean { return this.valid.has(token); }

    private handle(request: http.IncomingMessage, response: http.ServerResponse): void {
        const chunks: Buffer[] = [];
        request.on("data", (chunk: Buffer) => chunks.push(chunk));
        request.on("end", () => {
            const form = Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString("utf8")));
            this.tokenRequests += 1;
            this.lastForm = form;
            const reply = this.decide(request.method ?? "", form);
            const respond = (): void => {
                const body: Record<string, unknown> = { ...(reply.json as Record<string, unknown> | undefined) };
                const headers: Record<string, string> = { "Content-Type": "application/json", ...reply.headers };
                if (this.canary !== null) {
                    body["error_description"] = this.canary;
                    body["canary"] = this.canary;
                    headers["WWW-Authenticate"] = `Bearer realm="${this.canary}"`;
                }
                response.writeHead(reply.status, headers);
                response.end(JSON.stringify(body));
            };
            if (this.delayMs > 0) setTimeout(respond, this.delayMs); else respond();
        });
    }

    private decide(method: string, form: Record<string, string>): OAuthQueuedReply {
        const queued = this.queue.shift();
        if (queued) return queued;
        if (method !== "POST" || form["grant_type"] !== "refresh_token") return { status: 400, json: { error: "unsupported_grant_type" } };
        if (form["client_id"] !== this.clientId || form["client_secret"] !== this.clientSecret) return { status: 401, json: { error: "invalid_client" } };
        if (this.revoked || form["refresh_token"] !== this.refreshToken) return { status: 400, json: { error: "invalid_grant" } };
        this.issuedCount += 1;
        const token = `fake-access-token-${String(this.issuedCount).padStart(6, "0")}`;
        this.valid.add(token);
        return { status: 200, json: { access_token: token, expires_in: this.expiresIn, token_type: "Bearer", scope: "https://www.googleapis.com/auth/drive.file" } };
    }
}
