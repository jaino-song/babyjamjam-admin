import { Prisma } from "@prisma/client";
import { SbEformsignBackupExportRepository } from "infrastructure/database/repositories/sb.eformsign-backup-export.repository";
import * as runSystemScopeModule from "infrastructure/tenant/run-system-scope";

const FORBIDDEN_SELECT_KEYS = [
    "content", "detailPayload", "customerName", "customerPhone", "documentName", "documentNumber", "templateName",
    "creatorName", "lastEditorName", "stepRecipientName", "stepRecipientSms", "syncError",
];

function setup() {
    const tx = {
        eformsign_doc: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null) },
        eformsign_doc_file: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null) },
    };
    const prisma = {
        $transaction: jest.fn(async (operation: (value: typeof tx) => Promise<unknown>, _options?: unknown) => operation(tx)),
        ...tx,
    };
    return { tx, prisma, repository: new SbEformsignBackupExportRepository(prisma as never) };
}

function selects(...mocks: jest.Mock[]): Array<Record<string, unknown>> {
    return mocks.flatMap(mock => mock.mock.calls.map(call => {
        const args = call[0] as { select?: Record<string, unknown> };
        expect(args.select).toBeDefined(); // a read without an explicit select would fetch every column
        return args.select!;
    }));
}

describe("SbEformsignBackupExportRepository", () => {
    let scopeSpy: jest.SpyInstance;
    let insideScope: number;
    beforeEach(() => {
        insideScope = 0;
        scopeSpy = jest.spyOn(runSystemScopeModule, "runSystemScope").mockImplementation(async (fn) => {
            insideScope++;
            try { return await fn(); } finally { insideScope--; }
        });
    });
    afterEach(() => scopeSpy.mockRestore());

    describe("readSourceForSnapshot", () => {
        it("reads docs and file metadata in one RepeatableRead transaction inside system scope", async () => {
            const { prisma, tx, repository } = setup();
            const seenInScope: number[] = [];
            prisma.$transaction.mockImplementation(async (operation: (value: typeof tx) => Promise<unknown>, _options?: unknown) => {
                seenInScope.push(insideScope);
                return operation(tx);
            });
            await repository.readSourceForSnapshot();
            expect(scopeSpy).toHaveBeenCalledTimes(1);
            expect(seenInScope).toEqual([1]);
            expect(prisma.$transaction).toHaveBeenCalledTimes(1);
            expect(prisma.$transaction.mock.calls[0]![1]).toMatchObject({ isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
            // every doc/file read goes through the transaction client, not the base client
            expect(prisma.eformsign_doc.findMany).toBe(tx.eformsign_doc.findMany);
            expect(tx.eformsign_doc.findMany).toHaveBeenCalled();
            expect(tx.eformsign_doc_file.findMany).toHaveBeenCalledTimes(1);
        });

        it("select lists never contain content, detailPayload or any name/phone column", async () => {
            const { tx, repository } = setup();
            await repository.readSourceForSnapshot();
            const all = selects(tx.eformsign_doc.findMany, tx.eformsign_doc_file.findMany);
            expect(all.length).toBeGreaterThanOrEqual(3);
            for (const select of all) {
                for (const key of FORBIDDEN_SELECT_KEYS) expect(Object.keys(select)).not.toContain(key);
            }
            const fileSelect = tx.eformsign_doc_file.findMany.mock.calls[0]![0].select as Record<string, unknown>;
            expect(Object.keys(fileSelect).sort()).toEqual(["byteSize", "eformsignDocId", "fileType", "sha256"]);
        });

        it("derives detailPayloadIsNull from a SQL-NULL filter, never from the payload", async () => {
            const { tx, repository } = setup();
            tx.eformsign_doc.findMany
                .mockResolvedValueOnce([
                    { id: 1, documentId: "D001", documentKind: "contract", statusType: "003", templateId: null,
                        permanentPurgeRequestedAt: null, voidedAt: null },
                    { id: 2, documentId: "D014", documentKind: null, statusType: "049", templateId: null,
                        permanentPurgeRequestedAt: null, voidedAt: null },
                ])
                .mockResolvedValueOnce([{ id: 2 }]);
            tx.eformsign_doc_file.findMany.mockResolvedValue([
                { eformsignDocId: 1, fileType: "document", sha256: "a".repeat(64), byteSize: 5 },
            ]);
            const source = await repository.readSourceForSnapshot();
            const nullFilter = tx.eformsign_doc.findMany.mock.calls.find(c => c[0].where)![0];
            expect(nullFilter.where).toEqual({ detailPayload: { equals: Prisma.DbNull } });
            expect(Object.keys(nullFilter.select)).toEqual(["id"]);
            expect(source.docs.map(d => [d.documentId, d.detailPayloadIsNull])).toEqual([["D001", false], ["D014", true]]);
            expect(source.files).toEqual([{ documentId: "D001", fileType: "document", sha256: "a".repeat(64), byteSize: 5 }]);
            for (const doc of source.docs) expect(Object.keys(doc)).not.toContain("id");
        });

        it("skips file rows whose document is not in the snapshot read", async () => {
            const { tx, repository } = setup();
            tx.eformsign_doc_file.findMany.mockResolvedValue([{ eformsignDocId: 99, fileType: "document", sha256: "a".repeat(64), byteSize: 1 }]);
            await expect(repository.readSourceForSnapshot()).resolves.toEqual({ docs: [], files: [] });
        });
    });

    describe("readArtifactForDownload", () => {
        it("reads doc and file in one system-scope transaction, selecting content only on request", async () => {
            const { prisma, tx, repository } = setup();
            tx.eformsign_doc.findUnique.mockResolvedValue({ id: 7, permanentPurgeRequestedAt: null, statusType: "003", syncStatus: "ready" });
            tx.eformsign_doc_file.findUnique.mockResolvedValue({ sha256: "a".repeat(64), byteSize: 3, contentType: "application/pdf" });

            const meta = await repository.readArtifactForDownload("D001", "document", { withContent: false });
            expect(scopeSpy).toHaveBeenCalledTimes(1);
            expect(prisma.$transaction).toHaveBeenCalledTimes(1);
            expect(meta.doc).toEqual({ permanentPurgeRequestedAt: null, statusType: "003", syncStatus: "ready" });
            expect(meta.file).toEqual({ sha256: "a".repeat(64), byteSize: 3, contentType: "application/pdf" });
            const [metaSelect] = selects(tx.eformsign_doc_file.findUnique);
            expect(Object.keys(metaSelect!)).not.toContain("content");

            tx.eformsign_doc_file.findUnique.mockClear();
            await repository.readArtifactForDownload("D001", "document", { withContent: true });
            const [contentSelect] = selects(tx.eformsign_doc_file.findUnique);
            expect(contentSelect).toMatchObject({ content: true });
            for (const key of FORBIDDEN_SELECT_KEYS.filter(k => k !== "content")) expect(Object.keys(contentSelect!)).not.toContain(key);
            for (const select of selects(tx.eformsign_doc.findUnique)) {
                for (const key of FORBIDDEN_SELECT_KEYS) expect(Object.keys(select)).not.toContain(key);
            }
        });

        it("returns null file without querying files when the document row is gone", async () => {
            const { tx, repository } = setup();
            await expect(repository.readArtifactForDownload("D001", "document", { withContent: false }))
                .resolves.toEqual({ doc: null, file: null });
            expect(tx.eformsign_doc_file.findUnique).not.toHaveBeenCalled();
        });
    });

    describe("write surface", () => {
        it("never calls a write method on eformsign_doc or eformsign_doc_file", async () => {
            const { tx, repository } = setup();
            await repository.readSourceForSnapshot();
            await repository.readArtifactForDownload("D001", "document", { withContent: true });
            for (const model of [tx.eformsign_doc, tx.eformsign_doc_file]) {
                expect(Object.keys(model).sort()).toEqual(["findMany", "findUnique"]); // only read mocks exist; a write would throw
            }
        });
    });
});
