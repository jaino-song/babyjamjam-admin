import { createHash } from "node:crypto";
import {
    artifactIdentity, canonicalJson, evaluateBundle, metadataRevision, type ArtifactClaim,
} from "domain/eformsign-backup/source-evidence";
import {
    WorkerError, buildCompletion, buildManifest, buildRunInventory, bundleIdFor, completionContentDigest,
    completionSchema, manifestSchema, parseCompletionName, runInventorySchema, toArchiveArtifactType,
} from "domain/eformsign-backup/worker";

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const COMPANY = "company-1";
const RUN = "3f2b8c1e-4d5a-4b6c-9d7e-8f9a0b1c2d3e";
const stableMetadata = { companyId: COMPANY, documentId: "D001", documentKind: "contract", statusType: "completed", templateId: "T1" };
const DOC_SHA = sha("document bytes");
const AUDIT_SHA = sha("audit bytes");

function claims(kinds: Array<"document" | "audit-trail">): ArtifactClaim[] {
    return kinds.map((artifactKind) => ({
        companyId: COMPANY, documentId: "D001", artifactKind,
        contentSha256: artifactKind === "document" ? DOC_SHA : AUDIT_SHA, byteLength: 100,
    }));
}

describe("bundleIdFor", () => {
    it("equals evaluateBundle(...).bundleId for a document with both artifacts (golden)", () => {
        const both = claims(["document", "audit-trail"]);
        const evidence = evaluateBundle({ companyId: COMPANY, documentId: "D001", artifacts: both, stableMetadata });
        expect(evidence.consistency).toBe("unverified");
        expect(evidence.bundleId).toMatch(/^[0-9a-f]{64}$/);
        const revision = metadataRevision(stableMetadata);
        const artifacts = both.map((claim) => ({ artifactType: claim.artifactKind, artifactIdentity: artifactIdentity(claim) }));
        expect(bundleIdFor(COMPANY, "D001", revision, artifacts)).toBe(evidence.bundleId);
        // order of the input does not matter
        expect(bundleIdFor(COMPANY, "D001", revision, [...artifacts].reverse())).toBe(evidence.bundleId);
    });

    it("is null unless both kinds are present, like an incomplete evaluateBundle", () => {
        for (const kinds of [["document"], ["audit-trail"]] as const) {
            const one = claims([...kinds]);
            const evidence = evaluateBundle({ companyId: COMPANY, documentId: "D001", artifacts: one, stableMetadata });
            expect(evidence.bundleId).toBeNull();
            const artifacts = one.map((claim) => ({ artifactType: claim.artifactKind, artifactIdentity: artifactIdentity(claim) }));
            expect(bundleIdFor(COMPANY, "D001", metadataRevision(stableMetadata), artifacts)).toBeNull();
        }
    });

    it("refuses two artifacts of the same kind", () => {
        const dup = [
            { artifactType: "document" as const, artifactIdentity: sha("1") },
            { artifactType: "document" as const, artifactIdentity: sha("2") },
        ];
        expect(() => bundleIdFor(COMPANY, "D001", sha("r"), dup)).toThrow(WorkerError);
    });
});

describe("toArchiveArtifactType", () => {
    it("maps the export spelling audit_trail to audit-trail in one place", () => {
        expect(toArchiveArtifactType("audit_trail")).toBe("audit-trail");
        expect(toArchiveArtifactType("document")).toBe("document");
    });
});

describe("buildManifest", () => {
    const revision = metadataRevision(stableMetadata);
    const both = claims(["document", "audit-trail"]).map((claim) => ({
        artifactType: claim.artifactKind, artifactIdentity: artifactIdentity(claim), sha256: claim.contentSha256, byteLength: claim.byteLength,
    }));

    it("derives bundleId, consistency and relativeKey, and serialises canonical JSON", () => {
        const built = buildManifest({ companyId: COMPANY, documentId: "D001", metadataRevision: revision, artifacts: both });
        const bundleId = evaluateBundle({ companyId: COMPANY, documentId: "D001", artifacts: claims(["document", "audit-trail"]), stableMetadata }).bundleId;
        expect(built.value).toEqual({
            schemaVersion: 1, companyId: COMPANY, documentId: "D001", metadataRevision: revision, bundleId, consistency: "unverified",
            artifacts: [
                { artifactType: "audit-trail", artifactIdentity: both[1]!.artifactIdentity, sha256: AUDIT_SHA, byteLength: 100,
                    relativeKey: `eformsign/${COMPANY}/D001/artifacts/audit-trail/${AUDIT_SHA}.pdf` },
                { artifactType: "document", artifactIdentity: both[0]!.artifactIdentity, sha256: DOC_SHA, byteLength: 100,
                    relativeKey: `eformsign/${COMPANY}/D001/artifacts/document/${DOC_SHA}.pdf` },
            ],
        });
        expect(Buffer.from(built.bytes).toString("utf8")).toBe(canonicalJson(built.value));
        expect(built.sha256).toBe(createHash("sha256").update(built.bytes).digest("hex"));
        expect(manifestSchema.safeParse(JSON.parse(Buffer.from(built.bytes).toString("utf8"))).success).toBe(true);
    });

    it("is order independent and marks a single-kind document incomplete with bundleId null", () => {
        const a = buildManifest({ companyId: COMPANY, documentId: "D001", metadataRevision: revision, artifacts: both });
        const b = buildManifest({ companyId: COMPANY, documentId: "D001", metadataRevision: revision, artifacts: [...both].reverse() });
        expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true);
        const single = buildManifest({ companyId: COMPANY, documentId: "D004", metadataRevision: revision, artifacts: [both[0]!] });
        expect(single.value.bundleId).toBeNull();
        expect(single.value.consistency).toBe("incomplete");
    });

    it("rejects a document that cannot be a path, and an empty artifact list", () => {
        expect(() => buildManifest({ companyId: COMPANY, documentId: "a".repeat(256), metadataRevision: revision, artifacts: both }))
            .toThrow(expect.objectContaining({ reasonCode: "invalid-path-segment" }));
        expect(() => buildManifest({ companyId: COMPANY, documentId: "D001", metadataRevision: revision, artifacts: [] }))
            .toThrow(expect.objectContaining({ reasonCode: "internal" }));
    });
});

