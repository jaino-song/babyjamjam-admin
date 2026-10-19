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

describe("manifestSchema binds every key to the manifest's own document (D1)", () => {
    const revision = metadataRevision(stableMetadata);
    const artifacts = claims(["document", "audit-trail"]).map((claim) => ({
        artifactType: claim.artifactKind, artifactIdentity: artifactIdentity(claim), sha256: claim.contentSha256, byteLength: claim.byteLength,
    }));
    const good = () => structuredClone(buildManifest({ companyId: COMPANY, documentId: "D001", metadataRevision: revision, artifacts }).value);
    const accepts = (value: unknown) => manifestSchema.safeParse(value).success;

    it("accepts correctly bound keys, with one or two artifact types", () => {
        expect(accepts(good())).toBe(true);
        const single = buildManifest({ companyId: COMPANY, documentId: "D004", metadataRevision: revision, artifacts: [artifacts[0]!] });
        expect(accepts(single.value)).toBe(true);
    });

    it("rejects a relativeKey that points at another document, another company or another sha", () => {
        const otherDoc = good();
        otherDoc.artifacts[0]!.relativeKey = otherDoc.artifacts[0]!.relativeKey.replace("/D001/", "/D002/");
        expect(accepts(otherDoc)).toBe(false);
        const otherCompany = good();
        otherCompany.artifacts[1]!.relativeKey = otherCompany.artifacts[1]!.relativeKey.replace(`/${COMPANY}/`, "/company-2/");
        expect(accepts(otherCompany)).toBe(false);
        const otherSha = good();
        otherSha.artifacts[0]!.relativeKey = otherSha.artifacts[0]!.relativeKey.replace(/[0-9a-f]{64}\.pdf$/, `${"0".repeat(64)}.pdf`);
        expect(accepts(otherSha)).toBe(false);
        const swappedType = good();
        swappedType.artifacts[0]!.relativeKey = swappedType.artifacts[1]!.relativeKey;
        expect(accepts(swappedType)).toBe(false);
    });

    it("rejects the installation marker, or any non-artifact path, as a relativeKey", () => {
        for (const key of [".bjj-backup/installation.json", "eformsign/company-1/runs/x.json", "../outside.pdf", "/etc/passwd"]) {
            const value = good();
            value.artifacts[0]!.relativeKey = key;
            expect(accepts(value)).toBe(false);
        }
    });

    it("rejects a duplicate artifactType", () => {
        const value = good();
        value.artifacts[1] = { ...value.artifacts[0]! };
        expect(accepts(value)).toBe(false);
    });

    it("rejects a bundleId or consistency that disagrees with the artifact types", () => {
        const withoutBundle = good();
        withoutBundle.bundleId = null;
        expect(accepts(withoutBundle)).toBe(false); // two types need a bundleId
        const incompleteWithBundle = good();
        incompleteWithBundle.consistency = "incomplete";
        expect(accepts(incompleteWithBundle)).toBe(false);
        const single = structuredClone(buildManifest({ companyId: COMPANY, documentId: "D004", metadataRevision: revision, artifacts: [artifacts[0]!] }).value);
        expect(accepts({ ...single, bundleId: sha("b") })).toBe(false); // one type may not carry a bundleId
        expect(accepts({ ...single, consistency: "unverified" })).toBe(false);
    });
});

describe("completionSchema binds every manifestKey and orders entries (D1, D2)", () => {
    const base = {
        companyId: COMPANY, sequence: 2, snapshotId: "snap-0002", runId: RUN, scopeRevision: "2026-10-19-company-all-docs",
        policyRevision: "2026-10-18-completed-pdf-audit", destinationIdentity: "local:arch-1", destinationRevision: "local-layout-v1",
        gaps: [],
    };
    const entry = (documentId: string) => ({ documentId, metadataRevision: sha(`m-${documentId}`), manifestSha256: sha(`f-${documentId}`) });
    const good = () => structuredClone(buildCompletion({ ...base, entries: [entry("D001"), entry("D002")] }).value);
    const accepts = (value: unknown) => completionSchema.safeParse(value).success;

    it("accepts correctly bound, sorted entries", () => {
        expect(accepts(good())).toBe(true);
        expect(accepts({ ...good(), entries: [] })).toBe(true);
    });

    it("rejects a manifestKey of another document, another company or another revision", () => {
        const otherDoc = good();
        otherDoc.entries[0]!.manifestKey = otherDoc.entries[1]!.manifestKey;
        expect(accepts(otherDoc)).toBe(false);
        const otherCompany = good();
        otherCompany.entries[0]!.manifestKey = otherCompany.entries[0]!.manifestKey.replace(`/${COMPANY}/`, "/company-2/");
        expect(accepts(otherCompany)).toBe(false);
        const otherRevision = good();
        otherRevision.entries[1]!.manifestKey = otherRevision.entries[1]!.manifestKey.replace(/[0-9a-f]{64}\.json$/, `${"0".repeat(64)}.json`);
        expect(accepts(otherRevision)).toBe(false);
        const marker = good();
        marker.entries[0]!.manifestKey = ".bjj-backup/installation.json";
        expect(accepts(marker)).toBe(false);
    });

    it("rejects unsorted and duplicate entries", () => {
        const value = good();
        expect(accepts({ ...value, entries: [...value.entries].reverse() })).toBe(false);
        expect(accepts({ ...value, entries: [value.entries[0], value.entries[0]] })).toBe(false);
    });

    it("buildCompletion refuses duplicate entries instead of publishing them", () => {
        expect(() => buildCompletion({ ...base, entries: [entry("D001"), entry("D001")] })).toThrow(WorkerError);
    });

    it("rejects control characters in a gap documentId, like the ledger field", () => {
        for (const documentId of ["D\u0000001", "D\n001", "D\u007f001", "", "x".repeat(513)]) {
            expect(accepts({ ...good(), gaps: [{ documentId, reasonCode: "source-removed" }] })).toBe(false);
        }
        expect(accepts({ ...good(), gaps: [{ documentId: "Dé", reasonCode: "source-removed" }] })).toBe(true);
    });
});
