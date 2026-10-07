import { EformsignDocumentMirrorService } from "application/services/eformsign-document-mirror.service";

const VERSION = new Date("2026-10-01T00:00:00.000Z");

function serviceAt(statusType: string): EformsignDocumentMirrorService {
    const metadata = {
        fileType: "document",
        contentType: "application/pdf",
        contentDisposition: "inline",
        byteSize: 3,
        sha256: "hash",
        sourceUpdatedDate: VERSION,
        syncedAt: VERSION,
    };
    const service = Object.create(EformsignDocumentMirrorService.prototype);
    service.mirrorRepository = {
        findState: async () => ({
            documentId: "doc-1",
            detailPayload: { current_status: { status_type: statusType } },
            detailSourceUpdatedDate: VERSION,
            syncStatus: "partial",
            permanentPurgeRequestedAt: null,
            files: [metadata],
        }),
    };
    return service;
}

describe("stored document PDF while the audit trail is still syncing", () => {
    it.each(["060", "041"])("stays readable at %s (the participant stage)", async (statusType) => {
        await expect(serviceAt(statusType).getStoredFileMetadata("doc-1", "document")).resolves.not.toBeNull();
    });

    it.each(["040", "045", "042"])("is not readable at %s", async (statusType) => {
        await expect(serviceAt(statusType).getStoredFileMetadata("doc-1", "document")).resolves.toBeNull();
    });
});
