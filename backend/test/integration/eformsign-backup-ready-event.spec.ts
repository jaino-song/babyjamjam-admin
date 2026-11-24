import { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Test } from "@nestjs/testing";
import request from "supertest";

import { EformsignBackupService } from "application/services/eformsign-backup.service";
import { BackupDocumentRow, EFORMSIGN_BACKUP_REPOSITORY } from "domain/repositories/eformsign-backup.repository.interface";
import { EformsignBackupTokenGuard } from "infrastructure/auth/eformsign-backup-token.guard";
import { PrismaService } from "infrastructure/database/prisma.service";
import { SbEformsignBackupRepository } from "infrastructure/database/repositories/sb.eformsign-backup.repository";
import { GlobalValidationPipe } from "infrastructure/pipes/global-validation.pipe";
import { EformsignBackupInternalController } from "interface/controllers/eformsign-backup-internal.controller";

const start = new Date("2026-11-24T01:00:00.000Z");
const end = new Date("2026-11-24T01:05:00.000Z");
const revision = new Date("2026-11-24T00:01:00.000Z");
const path = "/internal/eformsign-backup";
const windowQuery = `since=${start.toISOString()}&until=${end.toISOString()}`;
const auth = { Authorization: "Bearer synthetic-fixture" };
const chunk = { serviceRecordCaseId: "case-cat", snapshotVersion: 2, chunkIndex: 1, chunkCount: 2, firstSessionIndex: 10 };
const body = { id: "body-id", fileType: "document", sha256: "a".repeat(64), byteSize: 100, sourceUpdatedDate: revision };
const audit = { ...body, id: "audit-id", fileType: "audit_trail", byteSize: 210 };
type Seed = BackupDocumentRow & { branchId: string | null; permanentPurgeRequestedAt: Date | null };
const seed: Seed = {
    id: 30, documentId: "vendor-b", documentKind: "service_record_snapshot", documentName: "Synthetic title",
    statusType: "003", detailPayload: { internal: true }, customerName: "Synthetic client", createdDate: start,
    syncStatus: "ready", detailSourceUpdatedDate: revision, serviceRecordCase: null, employeeSchedule: null, client: null,
    serviceRecordSnapshotChunk: chunk, files: [body, audit], permanentPurgeRequestedAt: null, branchId: null,
};

