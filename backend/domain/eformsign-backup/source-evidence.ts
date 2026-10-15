import { createHash } from "node:crypto";
import { types } from "node:util";

export const EVIDENCE_DOMAINS = Object.freeze({
    artifact: "eformsign-backup/artifact/v1",
    metadata: "eformsign-backup/metadata/v1",
    bundle: "eformsign-backup/bundle/v1",
    documentIdSet: "eformsign-backup/document-id-set/v1",
});
export type ArtifactKind = "document" | "audit-trail";
export interface ArtifactClaim {
    companyId: string;
    documentId: string;
    artifactKind: ArtifactKind;
    contentSha256: string;
    byteLength: number;
}
// These observations belong to the acquisition record, never identity metadata.
export interface AcquisitionProvenance {
    acquisitionId: string;
    acquiredAt: string;
    sourceUpdatedDate: string | null;
}
export interface BundleEvidence {
    sourceRevision: null;
    metadataRevision: string;
    bundleId: string | null;
    consistency: "incomplete" | "conflict" | "unverified";
}

function invalid(): never { throw new Error("Invalid evidence"); }
export function assertIdentifier(value: unknown): asserts value is string {
    if (typeof value !== "string" || value === "." || value === ".." || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/.test(value)) invalid();
}
export function assertSha256(value: unknown): asserts value is string {
    if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) invalid();
}
export function assertCount(value: unknown): asserts value is number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) invalid();
}
function jsonString(value: string): string {
    // Lone surrogates cannot be represented unambiguously as UTF-8 scalar values.
    if (/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) invalid();
    return JSON.stringify(value);
}

/** Conservative JSON profile: safe integers, data properties, plain objects and dense arrays. */
export function canonicalJson(value: unknown): string {
    const ancestors = new Set<object>();
    let nodes = 0;
    function encode(item: unknown, depth: number): string {
        if (++nodes > 100_000 || depth > 64) invalid();
        if (item === null) return "null";
        if (typeof item === "string") return jsonString(item);
        if (typeof item === "boolean") return String(item);
        if (typeof item === "number") {
            if (!Number.isSafeInteger(item) || Object.is(item, -0)) invalid();
            return String(item);
        }
        if (typeof item !== "object" || types.isProxy(item) || ancestors.has(item)) invalid();
        const array = Array.isArray(item);
        if (Object.getPrototypeOf(item) !== (array ? Array.prototype : Object.prototype)) invalid();
        const descriptors = Object.getOwnPropertyDescriptors(item);
        const keys = Reflect.ownKeys(descriptors);
        for (const key of keys) {
            if (typeof key !== "string") invalid();
            const descriptor = descriptors[key]!;
            if (!("value" in descriptor) || (!descriptor.enumerable && !(array && key === "length"))) invalid();
            if (["__proto__", "constructor", "prototype"].includes(key)) invalid();
        }
        ancestors.add(item);
        let result: string;
        if (array) {
            if (keys.length !== item.length + 1) invalid();
            const parts: string[] = [];
            for (let i = 0; i < item.length; i++) {
                const descriptor = descriptors[String(i)];
                if (!descriptor) invalid();
                parts.push(encode(descriptor.value, depth + 1));
            }
            result = `[${parts.join(",")}]`;
        } else {
            result = `{${(keys as string[]).sort().map(key => `${jsonString(key)}:${encode(descriptors[key]!.value, depth + 1)}`).join(",")}}`;
        }
        ancestors.delete(item);
        return result;
    }
    const result = encode(value, 0);
    if (Buffer.byteLength(result, "utf8") > 1_048_576) invalid();
    return result;
}

export function evidenceDigest(domain: string, value: unknown): string {
    if (!Object.values(EVIDENCE_DOMAINS).some(label => label === domain)) invalid();
    return createHash("sha256").update(`${domain}\n${canonicalJson(value)}`, "utf8").digest("hex");
}
export function artifactIdentity(claim: ArtifactClaim): string {
    if (!claim || typeof claim !== "object" || Array.isArray(claim)) invalid();
    canonicalJson(claim);
    assertIdentifier(claim.companyId);
    assertIdentifier(claim.documentId);
    assertSha256(claim.contentSha256);
    assertCount(claim.byteLength);
    if (claim.artifactKind !== "document" && claim.artifactKind !== "audit-trail") invalid();
    return evidenceDigest(EVIDENCE_DOMAINS.artifact, {
        companyId: claim.companyId, documentId: claim.documentId,
        artifactKind: claim.artifactKind, contentSha256: claim.contentSha256,
    });
}
export function metadataRevision(stableMetadata: unknown): string {
    if (!stableMetadata || typeof stableMetadata !== "object" || Array.isArray(stableMetadata)) invalid();
    return evidenceDigest(EVIDENCE_DOMAINS.metadata, stableMetadata);
}
export function evaluateBundle(input: {
    companyId: string; documentId: string; artifacts: readonly ArtifactClaim[]; stableMetadata: unknown;
}): BundleEvidence {
    if (!input || typeof input !== "object" || Array.isArray(input)) invalid();
    canonicalJson(input);
    assertIdentifier(input.companyId);
    assertIdentifier(input.documentId);
    if (!Array.isArray(input.artifacts)) invalid();
    const revision = metadataRevision(input.stableMetadata);
    const refs = new Map<ArtifactKind, { artifactId: string; byteLength: number }>();
    let conflict = false;
    for (const claim of input.artifacts) {
        const artifactId = artifactIdentity(claim);
        if (claim.companyId !== input.companyId || claim.documentId !== input.documentId) invalid();
        const previous = refs.get(claim.artifactKind);
        if (previous && (previous.artifactId !== artifactId || previous.byteLength !== claim.byteLength)) conflict = true;
        refs.set(claim.artifactKind, { artifactId, byteLength: claim.byteLength });
    }
    const base = { sourceRevision: null, metadataRevision: revision, bundleId: null } as const;
    if (conflict) return { ...base, consistency: "conflict" };
    if (refs.size !== 2) return { ...base, consistency: "incomplete" };
    const artifacts = [...refs].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
        .map(([artifactKind, ref]) => ({ artifactKind, artifactId: ref.artifactId }));
    return { ...base, consistency: "unverified", bundleId: evidenceDigest(EVIDENCE_DOMAINS.bundle, {
        companyId: input.companyId, documentId: input.documentId, artifacts,
        metadataRevision: revision, sourceRevision: null,
    }) };
}
