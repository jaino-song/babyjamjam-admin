import { Controller, Get, Logger, MiddlewareConsumer, Module, NestModule, type INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { HttpAdapterHost } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import type { AddressInfo } from "node:net";
import path from "node:path";

import { EformsignBackupExportModule } from "module/eformsign-backup-export.module";
import { PrismaExceptionFilter } from "infrastructure/filters/prisma-exception.filter";
import { SbEformsignBackupExportCredentialRepository } from "infrastructure/database/repositories/sb.eformsign-backup-export-credential.repository";
import { ServiceRecordSentryExceptionFilter } from "infrastructure/observability/service-record-sentry-exception.filter";
import { GlobalValidationPipe } from "infrastructure/pipes/global-validation.pipe";
import { TenantAlsMiddleware } from "infrastructure/tenant/tenant-als.middleware";
import { runWorkerCli } from "infrastructure/eformsign-backup/worker/cli";
import { restoreFromArchive } from "infrastructure/eformsign-backup/worker/restore";

import { pdfjsPageCount } from "../infrastructure/eformsign-backup/worker/helpers/pdfjs-open";
import { buildMinimalPdf } from "../infrastructure/eformsign-backup/worker/helpers/pdf-fixture-minimal";
import {
    COMPANY, createHarness, destroyHarness, environmentFor, listFiles, makeBase, readLedgerRecords, rewriteConfig, treeContains, type Harness,
} from "../infrastructure/eformsign-backup/worker/helpers/runner-support";

// Nothing may leave the process.
jest.mock("@sentry/nestjs", () => {
    const scope = new Proxy({}, { get: () => () => undefined });
    return {
        withScope: (fn: (s: unknown) => unknown) => fn(scope),
        captureException: jest.fn(),
        captureMessage: jest.fn(),
        captureEvent: jest.fn(),
    };
});

/**
 * BJJ-455 T-WRK-16: the BJJ-454 export controller, the BJJ-455 worker (in process), the local archive and restore, one
 * full circle against a throwaway PostgreSQL. Skipped unless HOLIDAY_REVIEW_REAL_DB=1, and then only against a local
 * throwaway database (see the target guard). The spec empties eformsign_doc and the export tables before and after it runs
 * because CI runs every test/prisma spec sequentially on one database.
 */
function assertTarget(databaseUrl = process.env["DATABASE_URL"], directUrl = process.env["DIRECT_URL"]): void {
    if (!databaseUrl || !directUrl || databaseUrl !== directUrl
        || !/^postgresql:\/\/[A-Za-z0-9_.-]+@(localhost|127\.0\.0\.1)(:\d+)?\/[A-Za-z0-9_]*throwaway[A-Za-z0-9_]*$/.test(databaseUrl)) {
        throw new Error("Refusing worker real-DB spec: matching local throwaway targets required");
    }
}
describe("worker real-DB target guard", () => {
    it("refuses missing, mismatched and non-disposable targets", () => {
        const url = "postgresql://test@localhost/throwaway_worker";
        expect(() => assertTarget(url, url)).not.toThrow();
        for (const [a, b] of [["", ""], [url, "other"], ["postgresql://test@remote/throwaway_worker", "postgresql://test@remote/throwaway_worker"],
            ["postgresql://test@localhost/production", "postgresql://test@localhost/production"]]) {
            expect(() => assertTarget(a, b)).toThrow("Refusing");
        }
    });
});

const sha = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");

@Controller("probe-worker")
class ProbeController {
    @Get("ping")
    ping(): string { return "pong"; }
}

@Module({ imports: [EformsignBackupExportModule], controllers: [ProbeController] })
class HarnessModule implements NestModule {
    configure(consumer: MiddlewareConsumer): void {
        // Same registration as AppModule.configure().
        consumer.apply(TenantAlsMiddleware).forRoutes("*");
    }
}

const describeReal = process.env["HOLIDAY_REVIEW_REAL_DB"] === "1" ? describe : describe.skip;

describeReal("T-WRK-16: export controller -> worker -> archive -> restore (real PostgreSQL)", () => {
    let raw: PrismaClient;
    let app: INestApplication;
    let h: Harness;
    let token: string;
    let outBase: string;
    let hashAfterSeed: string;
    const seeded: Record<string, Buffer> = {};
    const captured: string[] = [];
    const previousMode = process.env["TENANT_ISOLATION_MODE"];

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
    async function seed(documentId: string, statusType: string, files: Array<{ fileType: "document" | "audit_trail"; bytes: Buffer }>): Promise<void> {
        const row = await raw.eformsign_doc.create({
            data: {
                documentId, createdDate: new Date("2026-10-01T00:00:00.000Z"), updatedDate: new Date("2026-10-02T00:00:00.000Z"),
                statusType, statusDetail: "synthetic", stepType: "reviewer", stepIndex: "1", stepName: "reviewer",
                stepRecipientType: "client", stepRecipientName: "synthetic", stepRecipientSms: "01000000000",
                expiredDate: new Date("2099-01-01T00:00:00.000Z"), branchId: null, documentKind: "contract", customerName: null,
                syncStatus: "ready", detailPayload: { synthetic: true },
            },
        });
        for (const file of files) {
            await raw.eformsign_doc_file.create({
                data: {
                    eformsignDocId: row.id, fileType: file.fileType, content: file.bytes as unknown as Uint8Array<ArrayBuffer>,
                    contentType: "application/pdf", byteSize: file.bytes.length, sha256: sha(file.bytes),
                    sourceUpdatedDate: new Date("2026-10-02T00:00:00.000Z"),
                },
            });
        }
    }

    beforeAll(async () => {
        assertTarget();
        process.env["TENANT_ISOLATION_MODE"] = "enforce";
        for (const level of ["log", "warn", "error", "debug", "verbose"] as const) {
            jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => { captured.push(JSON.stringify(args)); });
        }
        raw = new PrismaClient();
        await raw.$connect();
        await clean();

        const moduleRef = await Test.createTestingModule({ imports: [HarnessModule] })
            .overrideProvider(ConfigService).useValue({ get: (key: string) => (key === "EFORMSIGN_COMPANY_ID" ? COMPANY : undefined) })
            .compile();
        app = moduleRef.createNestApplication();
        app.useGlobalPipes(new GlobalValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
        app.useGlobalFilters(new ServiceRecordSentryExceptionFilter(app.get(HttpAdapterHost)), new PrismaExceptionFilter());
        await app.init();
        await app.listen(0, "127.0.0.1");
        const port = (app.getHttpServer().address() as AddressInfo).port;

        for (const [id, label] of [["E001", "one"], ["E002", "two"]] as const) {
            const document = buildMinimalPdf(`${id} document ${label}`);
            const audit = buildMinimalPdf(`${id} audit ${label}`);
            seeded[`${id}/document`] = document;
            seeded[`${id}/audit-trail`] = audit;
            await seed(id, "003", [{ fileType: "document", bytes: document }, { fileType: "audit_trail", bytes: audit }]);
        }
        await seed("E003", "060", []);
        hashAfterSeed = await businessHash();

        const credentials = app.get(SbEformsignBackupExportCredentialRepository);
        ({ token } = await credentials.issue({ principalId: "worker-real-db", label: "bjj455 worker", companyIds: [COMPANY] }));

        h = await createHarness({ startServer: false });
        h.baseUrl = `http://127.0.0.1:${port}/internal/eformsign-backup/v1`;
        await fs.writeFile(h.tokenPath, `${token}\n`);
        await fs.chmod(h.tokenPath, 0o600);
        await rewriteConfig(h, {});
        outBase = await makeBase("bjj455-realdb-out-");
    }, 120_000);

    afterAll(async () => {
        jest.restoreAllMocks();
        if (previousMode === undefined) delete process.env["TENANT_ISOLATION_MODE"];
        else process.env["TENANT_ISOLATION_MODE"] = previousMode;
        if (h) await destroyHarness(h);
        if (outBase) await fs.rm(outBase, { recursive: true, force: true });
        if (app) await app.close();
        if (raw) {
            await clean();
            await raw.$disconnect();
        }
    }, 60_000);

    it("should run the full circle: init, run, restore, open every PDF, leave the business tables untouched and never leak the token", async () => {
        const stdout: string[] = [];
        const stderr: string[] = [];
        const cli = (args: string[]) => runWorkerCli(args, environmentFor(h, { out: (line) => stdout.push(line), err: (line) => stderr.push(line) }));

        expect(await cli(["init", "--config", h.configPath])).toBe(0);
        expect(await cli(["run", "--config", h.configPath])).toBe(0);

        const events = stdout.map((line) => JSON.parse(line) as Record<string, unknown>);
        expect(events.find((event) => String(event["event"]).startsWith("run_"))).toMatchObject({ event: "run_partial", counts: { candidates: 3, included: 2, verified: 4, blocked: 0 } });
        expect(stderr).toEqual([]);

        const outDir = path.join(outBase, "restored");
        await fs.mkdir(outDir, { mode: 0o700 });
        const report = await restoreFromArchive({ archivePath: h.archive, companyId: COMPANY, selector: { latest: true }, outDir });

        expect(report).toMatchObject({ status: "unverified-archive", sequence: 1 });
        expect(report.documents.map((doc) => doc.documentId)).toEqual(["E001", "E002"]);
        for (const doc of report.documents) {
            for (const artifact of doc.artifacts) {
                const restored = await fs.readFile(path.join(outDir, doc.documentId, `${artifact.artifactType}.pdf`));
                expect(restored.equals(seeded[`${doc.documentId}/${artifact.artifactType}`]!)).toBe(true);
                expect(await pdfjsPageCount(path.join(outDir, doc.documentId, `${artifact.artifactType}.pdf`))).toBeGreaterThanOrEqual(1);
            }
        }

        expect(await businessHash()).toBe(hashAfterSeed);

        // Token canary: stdout, stderr, captured application logs, every ledger and archive file, and the restore output.
        const everything = [...stdout, ...stderr, ...captured].join("\n");
        expect(everything).not.toContain(token);
        expect(await treeContains(h.control, token)).toBe(false);
        expect(await treeContains(h.archive, token)).toBe(false);
        expect(await treeContains(outDir, token)).toBe(false);
        expect((await listFiles(h.archive)).some((file) => file.includes(token))).toBe(false);
        const records = await readLedgerRecords(h.control);
        expect(records.filter((record) => record.type === "destination_transition" && record.body["to"] === "verified")).toHaveLength(4);
    }, 240_000);
});
