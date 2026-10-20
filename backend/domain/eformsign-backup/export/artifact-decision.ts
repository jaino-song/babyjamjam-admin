import { createHash } from "node:crypto";
import { normalizeEformsignStatusCode } from "domain/utils/eformsign-status-code";
import { EXPORT_ARTIFACT_MAX_BYTES } from "./constants";

export interface ExportArtifactExpectation {
    sha256: string;
    byteSize: number;
}

export type ExportArtifactDecision =
    | { kind: "serve" }
    | { kind: "error"; code: "SOURCE_REMOVED" | "ARTIFACT_PENDING" | "MIRROR_MISSING" | "VERSION_CHANGED" | "ARTIFACT_TOO_LARGE" };

const PENDING_SYNC_STATUSES: ReadonlySet<string> = new Set(["pending", "syncing", "partial"]);

const fail = (code: Extract<ExportArtifactDecision, { kind: "error" }>["code"]): ExportArtifactDecision => ({ kind: "error", code });

/** Contract 3.5 rows 4-8, first match wins. Rows 1-3b (auth, snapshot, expiry, slots) are not decided here. */
export function decideExportArtifact(input: {
    expected: ExportArtifactExpectation;
    doc: null | { permanentPurgeRequestedAt: Date | null; statusType: string | null; syncStatus: string | null };
    file: null | { sha256: string; byteSize: number };
}): ExportArtifactDecision {
    const { expected, doc, file } = input;
    if (!doc) return fail("SOURCE_REMOVED");
    if (doc.permanentPurgeRequestedAt) return fail("SOURCE_REMOVED");
    if (!file) {
        const status = normalizeEformsignStatusCode(doc.statusType);
        if (status === "049" || status === "099") return fail("SOURCE_REMOVED");
        return fail(doc.syncStatus !== null && PENDING_SYNC_STATUSES.has(doc.syncStatus) ? "ARTIFACT_PENDING" : "MIRROR_MISSING");
    }
    if (file.sha256 !== expected.sha256) return fail("VERSION_CHANGED");
    if (file.byteSize > EXPORT_ARTIFACT_MAX_BYTES) return fail("ARTIFACT_TOO_LARGE");
    return { kind: "serve" };
}

/** Row 9: the bytes actually read must match the snapshot's length and sha256. */
export function verifyExportArtifactBytes(bytes: Buffer, expected: ExportArtifactExpectation): boolean {
    if (bytes.length !== expected.byteSize) return false;
    return createHash("sha256").update(bytes).digest("hex") === expected.sha256;
}
