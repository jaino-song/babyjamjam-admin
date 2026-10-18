import { createHash } from "node:crypto";
import { ConfigService } from "@nestjs/config";
import { PrismaClient } from "@prisma/client";
import { EformsignBackupExportService } from "application/services/eformsign-backup-export.service";
import {
    EXPORT_POLICY_REVISION,
    EXPORT_SCOPE_REVISION,
    ExportError,
    type ExportCandidateView,
    type ExportErrorCode,
    type ExportPrincipal,
} from "domain/eformsign-backup/export";
import { artifactIdentity } from "domain/eformsign-backup/source-evidence";
import type { PrismaService } from "infrastructure/database/prisma.service";
import { SbEformsignBackupExportRepository } from "infrastructure/database/repositories/sb.eformsign-backup-export.repository";
import { tenantIsolationExtension } from "infrastructure/database/tenant-isolation.extension";
import { tenantContextStore } from "infrastructure/tenant/tenant-context.store";

/**
 * Real-PostgreSQL behaviour of the machine-export service (BJJ-454 unit 3.4). Skipped unless
 * HOLIDAY_REVIEW_REAL_DB=1, and then only against a local throwaway database:
 *
 *   createdb throwaway_u34a && export DATABASE_URL=postgresql://<user>@localhost/throwaway_u34a DIRECT_URL=$DATABASE_URL
 *   npx prisma migrate deploy && HOLIDAY_REVIEW_REAL_DB=1 npx jest test/prisma/eformsign-backup-export-service.real-db.spec.ts
 *
 * CI runs every test/prisma spec sequentially on ONE database and a snapshot reads every
 * eformsign_doc row, so each block empties eformsign_doc (files cascade) and the snapshot tables
 * before it seeds and after it finishes. Credentials are not read by this service and are left alone.
 */
function assertTarget(databaseUrl = process.env["DATABASE_URL"], directUrl = process.env["DIRECT_URL"]): void {
    if (!databaseUrl || !directUrl || databaseUrl !== directUrl
        || !/^postgresql:\/\/[A-Za-z0-9_.-]+@(localhost|127\.0\.0\.1)(:\d+)?\/[A-Za-z0-9_]*throwaway[A-Za-z0-9_]*$/.test(databaseUrl)) {
        throw new Error("Refusing export service real-DB spec: matching local throwaway targets required");
    }
}
describe("export service real-DB target guard", () => {
    it("refuses missing, mismatched and non-disposable targets", () => {
        const url = "postgresql://test@localhost/throwaway_export";
        expect(() => assertTarget(url, url)).not.toThrow();
        for (const [a, b] of [["", ""], [url, "other"], ["postgresql://test@remote/throwaway_export", "postgresql://test@remote/throwaway_export"],
            ["postgresql://test@localhost/production", "postgresql://test@localhost/production"]]) {
            expect(() => assertTarget(a, b)).toThrow("Refusing");
        }
    });
});

const COMPANY = "u34-company";
const PRINCIPAL: ExportPrincipal = { credentialId: "u34-credential", principalId: "u34-worker", companyIds: [COMPANY, "u34-company-b"] };
const BODY = { companyId: COMPANY, scopeRevision: EXPORT_SCOPE_REVISION, policyRevision: EXPORT_POLICY_REVISION };
const PII_SENTINEL = "U34-PII-SENTINEL";
const sha = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");
const pdf = (label: string): Buffer => Buffer.from(`%PDF-1.4\n% synthetic ${label}\n%%EOF\n`, "utf8");

const describeReal = process.env["HOLIDAY_REVIEW_REAL_DB"] === "1" ? describe : describe.skip;

