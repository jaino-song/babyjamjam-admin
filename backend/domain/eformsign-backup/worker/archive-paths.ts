import type { ArtifactKind } from "domain/eformsign-backup/source-evidence";
import {
    HEX64_PATTERN, MAX_SEQUENCE, UUID_V4_PATTERN, isPathIdentifier,
} from "./schema-fields";
import { WorkerError } from "./worker-error";

/**
 * Archive path builders (contract W4). Every segment is validated; anything else is rejected, never escaped.
 * Keys are POSIX relative paths without a leading slash.
 */
export const ARCHIVE_DATA_DIRECTORY = "eformsign";
export const ARCHIVE_MARKER_KEY = ".bjj-backup/installation.json";
export const ARCHIVE_ARTIFACT_TYPES = ["document", "audit-trail"] as const satisfies readonly ArtifactKind[];
export type ArchiveArtifactType = typeof ARCHIVE_ARTIFACT_TYPES[number];

/** `eformsign/{companyId}/` also holds these two directories, so a document may not take their names. */
const RESERVED_DOCUMENT_IDS: ReadonlySet<string> = new Set(["completions", "runs"]);
const COMPLETION_NAME_PATTERN = /^(\d{12})-([0-9a-f]{64})\.json$/;
const ARTIFACT_KEY_PATTERN = /^eformsign\/([^/]+)\/([^/]+)\/artifacts\/(document|audit-trail)\/([0-9a-f]{64})\.pdf$/;

function reject(): never {
    throw new WorkerError("invalid-path-segment");
}
function identifierSegment(value: unknown): string {
    return isPathIdentifier(value) ? value : reject();
}
function documentSegment(value: unknown): string {
    const id = identifierSegment(value);
    return RESERVED_DOCUMENT_IDS.has(id) ? reject() : id;
}
function hexSegment(value: unknown): string {
    return typeof value === "string" && HEX64_PATTERN.test(value) ? value : reject();
}
function runIdSegment(value: unknown): string {
    return typeof value === "string" && UUID_V4_PATTERN.test(value) ? value : reject();
}
function artifactTypeSegment(value: unknown): ArchiveArtifactType {
    return value === "document" || value === "audit-trail" ? value : reject();
}

export function isValidSequence(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= MAX_SEQUENCE;
}
/** Sequence as the 12-digit zero-padded decimal of a completion file name. */
export function sequence12(sequence: unknown): string {
    return isValidSequence(sequence) ? String(sequence).padStart(12, "0") : reject();
}

export function artifactKey(input: {
    companyId: string; documentId: string; artifactType: ArchiveArtifactType; sha256: string;
}): string {
    return `${ARCHIVE_DATA_DIRECTORY}/${identifierSegment(input.companyId)}/${documentSegment(input.documentId)}`
        + `/artifacts/${artifactTypeSegment(input.artifactType)}/${hexSegment(input.sha256)}.pdf`;
}

export function manifestKey(input: { companyId: string; documentId: string; metadataRevision: string }): string {
    return `${ARCHIVE_DATA_DIRECTORY}/${identifierSegment(input.companyId)}/${documentSegment(input.documentId)}`
        + `/manifests/${hexSegment(input.metadataRevision)}.json`;
}

export function completionName(input: { sequence: number; contentDigest: string }): string {
    return `${sequence12(input.sequence)}-${hexSegment(input.contentDigest)}.json`;
}

export function completionKey(input: { companyId: string; sequence: number; contentDigest: string }): string {
    return `${ARCHIVE_DATA_DIRECTORY}/${identifierSegment(input.companyId)}/completions/${completionName(input)}`;
}

export function runKey(input: { companyId: string; runId: string }): string {
    return `${ARCHIVE_DATA_DIRECTORY}/${identifierSegment(input.companyId)}/runs/${runIdSegment(input.runId)}.json`;
}

export function markerKey(): string {
    return ARCHIVE_MARKER_KEY;
}

/** `null` unless the name is exactly `{sequence12}-{contentDigest}.json` with a sequence in 1..999999999999. */
export function parseCompletionName(name: string): { sequence: number; contentDigest: string } | null {
    const match = COMPLETION_NAME_PATTERN.exec(name);
    if (!match) return null;
    const sequence = Number(match[1]);
    return isValidSequence(sequence) ? { sequence, contentDigest: match[2]! } : null;
}

/** Inverse of `artifactKey`; `null` for anything that is not a valid artifact key. */
export function parseArtifactKey(key: string): {
    companyId: string; documentId: string; artifactType: ArchiveArtifactType; sha256: string;
} | null {
    const match = ARTIFACT_KEY_PATTERN.exec(key);
    if (!match) return null;
    const [, companyId, documentId, artifactType, sha256] = match;
    try {
        const parts = {
            companyId: companyId!, documentId: documentId!, artifactType: artifactType as ArchiveArtifactType, sha256: sha256!,
        };
        return artifactKey(parts) === key ? parts : null;
    } catch {
        return null;
    }
}
