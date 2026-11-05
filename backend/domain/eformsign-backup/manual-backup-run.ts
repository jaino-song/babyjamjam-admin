import type { ExportCandidateView } from "./export/types";
import type { ExportCounts } from "./export/classification";
import { EXPORT_CLASSIFICATIONS, EXPORT_FILE_TYPES } from "./export/constants";
import {
    MANUAL_BACKUP_CONTRACT_MILESTONES, MANUAL_BACKUP_RECORD_MILESTONES, parseManualBackupScope,
    type ManualBackupScope, type ContractMilestone, type RecordMilestone,
} from "./manual-backup-scope";

export type BackupJson = null | boolean | number | string | readonly BackupJson[] | { readonly [key: string]: BackupJson };
export type BackupObject = { readonly [key: string]: BackupJson };
type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;
export type ManualBackupCandidate = DeepReadonly<ExportCandidateView>;
export type ManualBackupRunStatus = "queued" | "running" | "partial" | "blocked" | "failed" | "unverified";
export type ManualBackupTerminalStatus = Exclude<ManualBackupRunStatus, "queued" | "running">;
export type ManualBackupRunErrorCode = "INVALID_INPUT" | "IDEMPOTENCY_CONFLICT" | "RUN_ACTIVE" | "SOURCE_SCOPE_CHANGED" | "NOT_FOUND" | "LEASE_LOST";
export class ManualBackupRunError extends Error {
    constructor(readonly code: ManualBackupRunErrorCode) { super("Manual backup operation rejected"); this.name = "ManualBackupRunError"; }
}
export interface ManualBackupDocumentInput {
    readonly documentId: string;
    readonly ordinal: number;
    readonly kind: "contract" | "record";
    readonly currentMilestone: ContractMilestone | RecordMilestone | null;
    readonly documentCreatedAt: Date;
    readonly candidate: ManualBackupCandidate;
}
export interface EnqueueManualBackupInput {
    readonly companyId: string;
    readonly branchId: string;
    readonly requestedByUserId: string | null;
    readonly requestKey: string;
    readonly requestHash: string;
    readonly scope: ManualBackupScope;
    readonly sourceCounts: Readonly<ExportCounts>;
    readonly snapshotAt: Date;
    readonly documents: readonly ManualBackupDocumentInput[];
}
/** Internal persistence record. Future staff DTO mappers MUST allowlist fields, excluding lease identity. */
export interface ManualBackupRunRecord extends Omit<EnqueueManualBackupInput, "documents"> {
    readonly id: string;
    readonly status: ManualBackupRunStatus;
    readonly activeKey: string | null;
    readonly attempts: number;
    readonly leaseToken: string | null;
    readonly leaseOwnerPrincipalId: string | null;
    readonly leaseExpiresAt: Date | null;
    readonly heartbeatAt: Date | null;
    readonly startedAt: Date | null;
    readonly finishedAt: Date | null;
    readonly workerRunId: string | null;
    readonly reportHash: string | null;
    readonly result: BackupObject | null;
    readonly failureCode: string | null;
    readonly createdAt: Date;
    readonly updatedAt: Date;
}
export interface ManualBackupDocumentRecord extends ManualBackupDocumentInput {
    readonly runId: string;
    readonly branchId: string;
    readonly outcome: BackupObject | null;
}
export interface ManualBackupLeaseIdentity {
    readonly companyId: string;
    readonly principalId: string;
    readonly runId: string;
    readonly leaseToken: string;
}
export interface ManualBackupFinishInput {
    readonly status: ManualBackupTerminalStatus;
    readonly workerRunId: string;
    readonly reportHash: string;
    readonly result: BackupObject;
    readonly failureCode?: string;
}
export interface ManualBackupDocumentResult { readonly documentId: string; readonly outcome: BackupObject }
export const MANUAL_BACKUP_REPORT_MAX_BYTES = 128 * 1024;
export const MANUAL_BACKUP_OUTCOME_MAX_BYTES = 16 * 1024;

