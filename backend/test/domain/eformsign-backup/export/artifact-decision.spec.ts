import { createHash } from "node:crypto";
import { decideExportArtifact, verifyExportArtifactBytes } from "domain/eformsign-backup/export";

const SHA = "a".repeat(64);
const OTHER_SHA = "b".repeat(64);
const MIB = 1024 * 1024;
const expected = { sha256: SHA, byteSize: 10 };
const liveDoc = { permanentPurgeRequestedAt: null, statusType: "003", syncStatus: "ready" };
const goodFile = { sha256: SHA, byteSize: 10 };

describe("decideExportArtifact (contract 3.5 rows 4-8)", () => {
    it("serve when the current row matches the snapshot", () => {
        expect(decideExportArtifact({ expected, doc: liveDoc, file: goodFile })).toEqual({ kind: "serve" });
    });

    describe("row 4 -> SOURCE_REMOVED", () => {
        it("no current document row", () => {
            expect(decideExportArtifact({ expected, doc: null, file: goodFile })).toEqual({ kind: "error", code: "SOURCE_REMOVED" });
        });
        it("permanent purge requested, even with a matching file", () => {
            expect(decideExportArtifact({
                expected, doc: { ...liveDoc, permanentPurgeRequestedAt: new Date() }, file: goodFile,
            })).toEqual({ kind: "error", code: "SOURCE_REMOVED" });
        });
        it.each(["049", "099", "doc_delete"])("status %s with no file row", (statusType) => {
            expect(decideExportArtifact({ expected, doc: { ...liveDoc, statusType }, file: null }))
                .toEqual({ kind: "error", code: "SOURCE_REMOVED" });
        });
        it("049/099 with a file row present is NOT row 4 (falls through to the file checks)", () => {
            expect(decideExportArtifact({ expected, doc: { ...liveDoc, statusType: "049" }, file: goodFile })).toEqual({ kind: "serve" });
            expect(decideExportArtifact({ expected, doc: { ...liveDoc, statusType: "099" }, file: { ...goodFile, sha256: OTHER_SHA } }))
                .toEqual({ kind: "error", code: "VERSION_CHANGED" });
        });
        it("outranks every later row", () => {
            expect(decideExportArtifact({
                expected, doc: { ...liveDoc, permanentPurgeRequestedAt: new Date(), syncStatus: "pending" }, file: null,
            })).toEqual({ kind: "error", code: "SOURCE_REMOVED" });
        });
    });

    describe("row 5 -> ARTIFACT_PENDING / row 6 -> MIRROR_MISSING (no file row)", () => {
        it.each(["pending", "syncing", "partial"])("sync_status %s is ARTIFACT_PENDING", (syncStatus) => {
            expect(decideExportArtifact({ expected, doc: { ...liveDoc, syncStatus }, file: null }))
                .toEqual({ kind: "error", code: "ARTIFACT_PENDING" });
        });
        it.each(["ready", "failed"])("sync_status %s is MIRROR_MISSING", (syncStatus) => {
            expect(decideExportArtifact({ expected, doc: { ...liveDoc, syncStatus }, file: null }))
                .toEqual({ kind: "error", code: "MIRROR_MISSING" });
        });
        it("an unrecognized or null sync_status is MIRROR_MISSING", () => {
            expect(decideExportArtifact({ expected, doc: { ...liveDoc, syncStatus: "weird" }, file: null }))
                .toEqual({ kind: "error", code: "MIRROR_MISSING" });
            expect(decideExportArtifact({ expected, doc: { ...liveDoc, syncStatus: null }, file: null }))
                .toEqual({ kind: "error", code: "MIRROR_MISSING" });
        });
    });

    describe("row 7 -> VERSION_CHANGED", () => {
        it("file sha256 differs from the snapshot", () => {
            expect(decideExportArtifact({ expected, doc: liveDoc, file: { ...goodFile, sha256: OTHER_SHA } }))
                .toEqual({ kind: "error", code: "VERSION_CHANGED" });
        });
        it("outranks the size check", () => {
            expect(decideExportArtifact({
                expected: { sha256: SHA, byteSize: 100 * MIB }, doc: liveDoc, file: { sha256: OTHER_SHA, byteSize: 100 * MIB },
            })).toEqual({ kind: "error", code: "VERSION_CHANGED" });
        });
    });

    describe("row 8 -> ARTIFACT_TOO_LARGE", () => {
        it("file larger than 64 MiB", () => {
            expect(decideExportArtifact({
                expected: { sha256: SHA, byteSize: 64 * MIB + 1 }, doc: liveDoc, file: { sha256: SHA, byteSize: 64 * MIB + 1 },
            })).toEqual({ kind: "error", code: "ARTIFACT_TOO_LARGE" });
        });
        it("exactly 64 MiB is served", () => {
            expect(decideExportArtifact({
                expected: { sha256: SHA, byteSize: 64 * MIB }, doc: liveDoc, file: { sha256: SHA, byteSize: 64 * MIB },
            })).toEqual({ kind: "serve" });
        });
    });
});

describe("verifyExportArtifactBytes (row 9)", () => {
    const bytes = Buffer.from("%PDF-1.7 synthetic");
    const hash = createHash("sha256").update(bytes).digest("hex");

    it("true when length and sha256 both match", () => {
        expect(verifyExportArtifactBytes(bytes, { sha256: hash, byteSize: bytes.length })).toBe(true);
    });
    it("false when the length differs", () => {
        expect(verifyExportArtifactBytes(bytes, { sha256: hash, byteSize: bytes.length + 1 })).toBe(false);
    });
    it("false when the hash differs", () => {
        expect(verifyExportArtifactBytes(bytes, { sha256: OTHER_SHA, byteSize: bytes.length })).toBe(false);
    });
    it("false when bytes were altered but the length is unchanged", () => {
        const altered = Buffer.from("%PDF-1.7 synthetiX");
        expect(verifyExportArtifactBytes(altered, { sha256: hash, byteSize: bytes.length })).toBe(false);
    });
});
