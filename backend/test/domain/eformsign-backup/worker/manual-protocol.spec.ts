import { createHash } from "node:crypto";
import {
    WorkerError, manualExecutionScopeSchema, manualSelectedCandidateSchema, manualDocumentResultSchema,
    manualAggregateResultSchema, destinationObservationSchema, normalizeManualSelection, manualSelectionDigest,
    manualDocumentResultDigest, manualDocumentResultsDigest, manualAggregateResultDigest, buildManualAggregateResult,
    type ManualSelectedCandidate, type ManualDocumentResult, type ManualExecutionScope,
} from "domain/eformsign-backup/worker";

const jobId = "00000000-0000-4000-8000-000000000001";
const branchId = "00000000-0000-4000-8000-000000000002";
const runId = "00000000-0000-4000-8000-000000000003";
const receiptId = "00000000-0000-4000-8000-000000000004";
const h = (char: string) => char.repeat(64);
const candidate: ManualSelectedCandidate = {
    ordinal: 1, documentId: "doc-1", classification: "included", reasons: ["z", "a", "z"],
    statusType: "completed", documentKind: "contract", metadataRevision: h("a"),
    artifacts: [
        { artifactType: "audit-trail", artifactIdentity: h("b"), sha256: h("c"), byteLength: 2 },
        { artifactType: "document", artifactIdentity: h("d"), sha256: h("e"), byteLength: 1 },
    ],
};
const selection = { jobId, companyId: "company-1", branchId, scopeRevision: "scope-v1", policyRevision: "policy-v1", candidates: [candidate] };
const scope: ManualExecutionScope = { kind: "manual", jobId, attemptId: `${jobId}.attempt-1`, companyId: "company-1", branchId, selectionDigest: manualSelectionDigest(selection) };
const verified = {
    destinationIdentity: "local-1", destinationRevision: "rev-1", state: "verified" as const, manifestStatus: "verified" as const,
    artifacts: [h("d"), h("b")].map((artifactIdentity) => ({ artifactIdentity, state: "verified" as const, reasonCode: null })), reasons: [],
};
const result: ManualDocumentResult = { receiptId, runId, scope, documentId: "doc-1", classification: "included",
    expectedArtifactIdentities: [h("d"), h("b")], observedAtSequence: 4, local: verified, drive: { ...verified, destinationIdentity: "drive-1" }, reasons: ["z", "a", "a"] };
