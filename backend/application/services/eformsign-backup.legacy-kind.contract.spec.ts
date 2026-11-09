// Main-authored contract test (BJJ-570 Phase 5, legacy rows). Do not edit; if it is wrong, stop and report.
import { BackupDocumentRow, IEformsignBackupRepository } from "domain/repositories/eformsign-backup.repository.interface";
import { EformsignBackupService } from "application/services/eformsign-backup.service";

const date = new Date("2026-11-07T00:00:00.000Z");
const file = { id: "file", fileType: "document", sha256: "a".repeat(64), byteSize: 3, sourceUpdatedDate: date };
const fields = (pairs: Record<string, string>) => ({ fields: Object.entries(pairs).map(([id, value]) => ({ id, value, type: "text" })) });
const row = (patch: Partial<BackupDocumentRow>): BackupDocumentRow => ({
    id: 7, documentId: "doc", documentKind: null, documentName: null, statusType: "003", detailPayload: null, customerName: "홍길동", createdDate: date,
    syncStatus: "ready", detailSourceUpdatedDate: date,
    serviceRecordCase: null, employeeSchedule: null, client: null,
    serviceRecordSnapshotChunk: null, files: [file], ...patch,
});

describe("eformsign backup legacy rows (contract)", () => {
    const repository: jest.Mocked<IEformsignBackupRepository> = {
        listDocuments: jest.fn(), findFile: jest.fn(), createRun: jest.fn(), listRuns: jest.fn(),
    };
    const service = new EformsignBackupService(repository);
    const item = async (patch: Partial<BackupDocumentRow>) => {
        repository.listDocuments.mockResolvedValue([row(patch)]);
        return (await service.listDocuments(undefined, 200)).items[0];
    };

    it("classifies a kind-less row by its document name", async () => {
        expect(await item({ documentName: "산모신생아건강관리서비스 계약서_홍길동" })).toMatchObject({ kind: "contract" });
        expect(await item({ documentName: "서비스 제공기록지 - 실플_홍길동" })).toMatchObject({ kind: "service_record" });
        expect(await item({ documentName: "제공인력 계약서_김관리" })).toMatchObject({ kind: "other", title: "제공인력 계약서_김관리" });
        expect(await item({ documentName: "산모님 안내문 전자문서용" })).toMatchObject({ kind: "other" });
        expect(await item({ documentName: null })).toMatchObject({ kind: "other" });
    });

    it("keeps the stored kind when it is set", async () => {
        expect(await item({ documentKind: "contract", documentName: "아무 이름" })).toMatchObject({ kind: "contract" });
        expect(await item({ documentKind: "service_record_snapshot", documentName: "아무 이름" })).toMatchObject({ kind: "service_record" });
    });

    it("returns the document name as title for every kind", async () => {
        expect(await item({ documentKind: "contract", documentName: "산모신생아건강관리서비스 계약서_홍길동" }))
            .toMatchObject({ title: "산모신생아건강관리서비스 계약서_홍길동" });
        expect(await item({ documentKind: "contract", documentName: null })).toMatchObject({ title: null });
    });

    it("reads a contract start date from the stored document fields when no linked record has one", async () => {
        const name = "산모신생아건강관리서비스 계약서_홍길동";
        expect(await item({ documentName: name, detailPayload: fields({ "계약 시작 년도": "26", "계약 시작 월": "3", "계약 시작 일": "5" }) }))
            .toMatchObject({ serviceStartDate: "2026-03-05" });
        expect(await item({ documentName: name, detailPayload: fields({ "서비스 기간": "2025-11-02 ~ 2025-12-01" }) }))
            .toMatchObject({ serviceStartDate: "2025-11-02" });
        expect(await item({ documentName: name, detailPayload: { fields: [] } })).toMatchObject({ serviceStartDate: null });
        expect(await item({ documentName: name, detailPayload: null })).toMatchObject({ serviceStartDate: null });
    });

    it("prefers the linked schedule, then the client, over the document fields", async () => {
        const detailPayload = fields({ "계약 시작 년도": "2026", "계약 시작 월": "01", "계약 시작 일": "01" });
        expect(await item({ documentKind: "contract", detailPayload, employeeSchedule: { startDate: new Date("2026-02-02T00:00:00.000Z") } }))
            .toMatchObject({ serviceStartDate: "2026-02-02" });
        expect(await item({ documentKind: "contract", detailPayload, client: { startDate: new Date("2026-03-03T00:00:00.000Z") } }))
            .toMatchObject({ serviceStartDate: "2026-03-03" });
        expect(await item({ documentKind: "contract", detailPayload })).toMatchObject({ serviceStartDate: "2026-01-01" });
    });

    it("gives other documents no start date", async () => {
        expect(await item({ documentName: "제공인력 계약서_김관리", detailPayload: fields({ "계약시작일": "2026-04-01" }) }))
            .toMatchObject({ kind: "other", serviceStartDate: null });
    });
});
