import { DriveTokenSource } from "infrastructure/eformsign-backup/worker/drive-auth";

import { startDriveFakes, type DriveHarness } from "./helpers/drive-support";

describe("DriveTokenSource", () => {
    let h: DriveHarness;
    let nowMs: number;
    const now = (): Date => new Date(nowMs);
    const source = (overrides: Partial<ConstructorParameters<typeof DriveTokenSource>[0]> = {}): DriveTokenSource => new DriveTokenSource({
        tokenUrl: h.oauth.tokenUrl, clientId: h.oauth.clientId, clientSecret: h.oauth.clientSecret, refreshToken: h.oauth.refreshToken,
        now, requestTimeoutMs: 2000, ...overrides,
    });

    beforeEach(async () => { h = await startDriveFakes(); nowMs = Date.UTC(2026, 10, 1, 0, 0, 0); });
    afterEach(async () => { await h.close(); });

    it("should refresh once and serve the cached token", async () => {
        const tokens = source();
        const first = await tokens.get();
        const second = await tokens.get();
        expect(first.ok && second.ok).toBe(true);
        expect(first).toEqual(second);
        expect(h.oauth.tokenRequests).toBe(1);
        expect(h.oauth.lastForm).toEqual({
            grant_type: "refresh_token", refresh_token: h.oauth.refreshToken, client_id: h.oauth.clientId, client_secret: h.oauth.clientSecret,
        });
    });

    it("should keep the token until 60 seconds before it expires by the injected clock", async () => {
        const tokens = source();
        await tokens.get();
        nowMs += 3539_000;
        await tokens.get();
        expect(h.oauth.tokenRequests).toBe(1);
        nowMs += 2_000; // 3541 s after the grant: inside the 60 s margin
        const renewed = await tokens.get();
        expect(h.oauth.tokenRequests).toBe(2);
        expect(renewed.ok).toBe(true);
    });

    it("should run one token request for five concurrent callers", async () => {
        const tokens = source();
        const results = await Promise.all([1, 2, 3, 4, 5].map(() => tokens.get()));
        expect(h.oauth.tokenRequests).toBe(1);
        for (const result of results) expect(result).toEqual(results[0]);
    });

    it("should force a new token with get(true) and make it the cached one", async () => {
        const tokens = source();
        const first = await tokens.get();
        const forced = await tokens.get(true);
        expect(h.oauth.tokenRequests).toBe(2);
        expect(forced).not.toEqual(first);
        expect(await tokens.get()).toEqual(forced);
        expect(h.oauth.tokenRequests).toBe(2);
    });

    it("should not serve the refused token again when a forced refresh fails", async () => {
        const tokens = source();
        await tokens.get();
        h.oauth.revoke();
        expect(await tokens.get(true)).toMatchObject({ ok: false });
        expect(h.oauth.tokenRequests).toBe(2);
        await tokens.get();
        expect(h.oauth.tokenRequests).toBe(3);
    });

    describe("a forced get while another refresh is in flight", () => {
        /** The first grant is `refused` (3600 s); the second request is held until `finish` and then fails with 503; later ones succeed. */
        async function scenario(options: { withInflight: boolean; rollback: boolean }): Promise<{ requests: number; refusedServedAgain: boolean }> {
            let requests = 0;
            let finish: () => void = () => undefined;
            const tokens = source({
                fetchImpl: (async () => {
                    requests++;
                    if (requests === 2) return new Promise<Response>((resolve) => { finish = () => resolve(new Response("{}", { status: 503 })); });
                    return Response.json({ access_token: requests === 1 ? "synthetic-refused" : "synthetic-new", expires_in: 3600 });
                }) as typeof fetch,
            });
            const first = await tokens.get();
            expect(first.ok).toBe(true);
            nowMs += 3_540_001; // just past the 60 s margin: a normal refresh starts
            const nonForced = options.withInflight ? tokens.get() : null;
            const forced = tokens.get(true);
            if (nonForced !== null) expect(forced).toBe(nonForced);
            finish();
            expect((await forced).ok).toBe(false);
            if (options.rollback) nowMs -= 1_001; // a wall clock can step back (NTP), across the cache threshold
            const after = await tokens.get();
            return { requests, refusedServedAgain: after.ok && first.ok && after.value === first.value };
        }

        it("should not serve the refused token again when the joined refresh fails and the clock steps back", async () => {
            expect((await scenario({ withInflight: true, rollback: true })).refusedServedAgain).toBe(false);
        });

        it("should keep the same outcome without a joined refresh (control)", async () => {
            expect((await scenario({ withInflight: false, rollback: true })).refusedServedAgain).toBe(false);
        });

        it("should keep the same outcome without a clock step back (control)", async () => {
            expect((await scenario({ withInflight: true, rollback: false })).refusedServedAgain).toBe(false);
        });
    });

    it("should report a revoked refresh token as token-rejected with the OAuth error only", async () => {
        h.oauth.revoke();
        expect(await source().get()).toEqual({
            ok: false, failure: { kind: "token-rejected", httpStatus: 400, reason: "invalid_grant", retryAfterSeconds: null },
        });
    });

    it("should report a wrong client secret as token-rejected invalid_client", async () => {
        expect(await source({ clientSecret: "wrong-client-secret-synthetic" }).get()).toEqual({
            ok: false, failure: { kind: "token-rejected", httpStatus: 401, reason: "invalid_client", retryAfterSeconds: null },
        });
    });

    it("should report unauthorized_client as token-rejected", async () => {
        h.oauth.enqueue({ status: 400, json: { error: "unauthorized_client" } });
        expect(await source().get()).toMatchObject({ ok: false, failure: { kind: "token-rejected", reason: "unauthorized_client" } });
    });

    it.each([
        ["an unknown 400 error", { status: 400, json: { error: "invalid_request" } }, 400],
        ["a 401 without an OAuth error", { status: 401, json: { message: "nope" } }, 401],
        ["a 500", { status: 500, json: { error: "invalid_grant" } }, 500],
    ])("should keep %s as an ordinary http failure", async (_name, reply, status) => {
        h.oauth.enqueue(reply);
        expect(await source().get()).toEqual({ ok: false, failure: { kind: "http", httpStatus: status, reason: null, retryAfterSeconds: null } });
    });

    it("should carry the Retry-After hint of a throttled token endpoint", async () => {
        h.oauth.enqueue({ status: 429, json: { error: "rate_limit" }, headers: { "Retry-After": "42" } });
        expect(await source().get()).toEqual({ ok: false, failure: { kind: "http", httpStatus: 429, reason: null, retryAfterSeconds: 42 } });
    });

    it("should report an unusable 200 as a transient upstream fault, not a token", async () => {
        h.oauth.enqueue({ status: 200, json: { token_type: "Bearer" } });
        expect(await source().get()).toEqual({ ok: false, failure: { kind: "http", httpStatus: 502, reason: null, retryAfterSeconds: null } });
    });

    it("should report an unreachable endpoint as network and a slow one as timeout", async () => {
        const dead = source({ tokenUrl: "http://127.0.0.1:1/token" });
        expect(await dead.get()).toEqual({ ok: false, failure: { kind: "network", httpStatus: null, reason: null, retryAfterSeconds: null } });
        h.oauth.delayMs = 400;
        expect(await source({ requestTimeoutMs: 50 }).get()).toEqual({
            ok: false, failure: { kind: "timeout", httpStatus: null, reason: null, retryAfterSeconds: null },
        });
    });

    it("should never put the token, a secret or the body into a failure", async () => {
        const canary = "CANARY-AUTH-7f3a91";
        h.oauth.canary = canary;
        h.oauth.revoke();
        const rejected = await source().get();
        h.oauth.enqueue({ status: 503, json: { error: "unavailable" } });
        const unavailable = await source().get();
        for (const result of [rejected, unavailable]) {
            const dump = JSON.stringify(result);
            for (const secret of [canary, h.oauth.refreshToken, h.oauth.clientSecret, h.oauth.clientId]) expect(dump).not.toContain(secret);
        }
    });
});