describeReal("EformsignBackupExportService (real PostgreSQL)", () => {
    let raw: PrismaClient;
    let extended: PrismaClient;
    let service: EformsignBackupExportService;
    let configuredCompany: string | undefined;
    let keySeq = 0;
    const nextKey = (): string => `u34-key-${process.pid}-${keySeq++}`;
    const branchIds: string[] = [];

    const configFor = (company: string | undefined) => ({
        get: (key: string) => (key === "EFORMSIGN_COMPANY_ID" ? company : undefined),
    }) as unknown as ConfigService;
    const makeService = (client: PrismaClient, company: string | undefined = COMPANY) =>
        new EformsignBackupExportService(new SbEformsignBackupExportRepository(client as unknown as PrismaService), configFor(company));

    async function expectExportError(promise: Promise<unknown>, code: ExportErrorCode): Promise<ExportError> {
        const error = await promise.then(() => null, (e: unknown) => e);
        expect(error).toBeInstanceOf(ExportError);
        expect((error as ExportError).code).toBe(code);
        return error as ExportError;
    }

    async function clean(): Promise<void> {
        await raw.eformsign_backup_export_snapshot.deleteMany({});
        await raw.eformsign_doc.deleteMany({});
    }
    async function removeBranches(): Promise<void> {
        if (branchIds.length) await raw.branch.deleteMany({ where: { id: { in: branchIds.splice(0) } } });
    }
    async function makeBranch(label: string, isActive: boolean): Promise<string> {
        const branch = await raw.branch.create({ data: { name: `u34 ${label}`, slug: `u34-${label}-${process.pid}-${Date.now()}`, isActive } });
        branchIds.push(branch.id);
        return branch.id;
    }

    interface SeedDoc {
        documentId: string;
        documentKind?: string | null;
        statusType?: string;
        branchId?: string | null;
        files?: Array<{ fileType: "document" | "audit_trail"; bytes: Buffer }>;
        purgeRequestedAt?: Date;
        voidedAt?: Date;
        payload?: boolean;
        syncStatus?: string;
        customerName?: string;
    }
    const docData = (doc: SeedDoc) => ({
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
        branchId: doc.branchId ?? null,
        documentKind: doc.documentKind === undefined ? "contract" : doc.documentKind,
        customerName: doc.customerName ?? null,
        syncStatus: doc.syncStatus ?? "ready",
        ...(doc.payload === false ? {} : { detailPayload: { synthetic: true } }),
        ...(doc.purgeRequestedAt ? { permanentPurgeRequestedAt: doc.purgeRequestedAt } : {}),
        ...(doc.voidedAt ? { voidedAt: doc.voidedAt } : {}),
    });
    async function seed(doc: SeedDoc): Promise<void> {
        const row = await raw.eformsign_doc.create({ data: docData(doc) });
        for (const file of doc.files ?? []) {
            await raw.eformsign_doc_file.create({
                data: {
                    eformsignDocId: row.id, fileType: file.fileType, content: file.bytes as unknown as Uint8Array<ArrayBuffer>, contentType: "application/pdf",
                    byteSize: file.bytes.length, sha256: sha(file.bytes), sourceUpdatedDate: new Date("2026-10-02T00:00:00.000Z"),
                },
            });
        }
    }

    async function listAll(snapshotId: string, limit = "100"): Promise<{ items: ExportCandidateView[]; pages: number }> {
        const items: ExportCandidateView[] = [];
        let cursor: string | undefined;
        let pages = 0;
        do {
            const page = await service.listCandidates(PRINCIPAL, snapshotId, cursor, cursor ? undefined : limit);
            items.push(...page.items);
            cursor = page.nextCursor ?? undefined;
            pages++;
        } while (cursor);
        return { items, pages };
    }

    async function businessHash(): Promise<string> {
        const [docs] = await raw.$queryRaw<Array<{ h: string | null }>>`SELECT md5(string_agg(t::text, ',' ORDER BY id)) AS h FROM eformsign_doc t`;
        const [files] = await raw.$queryRaw<Array<{ h: string | null }>>`SELECT md5(string_agg(t::text, ',' ORDER BY id)) AS h FROM eformsign_doc_file t`;
        return `${docs?.h}|${files?.h}`;
    }
    async function snapshotRowCount(idempotencyKey: string): Promise<number> {
        return raw.eformsign_backup_export_snapshot.count({ where: { principalId: PRINCIPAL.principalId, idempotencyKey } });
    }

    const previousMode = process.env["TENANT_ISOLATION_MODE"];
    beforeAll(async () => {
        assertTarget();
        raw = new PrismaClient();
        extended = new PrismaClient().$extends(tenantIsolationExtension()) as unknown as PrismaClient;
        await raw.$connect();
        configuredCompany = COMPANY;
        service = new EformsignBackupExportService(
            new SbEformsignBackupExportRepository(extended as unknown as PrismaService),
            { get: (key: string) => (key === "EFORMSIGN_COMPANY_ID" ? configuredCompany : undefined) } as unknown as ConfigService,
        );
    });
    afterAll(async () => {
        if (previousMode === undefined) delete process.env["TENANT_ISOLATION_MODE"];
        else process.env["TENANT_ISOLATION_MODE"] = previousMode;
        if (!raw) return;
        await clean();
        await removeBranches();
        await raw.$disconnect();
        await (extended as unknown as PrismaClient).$disconnect();
    });

    describe("V06b fixture (N = 9)", () => {
        const B = { activeId: "", inactiveId: "" };
        const D001 = { document: pdf("D001 document"), audit_trail: pdf("D001 audit") };
        const D002 = { document: pdf("D002 document"), audit_trail: pdf("D002 audit") };
        const D003 = { document: pdf("D003 document"), audit_trail: pdf("D003 audit") };
        const D004 = { document: pdf("D004 document") };
        let snapshotId: string;
        let pagesBefore: ExportCandidateView[];

        beforeAll(async () => {
            await clean();
            await removeBranches();
            B.activeId = await makeBranch("active", true);
            B.inactiveId = await makeBranch("inactive", false);
            const files = (set: Partial<Record<"document" | "audit_trail", Buffer>>) =>
                (["document", "audit_trail"] as const).flatMap(fileType => set[fileType] ? [{ fileType, bytes: set[fileType]! }] : []);
            await seed({ documentId: "D001", statusType: "003", branchId: B.activeId, files: files(D001), customerName: PII_SENTINEL });
            await seed({ documentId: "D002", statusType: "doc_complete", branchId: B.inactiveId, files: files(D002) });
            await seed({ documentId: "D003", documentKind: "service_record_snapshot", statusType: "003", branchId: null, files: files(D003) });
            await seed({ documentId: "D004", statusType: "003", branchId: B.activeId, files: files(D004) });
            await seed({ documentId: "D005", documentKind: null, statusType: "003", branchId: B.activeId });
            await seed({ documentId: "D006", statusType: "060", branchId: B.activeId });
            await seed({ documentId: "D007", statusType: "003", branchId: B.activeId, purgeRequestedAt: new Date("2026-10-05T00:00:00.000Z") });
            await seed({ documentId: "D008", statusType: "061", branchId: B.activeId });
            await seed({ documentId: "D017", statusType: "002", branchId: B.activeId });
        });
        afterAll(async () => { await clean(); await removeBranches(); });

        it("T-EXP-12 + T-EXP-06/07: snapshot, replay, paging and every artifact leave eformsign_doc/_file byte-identical; counts are literal", async () => {
            const hashBefore = await businessHash();
            const key = nextKey();
            const created = await service.createSnapshot(PRINCIPAL, BODY, key);
            snapshotId = created.snapshotId;

            // T-EXP-06: literal expectations from the QA V06b row (N=9), not copied from output.
            expect(created.status).toBe("ready");
            expect(created.counts).toEqual({ total: 9, included: 4, unknownTemplate: 1, inaccessible: 1, excludedByPolicy: 3, policyPending: 0 });
            expect(created.coverage).toEqual({ status: "unverified", reasonCode: "collection-receipt-unavailable" });
            expect(created.backupComplete).toBe(false);
            expect(new Date(created.expiresAt!).getTime() - new Date(created.readyAt!).getTime()).toBe(24 * 3_600_000);

            const { items, pages } = await listAll(snapshotId, "4");
            pagesBefore = items;
            expect(pages).toBe(3);
            expect(items.map(i => i.ordinal)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
            const byId = Object.fromEntries(items.map(i => [i.documentId, i]));
            const classes = Object.fromEntries(items.map(i => [i.documentId, i.classification]));
            expect(classes).toEqual({
                D001: "included", D002: "included", D003: "included", D004: "included", D005: "unknown_template",
                D006: "excluded_by_policy", D007: "inaccessible", D008: "excluded_by_policy", D017: "excluded_by_policy",
            });
            // T-EXP-07: inactive-branch and unassigned (NULL branch) documents are in the snapshot.
            expect(byId["D002"]!.classification).toBe("included");
            expect(byId["D003"]!.classification).toBe("included");
            expect(byId["D002"]!.statusType).toBe("003"); // stored "doc_complete" normalised
            expect(byId["D004"]!.reasons).toEqual(["artifact-missing-at-snapshot:audit_trail"]);
            expect(byId["D004"]!.artifacts.map(a => a.fileType)).toEqual(["document"]);
            expect(byId["D007"]!.reasons).toEqual(["purge-pending"]);
            expect(byId["D005"]!.reasons).toEqual(["document-kind-unknown"]);
            expect(byId["D006"]!.reasons).toEqual(["incomplete-no-file"]);
            expect(byId["D017"]!.artifacts).toEqual([]);
            expect(byId["D001"]!.artifacts).toEqual([
                { fileType: "document", sha256: sha(D001.document), byteSize: D001.document.length,
                    artifactIdentity: artifactIdentity({ companyId: COMPANY, documentId: "D001", artifactKind: "document",
                        contentSha256: sha(D001.document), byteLength: D001.document.length }) },
                { fileType: "audit_trail", sha256: sha(D001.audit_trail), byteSize: D001.audit_trail.length,
                    artifactIdentity: artifactIdentity({ companyId: COMPANY, documentId: "D001", artifactKind: "audit-trail",
                        contentSha256: sha(D001.audit_trail), byteLength: D001.audit_trail.length }) },
            ]);
            expect(JSON.stringify([created, items])).not.toContain(PII_SENTINEL);

            // Replay: same key + same body -> the same snapshot, and nothing new is written.
            const replay = await service.createSnapshot(PRINCIPAL, BODY, key);
            expect(replay).toEqual(created);
            expect(await snapshotRowCount(key)).toBe(1);
            await expect(service.getSnapshot(PRINCIPAL, snapshotId)).resolves.toEqual(created);

            // Every included artifact serves its exact seeded bytes.
            const seeded: Record<string, Buffer> = {
                "D001/document": D001.document, "D001/audit_trail": D001.audit_trail, "D002/document": D002.document,
                "D002/audit_trail": D002.audit_trail, "D003/document": D003.document, "D003/audit_trail": D003.audit_trail,
                "D004/document": D004.document,
            };
            let served = 0;
            for (const item of items) {
                for (const artifact of item.artifacts) {
                    const view = await service.readArtifact(PRINCIPAL, snapshotId, artifact.artifactIdentity);
                    expect(view.bytes.equals(seeded[`${item.documentId}/${artifact.fileType}`]!)).toBe(true);
                    expect(view.sha256).toBe(artifact.sha256);
                    expect(view.byteSize).toBe(artifact.byteSize);
                    expect(view.artifactIdentity).toBe(artifact.artifactIdentity);
                    view.release(); // the slot is held until the response ends
                    served++;
                }
            }
            expect(served).toBe(7);

            // Error paths in the same flow must not write business tables either.
            await expectExportError(service.readArtifact(PRINCIPAL, snapshotId, "0".repeat(64)), "NOT_FOUND");
            await expectExportError(service.getSnapshot({ ...PRINCIPAL, principalId: "someone-else" }, snapshotId), "NOT_FOUND");
            await expectExportError(service.createSnapshot(PRINCIPAL, { ...BODY, policyRevision: "old" }, nextKey()), "UNSUPPORTED_REVISION");

            expect(await businessHash()).toBe(hashBefore);
        });

        it("T-EXP-05: same key + same body -> same snapshot; a different body under the same key -> IDEMPOTENCY_CONFLICT", async () => {
            const key = nextKey();
            const first = await service.createSnapshot(PRINCIPAL, BODY, key);
            const again = await service.createSnapshot(PRINCIPAL, BODY, key);
            expect(again.snapshotId).toBe(first.snapshotId);
            expect(await snapshotRowCount(key)).toBe(1);

            // The only way two bodies differ for valid input is the configured company changing in between.
            configuredCompany = "u34-company-b";
            try {
                await expectExportError(service.createSnapshot(PRINCIPAL, { ...BODY, companyId: "u34-company-b" }, key), "IDEMPOTENCY_CONFLICT");
            } finally {
                configuredCompany = COMPANY;
            }
            expect(await snapshotRowCount(key)).toBe(1);
        });

        it("T-EXP-05: two concurrent createSnapshot with the same key and body -> exactly one snapshot row", async () => {
            const key = nextKey();
            const [a, b] = await Promise.all([
                service.createSnapshot(PRINCIPAL, BODY, key), service.createSnapshot(PRINCIPAL, BODY, key)]);
            expect(a.snapshotId).toBe(b.snapshotId);
            expect(await snapshotRowCount(key)).toBe(1);
            const candidates = await raw.eformsign_backup_export_candidate.count({ where: { snapshotId: a.snapshotId } });
            expect(candidates).toBe(9);
        });

        it("T-EXP-05: a real unique-violation race converges on the winner, and different bodies conflict", async () => {
            const key = nextKey();
            const winner = await service.createSnapshot(PRINCIPAL, BODY, key);
            // A second service that never sees the winner's row at lookup time, so its write meets the real P2002.
            const blind = makeService(extended, "u34-company-b");
            const repository = (blind as unknown as { repository: SbEformsignBackupExportRepository }).repository;
            jest.spyOn(repository, "findSnapshotByIdempotency").mockResolvedValue(null);
            await expectExportError(blind.createSnapshot(PRINCIPAL, { ...BODY, companyId: "u34-company-b" }, key), "IDEMPOTENCY_CONFLICT");

            const blindSame = makeService(extended);
            jest.spyOn((blindSame as unknown as { repository: SbEformsignBackupExportRepository }).repository,
                "findSnapshotByIdempotency").mockResolvedValue(null);
            const converged = await blindSame.createSnapshot(PRINCIPAL, BODY, key);
            expect(converged.snapshotId).toBe(winner.snapshotId);
            expect(await snapshotRowCount(key)).toBe(1);
            expect(await raw.eformsign_backup_export_candidate.count({ where: { snapshotId: winner.snapshotId } })).toBe(9);
        });

        it("two concurrent createSnapshot calls with different bodies under one key -> one snapshot row, one IDEMPOTENCY_CONFLICT", async () => {
            const key = nextKey();
            const other = makeService(extended, "u34-company-b");
            const results = await Promise.allSettled([
                service.createSnapshot(PRINCIPAL, BODY, key),
                other.createSnapshot(PRINCIPAL, { ...BODY, companyId: "u34-company-b" }, key),
            ]);
            expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
            const rejected = results.find(r => r.status === "rejected") as PromiseRejectedResult;
            expect(rejected.reason).toBeInstanceOf(ExportError);
            expect((rejected.reason as ExportError).code).toBe("IDEMPOTENCY_CONFLICT");
            expect(await snapshotRowCount(key)).toBe(1);
        });

        it("a failing write transaction rolls back and records a failed snapshot with no candidates", async () => {
            const failing = new PrismaClient().$extends({
                query: { eformsign_backup_export_candidate: { createMany: () => { throw new Error("injected createMany failure"); } } },
            }) as unknown as PrismaClient;
            try {
                const failingService = makeService(failing);
                const key = nextKey();
                const view = await failingService.createSnapshot(PRINCIPAL, BODY, key);
                expect(view.status).toBe("failed");
                expect(view.readyAt).toBeNull();
                expect(view.expiresAt).toBeNull();
                expect(JSON.stringify(view)).not.toContain("injected");

                const rows = await raw.$queryRaw<Array<{ id: string; status: string; counts: unknown; failure_code: string | null; ready_at: Date | null }>>`
                    SELECT id::text, status, counts, failure_code, ready_at FROM eformsign_backup_export_snapshot
                    WHERE principal_id = ${PRINCIPAL.principalId} AND idempotency_key = ${key}`;
                expect(rows).toHaveLength(1);
                expect(rows[0]).toMatchObject({ id: view.snapshotId, status: "failed", counts: null, ready_at: null });
                expect(rows[0]!.failure_code).toBeTruthy();
                expect(await raw.eformsign_backup_export_candidate.count({ where: { snapshotId: view.snapshotId } })).toBe(0);

                // The replay returns the failed representation, and candidates are refused with SNAPSHOT_FAILED.
                await expect(service.createSnapshot(PRINCIPAL, BODY, key)).resolves.toMatchObject({ snapshotId: view.snapshotId, status: "failed" });
                await expectExportError(service.listCandidates(PRINCIPAL, view.snapshotId), "SNAPSHOT_FAILED");
            } finally {
                await failing.$disconnect();
            }
        });

        it("mutation guard: with tenant isolation enforcing an HTTP branch context, the snapshot still reads all 9 documents", async () => {
            process.env["TENANT_ISOLATION_MODE"] = "enforce";
            try {
                const key = nextKey();
                const view = await tenantContextStore.run({ origin: "http", branchId: B.activeId },
                    () => service.createSnapshot(PRINCIPAL, BODY, key));
                expect(view.status).toBe("ready");
                expect(view.counts).toEqual({ total: 9, included: 4, unknownTemplate: 1, inaccessible: 1, excludedByPolicy: 3, policyPending: 0 });
                const ids = await raw.eformsign_backup_export_candidate.findMany({ where: { snapshotId: view.snapshotId }, select: { documentId: true } });
                expect(ids.map(i => i.documentId).sort()).toEqual(["D001", "D002", "D003", "D004", "D005", "D006", "D007", "D008", "D017"]);
            } finally {
                if (previousMode === undefined) delete process.env["TENANT_ISOLATION_MODE"];
                else process.env["TENANT_ISOLATION_MODE"] = previousMode;
            }
        });

        // Everything below changes the live rows after the snapshot was taken; the snapshot must not move.
        it("T-EXP-08: after changing D001's document file and D006's status, the candidate pages are unchanged and D001's artifact is VERSION_CHANGED", async () => {
            const replacement = pdf("D001 document replaced after the snapshot");
            await raw.$executeRaw`
                UPDATE eformsign_doc_file SET content = ${replacement}, byte_size = ${replacement.length}, sha256 = ${sha(replacement)}
                WHERE file_type = 'document' AND eformsign_doc_id = (SELECT id FROM eformsign_doc WHERE document_id = 'D001')`;
            await raw.$executeRaw`UPDATE eformsign_doc SET status_type = '003' WHERE document_id = 'D006'`;

            const { items } = await listAll(snapshotId, "4");
            expect(items).toEqual(pagesBefore);
            expect(items.find(i => i.documentId === "D006")!.classification).toBe("excluded_by_policy");
            const documentIdentity = pagesBefore.find(i => i.documentId === "D001")!.artifacts[0]!.artifactIdentity;
            const error = await expectExportError(service.readArtifact(PRINCIPAL, snapshotId, documentIdentity), "VERSION_CHANGED");
            expect(error.retryAfterSeconds).toBeUndefined();
        });

        it("T-EXP-10: exact artifact errors #4 to #9 and the exact-bytes serve", async () => {
            const identityOf = (documentId: string, fileType: string): string =>
                pagesBefore.find(i => i.documentId === documentId)!.artifacts.find(a => a.fileType === fileType)!.artifactIdentity;
            const idOf = async (documentId: string): Promise<number> =>
                (await raw.eformsign_doc.findUniqueOrThrow({ where: { documentId }, select: { id: true } })).id;

            // #5 ARTIFACT_PENDING: no file row, sync still running (D001 audit_trail).
            await raw.eformsign_doc_file.deleteMany({ where: { eformsignDocId: await idOf("D001"), fileType: "audit_trail" } });
            await raw.eformsign_doc.update({ where: { documentId: "D001" }, data: { syncStatus: "syncing" } });
            const pending = await expectExportError(service.readArtifact(PRINCIPAL, snapshotId, identityOf("D001", "audit_trail")), "ARTIFACT_PENDING");
            expect(pending.retryAfterSeconds).toBe(60);

            // #6 MIRROR_MISSING: no file row, sync ready (D002 audit_trail).
            await raw.eformsign_doc_file.deleteMany({ where: { eformsignDocId: await idOf("D002"), fileType: "audit_trail" } });
            await expectExportError(service.readArtifact(PRINCIPAL, snapshotId, identityOf("D002", "audit_trail")), "MIRROR_MISSING");

            // serve: D002 document is untouched -> exact bytes.
            const served = await service.readArtifact(PRINCIPAL, snapshotId, identityOf("D002", "document"));
            expect(served.bytes.equals(D002.document)).toBe(true);
            expect(served.sha256).toBe(sha(D002.document));
            served.release();

            // #9 CONSISTENCY_CONFLICT: stored sha/size still match the snapshot, the bytes do not
            // (equal length, so the byte_size = octet_length(content) CHECK is satisfied).
            const tampered = Buffer.from(D003.document);
            tampered[tampered.length - 2] = tampered[tampered.length - 2]! ^ 0x01;
            expect(tampered.length).toBe(D003.document.length);
            await raw.$executeRaw`
                UPDATE eformsign_doc_file SET content = ${tampered}
                WHERE file_type = 'document' AND eformsign_doc_id = (SELECT id FROM eformsign_doc WHERE document_id = 'D003')`;
            await expectExportError(service.readArtifact(PRINCIPAL, snapshotId, identityOf("D003", "document")), "CONSISTENCY_CONFLICT");

            // #4 SOURCE_REMOVED, three shapes.
            // (a) 049 and no file row (D004).
            await raw.eformsign_doc_file.deleteMany({ where: { eformsignDocId: await idOf("D004") } });
            await raw.eformsign_doc.update({ where: { documentId: "D004" }, data: { statusType: "doc_delete" } });
            await expectExportError(service.readArtifact(PRINCIPAL, snapshotId, identityOf("D004", "document")), "SOURCE_REMOVED");
            // (b) permanent purge requested after the snapshot (D003 audit_trail still has its file).
            await raw.eformsign_doc.update({ where: { documentId: "D003" }, data: { permanentPurgeRequestedAt: new Date() } });
            await expectExportError(service.readArtifact(PRINCIPAL, snapshotId, identityOf("D003", "audit_trail")), "SOURCE_REMOVED");
            // (c) the document row itself is gone (files cascade).
            await raw.eformsign_doc.delete({ where: { documentId: "D003" } });
            await expectExportError(service.readArtifact(PRINCIPAL, snapshotId, identityOf("D003", "audit_trail")), "SOURCE_REMOVED");

            // The snapshot itself never moved through all of this.
            const { items } = await listAll(snapshotId, "4");
            expect(items).toEqual(pagesBefore);
        });
    });

    describe("additional classifications", () => {
        beforeAll(async () => {
            await clean();
            await seed({ documentId: "999doc", statusType: "999" });
            await seed({ documentId: "long-status", statusType: "doc_request_something" });
            await seed({ documentId: "D014", documentKind: null, statusType: "049", payload: false });
            await seed({ documentId: "bad id!", statusType: "003" });
            await seed({ documentId: "D015", statusType: "003", voidedAt: new Date("2026-10-06T00:00:00.000Z"), files: [{ fileType: "document", bytes: pdf("D015") }] });
            await seed({ documentId: "a-lower", statusType: "002" });
            await seed({ documentId: "Z-upper", statusType: "002" });
        });
        afterAll(clean);

        it("policy_pending keeps the raw status, tombstones are purged, bad ids are identifier-invalid, void is only a reason; ordinals follow code-unit order", async () => {
            const view = await service.createSnapshot(PRINCIPAL, BODY, nextKey());
            expect(view.status).toBe("ready");
            expect(view.counts).toEqual({ total: 7, inaccessible: 2, unknownTemplate: 0, policyPending: 2, excludedByPolicy: 2, included: 1 });
            const { items } = await listAll(view.snapshotId);
            const byId = Object.fromEntries(items.map(i => [i.documentId, i]));
            expect(byId["999doc"]).toMatchObject({ classification: "policy_pending", statusType: "999", reasons: ["status-unclassified"] });
            expect(byId["long-status"]).toMatchObject({ classification: "policy_pending", statusType: "doc_request_something" });
            expect(byId["D014"]).toMatchObject({ classification: "inaccessible", reasons: ["purged"], statusType: "049", artifacts: [] });
            expect(byId["bad id!"]).toMatchObject({ classification: "inaccessible", reasons: ["identifier-invalid"], artifacts: [] });
            expect(byId["D015"]).toMatchObject({ classification: "included" });
            expect(byId["D015"]!.reasons).toEqual(["voided", "artifact-missing-at-snapshot:audit_trail"]);
            // Code-unit order: "999doc" < "D014" < ... < "Z-upper" < "a-lower" < "bad id!" < "long-status".
            expect(items.map(i => i.documentId)).toEqual(["999doc", "D014", "D015", "Z-upper", "a-lower", "bad id!", "long-status"]);
            expect(items.map(i => i.ordinal)).toEqual([1, 2, 3, 4, 5, 6, 7]);
        });
    });

    describe("paging over 250 documents", () => {
        const ids = Array.from({ length: 250 }, (_, i) => `P${String(i + 1).padStart(3, "0")}`);
        beforeAll(async () => {
            await clean();
            await raw.eformsign_doc.createMany({ data: ids.map(documentId => docData({ documentId, statusType: "003" })) });
        });
        afterAll(clean);

        it("pages of 100 cover ids 001..250 exactly once, and a replayed cursor returns identical results", async () => {
            const view = await service.createSnapshot(PRINCIPAL, BODY, nextKey());
            expect(view.counts.total).toBe(250);
            const first = await service.listCandidates(PRINCIPAL, view.snapshotId);
            expect(first.items).toHaveLength(100);
            expect(first.nextCursor).not.toBeNull();
            const second = await service.listCandidates(PRINCIPAL, view.snapshotId, first.nextCursor!);
            expect(second.items).toHaveLength(100);
            const third = await service.listCandidates(PRINCIPAL, view.snapshotId, second.nextCursor!);
            expect(third.items).toHaveLength(50);
            expect(third.nextCursor).toBeNull();

            const all = [...first.items, ...second.items, ...third.items];
            expect(new Set(all.map(i => i.documentId))).toEqual(new Set(ids));
            expect(all.map(i => i.ordinal)).toEqual(Array.from({ length: 250 }, (_, i) => i + 1));
            // Replay: identical items and identical cursors.
            await expect(service.listCandidates(PRINCIPAL, view.snapshotId, first.nextCursor!)).resolves.toEqual(second);
            await expect(service.listCandidates(PRINCIPAL, view.snapshotId)).resolves.toEqual(first);
        });

        it("a limit that exactly exhausts the snapshot ends with a null cursor", async () => {
            const view = await service.createSnapshot(PRINCIPAL, BODY, nextKey());
            const { items, pages } = await listAll(view.snapshotId, "50");
            expect(items).toHaveLength(250);
            expect(pages).toBe(5);
        });
    });
});
