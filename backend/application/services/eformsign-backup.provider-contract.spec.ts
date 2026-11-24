import { BackupDocumentRow, IEformsignBackupRepository } from "domain/repositories/eformsign-backup.repository.interface";

import { EformsignBackupService } from "./eformsign-backup.service";

const field = (id: string, value: string) => ({ id, type: "text", value });
const signer = field("제공인력 성명", " 김관리 ");
const year = field("계약년", " 26 ");
const month = field("계약월", "5");
const day = field("계약일", "1");
const fields = [signer, year, month, day];
const template = { name: "제공인력 계약서" };
const date = new Date("2025-01-01");

async function list(patch: Partial<BackupDocumentRow> = {}) {
    const row: BackupDocumentRow = {
        id: 1, documentId: "fixture", documentKind: null, documentName: "발급 문서", statusType: "003",
        detailPayload: { template, fields }, customerName: null, createdDate: date, syncStatus: "ready",
        detailSourceUpdatedDate: date, serviceRecordCase: null, employeeSchedule: null, client: null,
        serviceRecordSnapshotChunk: null, files: [], ...patch,
    };
    const repository: jest.Mocked<IEformsignBackupRepository> = {
        listReadyEvents: jest.fn(), findReadyTarget: jest.fn(),
        listDocuments: jest.fn().mockResolvedValue([row]), findFile: jest.fn(), createRun: jest.fn(), listRuns: jest.fn(),
    };
    return (await new EformsignBackupService(repository).listDocuments(undefined, 200)).items[0];
}

describe("eformsign backup provider metadata", () => {
    it("uses the exact template and form fields independently of the generated title", async () => {
        const result = await list({
            documentName: "서비스 제공기록지 (변경된 문서 제목)",
            detailPayload: { template, fields: [...fields, field(signer.id, "김관리"), field("기관 성명", "다른 값")] },
        });
        expect(result).toMatchObject({ kind: "other", providerContract: { signerName: "김관리", signedDate: "2026-05-01" } });
        expect(result).not.toHaveProperty("detailPayload");
    });

    it("accepts a four-digit year and a real leap day at review", async () => {
        const result = await list({ statusType: "070", detailPayload: { template,
            fields: [signer, field(year.id, "2024"), field(month.id, "02"), field(day.id, "29")] } });
        expect(result).toMatchObject({ completed: false, providerContract: { signerName: "김관리", signedDate: "2024-02-29" } });
    });

    it.each([
        [signer, year, month],
        [...fields, field(signer.id, "다른 사람")],
        [...fields, field(year.id, "2026")],
        [...fields, field(day.id, " ")],
        [field(signer.id, "../"), year, month, day],
        [field("을성명", "김관리"), year, month, day],
        [signer, field(year.id, "1926"), month, day],
        [signer, year, field(month.id, "2"), field(day.id, "29")],
    ].map((candidate) => ({ candidate })))("omits missing, unsafe, invalid, or ambiguous values ($candidate)", async ({ candidate }) => {
        expect(await list({ detailPayload: { template, fields: candidate } })).not.toHaveProperty("providerContract");
    });

    it("does not use similar titles or fields on another template", async () => {
        const result = await list({ documentName: template.name, detailPayload: { template: { name: template.name + " " }, fields } });
        expect(result).toMatchObject({ kind: "other" });
        expect(result).not.toHaveProperty("providerContract");
    });

    it.each([["contract", "contract"], ["service_record_snapshot", "service_record"]])(
        "keeps explicit %s classification", async (documentKind, kind) => {
            const result = await list({ documentKind });
            expect(result).toMatchObject({ kind });
            expect(result).not.toHaveProperty("providerContract");
        },
    );
});
