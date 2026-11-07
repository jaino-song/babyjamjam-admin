import { NotFoundException } from "@nestjs/common";

import { BackupDocumentRow, BackupFileRow, IEformsignBackupRepository } from "domain/repositories/eformsign-backup.repository.interface";
import { EformsignBackupService } from "./eformsign-backup.service";

const date = new Date("2026-11-07T00:00:00.000Z");
const file = { id: "file", fileType: "document", sha256: "a".repeat(64), byteSize: 3, sourceUpdatedDate: date };
const document = (patch: Partial<BackupDocumentRow> = {}): BackupDocumentRow => ({
    id: 7, documentId: "doc", documentKind: null, customerName: null, createdDate: date,
    syncStatus: "ready", detailSourceUpdatedDate: date,
    serviceRecordCase: null, employeeSchedule: null, client: null,
    serviceRecordSnapshotChunk: null, files: [file], ...patch,
});

describe("EformsignBackupService", () => {
    const repository: jest.Mocked<IEformsignBackupRepository> = {
        listDocuments: jest.fn(), findFile: jest.fn(), createRun: jest.fn(), listRuns: jest.fn(),
    };
    const service = new EformsignBackupService(repository);
    beforeEach(() => jest.resetAllMocks());
    const item = async (patch: Partial<BackupDocumentRow> = {}) => {
        repository.listDocuments.mockResolvedValue([document(patch)]);
        return (await service.listDocuments(undefined, 200)).items[0];
    };

    it.each([[null, "contract"], ["contract", "contract"], ["service_record_snapshot", "service_record"]])(
        "maps kind %p to %p", async (documentKind, kind) => {
            expect(await item({ documentKind })).toMatchObject({ kind });
        },
    );
    it("uses the case date only for service records", async () => {
        expect(await item({ documentKind: "service_record_snapshot", serviceRecordCase: { startDate: date },
            employeeSchedule: { startDate: new Date("2020-01-01") } })).toMatchObject({ serviceStartDate: "2026-11-07" });
        expect(await item({ documentKind: "service_record_snapshot", client: { startDate: date } }))
            .toMatchObject({ serviceStartDate: null });
    });
    it("prefers schedule then client, then null for contracts", async () => {
        expect(await item({ serviceRecordCase: { startDate: new Date("2010-01-01") },
            employeeSchedule: { startDate: date }, client: { startDate: new Date("2020-01-01") } }))
            .toMatchObject({ serviceStartDate: "2026-11-07" });
        expect(await item({ employeeSchedule: { startDate: null }, client: { startDate: date } }))
            .toMatchObject({ serviceStartDate: "2026-11-07" });
        expect(await item()).toMatchObject({ serviceStartDate: null, serviceRecordChunk: null });
    });
    it("formats UTC db.Date without shifting the day in Asia/Seoul", async () => {
        const previous = process.env["TZ"];
        process.env["TZ"] = "Asia/Seoul";
        try {
            expect(await item({ employeeSchedule: { startDate: date } })).toMatchObject({
                serviceStartDate: "2026-11-07", createdAt: "2026-11-07T00:00:00.000Z",
            });
        } finally {
            if (previous === undefined) delete process.env["TZ"]; else process.env["TZ"] = previous;
        }
    });
    it("maps the chunk fields", async () => {
        expect(await item({ serviceRecordSnapshotChunk: {
            serviceRecordCaseId: "case", snapshotVersion: 2, chunkIndex: 1, chunkCount: 3, firstSessionIndex: 5,
        } })).toMatchObject({ serviceRecordChunk: {
            caseId: "case", snapshotVersion: 2, chunkIndex: 1, chunkCount: 3, firstSessionIndex: 5,
        } });
    });
    it("lists only current ready files, without source dates", async () => {
        expect(await item()).toMatchObject({ files: [{ fileId: "file", fileType: "document", sha256: file.sha256, byteSize: 3 }] });
        expect((await item({ syncStatus: "partial" }))?.files).toEqual([]);
        expect((await item({ detailSourceUpdatedDate: new Date("2020-01-01") }))?.files).toEqual([]);
        expect((await item({ detailSourceUpdatedDate: null }))?.files).toEqual([]);
    });
    it("sets a cursor only for a full page", async () => {
        repository.listDocuments.mockResolvedValue([document()]);
        expect((await service.listDocuments(1, 1)).nextCursor).toBe(7);
        expect(repository.listDocuments).toHaveBeenCalledWith(1, 1);
        expect((await service.listDocuments(undefined, 2)).nextCursor).toBeNull();
        repository.listDocuments.mockResolvedValue([]);
        expect((await service.listDocuments(undefined, 1)).nextCursor).toBeNull();
    });
    it("stores dates and only the first 200 failures", async () => {
        repository.createRun.mockResolvedValue({ id: "run" });
        const failures = Array.from({ length: 250 }, (_, i) => ({ docId: String(i), reason: "failed" }));
        expect(await service.createRun({ startedAt: date.toISOString(), finishedAt: date.toISOString(), status: "partial",
            limited: false, totalDocs: 250, savedFiles: 0, skippedFiles: 0, failedFiles: 250, driveStatus: "ok", failures }))
            .toEqual({ id: "run" });
        expect(repository.createRun.mock.calls[0]?.[0]).toMatchObject({ startedAt: date, finishedAt: date, failures: failures.slice(0, 200) });
    });
    const storedFile = (): BackupFileRow => ({ content: Buffer.from([0, 1, 255]), sha256: file.sha256, sourceUpdatedDate: date,
        eformsignDoc: { statusType: "003", permanentPurgeRequestedAt: null, syncStatus: "ready", detailSourceUpdatedDate: date } });
    it("returns exact file bytes", async () => {
        repository.findFile.mockResolvedValue(storedFile());
        expect(await service.getFile("file")).toEqual({ buffer: Buffer.from([0, 1, 255]), sha256: file.sha256 });
    });
    it.each([
        { statusType: "001" }, { permanentPurgeRequestedAt: date }, { syncStatus: "partial" },
        { detailSourceUpdatedDate: new Date("2020-01-01") }, { detailSourceUpdatedDate: null },
    ])("hides an ineligible file (%p)", async (patch) => {
        const stored = storedFile(); stored.eformsignDoc = { ...stored.eformsignDoc, ...patch };
        repository.findFile.mockResolvedValue(stored);
        await expect(service.getFile("file")).rejects.toThrow(NotFoundException);
    });
    it("returns 404 for a missing file", async () => {
        repository.findFile.mockResolvedValue(null);
        await expect(service.getFile("missing")).rejects.toThrow(NotFoundException);
    });
    it("maps history to exactly the public run fields", async () => {
        const run = { id: "run", startedAt: date, finishedAt: date, status: "success", limited: false,
            totalDocs: 1, savedFiles: 2, skippedFiles: 0, failedFiles: 0, driveStatus: "ok", failures: [] };
        repository.listRuns.mockResolvedValue([run]);
        expect(await service.listRuns(60)).toEqual({ items: [{ ...run, startedAt: date.toISOString(), finishedAt: date.toISOString() }] });
        expect(repository.listRuns).toHaveBeenCalledWith(60);
    });
});
