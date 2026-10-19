import { Controller, Get, Logger, MiddlewareConsumer, Module, NestModule, type INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { HttpAdapterHost } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import request from "supertest";

import { EformsignDocumentMirrorService } from "application/services/eformsign-document-mirror.service";
import { EXPORT_POLICY_REVISION, EXPORT_SCOPE_REVISION } from "domain/eformsign-backup/export";
import { artifactIdentity } from "domain/eformsign-backup/source-evidence";
import { EformsignApiClient } from "infrastructure/api/eformsign-api.client";
import { PrismaService } from "infrastructure/database/prisma.service";
import { SbEformsignBackupExportCredentialRepository } from "infrastructure/database/repositories/sb.eformsign-backup-export-credential.repository";
import { SbEformsignBackupExportRepository } from "infrastructure/database/repositories/sb.eformsign-backup-export.repository";
import { SbEformsignDocumentMirrorRepository } from "infrastructure/database/repositories/sb.eformsign-document-mirror.repository";
import { PrismaExceptionFilter } from "infrastructure/filters/prisma-exception.filter";
import { ServiceRecordSentryExceptionFilter } from "infrastructure/observability/service-record-sentry-exception.filter";
import { GlobalValidationPipe } from "infrastructure/pipes/global-validation.pipe";
import { TenantAlsMiddleware } from "infrastructure/tenant/tenant-als.middleware";
import { tenantContextStore } from "infrastructure/tenant/tenant-context.store";
import { TenantIsolationViolationError } from "infrastructure/tenant/tenant-isolation.reporter";
import { EformsignBackupExportModule } from "module/eformsign-backup-export.module";

// Nothing may leave the process, and the Sentry calls are what T-EXP-14 counts.
jest.mock("@sentry/nestjs", () => {
    const scope = new Proxy({}, { get: () => () => undefined });
    return {
        withScope: (fn: (s: unknown) => unknown) => fn(scope),
        captureException: jest.fn(),
        captureMessage: jest.fn(),
        captureEvent: jest.fn(),
    };
});
const Sentry = require("@sentry/nestjs") as { captureException: jest.Mock; captureMessage: jest.Mock; captureEvent: jest.Mock };

/**
 * HTTP end to end of the machine export API (BJJ-454 unit 3.5): the real module, guard, filter,
 * service and repositories against a throwaway PostgreSQL, behind the application's real
 * TenantAlsMiddleware, global pipe and global filters, with TENANT_ISOLATION_MODE=enforce.
 * Skipped unless HOLIDAY_REVIEW_REAL_DB=1, and then only against a local throwaway database:
 *
 *   createdb throwaway_u35a && export DATABASE_URL=postgresql://<user>@localhost/throwaway_u35a DIRECT_URL=$DATABASE_URL
 *   npx prisma migrate deploy && HOLIDAY_REVIEW_REAL_DB=1 npx jest test/prisma/eformsign-backup-export-http.real-db.spec.ts
 *
 * CI runs every test/prisma spec sequentially on ONE database and a snapshot reads every
 * eformsign_doc row, so this spec empties eformsign_doc (files cascade) and the three export
 * tables before it seeds and after it finishes.
 */
function assertTarget(databaseUrl = process.env["DATABASE_URL"], directUrl = process.env["DIRECT_URL"]): void {
    if (!databaseUrl || !directUrl || databaseUrl !== directUrl
        || !/^postgresql:\/\/[A-Za-z0-9_.-]+@(localhost|127\.0\.0\.1)(:\d+)?\/[A-Za-z0-9_]*throwaway[A-Za-z0-9_]*$/.test(databaseUrl)) {
        throw new Error("Refusing export HTTP real-DB spec: matching local throwaway targets required");
    }
}
describe("export HTTP real-DB target guard", () => {
    it("refuses missing, mismatched and non-disposable targets", () => {
        const url = "postgresql://test@localhost/throwaway_export_http";
        expect(() => assertTarget(url, url)).not.toThrow();
        for (const [a, b] of [["", ""], [url, "other"], ["postgresql://test@remote/throwaway_export_http", "postgresql://test@remote/throwaway_export_http"],
            ["postgresql://test@localhost/production", "postgresql://test@localhost/production"]]) {
            expect(() => assertTarget(a, b)).toThrow("Refusing");
        }
    });
});

const BASE = "/internal/eformsign-backup/v1";
const COMPANY = "u35-company";
const OTHER_COMPANY = "u35-other-company";
const BODY = { companyId: COMPANY, scopeRevision: EXPORT_SCOPE_REVISION, policyRevision: EXPORT_POLICY_REVISION };
const PII_SENTINEL = "U35-PII-SENTINEL";
const UNKNOWN_UUID = "99999999-9999-4999-8999-999999999999";
const sha = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");
const pdf = (label: string): Buffer => Buffer.from(`%PDF-1.4\n% synthetic ${label}\n%%EOF\n`, "utf8");

@Controller("probe-u35")
class ProbeController {
    // Control for T-EXP-14: a non-export route that fails goes through the real global filters.
    @Get("boom")
    boom(): never {
        throw new Error("probe failure");
    }
}

@Module({ imports: [EformsignBackupExportModule], controllers: [ProbeController] })
class HarnessModule implements NestModule {
    configure(consumer: MiddlewareConsumer): void {
        // Same registration as AppModule.configure().
        consumer.apply(TenantAlsMiddleware).forRoutes("*");
    }
}

const binaryParser = (res: request.Response, done: (err: Error | null, body: Buffer) => void): void => {
    const chunks: Buffer[] = [];
    res.on("data", (chunk: Buffer) => chunks.push(chunk));
    res.on("end", () => done(null, Buffer.concat(chunks)));
};

const describeReal = process.env["HOLIDAY_REVIEW_REAL_DB"] === "1" ? describe : describe.skip;

describeReal("machine export over HTTP (real PostgreSQL, tenant enforce)", () => {
    let raw: PrismaClient;
    let app: INestApplication;
    let credentials: SbEformsignBackupExportCredentialRepository;
    let company: string | undefined = COMPANY;
    let tokenA: string;
    let tokenB: string;
    let hashAfterSeed: string;
    let snapshotA: string;
    let seededBytes: Record<string, Buffer>;
    let keySeq = 0;
    const nextKey = (): string => `u35-key-${process.pid}-${keySeq++}`;
    const transcript: string[] = [];
    const logLines: string[] = [];
    const issuedTokens: string[] = [];
    const previousMode = process.env["TENANT_ISOLATION_MODE"];

    /** Sends a request and records everything the client could see, for the T-EXP-14 sweep. */
    async function send(req: request.Test): Promise<request.Response> {
        const res = await req;
        transcript.push(JSON.stringify(res.headers) + (typeof res.text === "string" ? res.text : ""));
        return res;
    }
    const api = () => request(app.getHttpServer());
    const get = (path: string, token?: string) => send(withAuth(api().get(`${BASE}${path}`), token));
    const post = (token: string | undefined, key: string | null, body: unknown = BODY) => {
        const req = withAuth(api().post(`${BASE}/snapshots`), token);
        if (key !== null) req.set("Idempotency-Key", key);
        return send(req.send(body as object));
    };
    const getBytes = async (path: string, token: string) => {
        const res = await withAuth(api().get(`${BASE}${path}`), token).buffer(true).parse(binaryParser);
        transcript.push(JSON.stringify(res.headers));
        return res;
    };
    function withAuth(req: request.Test, token?: string): request.Test {
        return token === undefined ? req : req.set("Authorization", `Bearer ${token}`);
    }
    const withoutRequestId = (res: request.Response): Record<string, unknown> => {
        const rest = { ...(res.body as Record<string, unknown>) };
        delete rest["requestId"];
        return rest;
    };

    async function issue(principalId: string, companyIds: string[]): Promise<{ id: string; token: string }> {
        const issued = await credentials.issue({ principalId, label: "u35 http", companyIds });
        issuedTokens.push(issued.token);
        return issued;
    }

    async function clean(): Promise<void> {
        await raw.eformsign_backup_export_snapshot.deleteMany({});
        await raw.eformsign_backup_export_candidate.deleteMany({});
        await raw.eformsign_backup_export_credential.deleteMany({});
        await raw.eformsign_doc.deleteMany({});
    }
    async function businessHash(): Promise<string> {
        const [docs] = await raw.$queryRaw<Array<{ h: string | null }>>`SELECT md5(string_agg(t::text, ',' ORDER BY id)) AS h FROM eformsign_doc t`;
        const [files] = await raw.$queryRaw<Array<{ h: string | null }>>`SELECT md5(string_agg(t::text, ',' ORDER BY id)) AS h FROM eformsign_doc_file t`;
        return `${docs?.h}|${files?.h}`;
    }

    interface SeedDoc {
        documentId: string;
        documentKind?: string | null;
        statusType?: string;
        files?: Array<{ fileType: "document" | "audit_trail"; bytes: Buffer }>;
        customerName?: string;
    }
    async function seed(doc: SeedDoc): Promise<void> {
        const row = await raw.eformsign_doc.create({
            data: {
                documentId: doc.documentId,
                createdDate: new Date("2026-10-01T00:00:00.000Z"),
                updatedDate: new Date("2026-10-02T00:00:00.000Z"),
                statusType: doc.statusType ?? "003",
                statusDetail: "synthetic",
                stepType: "reviewer",
                stepIndex: "1",
                stepName: "reviewer",
                stepRecipientType: "client",
                stepRecipientName: "synthetic",
                stepRecipientSms: "01000000000",
                expiredDate: new Date("2099-01-01T00:00:00.000Z"),
                branchId: null,
                documentKind: doc.documentKind === undefined ? "contract" : doc.documentKind,
                customerName: doc.customerName ?? null,
                syncStatus: "ready",
                detailPayload: { synthetic: true },
            },
        });
        for (const file of doc.files ?? []) {
            await raw.eformsign_doc_file.create({
                data: {
                    eformsignDocId: row.id, fileType: file.fileType, content: file.bytes as unknown as Uint8Array<ArrayBuffer>,
                    contentType: "application/pdf", byteSize: file.bytes.length, sha256: sha(file.bytes),
                    sourceUpdatedDate: new Date("2026-10-02T00:00:00.000Z"),
                },
            });
        }
    }
    async function insertSnapshotRow(status: "building" | "failed", principalId: string): Promise<string> {
        const row = await raw.eformsign_backup_export_snapshot.create({
            data: {
                principalId, companyId: COMPANY, scopeRevision: EXPORT_SCOPE_REVISION, policyRevision: EXPORT_POLICY_REVISION,
                idempotencyKey: nextKey(), requestHash: "0".repeat(64), status, ...(status === "failed" ? { failureCode: "u35-injected" } : {}),
            },
            select: { id: true },
        });
        return row.id;
    }

    interface Page { items: Array<{ ordinal: number; documentId: string; classification: string; artifacts: Array<{ fileType: string; artifactIdentity: string; sha256: string; byteSize: number }> }>; nextCursor: string | null }
    async function pages(snapshotId: string, token: string, limit: string): Promise<Page[]> {
        const out: Page[] = [];
        let next: string | null = null;
        do {
            const query: string = next ? `?cursor=${next}` : `?limit=${limit}`;
            const res: request.Response = await get(`/snapshots/${snapshotId}/candidates${query}`, token);
            expect(res.status).toBe(200);
            out.push(res.body as Page);
            next = (res.body as Page).nextCursor;
        } while (next);
        return out;
    }

    beforeAll(async () => {
        assertTarget();
        process.env["TENANT_ISOLATION_MODE"] = "enforce";
        for (const level of ["log", "warn", "error", "debug", "verbose"] as const) {
            jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => { logLines.push(JSON.stringify(args)); });
        }
        raw = new PrismaClient();
        await raw.$connect();
        await clean();

        const moduleRef = await Test.createTestingModule({ imports: [HarnessModule] })
            .overrideProvider(ConfigService).useValue({ get: (key: string) => (key === "EFORMSIGN_COMPANY_ID" ? company : undefined) })
            .compile();
        app = moduleRef.createNestApplication();
        // Same global wiring as main.ts.
        app.useGlobalPipes(new GlobalValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
        app.useGlobalFilters(new ServiceRecordSentryExceptionFilter(app.get(HttpAdapterHost)), new PrismaExceptionFilter());
        await app.init();
        credentials = app.get(SbEformsignBackupExportCredentialRepository);

        const e001 = { document: pdf("E001 document"), audit_trail: pdf("E001 audit") };
        const e002 = { document: pdf("E002 document"), audit_trail: pdf("E002 audit") };
        const e003 = { document: pdf("E003 document") };
        seededBytes = {
            "E001/document": e001.document, "E001/audit_trail": e001.audit_trail,
            "E002/document": e002.document, "E002/audit_trail": e002.audit_trail, "E003/document": e003.document,
        };
        await seed({ documentId: "E001", customerName: PII_SENTINEL, files: [{ fileType: "document", bytes: e001.document }, { fileType: "audit_trail", bytes: e001.audit_trail }] });
        await seed({ documentId: "E002", files: [{ fileType: "document", bytes: e002.document }, { fileType: "audit_trail", bytes: e002.audit_trail }] });
        await seed({ documentId: "E003", files: [{ fileType: "document", bytes: e003.document }] });
        await seed({ documentId: "E004", statusType: "060" });
        await seed({ documentId: "E005", documentKind: null });
        hashAfterSeed = await businessHash();

        ({ token: tokenA } = await issue("u35-worker-a", [COMPANY, OTHER_COMPANY]));
        ({ token: tokenB } = await issue("u35-worker-b", [COMPANY]));
    });

    afterAll(async () => {
        jest.restoreAllMocks();
        if (previousMode === undefined) delete process.env["TENANT_ISOLATION_MODE"];
        else process.env["TENANT_ISOLATION_MODE"] = previousMode;
        if (app) await app.close();
        if (raw) {
            await clean();
            await raw.$disconnect();
        }
    });

    it("is actually enforcing: an unscoped eformsign_doc read in an HTTP context is refused (so the export's system-scope reads are doing real work)", async () => {
        const prisma = app.get(PrismaService);
        await expect(
            tenantContextStore.run({ origin: "http" }, async () => await prisma.eformsign_doc.findMany({ select: { id: true } })),
        ).rejects.toBeInstanceOf(TenantIsolationViolationError);
    });

    it("T-EXP-01: POST -> GET -> candidates -> every artifact over HTTP, with independently computed sha256", async () => {
        const key = nextKey();
        const created = await post(tokenA, key);

        expect(created.status).toBe(202);
        expect(created.headers["cache-control"]).toBe("no-store");
        expect(created.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
        expect(created.body).toMatchObject({
            status: "ready", companyId: COMPANY, scopeRevision: EXPORT_SCOPE_REVISION, policyRevision: EXPORT_POLICY_REVISION,
            counts: { total: 5, included: 3, unknownTemplate: 1, excludedByPolicy: 1, inaccessible: 0, policyPending: 0 },
            coverage: { status: "unverified", reasonCode: "collection-receipt-unavailable" }, backupComplete: false,
        });
        snapshotA = (created.body as { snapshotId: string }).snapshotId;

        const replay = await post(tokenA, key);
        expect(replay.status).toBe(202);
        expect(replay.body).toEqual(created.body);
        const conflict = await post(tokenA, key, { ...BODY, companyId: OTHER_COMPANY });
        expect(conflict.status).toBe(404); // the company check comes before the idempotency lookup (contract 3.1)

        const read = await get(`/snapshots/${snapshotA}`, tokenA);
        expect(read.status).toBe(200);
        expect(read.body).toEqual(created.body);

        const all = await pages(snapshotA, tokenA, "100");
        expect(all).toHaveLength(1);
        const items = all[0]!.items;
        expect(items.map(item => item.documentId)).toEqual(["E001", "E002", "E003", "E004", "E005"]);
        expect(items.map(item => item.classification)).toEqual(["included", "included", "included", "excluded_by_policy", "unknown_template"]);

        let served = 0;
        for (const item of items) {
            for (const artifact of item.artifacts) {
                const res = await getBytes(`/snapshots/${snapshotA}/artifacts/${artifact.artifactIdentity}`, tokenA);
                const expected = seededBytes[`${item.documentId}/${artifact.fileType}`]!;
                const body = res.body as Buffer;
                expect(res.status).toBe(200);
                expect(body.equals(expected)).toBe(true);
                expect(res.headers["content-length"]).toBe(String(expected.length));
                expect(res.headers["content-type"]).toBe("application/pdf");
                expect(res.headers["x-content-sha256"]).toBe(sha(body));
                expect(res.headers["x-content-sha256"]).toBe(artifact.sha256);
                expect(res.headers["x-artifact-identity"]).toBe(artifact.artifactIdentity);
                expect(res.headers["content-disposition"]).toBe(`attachment; filename="${artifact.artifactIdentity}.pdf"`);
                expect(res.headers["cache-control"]).toBe("no-store");
                expect(artifact.byteSize).toBe(expected.length);
                expect(artifact.artifactIdentity).toBe(artifactIdentity({
                    companyId: COMPANY, documentId: item.documentId, artifactKind: artifact.fileType === "audit_trail" ? "audit-trail" : "document",
                    contentSha256: sha(expected), byteLength: expected.length,
                }));
                served++;
            }
        }
        expect(served).toBe(5);
    });

    it("T-EXP-02: none, malformed, unknown and revoked credentials share one 401 body; revocation applies on the next request", async () => {
        const toRevoke = await issue("u35-worker-revoke", [COMPANY]);
        const beforeRevoke = await get(`/snapshots/${UNKNOWN_UUID}`, toRevoke.token);
        expect(beforeRevoke.status).toBe(404); // authenticated: the credential works

        await expect(credentials.revoke(toRevoke.id)).resolves.toBe(true);

        const attempts = [
            await get(`/snapshots/${snapshotA}`),
            await send(api().get(`${BASE}/snapshots/${snapshotA}`).set("Authorization", "Basic abc")),
            await get(`/snapshots/${snapshotA}`, "ebx_short"),
            await get(`/snapshots/${snapshotA}`, `ebx_${"Z".repeat(43)}`),
            await get(`/snapshots/${snapshotA}`, toRevoke.token),
            await send(api().get(`${BASE}/snapshots/${snapshotA}`).set("Cookie", "auth_token=eyJhbGciOiJIUzI1NiJ9.e30.x")),
        ];
        for (const res of attempts) {
            expect(res.status).toBe(401);
            expect(res.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
            expect(res.body).toEqual({ code: "UNAUTHORIZED", retryable: false, requestId: res.headers["x-request-id"] });
            expect(withoutRequestId(res)).toEqual(withoutRequestId(attempts[0]!));
        }
        expect((await post(undefined, nextKey())).status).toBe(401);
    });

    it("T-EXP-03: rotation keeps the principal's snapshots readable with the new credential and kills the old one", async () => {
        const oldCredential = await issue("u35-worker-rot", [COMPANY]);
        const created = await post(oldCredential.token, nextKey());
        expect(created.status).toBe(202);
        const rotatedSnapshot = (created.body as { snapshotId: string }).snapshotId;

        const fresh = await issue("u35-worker-rot", [COMPANY]);
        await expect(credentials.revoke(oldCredential.id)).resolves.toBe(true);

        const withNew = await get(`/snapshots/${rotatedSnapshot}`, fresh.token);
        expect(withNew.status).toBe(200);
        expect(withNew.body).toEqual(created.body);
        expect((await get(`/snapshots/${rotatedSnapshot}/candidates?limit=1`, fresh.token)).status).toBe(200);
        const withOld = await get(`/snapshots/${rotatedSnapshot}`, oldCredential.token);
        expect(withOld.status).toBe(401);
        expect(withOld.body).toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("T-EXP-04: other company / other principal -> one 404 body; unset or invalid company -> 503 after authentication", async () => {
        const mismatch = await post(tokenA, nextKey(), { ...BODY, companyId: OTHER_COMPANY });
        const outsider = await issue("u35-worker-out", [OTHER_COMPANY]);
        const notAllowed = await post(outsider.token, nextKey());
        const foreign = await get(`/snapshots/${snapshotA}`, tokenB);
        const foreignCandidates = await get(`/snapshots/${snapshotA}/candidates`, tokenB);
        const identity = (await pages(snapshotA, tokenA, "1"))[0]!.items[0]!.artifacts[0]!.artifactIdentity;
        const foreignArtifact = await get(`/snapshots/${snapshotA}/artifacts/${identity}`, tokenB);
        const unknown = await get(`/snapshots/${UNKNOWN_UUID}`, tokenA);
        const notUuid = await get("/snapshots/not-a-uuid", tokenA);

        for (const res of [mismatch, notAllowed, foreign, foreignCandidates, foreignArtifact, unknown, notUuid]) {
            expect(res.status).toBe(404);
            expect(res.body).toEqual({ code: "NOT_FOUND", retryable: false, requestId: res.headers["x-request-id"] });
            expect(withoutRequestId(res)).toEqual(withoutRequestId(unknown));
        }

        company = undefined;
        try {
            const unauthenticated = await get(`/snapshots/${snapshotA}`, `ebx_${"Q".repeat(43)}`);
            expect(unauthenticated.status).toBe(401);
            for (const res of [
                await post(tokenA, nextKey()),
                await get(`/snapshots/${snapshotA}`, tokenA),
                await get(`/snapshots/${snapshotA}/candidates`, tokenA),
                await get(`/snapshots/${snapshotA}/artifacts/${identity}`, tokenA),
            ]) {
                expect(res.status).toBe(503);
                expect(res.body).toEqual({ code: "EXPORT_UNAVAILABLE", retryable: true, requestId: res.headers["x-request-id"] });
            }
            company = "   ";
            expect((await get(`/snapshots/${snapshotA}`, tokenA)).status).toBe(503);
            company = "bad id!";
            const invalid = await get(`/snapshots/${snapshotA}`, tokenA);
            expect(invalid.status).toBe(503);
            expect(invalid.body).toMatchObject({ code: "EXPORT_UNAVAILABLE", reasonCode: "company-id-invalid" });
        } finally {
            company = COMPANY;
        }
        expect((await get(`/snapshots/${snapshotA}`, tokenA)).status).toBe(200);
    });

    it("T-EXP-09: cursor over HTTP - replay, cursor-carried limit, mismatches, broken cursor, last page", async () => {
        const first = await get(`/snapshots/${snapshotA}/candidates?limit=2`, tokenA);
        expect(first.status).toBe(200);
        const firstBody = first.body as Page;
        expect(firstBody.items.map(item => item.ordinal)).toEqual([1, 2]);
        expect(firstBody.nextCursor).toEqual(expect.any(String));
        const cursor = firstBody.nextCursor!;

        const second = await get(`/snapshots/${snapshotA}/candidates?cursor=${cursor}`, tokenA); // limit omitted: the cursor's l (2)
        const replay = await get(`/snapshots/${snapshotA}/candidates?cursor=${cursor}`, tokenA);
        const explicit = await get(`/snapshots/${snapshotA}/candidates?cursor=${cursor}&limit=2`, tokenA);
        expect(second.status).toBe(200);
        expect((second.body as Page).items.map(item => item.ordinal)).toEqual([3, 4]);
        expect(replay.body).toEqual(second.body);
        expect(explicit.body).toEqual(second.body);

        const last = await get(`/snapshots/${snapshotA}/candidates?cursor=${(second.body as Page).nextCursor}`, tokenA);
        expect((last.body as Page).items.map(item => item.ordinal)).toEqual([5]);
        expect((last.body as Page).nextCursor).toBeNull();

        const mismatch = await get(`/snapshots/${snapshotA}/candidates?cursor=${cursor}&limit=3`, tokenA);
        expect(mismatch.status).toBe(400);
        expect(mismatch.body).toMatchObject({ code: "CURSOR_PARAMETER_MISMATCH", retryable: false });

        const otherSnapshot = (await post(tokenA, nextKey())).body as { snapshotId: string };
        const wrongSnapshot = await get(`/snapshots/${otherSnapshot.snapshotId}/candidates?cursor=${cursor}`, tokenA);
        expect(wrongSnapshot.status).toBe(400);
        expect(wrongSnapshot.body).toMatchObject({ code: "CURSOR_PARAMETER_MISMATCH" });

        for (const broken of ["not-a-cursor", "%20", "e30", "A".repeat(600)]) {
            const res = await get(`/snapshots/${snapshotA}/candidates?cursor=${broken}`, tokenA);
            expect(res.status).toBe(400);
            expect(res.body).toMatchObject({ code: "INVALID_CURSOR", retryable: false });
        }
        for (const limit of ["0", "101", "abc", "-1", "1.5", ""]) {
            const res = await get(`/snapshots/${snapshotA}/candidates?limit=${limit}`, tokenA);
            expect(res.status).toBe(400);
            expect(res.body).toMatchObject({ code: "INVALID_REQUEST" });
        }
        const walked = await pages(snapshotA, tokenA, "2");
        expect(walked.map(page => page.items.length)).toEqual([2, 2, 1]);
    });

    it("T-EXP-11: an expired snapshot is 410 on every route and on idempotent replay; building and failed are 409", async () => {
        const key = nextKey();
        const created = (await post(tokenA, key)).body as { snapshotId: string };
        const identity = (await pages(created.snapshotId, tokenA, "1"))[0]!.items[0]!.artifacts[0]!.artifactIdentity;
        await raw.$executeRaw`UPDATE eformsign_backup_export_snapshot SET expires_at = now() - interval '1 minute' WHERE id = ${created.snapshotId}::uuid`;

        const expired = [
            await get(`/snapshots/${created.snapshotId}`, tokenA),
            await get(`/snapshots/${created.snapshotId}/candidates`, tokenA),
            await get(`/snapshots/${created.snapshotId}/artifacts/${identity}`, tokenA),
            await post(tokenA, key),
        ];
        for (const res of expired) {
            expect(res.status).toBe(410);
            expect(res.body).toEqual({ code: "SNAPSHOT_EXPIRED", retryable: false, requestId: res.headers["x-request-id"] });
        }
        // Another principal still gets the indistinguishable 404, never the 410.
        expect((await get(`/snapshots/${created.snapshotId}`, tokenB)).status).toBe(404);

        const building = await insertSnapshotRow("building", "u35-worker-a");
        const buildingView = await get(`/snapshots/${building}`, tokenA);
        expect(buildingView.status).toBe(200);
        expect(buildingView.body).toMatchObject({ status: "building", backupComplete: false });
        const buildingCandidates = await get(`/snapshots/${building}/candidates`, tokenA);
        expect(buildingCandidates.status).toBe(409);
        expect(buildingCandidates.body).toEqual({ code: "SNAPSHOT_NOT_READY", retryable: true, requestId: buildingCandidates.headers["x-request-id"] });

        const failed = await insertSnapshotRow("failed", "u35-worker-a");
        const failedView = await get(`/snapshots/${failed}`, tokenA);
        expect(failedView.status).toBe(200);
        expect(failedView.body).toMatchObject({ status: "failed" });
        expect(JSON.stringify(failedView.body)).not.toContain("u35-injected");
        const failedCandidates = await get(`/snapshots/${failed}/candidates`, tokenA);
        expect(failedCandidates.status).toBe(409);
        expect(failedCandidates.body).toEqual({ code: "SNAPSHOT_FAILED", retryable: false, requestId: failedCandidates.headers["x-request-id"] });
    });

    it("request validation reaches the contract error shape through the real global pipe", async () => {
        const noKey = await post(tokenA, null);
        expect(noKey.status).toBe(400);
        expect(noKey.body).toEqual({ code: "INVALID_REQUEST", retryable: false, requestId: noKey.headers["x-request-id"], reasonCode: "idempotency-key" });
        const extra = await post(tokenA, nextKey(), { ...BODY, extra: 1 });
        expect(extra.status).toBe(400);
        expect(extra.body).toEqual({ code: "INVALID_REQUEST", retryable: false, requestId: extra.headers["x-request-id"], reasonCode: "body" });
        const unsupported = await post(tokenA, nextKey(), { ...BODY, policyRevision: "old-policy" });
        expect(unsupported.status).toBe(400);
        expect(unsupported.body).toMatchObject({ code: "UNSUPPORTED_REVISION" });
    });

    it("T-EXP-12: the whole flow left eformsign_doc / eformsign_doc_file byte-identical and never touched the mirror or provider", async () => {
        const proto = (cls: { prototype: object }) => cls.prototype as Record<string, unknown>;
        const methodNames = (cls: { prototype: object }): string[] =>
            Object.getOwnPropertyNames(cls.prototype).filter(name => name !== "constructor"
                && typeof Object.getOwnPropertyDescriptor(cls.prototype, name)?.value === "function");
        const spies: jest.SpyInstance[] = [];
        for (const cls of [EformsignDocumentMirrorService, EformsignApiClient, SbEformsignDocumentMirrorRepository]) {
            const names = methodNames(cls);
            expect(names.length).toBeGreaterThan(0);
            for (const name of names) spies.push(jest.spyOn(proto(cls), name as never));
        }

        // One more full pass with the spies installed, so the zero-call claim covers a complete flow.
        const created = (await post(tokenA, nextKey())).body as { snapshotId: string };
        for (const page of await pages(created.snapshotId, tokenA, "2")) {
            for (const item of page.items) {
                for (const artifact of item.artifacts) {
                    expect((await getBytes(`/snapshots/${created.snapshotId}/artifacts/${artifact.artifactIdentity}`, tokenA)).status).toBe(200);
                }
            }
        }
        await get(`/snapshots/${created.snapshotId}/artifacts/${"0".repeat(64)}`, tokenA);

        expect(await businessHash()).toBe(hashAfterSeed);
        expect(spies.reduce((sum, spy) => sum + spy.mock.calls.length, 0)).toBe(0);
        spies.forEach(spy => spy.mockRestore());
    });

    it("T-EXP-10 over HTTP: removed, version-changed and pending artifacts map to their contract errors", async () => {
        const created = (await post(tokenA, nextKey())).body as { snapshotId: string };
        const all = (await pages(created.snapshotId, tokenA, "100"))[0]!.items;
        const identityOf = (documentId: string, fileType: string): string =>
            all.find(item => item.documentId === documentId)!.artifacts.find(a => a.fileType === fileType)!.artifactIdentity;
        const idOf = async (documentId: string): Promise<number> =>
            (await raw.eformsign_doc.findUniqueOrThrow({ where: { documentId }, select: { id: true } })).id;

        // #7 VERSION_CHANGED
        const replacement = pdf("E001 document replaced");
        await raw.$executeRaw`UPDATE eformsign_doc_file SET content = ${replacement}, byte_size = ${replacement.length}, sha256 = ${sha(replacement)}
            WHERE file_type = 'document' AND eformsign_doc_id = ${await idOf("E001")}`;
        const changed = await get(`/snapshots/${created.snapshotId}/artifacts/${identityOf("E001", "document")}`, tokenA);
        expect(changed.status).toBe(409);
        expect(changed.body).toEqual({ code: "VERSION_CHANGED", retryable: false, requestId: changed.headers["x-request-id"] });

        // #5 ARTIFACT_PENDING and #6 MIRROR_MISSING
        await raw.eformsign_doc_file.deleteMany({ where: { eformsignDocId: await idOf("E002"), fileType: "audit_trail" } });
        await raw.eformsign_doc.update({ where: { documentId: "E002" }, data: { syncStatus: "syncing" } });
        const pending = await get(`/snapshots/${created.snapshotId}/artifacts/${identityOf("E002", "audit_trail")}`, tokenA);
        expect(pending.status).toBe(409);
        expect(pending.body).toEqual({ code: "ARTIFACT_PENDING", retryable: true, requestId: pending.headers["x-request-id"], retryAfterSeconds: 60 });
        expect(pending.headers["retry-after"]).toBe("60");
        await raw.eformsign_doc.update({ where: { documentId: "E002" }, data: { syncStatus: "ready" } });
        const missing = await get(`/snapshots/${created.snapshotId}/artifacts/${identityOf("E002", "audit_trail")}`, tokenA);
        expect(missing.status).toBe(409);
        expect(missing.body).toMatchObject({ code: "MIRROR_MISSING", retryable: true });

        // #4 SOURCE_REMOVED
        await raw.eformsign_doc.update({ where: { documentId: "E003" }, data: { permanentPurgeRequestedAt: new Date() } });
        const removed = await get(`/snapshots/${created.snapshotId}/artifacts/${identityOf("E003", "document")}`, tokenA);
        expect(removed.status).toBe(410);
        expect(removed.body).toEqual({ code: "SOURCE_REMOVED", retryable: false, requestId: removed.headers["x-request-id"] });
    });

    it("T-EXP-14: no response, header or log line ever carries a raw token or customer data; an unexpected 500 is not sent to Sentry", async () => {
        const captured = () => Sentry.captureException.mock.calls.length + Sentry.captureEvent.mock.calls.length + Sentry.captureMessage.mock.calls.length;

        const before = captured();
        const injected = jest.spyOn(SbEformsignBackupExportRepository.prototype, "findSnapshot")
            .mockRejectedValueOnce(new Error(`database exploded for Bearer ${tokenA} ${PII_SENTINEL}`));
        const failure = await get(`/snapshots/${snapshotA}`, tokenA);
        injected.mockRestore();
        expect(failure.status).toBe(500);
        expect(failure.body).toEqual({ code: "INTERNAL", retryable: true, requestId: failure.headers["x-request-id"] });
        expect(failure.headers["cache-control"]).toBe("no-store");
        expect(captured()).toBe(before);

        // Control: a failing non-export route does reach the global Sentry filter, so the counter above can move.
        const probe = await send(api().get("/probe-u35/boom"));
        expect(probe.status).toBe(500);
        expect(Sentry.captureException.mock.calls.length).toBeGreaterThan(0);
        const probeCall = JSON.stringify(Sentry.captureException.mock.calls);
        expect(probeCall).not.toContain(tokenA);

        const everything = [...transcript, ...logLines].join("\n");
        for (const token of issuedTokens) {
            expect(everything).not.toContain(token);
            expect(everything).not.toContain(token.slice(4));
        }
        expect(everything).not.toContain(PII_SENTINEL);
        expect(everything).not.toContain("database exploded");
        expect(transcript.length).toBeGreaterThan(40);
    });
});
