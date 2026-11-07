import { prepareManualBackupSelection } from "application/utils/manual-backup-selection";
import type { ManualBackupSource, ManualBackupSourceDocument, ManualBackupSourceFile } from "domain/repositories/eformsign-backup-run.repository.interface";
import { MANUAL_BACKUP_CONTRACT_MILESTONES, MANUAL_BACKUP_RECORD_MILESTONES, type ManualBackupScope } from "domain/eformsign-backup/manual-backup-scope";
import { buildExportMetadataRevision, buildExportArtifacts } from "domain/eformsign-backup/export/evidence";
import { normalizeManualBackupEnqueue } from "domain/eformsign-backup/manual-backup-run";

const BRANCH = "11111111-1111-4111-8111-111111111111";
const FOREIGN = "22222222-2222-4222-8222-222222222222";
const DATE = new Date("2026-11-01T00:00:00Z");
const HASH = "a".repeat(64);
const scope: ManualBackupScope = { period: "all", start: "", end: "", kind: "all", contractStages: [...MANUAL_BACKUP_CONTRACT_MILESTONES], recordStages: [...MANUAL_BACKUP_RECORD_MILESTONES] };
const doc = (documentId = "doc-a", extra: Partial<ManualBackupSourceDocument> = {}): ManualBackupSourceDocument => ({
    documentId, branchId: BRANCH, documentKind: "contract", serviceRecordCaseId: null, templateId: "template-a",
    createdDate: new Date(DATE), updatedDate: new Date(DATE), statusType: "003", stepType: "", stepIndex: "",
    voidedAt: null, permanentPurgeRequestedAt: null, detailPayloadIsNull: true, ...extra,
});
const file = (documentId = "doc-a", fileType: "document" | "audit_trail" = "document"): ManualBackupSourceFile => ({ documentId, fileType, sha256: HASH, byteSize: 4 });
const source = (documents = [doc()], files: ManualBackupSourceFile[] = []): ManualBackupSource => ({ observedAt: new Date(DATE), documents, files });
const prepare = (raw = source(), posted: unknown = scope) => prepareManualBackupSelection({ companyId: "company-a", branchId: BRANCH, scope: posted, source: raw, serviceRecordTemplateIds: new Set(["record-template"]) });
function expectError(fn: () => unknown, code = "INVALID_INPUT"): void {
    try { fn(); throw new Error("expected rejection"); } catch (error) {
        expect(error).toMatchObject({ code, message: "Manual backup operation rejected" });
        expect(String(error)).not.toContain("sensitive");
    }
}
describe("manual backup fixed selection", () => {
    it("includes two existing artifacts for one completed document and no files for an incomplete one", () => {
        const result = prepare(source([doc(), doc("doc-b", { statusType: "060" })], [file(), file("doc-a", "audit_trail"), file("doc-b")]));
        expect(result.sourceCounts).toEqual({ total: 2, inaccessible: 0, unknownTemplate: 0, policyPending: 0, excludedByPolicy: 1, included: 1 });
        expect(result.documents[0]?.candidate.artifacts).toEqual(buildExportArtifacts("company-a", "doc-a", [file(), file("doc-a", "audit_trail")]));
        expect(result.documents[1]?.candidate.artifacts).toEqual([]);
        expect(result.documents[1]?.candidate.reasons).toEqual(["incomplete-no-file"]);
        expect(result.documents[0]?.candidate.metadataRevision).toBe(buildExportMetadataRevision({ companyId: "company-a", ...doc() }));
        expect(normalizeManualBackupEnqueue({ companyId: "company-a", branchId: BRANCH, requestedByUserId: null, requestKey: "k", requestHash: HASH, scope, ...result }).documents).toHaveLength(2);
    });
    it("detects raw kind, linked record and legacy template while keeping null raw kind ineligible", () => {
        const result = prepare(source([
            doc("a", { documentKind: "service_record_snapshot" }), doc("b", { serviceRecordCaseId: FOREIGN }),
            doc("c", { documentKind: null, templateId: "record-template", statusType: "062" }), doc("d", { documentKind: null }),
        ], [file("c")]));
        expect(result.documents.map(d => d.kind)).toEqual(["record", "record", "record", "contract"]);
        expect(result.documents[2]).toMatchObject({ currentMilestone: "completed", candidate: { classification: "unknown_template", documentKind: null, artifacts: [] } });
        expect(result.sourceCounts).toEqual({ total: 4, included: 2, unknownTemplate: 2, inaccessible: 0, excludedByPolicy: 0, policyPending: 0 });
    });
    it("keeps unknown stage only when all stages of its kind are selected and never uses reached stages", () => {
        const raw = source([doc("a", { statusType: "mystery" }), doc("b", { statusType: "072" }), doc("c", { statusType: "071" })]);
        expect(prepare(raw).documents[0]?.candidate.reasons).toEqual(["stage-unverified", "status-unclassified"]);
        expect(prepare(raw, { ...scope, contractStages: ["signed"] }).documents.map(d => d.documentId)).toEqual(["c"]);
        expect(prepare(raw, { ...scope, contractStages: ["reviewed"] }).documents.map(d => d.documentId)).toEqual(["b"]);
        expect(prepare(raw).documents[2]?.candidate.reasons).toEqual(["incomplete-no-file", "reviewer-rejected"]);
    });
    it("sorts code units, reassigns ordinals and is deterministic with reversed source/file order", () => {
        const docs = [doc("z"), doc("a"), doc("Z")]; const files = [file("a"), file("z")];
        const first = prepare(source(docs, files));
        expect(first).toEqual(prepare(source([...docs].reverse(), [...files].reverse())));
        expect(first.documents.map(d => [d.documentId, d.ordinal, d.candidate.ordinal])).toEqual([["Z", 1, 1], ["a", 2, 2], ["z", 3, 3]]);
    });
    it("does not cap a selection at 100 or one 500-row source chunk", () => {
        const result = prepare(source(Array.from({ length: 501 }, (_, i) => doc(`doc-${String(i).padStart(4, "0")}`))));
        expect(result.sourceCounts.total).toBe(501); expect(result.documents[500]?.ordinal).toBe(501);
    });
    it.each(["7", "30"] as const)("uses posted %s-day bounds even when the snapshot is much later", period => {
        const end = period === "7" ? "2026-01-07" : "2026-01-30";
        const upper = period === "7" ? "2026-01-07T15:00:00.000Z" : "2026-01-30T15:00:00.000Z";
        const endTime = new Date(upper).getTime();
        const result = prepare(source([doc("a", { createdDate: new Date("2025-12-31T14:59:59.999Z") }),
            doc("b", { createdDate: new Date("2025-12-31T15:00:00Z") }), doc("c", { createdDate: new Date(endTime - 1) }),
            doc("d", { createdDate: new Date(endTime) })]), { ...scope, period, start: "2026-01-01", end });
        expect(result.documents.map(d => d.documentId)).toEqual(["b", "c"]);
    });
    it("handles custom KST midnight and one-sided bounds", () => {
        const raw = source([doc("a", { createdDate: new Date("2026-10-31T14:59:59.999Z") }), doc("b", { createdDate: new Date("2026-10-31T15:00:00Z") })]);
        expect(prepare(raw, { ...scope, period: "custom", start: "2026-11-01", end: "2026-11-01" }).documents.map(d => d.documentId)).toEqual(["b"]);
        expect(prepare(raw, { ...scope, period: "custom", start: "", end: "2026-10-31" }).documents.map(d => d.documentId)).toEqual(["a"]);
    });
    it("fails closed on foreign rows, including purging rows; excludes owned purging rows", () => {
        expectError(() => prepare(source([doc("a", { branchId: FOREIGN })])), "SOURCE_SCOPE_CHANGED");
        expectError(() => prepare(source([doc("a", { branchId: FOREIGN, permanentPurgeRequestedAt: DATE })])), "SOURCE_SCOPE_CHANGED");
        expect(prepare(source([doc("a", { permanentPurgeRequestedAt: DATE })])).documents).toEqual([]);
    });
    it("filters files to exact selected document IDs", () => {
        const raw = source([doc(), doc("b", { statusType: "060" })], [file(), file("foreign"), file("b", "audit_trail")]);
        expect(prepare(raw, { ...scope, contractStages: ["completed"] }).documents[0]?.candidate.artifacts).toHaveLength(1);
        expect(prepare(raw, { ...scope, contractStages: ["completed"] }).documents).toHaveLength(1);
    });
    it("allows an empty preparation with exact zero counts", () => {
        expect(prepare(source([]))).toEqual({ snapshotAt: DATE, documents: [], sourceCounts: { total: 0, inaccessible: 0, unknownTemplate: 0, policyPending: 0, excludedByPolicy: 0, included: 0 } });
    });
    it("does not mutate frozen inputs and outputs retain no mutable source references", () => {
        const original = source([Object.freeze(doc())], [Object.freeze(file())]);
        Object.freeze(original.documents); Object.freeze(original.files); Object.freeze(original);
        const first = prepare(original); const second = prepare(original);
        first.snapshotAt.setUTCFullYear(2000); first.documents[0]!.documentCreatedAt.setUTCFullYear(2000);
        (first.documents[0]!.candidate.reasons as string[]).push("changed");
        (first.documents[0]!.candidate.artifacts[0]! as { byteSize: number }).byteSize = 999;
        expect(prepare(original)).toEqual(second); expect(original.observedAt).toEqual(DATE); expect(original.files[0]?.byteSize).toBe(4);
    });
    it.each([{}, { ...scope, sensitive: "secret" }, { ...scope, contractStages: ["bad"] }, { ...scope, period: "7", start: "2026-01-01", end: "2026-01-30" }])("rejects invalid scopes with generic errors", posted => expectError(() => prepare(source(), posted)));
    it("rejects duplicate source IDs, invalid dates and malformed selected files without source echo", () => {
        expectError(() => prepare(source([doc(), doc()])));
        expectError(() => prepare({ ...source(), observedAt: new Date("bad") }));
        expectError(() => prepare(source([doc("a", { createdDate: new Date("bad") })])));
        for (const bad of [{ ...file(), sha256: "sensitive" }, { ...file(), byteSize: -1 }, { ...file(), fileType: "sensitive" }]) expectError(() => prepare(source([doc()], [bad as ManualBackupSourceFile])));
        expectError(() => prepare(source([doc()], [file(), file()])));
        expectError(() => prepareManualBackupSelection({ companyId: "sensitive user name", branchId: BRANCH, scope, source: source(), serviceRecordTemplateIds: new Set() }));
    });
});