describe("eformsign PDF-ready internal API", () => {
    let app: INestApplication;
    const events = jest.fn();
    const findUnique = jest.fn();
    const findMany = jest.fn();
    const tx = { eformsign_doc: { findUnique, findMany } };
    const transaction = jest.fn((read: (client: typeof tx) => unknown) => read(tx));

    beforeAll(async () => {
        const module = await Test.createTestingModule({
            controllers: [EformsignBackupInternalController],
            providers: [EformsignBackupService, EformsignBackupTokenGuard,
                { provide: EFORMSIGN_BACKUP_REPOSITORY, useClass: SbEformsignBackupRepository },
                { provide: ConfigService, useValue: { get: () => "synthetic-fixture" } },
                { provide: PrismaService, useValue: { eformsign_webhook_event: { findMany: events }, $transaction: transaction } }],
        }).compile();
        app = module.createNestApplication();
        app.useGlobalPipes(new GlobalValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
        await app.listen(0, "127.0.0.1");
    });
    afterAll(() => app.close());
    beforeEach(() => jest.clearAllMocks());
    const target = (id = "vendor-b") => request(app.getHttpServer()).get(`${path}/ready-documents`).query({ docId: id }).set(auth);

    it("protects both metadata routes with the existing bearer", async () => {
        await request(app.getHttpServer()).get(`${path}/ready-events?${windowQuery}`).expect(401);
        await request(app.getHttpServer()).get(`${path}/ready-documents?docId=vendor-b`).expect(401);
        expect(events).not.toHaveBeenCalled();
        expect(transaction).not.toHaveBeenCalled();
    });

    it("queries the ledger range in PK order and projects only ready-event metadata", async () => {
        events.mockResolvedValue([
            { id: 501, documentId: "vendor-a", rawStatus: "doc_complete", statusType: null, createdAt: start, sourceUpdatedDate: null },
            { id: 502, documentId: "vendor-a", rawStatus: null, statusType: "003", createdAt: start, sourceUpdatedDate: revision },
        ]);
        const readyEvent = { docId: "vendor-a", completed: true, createdAt: start.toISOString() };
        await request(app.getHttpServer()).get(`${path}/ready-events?${windowQuery}&afterId=500&limit=2`).set(auth)
            .expect("Cache-Control", "no-store").expect(200, {
                items: [{ ...readyEvent, id: 501, sourceUpdatedAt: null }, { ...readyEvent, id: 502, sourceUpdatedAt: revision.toISOString() }],
                nextCursor: 502,
            });
        expect(events).toHaveBeenCalledWith({
            where: {
                eventType: "ready_document_pdf", documentId: { not: null, notIn: [""] },
                createdAt: { gte: start, lt: end }, id: { gt: 500 },
            },
            orderBy: { id: "asc" }, take: 2,
            select: { id: true, documentId: true, rawStatus: true, statusType: true, sourceUpdatedDate: true, createdAt: true },
        });
        events.mockResolvedValue([]);
        await request(app.getHttpServer()).get(`${path}/ready-events?${windowQuery}`).set(auth).expect(200, { items: [], nextCursor: null });
        expect(events).toHaveBeenLastCalledWith(expect.objectContaining({ take: 50, where: expect.objectContaining({ id: { gt: 0 } }) }));
    });

    it.each(["&limit=101", "&afterId=-1", "&afterId=1e3", "&afterId=1&afterId=2", "&rawPayload=true"])(
        "rejects oversized or invalid feed query %s", async (extra) => {
            await request(app.getHttpServer()).get(`${path}/ready-events?${windowQuery}${extra}`).set(auth).expect(400);
            expect(events).not.toHaveBeenCalled();
        },
    );

    it("rejects invalid UTC ranges and malformed target IDs before querying", async () => {
        for (const query of [
            `since=${end.toISOString()}&until=${start.toISOString()}`,
            "since=2026-11-23&until=2026-11-24",
            "since=2026-01-01T00:00:00Z&until=2026-11-24T00:00:00Z",
        ]) {
            await request(app.getHttpServer()).get(`${path}/ready-events?${query}`).set(auth).expect(400);
        }
        for (const id of ["", "with spaces", "x".repeat(256)]) await target(id).expect(400);
        expect(events).not.toHaveBeenCalled();
        expect(transaction).not.toHaveBeenCalled();
    });

    it.each([
        [null, "pending", null],
        [{ ...seed, syncStatus: "partial" }, "pending", revision.toISOString()],
        [{ ...seed, files: [body] }, "pending", revision.toISOString()],
        [{ ...seed, files: [body, { ...audit, sourceUpdatedDate: start }] }, "pending", revision.toISOString()],
        [{ ...seed, detailSourceUpdatedDate: null }, "pending", null],
        [{ ...seed, statusType: "060" }, "pending", revision.toISOString()],
        [{ ...seed, statusType: "doc_expired" }, "ineligible", revision.toISOString()],
        [{ ...seed, permanentPurgeRequestedAt: end }, "ineligible", revision.toISOString()],
    ])("classifies absent, stale, and ineligible mirrors", async (row, status, sourceUpdatedAt) => {
        findUnique.mockResolvedValue(row);
        findMany.mockResolvedValue([]);
        await target().expect(200, { status, sourceUpdatedAt, items: [] });
    });

    it("selects only non-purged eligible same-branch case/version peers, then omits not-yet-current pairs", async () => {
        findUnique.mockResolvedValue(seed);
        findMany.mockResolvedValue([
            { ...seed, documentId: "vendor-a", serviceRecordSnapshotChunk: { ...chunk, chunkIndex: 0, firstSessionIndex: 0 } },
            { ...seed, documentId: "vendor-pending", files: [audit] },
        ]);
        const response = await target().expect("Cache-Control", "no-store").expect(200);
        expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { documentId: "vendor-b" } }));
        expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: {
                id: { not: seed.id }, branchId: null, permanentPurgeRequestedAt: null,
                statusType: { in: expect.arrayContaining(["003", "070"]) },
                serviceRecordSnapshotChunk: { serviceRecordCaseId: chunk.serviceRecordCaseId, snapshotVersion: 2 },
            },
            orderBy: [{ serviceRecordSnapshotChunk: { firstSessionIndex: "asc" } }, { id: "asc" }], take: 199,
        }));
        expect(response.body).toEqual({
            status: "ready", sourceUpdatedAt: revision.toISOString(), items: ["vendor-a", "vendor-b"].map((docId, index) => ({
                docId, kind: "service_record", title: seed.documentName, customerName: seed.customerName,
                serviceStartDate: null, createdAt: start.toISOString(), completed: true,
                serviceRecordChunk: {
                    caseId: chunk.serviceRecordCaseId, snapshotVersion: 2, chunkIndex: index, chunkCount: 2, firstSessionIndex: index * 10,
                },
                files: [
                    { fileId: body.id, fileType: "document", sha256: body.sha256, byteSize: body.byteSize },
                    { fileId: audit.id, fileType: "audit_trail", sha256: audit.sha256, byteSize: audit.byteSize },
                ],
            })),
        });
    });
});
