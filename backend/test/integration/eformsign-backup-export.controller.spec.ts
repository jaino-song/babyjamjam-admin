import { EventEmitter } from "node:events";
import { ArgumentsHost, BadRequestException, Catch, ExceptionFilter, INestApplication, Logger } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";

import { EformsignBackupExportService } from "application/services/eformsign-backup-export.service";
import { EformsignDocumentMirrorService } from "application/services/eformsign-document-mirror.service";
import {
    EXPORT_ERRORS,
    ExportError,
    hashExportToken,
    type ExportErrorCode,
} from "domain/eformsign-backup/export";
import { EformsignBackupExportGuard } from "infrastructure/auth/eformsign-backup-export.guard";
import { PrismaService } from "infrastructure/database/prisma.service";
import { SbEformsignBackupExportCredentialRepository } from "infrastructure/database/repositories/sb.eformsign-backup-export-credential.repository";
import { GlobalValidationPipe } from "infrastructure/pipes/global-validation.pipe";
import {
    EformsignBackupExportController,
    EformsignBackupExportExceptionFilter,
} from "interface/controllers/eformsign-backup-export.controller";
import { EformsignBackupExportModule } from "module/eformsign-backup-export.module";

const BASE = "/internal/eformsign-backup/v1";
const TOKEN = "ebx_" + "A".repeat(43);
const BEARER = `Bearer ${TOKEN}`;
const SNAPSHOT_ID = "11111111-1111-4111-8111-111111111111";
const IDENTITY = "a".repeat(64);
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PRINCIPAL = { credentialId: "cred-1", principalId: "worker-1", companyIds: ["C1"] };
const BODY = { companyId: "C1", scopeRevision: "2026-10-19-company-all-docs", policyRevision: "2026-10-18-completed-pdf-audit" };

const SNAPSHOT_VIEW = {
    snapshotId: SNAPSHOT_ID, status: "ready" as const, companyId: "C1",
    scopeRevision: BODY.scopeRevision, policyRevision: BODY.policyRevision,
    createdAt: "2026-10-19T00:00:00.000Z", readyAt: "2026-10-19T00:00:00.000Z", expiresAt: "2026-10-20T00:00:00.000Z",
    counts: { total: 0, inaccessible: 0, unknownTemplate: 0, policyPending: 0, excludedByPolicy: 0, included: 0 },
    coverage: { status: "unverified" as const, reasonCode: "collection-receipt-unavailable" as const },
    backupComplete: false as const,
};

/** Stands in for the app's global filters (Prisma, Sentry): an export request must never reach one. */
const globalFilterReached = jest.fn();
@Catch()
class GlobalSpyFilter implements ExceptionFilter {
    catch(_exception: unknown, host: ArgumentsHost): void {
        globalFilterReached();
        host.switchToHttp().getResponse().status(599).json({ message: "global filter" });
    }
}

const binaryParser = (res: request.Response, done: (err: Error | null, body: Buffer) => void): void => {
    const chunks: Buffer[] = [];
    res.on("data", (chunk: Buffer) => chunks.push(chunk));
    res.on("end", () => done(null, Buffer.concat(chunks)));
};

/** The response `close` event fires just after the client has the last byte, so poll briefly. */
async function waitFor(assertion: () => void, timeoutMs = 2000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        try {
            assertion();
            return;
        } catch (error) {
            if (Date.now() >= deadline) throw error;
            await new Promise(resolve => setTimeout(resolve, 10));
        }
    }
}

