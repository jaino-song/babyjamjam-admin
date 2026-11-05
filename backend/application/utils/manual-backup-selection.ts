import { isServiceRecordEformsignDocument } from "./eformsign-document-kind";
import { projectManualBackupMilestone } from "domain/eformsign-backup/manual-backup-milestone";
import { decideManualBackupScope, parseManualBackupScope } from "domain/eformsign-backup/manual-backup-scope";
import {
    ManualBackupRunError, assertBackupDate, assertBackupUuid, assertBackupText, assertBackupHash, requireBackupInput,
    type ManualBackupDocumentInput,
} from "domain/eformsign-backup/manual-backup-run";
import { assertIdentifier } from "domain/eformsign-backup/source-evidence";
import { classifyExportDocument, countExportClassifications, assertExclusiveCounts, type ExportCounts } from "domain/eformsign-backup/export/classification";
import { buildExportArtifacts, buildExportMetadataRevision } from "domain/eformsign-backup/export/evidence";
import { EXPORT_FILE_TYPES } from "domain/eformsign-backup/export/constants";
import type { ManualBackupSource, ManualBackupSourceFile } from "domain/repositories/eformsign-backup-run.repository.interface";

/** Freeze the posted scope against one observed source cut, without provider reads or a candidate cap. */
export function prepareManualBackupSelection(input: {
    companyId: string; branchId: string; scope: unknown; source: ManualBackupSource; serviceRecordTemplateIds: ReadonlySet<string>;
}): { snapshotAt: Date; sourceCounts: ExportCounts; documents: ManualBackupDocumentInput[] } {
    try {
        assertIdentifier(input.companyId); assertBackupUuid(input.branchId);
        const parsed = parseManualBackupScope(input.scope); requireBackupInput(parsed.ok);
        const { source } = input;
        assertBackupDate(source.observedAt);
        requireBackupInput(Array.isArray(source.documents) && Array.isArray(source.files));
        const seen = new Set<string>();
        const selected = source.documents.flatMap(doc => {
            assertBackupText(doc.documentId, 4096);
            requireBackupInput(!seen.has(doc.documentId)); seen.add(doc.documentId);
            if (doc.branchId !== input.branchId) throw new ManualBackupRunError("SOURCE_SCOPE_CHANGED");
            assertBackupDate(doc.createdDate); assertBackupDate(doc.updatedDate);
            if (doc.voidedAt !== null) assertBackupDate(doc.voidedAt);
            if (doc.permanentPurgeRequestedAt !== null) { assertBackupDate(doc.permanentPurgeRequestedAt); return []; }
            requireBackupInput(typeof doc.statusType === "string" && typeof doc.stepType === "string" && typeof doc.stepIndex === "string"
                && typeof doc.detailPayloadIsNull === "boolean");
            for (const value of [doc.documentKind, doc.templateId, doc.serviceRecordCaseId]) requireBackupInput(value === null || typeof value === "string");
            const kind = isServiceRecordEformsignDocument(doc, input.serviceRecordTemplateIds) ? "record" : "contract";
            const projection = projectManualBackupMilestone({ ...doc, kind });
            const decision = decideManualBackupScope(parsed.value, { ...projection, createdAt: doc.createdDate });
            return decision.matches ? [{ doc, projection, decision }] : [];
        }).sort((a, b) => a.doc.documentId < b.doc.documentId ? -1 : a.doc.documentId > b.doc.documentId ? 1 : 0);
        const selectedIds = new Set(selected.map(({ doc }) => doc.documentId));
        const filesById = new Map<string, ManualBackupSourceFile[]>();
        for (const file of source.files) {
            if (!selectedIds.has(file.documentId)) continue;
            requireBackupInput(EXPORT_FILE_TYPES.includes(file.fileType)); assertBackupHash(file.sha256);
            requireBackupInput(Number.isSafeInteger(file.byteSize) && file.byteSize >= 0 && !Object.is(file.byteSize, -0));
            const files = filesById.get(file.documentId) ?? [];
            requireBackupInput(!files.some(existing => existing.fileType === file.fileType));
            files.push({ documentId: file.documentId, fileType: file.fileType, sha256: file.sha256, byteSize: file.byteSize });
            filesById.set(file.documentId, files);
        }
        const documents: ManualBackupDocumentInput[] = selected.map(({ doc, projection, decision }, index) => {
            const ordinal = index + 1;
            const files = filesById.get(doc.documentId) ?? [];
            // Keep RAW kind/status/template: legacy template detection must not promote export eligibility.
            const classification = classifyExportDocument({ ...doc, fileTypesPresent: files.map(file => file.fileType) });
            const reasons = [...new Set([...classification.reasons, ...projection.reasonCodes,
                ...(decision.reason === "stage-unverified" ? [decision.reason] : [])])].sort();
            return { documentId: doc.documentId, ordinal, kind: projection.kind, currentMilestone: projection.currentMilestone,
                documentCreatedAt: new Date(doc.createdDate), candidate: {
                    ordinal, documentId: doc.documentId, classification: classification.classification, reasons,
                    statusType: classification.statusType, documentKind: doc.documentKind,
                    metadataRevision: buildExportMetadataRevision({ companyId: input.companyId, ...doc }),
                    artifacts: classification.classification === "included" ? buildExportArtifacts(input.companyId, doc.documentId, files) : [],
                } };
        });
        const sourceCounts = countExportClassifications(documents.map(doc => doc.candidate.classification));
        assertExclusiveCounts(sourceCounts);
        return { snapshotAt: new Date(source.observedAt), sourceCounts, documents };
    } catch (error) {
        if (error instanceof ManualBackupRunError && error.code === "SOURCE_SCOPE_CHANGED") throw error;
        throw new ManualBackupRunError("INVALID_INPUT");
    }
}