describe("buildCompletion", () => {
    const base = {
        companyId: COMPANY, sequence: 2, snapshotId: "snap-0002", runId: RUN, scopeRevision: "2026-10-19-company-all-docs",
        policyRevision: "2026-10-18-completed-pdf-audit", destinationIdentity: "local:arch-1", destinationRevision: "local-layout-v1",
    };
    const entries = [
        { documentId: "D002", metadataRevision: sha("m2"), manifestSha256: sha("f2") },
        { documentId: "D001", metadataRevision: sha("m1"), manifestSha256: sha("f1") },
    ];

    it("sorts entries and gaps, has no timestamp, and names the file by sequence and content digest", () => {
        const built = buildCompletion({
            ...base, entries,
            gaps: [{ documentId: "D009", reasonCode: "source-removed" }, { documentId: "D003", reasonCode: "exact-bytes-unavailable" },
                { documentId: "D009", reasonCode: "source-removed" }],
        });
        expect(built.value.entries.map((entry) => entry.documentId)).toEqual(["D001", "D002"]);
        expect(built.value.entries[0]!.manifestKey).toBe(`eformsign/${COMPANY}/D001/manifests/${sha("m1")}.json`);
        expect(built.value.gaps).toEqual([
            { documentId: "D003", reasonCode: "exact-bytes-unavailable" }, { documentId: "D009", reasonCode: "source-removed" },
        ]);
        expect(built.value.coverage).toBe("unverified");
        expect(Object.keys(built.value).some((key) => /at$|time|date/i.test(key))).toBe(false);
        const digest = createHash("sha256").update(canonicalJson(built.value)).digest("hex");
        expect(built.contentDigest).toBe(digest);
        expect(completionContentDigest(built.value)).toBe(digest);
        expect(built.sha256).toBe(digest);
        expect(built.name).toBe(`000000000002-${digest}.json`);
        expect(parseCompletionName(built.name)).toEqual({ sequence: 2, contentDigest: digest });
        expect(built.relativeKey).toBe(`eformsign/${COMPANY}/completions/${built.name}`);
        expect(completionSchema.safeParse(JSON.parse(Buffer.from(built.bytes).toString("utf8"))).success).toBe(true);
    });

    it("gives equal content the same name and different content a different one", () => {
        const a = buildCompletion({ ...base, entries, gaps: [] });
        const b = buildCompletion({ ...base, entries: [...entries].reverse(), gaps: [] });
        const c = buildCompletion({ ...base, entries: [entries[0]!], gaps: [] });
        expect(a.name).toBe(b.name);
        expect(a.name).not.toBe(c.name);
    });

    it("rejects a sequence that cannot be a file name", () => {
        expect(() => buildCompletion({ ...base, sequence: 0, entries, gaps: [] })).toThrow(WorkerError);
    });
});

describe("buildRunInventory", () => {
    it("builds canonical JSON for a valid run and rejects complete and no_known_gap", () => {
        const input = {
            runId: RUN, scheduledFor: "2026-10-19T10:00:00+09:00", startedAt: "2026-10-19T01:00:00.000Z",
            finishedAt: "2026-10-19T01:05:00.000Z", snapshotId: "snap-0002", sequence: 2, snapshotStatus: "partial" as const,
            historicalCoverage: "unverified" as const, reasonCodes: ["coverage-unverified" as const, "drive-not-configured" as const],
            counts: { candidates: 4, included: 3, verified: 3, blocked: 0, retryWait: 0, integrityError: 0, terminalUnavailable: 0, orphanTemps: 0 },
        };
        const built = buildRunInventory(input);
        expect(built.value).toEqual({ schemaVersion: 1, ...input });
        expect(runInventorySchema.safeParse(built.value).success).toBe(true);
        expect(() => buildRunInventory({ ...input, snapshotStatus: "complete" as never })).toThrow(WorkerError);
        expect(() => buildRunInventory({ ...input, historicalCoverage: "no_known_gap" as never })).toThrow(WorkerError);
    });
});