describe("EformsignBackupExportController (HTTP)", () => {
    let app: INestApplication;
    let findActiveByTokenHash: jest.Mock;
    let touchLastUsed: jest.Mock;
    const service = {
        createSnapshot: jest.fn(),
        getSnapshot: jest.fn(),
        listCandidates: jest.fn(),
        readArtifact: jest.fn(),
    };
    let loggerError: jest.SpyInstance;

    const api = () => request(app.getHttpServer());
    const authed = (req: request.Test): request.Test => req.set("Authorization", BEARER);

    const withoutRequestId = (res: request.Response): Record<string, unknown> => {
        const rest = { ...(res.body as Record<string, unknown>) };
        delete rest["requestId"];
        return rest;
    };

    async function expectErrorBody(res: request.Response, code: ExportErrorCode, extra: Record<string, unknown> = {}): Promise<void> {
        expect(res.status).toBe(EXPORT_ERRORS[code].status);
        expect(res.headers["cache-control"]).toBe("no-store");
        expect(res.headers["x-request-id"]).toMatch(UUID_V4);
        expect(res.body).toEqual({
            code, retryable: EXPORT_ERRORS[code].retryable, requestId: res.headers["x-request-id"], ...extra,
        });
    }

    beforeEach(async () => {
        findActiveByTokenHash = jest.fn(async (hash: string) => (hash === hashExportToken(TOKEN) ? { id: "cred-1", principalId: "worker-1", companyIds: ["C1"] } : null));
        touchLastUsed = jest.fn(async () => undefined);
        Object.values(service).forEach(fn => fn.mockReset());
        globalFilterReached.mockReset();
        loggerError = jest.spyOn(Logger.prototype, "error").mockImplementation(() => undefined);
        jest.spyOn(Logger.prototype, "debug").mockImplementation(() => undefined);

        const moduleRef = await Test.createTestingModule({
            controllers: [EformsignBackupExportController],
            providers: [
                EformsignBackupExportGuard,
                { provide: SbEformsignBackupExportCredentialRepository, useValue: { findActiveByTokenHash, touchLastUsed } },
                { provide: EformsignBackupExportService, useValue: service },
            ],
        }).compile();
        app = moduleRef.createNestApplication();
        app.useGlobalPipes(new GlobalValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
        app.useGlobalFilters(new GlobalSpyFilter());
        await app.init();
    });

    afterEach(async () => {
        await app?.close();
        jest.restoreAllMocks();
    });

    describe("routing, status codes and headers", () => {
        it("POST snapshots answers 202 with the service view and forwards principal, body and key", async () => {
            service.createSnapshot.mockResolvedValue(SNAPSHOT_VIEW);

            const res = await authed(api().post(`${BASE}/snapshots`)).set("Idempotency-Key", "key-1.a:b").send(BODY);

            expect(res.status).toBe(202);
            expect(res.body).toEqual(SNAPSHOT_VIEW);
            expect(res.headers["cache-control"]).toBe("no-store");
            expect(res.headers["x-request-id"]).toMatch(UUID_V4);
            expect(service.createSnapshot).toHaveBeenCalledWith(PRINCIPAL, BODY, "key-1.a:b");
            expect(touchLastUsed).toHaveBeenCalledWith("cred-1");
        });

        it("GET snapshots/:id answers 200", async () => {
            service.getSnapshot.mockResolvedValue(SNAPSHOT_VIEW);

            const res = await authed(api().get(`${BASE}/snapshots/${SNAPSHOT_ID}`));

            expect(res.status).toBe(200);
            expect(res.body).toEqual(SNAPSHOT_VIEW);
            expect(res.headers["cache-control"]).toBe("no-store");
            expect(res.headers["x-request-id"]).toMatch(UUID_V4);
            expect(service.getSnapshot).toHaveBeenCalledWith(PRINCIPAL, SNAPSHOT_ID);
        });

        it("GET candidates forwards cursor and limit as given, and nothing when absent", async () => {
            const page = { snapshotId: SNAPSHOT_ID, items: [], nextCursor: null };
            service.listCandidates.mockResolvedValue(page);

            const withParams = await authed(api().get(`${BASE}/snapshots/${SNAPSHOT_ID}/candidates?cursor=abc_-1&limit=7`));
            const bare = await authed(api().get(`${BASE}/snapshots/${SNAPSHOT_ID}/candidates`));

            expect(withParams.status).toBe(200);
            expect(withParams.body).toEqual(page);
            expect(withParams.headers["cache-control"]).toBe("no-store");
            expect(bare.status).toBe(200);
            expect(service.listCandidates).toHaveBeenNthCalledWith(1, PRINCIPAL, SNAPSHOT_ID, "abc_-1", "7");
            expect(service.listCandidates).toHaveBeenNthCalledWith(2, PRINCIPAL, SNAPSHOT_ID, undefined, undefined);
        });

        it("a repeated cursor or limit parameter is a 400, not a service call", async () => {
            const repeatedLimit = await authed(api().get(`${BASE}/snapshots/${SNAPSHOT_ID}/candidates?limit=1&limit=2`));
            const repeatedCursor = await authed(api().get(`${BASE}/snapshots/${SNAPSHOT_ID}/candidates?cursor=a&cursor=b`));

            await expectErrorBody(repeatedLimit, "INVALID_REQUEST", { reasonCode: "query" });
            await expectErrorBody(repeatedCursor, "INVALID_REQUEST", { reasonCode: "query" });
            expect(service.listCandidates).not.toHaveBeenCalled();
        });

        it("GET artifacts streams the exact bytes with the contract headers and a matching Content-Length", async () => {
            // Not valid UTF-8 and containing every byte value: a text round trip would corrupt it.
            const bytes = Buffer.from(Array.from({ length: 1024 }, (_, i) => i % 256));
            service.readArtifact.mockResolvedValue({
                bytes, contentType: "application/pdf", byteSize: bytes.length, sha256: "b".repeat(64), artifactIdentity: IDENTITY, release: jest.fn(),
            });

            const res = await authed(api().get(`${BASE}/snapshots/${SNAPSHOT_ID}/artifacts/${IDENTITY}`)).buffer(true).parse(binaryParser);

            expect(res.status).toBe(200);
            expect(Buffer.isBuffer(res.body)).toBe(true);
            expect((res.body as Buffer).equals(bytes)).toBe(true);
            expect(res.headers["content-length"]).toBe(String(bytes.length));
            expect(res.headers["content-type"]).toBe("application/pdf");
            expect(res.headers["x-artifact-identity"]).toBe(IDENTITY);
            expect(res.headers["x-content-sha256"]).toBe("b".repeat(64));
            expect(res.headers["content-disposition"]).toBe(`attachment; filename="${IDENTITY}.pdf"`);
            expect(res.headers["cache-control"]).toBe("no-store");
            expect(res.headers["x-request-id"]).toMatch(UUID_V4);
            expect(service.readArtifact).toHaveBeenCalledWith(PRINCIPAL, SNAPSHOT_ID, IDENTITY);
        });

        it("an unsafe stored content type falls back to application/pdf instead of failing the response", async () => {
            const bytes = Buffer.from("%PDF-1.4\n");
            service.readArtifact.mockResolvedValue({
                bytes, contentType: "text/plain\r\nX-Injected: 1", byteSize: bytes.length, sha256: "c".repeat(64), artifactIdentity: IDENTITY, release: jest.fn(),
            });

            const res = await authed(api().get(`${BASE}/snapshots/${SNAPSHOT_ID}/artifacts/${IDENTITY}`)).buffer(true).parse(binaryParser);

            expect(res.status).toBe(200);
            expect(res.headers["content-type"]).toBe("application/pdf");
            expect(res.headers["x-injected"]).toBeUndefined();
        });

        it("the artifact slot is released once the response has ended, and only then", async () => {
            const bytes = Buffer.from("%PDF-1.4\n");
            const release = jest.fn();
            service.readArtifact.mockResolvedValue({
                bytes, contentType: "application/pdf", byteSize: bytes.length, sha256: "d".repeat(64), artifactIdentity: IDENTITY, release,
            });

            const res = await authed(api().get(`${BASE}/snapshots/${SNAPSHOT_ID}/artifacts/${IDENTITY}`)).buffer(true).parse(binaryParser);

            expect(res.status).toBe(200);
            await waitFor(() => expect(release).toHaveBeenCalledTimes(1));
        });

        it("the artifact slot is released when writing the response throws, with a contract error body", async () => {
            const release = jest.fn();
            service.readArtifact.mockResolvedValue({
                // A control character in the identity makes setHeader throw before any byte is written.
                bytes: Buffer.from("x"), contentType: "application/pdf", byteSize: 1, sha256: "e".repeat(64), artifactIdentity: "bad\nidentity", release,
            });

            // Content-Type was already set when the throw happened, so the JSON body is not auto-parsed.
            const res = await authed(api().get(`${BASE}/snapshots/${SNAPSHOT_ID}/artifacts/${IDENTITY}`)).buffer(true).parse(binaryParser);

            expect(res.status).toBe(EXPORT_ERRORS["INTERNAL"].status);
            expect(JSON.parse((res.body as Buffer).toString("utf8"))).toMatchObject({ code: "INTERNAL" });
            await waitFor(() => expect(release).toHaveBeenCalledTimes(1));
        });

        it("an error raised by the service on the artifact route is a contract error body, not bytes", async () => {
            service.readArtifact.mockRejectedValue(new ExportError("VERSION_CHANGED"));

            const res = await authed(api().get(`${BASE}/snapshots/${SNAPSHOT_ID}/artifacts/${IDENTITY}`));

            await expectErrorBody(res, "VERSION_CHANGED");
        });
    });

    describe("request validation (contract 3.1)", () => {
        const post = (body: unknown, key: string | null = "key-1") => {
            const req = authed(api().post(`${BASE}/snapshots`));
            if (key !== null) req.set("Idempotency-Key", key);
            return req.send(body as object);
        };

        it.each([
            ["missing", null],
            ["empty", ""],
            ["129 characters", "k".repeat(129)],
            ["a forbidden character", "key 1"],
            ["a slash", "a/b"],
        ])("an Idempotency-Key that is %s is a 400 with reasonCode idempotency-key", async (_label, key) => {
            const res = await post(BODY, key);

            await expectErrorBody(res, "INVALID_REQUEST", { reasonCode: "idempotency-key" });
            expect(service.createSnapshot).not.toHaveBeenCalled();
        });

        it("accepts a 128-character key", async () => {
            service.createSnapshot.mockResolvedValue(SNAPSHOT_VIEW);

            const res = await post(BODY, "k".repeat(128));

            expect(res.status).toBe(202);
        });

        it.each([
            ["an unknown key", { ...BODY, extra: "x" }],
            ["a missing companyId", { scopeRevision: BODY.scopeRevision, policyRevision: BODY.policyRevision }],
            ["a missing policyRevision", { companyId: "C1", scopeRevision: BODY.scopeRevision }],
            ["an empty string", { ...BODY, companyId: "" }],
            ["a 257-character string", { ...BODY, companyId: "c".repeat(257) }],
            ["a number value", { ...BODY, scopeRevision: 1 }],
            ["a null value", { ...BODY, policyRevision: null }],
            ["an array body", [BODY]],
            ["an empty object", {}],
        ])("a body with %s is a 400 INVALID_REQUEST in the contract shape", async (_label, body) => {
            const res = await post(body);

            await expectErrorBody(res, "INVALID_REQUEST", { reasonCode: "body" });
            expect(service.createSnapshot).not.toHaveBeenCalled();
        });

        it("a request without a body is a 400, not a 500", async () => {
            const res = await authed(api().post(`${BASE}/snapshots`)).set("Idempotency-Key", "key-1");

            await expectErrorBody(res, "INVALID_REQUEST", { reasonCode: "body" });
        });

        it("accepts 256-character strings", async () => {
            service.createSnapshot.mockResolvedValue(SNAPSHOT_VIEW);

            const res = await post({ ...BODY, companyId: "c".repeat(256) });

            expect(res.status).toBe(202);
            expect(service.createSnapshot).toHaveBeenCalledWith(PRINCIPAL, { ...BODY, companyId: "c".repeat(256) }, "key-1");
        });
    });

    describe("authentication (contract D1, 3.6)", () => {
        const unauthenticated: Array<[string, (req: request.Test) => request.Test]> = [
            ["no Authorization header", req => req],
            ["a malformed header", req => req.set("Authorization", "Basic abc")],
            ["a bearer token of the wrong shape", req => req.set("Authorization", "Bearer ebx_short")],
            ["an unknown token", req => req.set("Authorization", `Bearer ebx_${"B".repeat(43)}`)],
        ];

        it("answers the same 401 body for none, malformed, unknown and revoked credentials", async () => {
            // "Revoked" and "unknown" are the same lookup result (no active row), exercised separately here.
            findActiveByTokenHash.mockResolvedValueOnce(null);
            const bodies: unknown[] = [];
            for (const [, decorate] of unauthenticated) {
                const res = await decorate(api().get(`${BASE}/snapshots/${SNAPSHOT_ID}`));
                await expectErrorBody(res, "UNAUTHORIZED");
                bodies.push(withoutRequestId(res));
            }
            findActiveByTokenHash.mockResolvedValueOnce(null);
            const revoked = await authed(api().get(`${BASE}/snapshots/${SNAPSHOT_ID}`));
            await expectErrorBody(revoked, "UNAUTHORIZED");
            bodies.push(withoutRequestId(revoked));

            expect(bodies).toHaveLength(5);
            for (const body of bodies) expect(body).toEqual(bodies[0]);
            expect(service.getSnapshot).not.toHaveBeenCalled();
        });

        it("rejects every route without a credential", async () => {
            const responses = [
                await api().post(`${BASE}/snapshots`).set("Idempotency-Key", "k").send(BODY),
                await api().get(`${BASE}/snapshots/${SNAPSHOT_ID}`),
                await api().get(`${BASE}/snapshots/${SNAPSHOT_ID}/candidates`),
                await api().get(`${BASE}/snapshots/${SNAPSHOT_ID}/artifacts/${IDENTITY}`),
            ];

            for (const res of responses) await expectErrorBody(res, "UNAUTHORIZED");
            expect(Object.values(service).every(fn => fn.mock.calls.length === 0)).toBe(true);
        });

        it("ignores a human session: the auth_token cookie alone is a 401", async () => {
            const res = await api().get(`${BASE}/snapshots/${SNAPSHOT_ID}`).set("Cookie", "auth_token=eyJhbGciOiJIUzI1NiJ9.e30.x");

            await expectErrorBody(res, "UNAUTHORIZED");
            expect(findActiveByTokenHash).not.toHaveBeenCalled();
            expect(service.getSnapshot).not.toHaveBeenCalled();
        });

        it("a cookie does not override a valid bearer token", async () => {
            service.getSnapshot.mockResolvedValue(SNAPSHOT_VIEW);

            const res = await authed(api().get(`${BASE}/snapshots/${SNAPSHOT_ID}`)).set("Cookie", "auth_token=whatever");

            expect(res.status).toBe(200);
        });
    });

    describe("error mapping (contract 3.6)", () => {
        const codes = Object.keys(EXPORT_ERRORS) as ExportErrorCode[];

        it.each(codes)("%s -> its status, retryable flag and requestId, with exactly the contract keys", async (code) => {
            service.getSnapshot.mockRejectedValue(new ExportError(code));

            const res = await authed(api().get(`${BASE}/snapshots/${SNAPSHOT_ID}`));

            await expectErrorBody(res, code);
            expect(res.headers["retry-after"]).toBeUndefined();
        });

        it("carries reasonCode and retryAfterSeconds, and sets Retry-After", async () => {
            service.getSnapshot.mockRejectedValue(new ExportError("RATE_LIMITED", { retryAfterSeconds: 5, reasonCode: "slots" }));

            const res = await authed(api().get(`${BASE}/snapshots/${SNAPSHOT_ID}`));

            await expectErrorBody(res, "RATE_LIMITED", { reasonCode: "slots", retryAfterSeconds: 5 });
            expect(res.headers["retry-after"]).toBe("5");
        });

        it("answers the identical 404 body for another principal's snapshot and an unknown id", async () => {
            service.getSnapshot.mockRejectedValue(new ExportError("NOT_FOUND"));
            const foreign = await authed(api().get(`${BASE}/snapshots/${SNAPSHOT_ID}`));
            const unknown = await authed(api().get(`${BASE}/snapshots/22222222-2222-4222-8222-222222222222`));
            const notUuid = await authed(api().get(`${BASE}/snapshots/not-a-uuid`));

            const strip = withoutRequestId;
            await expectErrorBody(foreign, "NOT_FOUND");
            expect(strip(unknown)).toEqual(strip(foreign));
            expect(strip(notUuid)).toEqual(strip(foreign));
            expect(unknown.status).toBe(404);
        });

        it("a Nest BadRequestException from parsing is a 400 INVALID_REQUEST without its message", async () => {
            service.getSnapshot.mockRejectedValue(new BadRequestException("secret parse detail"));

            const res = await authed(api().get(`${BASE}/snapshots/${SNAPSHOT_ID}`));

            await expectErrorBody(res, "INVALID_REQUEST");
            expect(JSON.stringify(res.body)).not.toContain("secret parse detail");
        });

        it("an unexpected error is a 500 INTERNAL with no message or stack, and the log carries the requestId only", async () => {
            service.getSnapshot.mockRejectedValue(new Error(`boom for ${BEARER} and customer 홍길동`));

            const res = await authed(api().get(`${BASE}/snapshots/${SNAPSHOT_ID}`));

            await expectErrorBody(res, "INTERNAL");
            expect(res.text).not.toContain("boom");
            expect(res.text).not.toContain(TOKEN);
            expect(res.text).not.toContain("stack");
            expect(loggerError).toHaveBeenCalledTimes(1);
            const logged = JSON.stringify(loggerError.mock.calls);
            expect(logged).toContain(res.headers["x-request-id"]);
            expect(logged).not.toContain("boom");
            expect(logged).not.toContain(TOKEN);
            expect(logged).not.toContain("홍길동");
        });

        it("a failing credential lookup is a 500 INTERNAL in the contract shape (the guard is under the same filter)", async () => {
            findActiveByTokenHash.mockRejectedValue(new Error("db down"));

            const res = await authed(api().get(`${BASE}/snapshots/${SNAPSHOT_ID}`));

            await expectErrorBody(res, "INTERNAL");
        });

        it("no export response, error or success, ever reaches a global filter (so nothing is captured by Sentry)", async () => {
            service.getSnapshot.mockRejectedValueOnce(new Error("unexpected")).mockRejectedValueOnce(new ExportError("NOT_FOUND"));
            service.createSnapshot.mockRejectedValueOnce(new TypeError("also unexpected"));

            await authed(api().get(`${BASE}/snapshots/${SNAPSHOT_ID}`));
            await authed(api().get(`${BASE}/snapshots/${SNAPSHOT_ID}`));
            await authed(api().post(`${BASE}/snapshots`)).set("Idempotency-Key", "k").send(BODY);
            await api().get(`${BASE}/snapshots/${SNAPSHOT_ID}`);

            expect(globalFilterReached).not.toHaveBeenCalled();
        });
    });
});

describe("EformsignBackupExportModule", () => {
    it("compiles with only the database replaced, wires the controller, and provides no mirror or provider service", async () => {
        const moduleRef = await Test.createTestingModule({ imports: [EformsignBackupExportModule] })
            .overrideProvider(PrismaService).useValue({})
            .compile();

        expect(moduleRef.get(EformsignBackupExportController)).toBeInstanceOf(EformsignBackupExportController);
        expect(moduleRef.get(EformsignBackupExportService)).toBeInstanceOf(EformsignBackupExportService);
        expect(moduleRef.get(EformsignBackupExportGuard)).toBeInstanceOf(EformsignBackupExportGuard);
        expect(() => moduleRef.get(EformsignDocumentMirrorService, { strict: false })).toThrow();
        await moduleRef.close();
    });

    it("guards the whole controller with the export guard and the export filter, and nothing else", () => {
        expect(Reflect.getMetadata("__guards__", EformsignBackupExportController)).toEqual([EformsignBackupExportGuard]);
        expect(Reflect.getMetadata("__exceptionFilters__", EformsignBackupExportController)).toEqual([EformsignBackupExportExceptionFilter]);
        expect(Reflect.getMetadata("path", EformsignBackupExportController)).toBe("internal/eformsign-backup/v1");
    });
});

describe("EformsignBackupExportController artifact slot lifetime (direct)", () => {
    class FakeResponse extends EventEmitter {
        destroyed = false;
        writableFinished = false;
        readonly calls: string[] = [];
        constructor(private readonly failOnHeader: string | null = null) { super(); }
        setHeader(name: string): void {
            this.calls.push(`setHeader:${name}`);
            if (name === this.failOnHeader) throw new Error("header rejected");
        }
        status(): this { this.calls.push("status"); return this; }
        end(): void { this.calls.push("end"); }
    }

    const viewWith = (release: () => void) => ({
        bytes: Buffer.from("x"), contentType: "application/pdf", byteSize: 1, sha256: "f".repeat(64), artifactIdentity: IDENTITY, release,
    });

    function arrange(response: FakeResponse, release: jest.Mock) {
        const service = { readArtifact: jest.fn().mockResolvedValue(viewWith(release)) };
        const controller = new EformsignBackupExportController(service as unknown as EformsignBackupExportService);
        const req = { eformsignBackupExportPrincipal: PRINCIPAL, eformsignBackupExportRequestId: "req-1" };
        const call = () => controller.readArtifact(req as never, response as never, SNAPSHOT_ID, IDENTITY);
        return { call, service };
    }

    it("registers the close listener before any header or body, and releases only on close", async () => {
        const response = new FakeResponse();
        const release = jest.fn();
        const registered: string[] = [];
        const original = response.once.bind(response);
        response.once = ((event: string, listener: () => void) => {
            registered.push(`once:${event}@${response.calls.length}`);
            return original(event, listener);
        }) as typeof response.once;
        const { call } = arrange(response, release);

        await call();

        expect(response.calls).toContain("end");
        // the listener is registered after the two stamp headers but before the status, the artifact headers and `end`
        expect(registered).toEqual(["once:close@2"]);
        expect(release).not.toHaveBeenCalled(); // `end` alone does not free the slot
        response.emit("close");
        expect(release).toHaveBeenCalledTimes(1);
    });

    it("releases exactly once even if close fires twice", async () => {
        const response = new FakeResponse();
        const release = jest.fn();
        await arrange(response, release).call();
        response.emit("close");
        response.emit("close");
        expect(release).toHaveBeenCalledTimes(1);
    });

    it("releases when the write path throws, and not a second time on the later close", async () => {
        const response = new FakeResponse("X-Content-Sha256");
        const release = jest.fn();
        await expect(arrange(response, release).call()).rejects.toThrow("header rejected");
        expect(release).toHaveBeenCalledTimes(1);
        response.emit("close");
        expect(release).toHaveBeenCalledTimes(1);
    });

    it("releases immediately when the client was already gone before the artifact arrived", async () => {
        const response = new FakeResponse();
        response.destroyed = true; // `close` already fired while the service was reading; it never fires again
        const release = jest.fn();
        await arrange(response, release).call();
        expect(release).toHaveBeenCalledTimes(1);
    });
});
