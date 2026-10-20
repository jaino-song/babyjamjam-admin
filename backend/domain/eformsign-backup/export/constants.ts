/** Pure constants of the BJJ-454 machine export (contract D3/D4, 3.3, 3.5). */
export const EXPORT_SCOPE_REVISION = "2026-10-19-company-all-docs";
export const EXPORT_POLICY_REVISION = "2026-10-18-completed-pdf-audit";
export const EXPORT_SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000;
export const EXPORT_PAGE_LIMIT_DEFAULT = 100;
export const EXPORT_PAGE_LIMIT_MAX = 100;
export const EXPORT_ARTIFACT_MAX_BYTES = 64 * 1024 * 1024;
export const EXPORT_ARTIFACT_MAX_CONCURRENCY = 2;

/** Priority order: the first matching rule wins (contract D4). */
export const EXPORT_CLASSIFICATIONS = [
    "inaccessible",
    "unknown_template",
    "policy_pending",
    "excluded_by_policy",
    "included",
] as const;
export type ExportClassification = typeof EXPORT_CLASSIFICATIONS[number];

export const EXPORT_FILE_TYPES = ["document", "audit_trail"] as const;
export type ExportFileType = typeof EXPORT_FILE_TYPES[number];
