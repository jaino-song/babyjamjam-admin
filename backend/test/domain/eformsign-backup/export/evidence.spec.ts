import { createHash } from "node:crypto";
import {
    buildExportArtifacts, buildExportMetadataRevision, exportRequestHash,
} from "domain/eformsign-backup/export";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const H1 = "a".repeat(64);
const H2 = "b".repeat(64);

describe("buildExportArtifacts", () => {
    it("artifactIdentity equals an independently computed digest (identity ignores byteSize)", () => {
        // Hand-written canonical JSON: keys sorted, domain-prefixed. byteLength is NOT part of identity.
        const expectedDocument = sha(
            `eformsign-backup/artifact/v1\n{"artifactKind":"document","companyId":"company-1","contentSha256":"${H1}","documentId":"D001"}`,
        );
        const expectedAudit = sha(
            `eformsign-backup/artifact/v1\n{"artifactKind":"audit-trail","companyId":"company-1","contentSha256":"${H2}","documentId":"D001"}`,
        );
        const result = buildExportArtifacts("company-1", "D001", [
            { fileType: "audit_trail", sha256: H2, byteSize: 7 },
            { fileType: "document", sha256: H1, byteSize: 123456 },
        ]);
        expect(result).toEqual([
            { fileType: "document", artifactIdentity: expectedDocument, sha256: H1, byteSize: 123456 },
            { fileType: "audit_trail", artifactIdentity: expectedAudit, sha256: H2, byteSize: 7 },
        ]);
    });

    it("byteSize does not change the identity", () => {
        const a = buildExportArtifacts("c", "D1", [{ fileType: "document", sha256: H1, byteSize: 1 }]);
        const b = buildExportArtifacts("c", "D1", [{ fileType: "document", sha256: H1, byteSize: 999 }]);
        expect(a[0]!.artifactIdentity).toBe(b[0]!.artifactIdentity);
    });

    it("document sorts before audit_trail whatever the input order; a single file is allowed", () => {
        const single = buildExportArtifacts("c", "D1", [{ fileType: "document", sha256: H1, byteSize: 1 }]);
        expect(single.map(a => a.fileType)).toEqual(["document"]);
        expect(buildExportArtifacts("c", "D1", [])).toEqual([]);
    });

    it("rejects duplicate file types, bad sha256 and negative sizes", () => {
        expect(() => buildExportArtifacts("c", "D1", [
            { fileType: "document", sha256: H1, byteSize: 1 }, { fileType: "document", sha256: H2, byteSize: 1 },
        ])).toThrow();
        expect(() => buildExportArtifacts("c", "D1", [{ fileType: "document", sha256: "xyz", byteSize: 1 }])).toThrow();
        expect(() => buildExportArtifacts("c", "D1", [{ fileType: "document", sha256: H1, byteSize: -1 }])).toThrow();
    });
});

describe("buildExportMetadataRevision", () => {
    it("equals the independently computed metadata digest", () => {
        const expected = sha(
            'eformsign-backup/metadata/v1\n{"companyId":"company-1","documentId":"D001","documentKind":"contract","statusType":"003","templateId":null}',
        );
        expect(buildExportMetadataRevision({
            companyId: "company-1", documentId: "D001", documentKind: "contract", statusType: "003", templateId: null,
        })).toBe(expected);
    });

    it("normalizes the status code before hashing (legacy value hashes like the canonical one)", () => {
        const canonical = buildExportMetadataRevision({ companyId: "c", documentId: "D1", documentKind: "contract", statusType: "003", templateId: "t" });
        const legacy = buildExportMetadataRevision({ companyId: "c", documentId: "D1", documentKind: "contract", statusType: "doc_complete", templateId: "t" });
        expect(legacy).toBe(canonical);
    });

    it("changes when any stable field changes", () => {
        const base = { companyId: "c", documentId: "D1", documentKind: "contract", statusType: "003", templateId: "t" };
        const revision = buildExportMetadataRevision(base);
        expect(buildExportMetadataRevision({ ...base, templateId: "u" })).not.toBe(revision);
        expect(buildExportMetadataRevision({ ...base, documentKind: null })).not.toBe(revision);
        expect(buildExportMetadataRevision({ ...base, statusType: "060" })).not.toBe(revision);
    });
});

describe("exportRequestHash", () => {
    it("is the sha256 hex of the key-sorted canonical JSON, independent of key order", () => {
        const expected = sha('{"companyId":"company-1","policyRevision":"p","scopeRevision":"s"}');
        expect(exportRequestHash({ scopeRevision: "s", companyId: "company-1", policyRevision: "p" })).toBe(expected);
        expect(exportRequestHash({ companyId: "company-1", policyRevision: "p", scopeRevision: "s" })).toBe(expected);
    });

    it("differs when the body differs", () => {
        expect(exportRequestHash({ companyId: "a" })).not.toBe(exportRequestHash({ companyId: "b" }));
    });
});