export function requireBackupInput(valid: unknown): asserts valid {
    if (!valid) throw new ManualBackupRunError("INVALID_INPUT");
}
export function assertBackupText(value: unknown, max: number): asserts value is string {
    requireBackupInput(typeof value === "string" && value.trim().length > 0 && value.length <= max && !value.includes("\0"));
}
export function assertBackupUuid(value: unknown): asserts value is string {
    requireBackupInput(typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value));
}
export function assertBackupHash(value: unknown): asserts value is string {
    requireBackupInput(typeof value === "string" && /^[0-9a-f]{64}$/.test(value));
}
export function assertBackupDate(value: unknown): asserts value is Date {
    requireBackupInput(value instanceof Date && Number.isFinite(value.getTime()));
}
/** Reject non-JSON JS values before serializing; sort object keys for JSONB-compatible replay equality. */
export function canonicalBackupJson(value: unknown): string {
    const seen = new Set<object>();
    const visit = (node: unknown, depth: number): string => {
        requireBackupInput(depth <= 64);
        if (node === null || typeof node === "boolean") return JSON.stringify(node);
        if (typeof node === "string") {
            requireBackupInput(!node.includes("\0") && [...node].every(char => {
                const cp = char.codePointAt(0) ?? 0; return cp < 0xd800 || cp > 0xdfff;
            }));
            return JSON.stringify(node);
        }
        if (typeof node === "number") { requireBackupInput(Number.isFinite(node)); return JSON.stringify(node); }
        requireBackupInput(typeof node === "object" && node !== null && !seen.has(node));
        requireBackupInput(Array.isArray(node) || Object.getPrototypeOf(node) === Object.prototype || Object.getPrototypeOf(node) === null);
        seen.add(node);
        let result: string;
        if (Array.isArray(node)) {
            requireBackupInput(Object.keys(node).length === node.length && Reflect.ownKeys(node).length === node.length + 1);
            const elements: string[] = [];
            for (let index = 0; index < node.length; index++) {
                const descriptor = Object.getOwnPropertyDescriptor(node, String(index));
                requireBackupInput(descriptor && "value" in descriptor);
                elements.push(visit(descriptor.value, depth + 1));
            }
            result = `[${elements.join(",")}]`;
        } else {
            const object = node as Record<string, unknown>;
            requireBackupInput(Reflect.ownKeys(node).length === Object.keys(node).length);
            result = `{${Object.keys(object).sort().map(key => {
                const descriptor = Object.getOwnPropertyDescriptor(object, key);
                requireBackupInput(descriptor && "value" in descriptor);
                return `${visit(key, depth + 1)}:${visit(descriptor.value, depth + 1)}`;
            }).join(",")}}`;
        }
        seen.delete(node);
        return result;
    };
    return visit(value, 0);
}
export function assertBackupObject(value: unknown, maxBytes: number): asserts value is BackupObject {
    requireBackupInput(value !== null && typeof value === "object" && !Array.isArray(value));
    const json = canonicalBackupJson(value);
    let bytes = 0;
    for (const char of json) {
        const cp = char.codePointAt(0) ?? 0;
        bytes += cp <= 0x7f ? 1 : cp <= 0x7ff ? 2 : cp <= 0xffff ? 3 : 4;
    }
    requireBackupInput(bytes <= maxBytes);
}
export function assertBackupLease(identity: ManualBackupLeaseIdentity): void {
    requireBackupInput(identity && typeof identity === "object");
    assertBackupText(identity.companyId, 256); assertBackupText(identity.principalId, 64);
    assertBackupUuid(identity.runId); assertBackupUuid(identity.leaseToken);
}
export function assertBackupPage(afterOrdinal: number, limit: number): void {
    requireBackupInput(Number.isSafeInteger(afterOrdinal) && afterOrdinal >= 0);
    requireBackupInput(Number.isSafeInteger(limit) && limit >= 1 && limit <= 100);
}
function exactKeys(value: object, keys: readonly string[]): void {
    requireBackupInput(Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key)));
}
function assertCandidate(candidate: ManualBackupCandidate, documentId: string, ordinal: number): void {
    assertBackupObject(candidate, MANUAL_BACKUP_REPORT_MAX_BYTES);
    exactKeys(candidate, ["ordinal", "documentId", "classification", "reasons", "statusType", "documentKind", "metadataRevision", "artifacts"]);
    requireBackupInput(candidate.documentId === documentId && candidate.ordinal === ordinal);
    requireBackupInput(EXPORT_CLASSIFICATIONS.includes(candidate.classification));
    requireBackupInput(Array.isArray(candidate.reasons) && candidate.reasons.every(reason => typeof reason === "string"));
    requireBackupInput(typeof candidate.statusType === "string" && (candidate.documentKind === null || typeof candidate.documentKind === "string"));
    assertBackupHash(candidate.metadataRevision);
    requireBackupInput(Array.isArray(candidate.artifacts) && candidate.artifacts.length <= 2);
    const types = new Set<string>();
    for (const artifact of candidate.artifacts) {
        exactKeys(artifact, ["fileType", "artifactIdentity", "sha256", "byteSize"]);
        requireBackupInput(EXPORT_FILE_TYPES.includes(artifact.fileType) && !types.has(artifact.fileType)); types.add(artifact.fileType);
        assertBackupHash(artifact.artifactIdentity); assertBackupHash(artifact.sha256);
        requireBackupInput(Number.isSafeInteger(artifact.byteSize) && artifact.byteSize >= 0);
    }
}
/** Revalidate trusted internal callers too; selection and classification remain the caller's responsibility. */
export function normalizeManualBackupEnqueue(input: EnqueueManualBackupInput): EnqueueManualBackupInput {
    requireBackupInput(input && typeof input === "object");
    exactKeys(input, ["companyId", "branchId", "requestedByUserId", "requestKey", "requestHash", "scope", "sourceCounts", "snapshotAt", "documents"]);
    assertBackupText(input.companyId, 256); assertBackupUuid(input.branchId);
    if (input.requestedByUserId !== null) assertBackupUuid(input.requestedByUserId);
    assertBackupText(input.requestKey, 128); assertBackupHash(input.requestHash); assertBackupDate(input.snapshotAt);
    const scope = parseManualBackupScope(input.scope); requireBackupInput(scope.ok);
    assertBackupObject(input.sourceCounts, 4096);
    const countKeys = ["total", "inaccessible", "unknownTemplate", "policyPending", "excludedByPolicy", "included"] as const;
    exactKeys(input.sourceCounts, countKeys);
    for (const key of countKeys) requireBackupInput(Number.isSafeInteger(input.sourceCounts[key]) && input.sourceCounts[key] >= 0);
    requireBackupInput(input.sourceCounts.total === countKeys.slice(1).reduce((sum, key) => sum + input.sourceCounts[key], 0));
    requireBackupInput(Array.isArray(input.documents) && input.documents.length === input.sourceCounts.total);
    let previous: string | undefined;
    for (const [index, doc] of input.documents.entries()) {
        requireBackupInput(doc && typeof doc === "object");
        exactKeys(doc, ["documentId", "ordinal", "kind", "currentMilestone", "documentCreatedAt", "candidate"]);
        assertBackupText(doc.documentId, 4096);
        requireBackupInput(doc.ordinal === index + 1 && (previous === undefined || previous < doc.documentId)); previous = doc.documentId;
        requireBackupInput(doc.kind === "contract" || doc.kind === "record");
        const stages: readonly string[] = doc.kind === "contract" ? MANUAL_BACKUP_CONTRACT_MILESTONES : MANUAL_BACKUP_RECORD_MILESTONES;
        requireBackupInput(doc.currentMilestone === null || stages.includes(doc.currentMilestone));
        assertBackupDate(doc.documentCreatedAt); assertCandidate(doc.candidate, doc.documentId, doc.ordinal);
    }
    return { ...input, scope: scope.value };
}
