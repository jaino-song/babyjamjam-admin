import { manualExecutionScopeSchema, type ManualExecutionScope } from "./worker/manual-protocol";

export const MANUAL_BACKUP_SCOPE_REVISION = "2026-11-06-branch-selected-docs";
export const MANUAL_BACKUP_LEASE_DURATION_MS = 180_000;

export function manualBackupSnapshotId(scope: ManualExecutionScope): string {
    try {
        const parsed = manualExecutionScopeSchema.safeParse(scope);
        if (parsed.success) return `manual-${parsed.data.jobId}-${parsed.data.attemptId.slice(parsed.data.jobId.length + 1)}`;
    } catch { /* Discard input/validator details. */ }
    throw new RangeError("Invalid manual execution scope");
}
