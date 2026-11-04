import { CustomVariable, SystemTemplateKey, isCaregiverSystemTemplateKey } from "../constants/system-template-registry";

export const BRANCH_SYSTEM_TEMPLATE_SNAPSHOT_VERSION = 1;

export interface BranchSystemTemplateSnapshotEntry {
    state?: "active" | "disabled" | "deleted";
    deletedAt?: string;
    content: string;
    customVariables: CustomVariable[];
    id: string;
    createdAt: string;
    updatedAt: string;
}

export interface BranchSystemTemplateSnapshot {
    version: 1 | 2;
    createdAt: string;
    createdBy: string;
    templates: Partial<Record<SystemTemplateKey, BranchSystemTemplateSnapshotEntry>> & Record<string, unknown>;
}

export class BranchSystemTemplateSnapshotError extends Error {
    constructor(
        readonly branchId: string,
        readonly templateKey?: SystemTemplateKey,
        reason = "snapshot is invalid or incomplete",
    ) {
        super(
            templateKey
                ? `Branch system template ${templateKey} is unavailable: ${reason}`
                : `Branch system template snapshot is unavailable: ${reason}`,
        );
        this.name = "BranchSystemTemplateSnapshotError";
    }
}

export type CaregiverTemplateLifecycleAction = "activate" | "disable" | "delete" | "restore";
export interface CaregiverTemplateLifecycleResult {
    key: SystemTemplateKey;
    state: "active" | "disabled" | "deleted";
    deletedAt: string | null;
    snapshotVersion: 2;
}

/** Strict known entries, lossless unknown entries. Absence is never a corrupt-data fallback. */
export function parseBranchSystemTemplateSnapshot(value: unknown, branchId: string): BranchSystemTemplateSnapshot | null {
    if (value === null) return null;
    const record = (item: unknown): item is Record<string, unknown> => typeof item === "object" && item !== null && !Array.isArray(item);
    const date = (item: unknown): item is string => typeof item === "string" && !Number.isNaN(new Date(item).getTime());
    if (!record(value) || (value["version"] !== 1 && value["version"] !== 2) || !date(value["createdAt"])
        || typeof value["createdBy"] !== "string" || !value["createdBy"] || !record(value["templates"])) throw new BranchSystemTemplateSnapshotError(branchId);
    for (const [key, entry] of Object.entries(value["templates"])) {
        if (!Object.values(SystemTemplateKey).includes(key as SystemTemplateKey)) continue;
        if (!record(entry) || typeof entry["content"] !== "string" || typeof entry["id"] !== "string" || !entry["id"]
            || !date(entry["createdAt"]) || !date(entry["updatedAt"]) || !Array.isArray(entry["customVariables"])
            || entry["customVariables"].some((variable: unknown) => !record(variable) || typeof variable["key"] !== "string" || !variable["key"]
                || typeof variable["label"] !== "string" || !variable["label"] || typeof variable["required"] !== "boolean")) throw new BranchSystemTemplateSnapshotError(branchId, key as SystemTemplateKey);
        if (entry["state"] !== undefined || entry["deletedAt"] !== undefined) {
            if (value["version"] !== 2 || !isCaregiverSystemTemplateKey(key) || !["active", "disabled", "deleted"].includes(String(entry["state"]))
                || (entry["state"] === "deleted" ? !date(entry["deletedAt"]) : entry["deletedAt"] !== undefined)) throw new BranchSystemTemplateSnapshotError(branchId, key as SystemTemplateKey);
        }
    }
    // JSON storage has no prototypes; cloning preserves every unrelated property without sharing mutable state.
    return structuredClone(value) as unknown as BranchSystemTemplateSnapshot;
}
