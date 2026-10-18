import { createHash } from "node:crypto";
import { normalizeEformsignStatusCode } from "domain/utils/eformsign-status-code";
import { artifactIdentity, canonicalJson, metadataRevision, type ArtifactKind } from "../source-evidence";
import { EXPORT_FILE_TYPES, type ExportFileType } from "./constants";

export interface ExportFileInput {
    fileType: ExportFileType;
    sha256: string;
    byteSize: number;
}

export interface ExportArtifact {
    fileType: ExportFileType;
    artifactIdentity: string;
    sha256: string;
    byteSize: number;
}

const ARTIFACT_KIND: Readonly<Record<ExportFileType, ArtifactKind>> = {
    document: "document",
    audit_trail: "audit-trail",
};

/** Document first, then audit_trail. Identity digests exclude byteSize (source-evidence.ts). */
export function buildExportArtifacts(
    companyId: string, documentId: string, files: readonly ExportFileInput[],
): ExportArtifact[] {
    const seen = new Set<string>();
    for (const file of files) {
        if (seen.has(file.fileType)) throw new Error("Duplicate export file type");
        seen.add(file.fileType);
    }
    return EXPORT_FILE_TYPES.flatMap((fileType) => {
        const file = files.find((candidate) => candidate.fileType === fileType);
        if (!file) return [];
        return [{
            fileType,
            artifactIdentity: artifactIdentity({
                companyId, documentId, artifactKind: ARTIFACT_KIND[fileType],
                contentSha256: file.sha256, byteLength: file.byteSize,
            }),
            sha256: file.sha256,
            byteSize: file.byteSize,
        }];
    });
}

export function buildExportMetadataRevision(input: {
    companyId: string;
    documentId: string;
    documentKind: string | null;
    statusType: string | null;
    templateId: string | null;
}): string {
    return metadataRevision({
        companyId: input.companyId,
        documentId: input.documentId,
        documentKind: input.documentKind,
        statusType: normalizeEformsignStatusCode(input.statusType),
        templateId: input.templateId,
    });
}

export function exportRequestHash(body: unknown): string {
    return createHash("sha256").update(canonicalJson(body), "utf8").digest("hex");
}
