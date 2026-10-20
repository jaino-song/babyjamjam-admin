import { createHash } from "node:crypto";
import {
    WorkerError, artifactKey, completionKey, completionName, manifestKey, markerKey, parseArtifactKey,
    parseCompletionName, runKey, sequence12,
} from "domain/eformsign-backup/worker";

const SHA = "a".repeat(64);
const REV = "b".repeat(64);
const DIGEST = createHash("sha256").update("x").digest("hex");
const RUN = "3f2b8c1e-4d5a-4b6c-9d7e-8f9a0b1c2d3e";

function reason(fn: () => unknown): string | null {
    try {
        fn();
        return null;
    } catch (error) {
        return error instanceof WorkerError ? error.reasonCode : `other:${String(error)}`;
    }
}

describe("archive path builders (T-WRK-02)", () => {
    it("builds every key of contract W4 as a POSIX relative path", () => {
        expect(artifactKey({ companyId: "company-1", documentId: "D001", artifactType: "document", sha256: SHA }))
            .toBe(`eformsign/company-1/D001/artifacts/document/${SHA}.pdf`);
        expect(artifactKey({ companyId: "company-1", documentId: "D001", artifactType: "audit-trail", sha256: SHA }))
            .toBe(`eformsign/company-1/D001/artifacts/audit-trail/${SHA}.pdf`);
        expect(manifestKey({ companyId: "company-1", documentId: "D001", metadataRevision: REV }))
            .toBe(`eformsign/company-1/D001/manifests/${REV}.json`);
        expect(completionKey({ companyId: "company-1", sequence: 3, contentDigest: DIGEST }))
            .toBe(`eformsign/company-1/completions/000000000003-${DIGEST}.json`);
        expect(completionName({ sequence: 999_999_999_999, contentDigest: DIGEST })).toBe(`999999999999-${DIGEST}.json`);
        expect(runKey({ companyId: "company-1", runId: RUN })).toBe(`eformsign/company-1/runs/${RUN}.json`);
        expect(markerKey()).toBe(".bjj-backup/installation.json");
    });

    it("accepts identifiers up to 255 UTF-8 bytes and rejects 256", () => {
        const ok = "a".repeat(255);
        expect(artifactKey({ companyId: "c", documentId: ok, artifactType: "document", sha256: SHA })).toContain(`/${ok}/`);
        expect(reason(() => artifactKey({ companyId: "c", documentId: "a".repeat(256), artifactType: "document", sha256: SHA })))
            .toBe("invalid-path-segment");
        expect(reason(() => artifactKey({ companyId: "a".repeat(256), documentId: "d", artifactType: "document", sha256: SHA })))
            .toBe("invalid-path-segment");
    });

    const BAD_IDS: Array<[string, unknown]> = [
        ["dot-dot", ".."], ["dot", "."], ["slash", "a/b"], ["leading slash", "/a"], ["percent-encoded slash", "%2F"],
        ["encoded dot-dot", "%2e%2e"], ["backslash", "a\\b"], ["empty", ""], ["space", "a b"], ["NUL", "a\u0000b"],
        ["non-ascii", "문서"], ["leading dot", ".hidden"], ["number", 5], ["null", null], ["undefined", undefined],
    ];
    it.each(BAD_IDS)("rejects %s as a company id and as a document id", (_name, value) => {
        expect(reason(() => artifactKey({ companyId: value as string, documentId: "D1", artifactType: "document", sha256: SHA })))
            .toBe("invalid-path-segment");
        expect(reason(() => manifestKey({ companyId: "c", documentId: value as string, metadataRevision: REV })))
            .toBe("invalid-path-segment");
        expect(reason(() => completionKey({ companyId: value as string, sequence: 1, contentDigest: DIGEST })))
            .toBe("invalid-path-segment");
    });

    it("keeps a document from taking the name of a sibling directory (completions, runs)", () => {
        for (const name of ["completions", "runs"]) {
            expect(reason(() => artifactKey({ companyId: "c", documentId: name, artifactType: "document", sha256: SHA })))
                .toBe("invalid-path-segment");
        }
        expect(reason(() => artifactKey({ companyId: "completions", documentId: "D1", artifactType: "document", sha256: SHA })))
            .toBeNull();
    });

    it.each([["uppercase hex", "A".repeat(64)], ["63 chars", "a".repeat(63)], ["65 chars", "a".repeat(65)],
        ["non-hex", "g".repeat(64)], ["empty", ""], ["path", `../${"a".repeat(61)}`], ["encoded", `%2F${"a".repeat(61)}`]])(
        "rejects %s as sha256, metadataRevision and contentDigest", (_name, value) => {
            expect(reason(() => artifactKey({ companyId: "c", documentId: "D", artifactType: "document", sha256: value })))
                .toBe("invalid-path-segment");
            expect(reason(() => manifestKey({ companyId: "c", documentId: "D", metadataRevision: value })))
                .toBe("invalid-path-segment");
            expect(reason(() => completionKey({ companyId: "c", sequence: 1, contentDigest: value })))
                .toBe("invalid-path-segment");
        });

    it("rejects an artifact type other than document or audit-trail (audit_trail is the export spelling)", () => {
        for (const type of ["audit_trail", "pdf", "", "Document", "../document"]) {
            expect(reason(() => artifactKey({ companyId: "c", documentId: "D", artifactType: type as "document", sha256: SHA })))
                .toBe("invalid-path-segment");
        }
    });

    it("rejects run ids that are not lowercase UUID v4", () => {
        for (const runId of ["", RUN.toUpperCase(), "3f2b8c1e-4d5a-1b6c-9d7e-8f9a0b1c2d3e", "../x", `${RUN}x`, "3f2b8c1e4d5a4b6c9d7e8f9a0b1c2d3e"]) {
            expect(reason(() => runKey({ companyId: "c", runId }))).toBe("invalid-path-segment");
        }
    });

    it("pads the sequence to 12 digits and rejects 0, -1, a fraction, too large and a non-number", () => {
        expect(sequence12(1)).toBe("000000000001");
        expect(sequence12(123_456_789_012)).toBe("123456789012");
        for (const sequence of [0, -1, 1.5, 1_000_000_000_000, Number.NaN, Infinity, "1", null]) {
            expect(reason(() => sequence12(sequence))).toBe("invalid-path-segment");
            expect(reason(() => completionKey({ companyId: "c", sequence: sequence as number, contentDigest: DIGEST })))
                .toBe("invalid-path-segment");
        }
    });

    it("returns keys that are relative and free of dot segments for every accepted input", () => {
        const keys = [
            artifactKey({ companyId: "a.b", documentId: "x..y", artifactType: "document", sha256: SHA }),
            manifestKey({ companyId: "a:b", documentId: "x_y-z", metadataRevision: REV }),
        ];
        for (const key of keys) {
            expect(key.startsWith("/")).toBe(false);
            expect(key.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..")).toBe(true);
        }
    });

    it("parses completion names and rejects everything else", () => {
        expect(parseCompletionName(`000000000002-${DIGEST}.json`)).toEqual({ sequence: 2, contentDigest: DIGEST });
        for (const name of ["latest.json", `000000000000-${DIGEST}.json`, `2-${DIGEST}.json`, `000000000002-${DIGEST}`,
            `000000000002-${DIGEST.toUpperCase()}.json`, `000000000002-${DIGEST}.json.bak`, `../000000000002-${DIGEST}.json`, ""]) {
            expect(parseCompletionName(name)).toBeNull();
        }
    });

    it("parses an artifact key back and rejects look-alikes", () => {
        const parts = { companyId: "c1", documentId: "D9", artifactType: "audit-trail" as const, sha256: SHA };
        expect(parseArtifactKey(artifactKey(parts))).toEqual(parts);
        expect(parseArtifactKey(`eformsign/c1/D9/artifacts/document/${SHA}.bin`)).toBeNull();
        expect(parseArtifactKey(`eformsign/c1/runs/artifacts/document/${SHA}.pdf`)).toBeNull();
        expect(parseArtifactKey(`eformsign/c1/../artifacts/document/${SHA}.pdf`)).toBeNull();
        expect(parseArtifactKey("nonsense")).toBeNull();
    });
});