const aggregateInput = () => ({ receiptId: branchId, runId, scope, selection, results: [result], status: "partial", reasons: [] });
// Independent test oracle: ordinary JSON with sorted keys, without any production normalization/hash helper.
function canonical(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}`;
    return JSON.stringify(value);
}
const oracle = (domain: string, value: unknown) => createHash("sha256").update(`eformsign-backup/${domain}/v1\n${canonical(value)}`).digest("hex");

it("hashes exact normalized selection with independent canonical oracle, without mutation", () => {
    const original = structuredClone(selection);
    const normalized = { ...selection, candidates: [{ ...candidate, reasons: ["a", "z"], artifacts: [...candidate.artifacts].reverse() }] };
    expect(manualSelectionDigest(selection)).toBe("11a8480b17331fa46951f193872a368e246087026c2d401a6053dff9be901d57");
    expect(manualSelectionDigest(selection)).toBe(oracle("manual-selection", normalized));
    expect(normalizeManualSelection(selection)).toEqual(normalized);
    expect(selection).toEqual(original);
    const second = { ...candidate, ordinal: 2, documentId: "doc-2" };
    expect(manualSelectionDigest({ ...selection, candidates: [second, candidate] }))
        .toBe(manualSelectionDigest({ ...selection, candidates: [candidate, second] }));
    for (const change of [{ companyId: "other" }, { branchId: jobId }, { policyRevision: "v2" }, { scopeRevision: "v2" }]) {
        expect(manualSelectionDigest({ ...selection, ...change })).not.toBe(scope.selectionDigest);
    }
});

it.each(["token", "password", "email", "name", "rawContent", "leaseToken", "capability"])("rejects unknown/secret field %s at every strict level", (key) => {
    for (const [schema, value] of [
        [manualExecutionScopeSchema, scope], [manualSelectedCandidateSchema, candidate],
        [manualDocumentResultSchema, result], [destinationObservationSchema, verified],
        [manualAggregateResultSchema, buildManualAggregateResult(aggregateInput())],
    ] as const) expect(schema.safeParse({ ...value, [key]: "private" }).success).toBe(false);
    expect(() => manualSelectionDigest({ ...selection, [key]: "private" })).toThrow(new WorkerError("ledger-schema"));
    expect(manualSelectedCandidateSchema.safeParse({ ...candidate, artifacts: [{ ...candidate.artifacts[0], [key]: "private" }] }).success).toBe(false);
});

it.each(["free prose", "a@b.test", "a\nb", "a\u0000b", "", "x".repeat(129)])("rejects unsafe reason %j", (reason) => {
    expect(manualSelectedCandidateSchema.safeParse({ ...candidate, reasons: [reason] }).success).toBe(false);
    expect(() => manualDocumentResultDigest({ ...result, reasons: [reason] })).toThrow(new WorkerError("ledger-schema"));
});

it("enforces public attempt ids, scalar bounds and duplicate constraints", () => {
    for (const attemptId of ["lease-token", `${jobId}.attempt-0`, `${branchId}.attempt-1`, `${jobId}.attempt-01`, `${jobId}.attempt-9007199254740992`]) {
        expect(manualExecutionScopeSchema.safeParse({ ...scope, attemptId }).success).toBe(false);
    }
    for (const change of [{ ordinal: 0 }, { ordinal: Number.MAX_SAFE_INTEGER + 1 }, { statusType: "contains spaces" }, { documentKind: "x@y" }, { reasons: Array(65).fill("ok") },
        { artifacts: [candidate.artifacts[0], candidate.artifacts[0]] },
        { artifacts: [candidate.artifacts[0], { ...candidate.artifacts[1], artifactIdentity: h("b") }] },
        { artifacts: [{ ...candidate.artifacts[0], byteLength: -1 }] }]) {
        expect(manualSelectedCandidateSchema.safeParse({ ...candidate, ...change }).success).toBe(false);
    }
    for (const duplicate of [{ ...candidate, documentId: "other" }, { ...candidate, ordinal: 2 }]) {
        expect(() => manualSelectionDigest({ ...selection, candidates: [candidate, duplicate] })).toThrow(new WorkerError("ledger-schema"));
    }
    expect(manualSelectedCandidateSchema.safeParse({ ...candidate, artifacts: [{ ...candidate.artifacts[0], byteLength: 0 }] }).success).toBe(true);
    expect(destinationObservationSchema.safeParse({ ...verified, destinationRevision: null }).success).toBe(false);
});

it("normalizes document/aggregate digests, separates domains and counts documents independently per destination", () => {
    const before = structuredClone(result);
    const normalized = { ...result, expectedArtifactIdentities: [h("b"), h("d")], reasons: ["a", "z"],
        local: { ...verified, artifacts: [...verified.artifacts].reverse() },
        drive: { ...result.drive, artifacts: [...verified.artifacts].reverse() } };
    const digest = manualDocumentResultDigest(result);
    expect(digest).toBe("315f15b6a472a622605ed2488d3a1582ce1228f4858a0527efaf10a18010e342");
    expect(digest).toBe(oracle("manual-document-result", normalized));
    expect(result).toEqual(before);
    const aggregate = buildManualAggregateResult(aggregateInput());
    expect(aggregate.counts).toEqual({ selected: 1, localVerified: 1, driveVerified: 1, metadataOnly: 0, attention: 0 });
    expect(aggregate).toMatchObject({ status: "partial", coverage: "unverified", backupComplete: false, documentResultCount: 1 });
    expect(aggregate.documentResultsDigest).toBe("79f760766226ff6653f2fe46fa5f95f97e9039536bcdae97510da4c734b1de20");
    expect(manualAggregateResultDigest(aggregate)).toBe("bf49bc2f6537b465e20a76ab101b3b4b7f421269fba4a88219f4bb9da779e179");
    expect(aggregate.documentResultsDigest).toBe(oracle("manual-document-results", [["doc-1", receiptId, digest]]));
    expect(manualAggregateResultDigest(aggregate)).toBe(oracle("manual-aggregate-result", aggregate));
    expect(new Set([scope.selectionDigest, digest, aggregate.documentResultsDigest, manualAggregateResultDigest(aggregate)]).size).toBe(4);
    expect(manualAggregateResultSchema.safeParse({ ...aggregate, status: "completed" }).success).toBe(false);
    expect(manualAggregateResultSchema.safeParse({ ...aggregate, backupComplete: true }).success).toBe(false);
    expect(manualAggregateResultSchema.safeParse({ ...aggregate, coverage: "complete" }).success).toBe(false);
    const partial = buildManualAggregateResult({ ...aggregateInput(), results: [{ ...result, drive: { ...result.drive, state: "blocked", manifestStatus: "blocked", artifacts: [] } }] });
    expect(partial.counts).toEqual({ selected: 1, localVerified: 1, driveVerified: 0, metadataOnly: 0, attention: 1 });
    const noDrive = buildManualAggregateResult({ ...aggregateInput(), results: [{ ...result, drive: { destinationIdentity: null, destinationRevision: null, state: "not_required", manifestStatus: "not_required", artifacts: [], reasons: [] } }] });
    expect(noDrive.counts.attention).toBe(0);
});

it("requires explicit complete result coverage and matching scope/classification/identities", () => {
    for (const results of [[], [result, result], [{ ...result, scope: { ...scope, companyId: "other" } }],
        [{ ...result, classification: "policy_pending" }], [{ ...result, expectedArtifactIdentities: [] }],
        [{ ...result, documentId: "other" }], [{ ...result, local: { ...verified, artifacts: [verified.artifacts[0]] } }]]) {
        expect(() => buildManualAggregateResult({ ...aggregateInput(), results })).toThrow(WorkerError);
    }
    expect(() => manualDocumentResultsDigest([result, { ...result, documentId: "other" }])).toThrow(new WorkerError("ledger-inconsistent"));
});

it("accepts empty selections defensively and has no total document encoding cap", () => {
    const empty = { ...selection, candidates: [] };
    const emptyScope = { ...scope, selectionDigest: manualSelectionDigest(empty) };
    expect(buildManualAggregateResult({ ...aggregateInput(), selection: empty, scope: emptyScope, results: [] }).counts.selected).toBe(0);
    const large = { ...selection, candidates: Array.from({ length: 5000 }, (_, i) => ({ ...candidate, ordinal: i + 1, documentId: `doc-${i}` })) };
    expect(manualSelectionDigest(large)).toBe(manualSelectionDigest({ ...large, candidates: [...large.candidates].reverse() }));
});

it("sorts a complete immutable result set by document and rejects duplicate document/receipt references", () => {
    const second = { ...result, documentId: "doc-2", receiptId: branchId };
    const input = [second, result];
    const before = structuredClone(input);
    expect(manualDocumentResultsDigest(input)).toBe(oracle("manual-document-results", [
        ["doc-1", receiptId, manualDocumentResultDigest(result)],
        ["doc-2", branchId, manualDocumentResultDigest(second)],
    ]));
    expect(manualDocumentResultsDigest(input)).toBe(manualDocumentResultsDigest([...input].reverse()));
    expect(input).toEqual(before);
    expect(() => manualDocumentResultsDigest([result, { ...result, receiptId: branchId }])).toThrow("ledger-inconsistent");
    expect(() => manualDocumentResultsDigest([result, { ...second, receiptId }])).toThrow("ledger-inconsistent");
});
