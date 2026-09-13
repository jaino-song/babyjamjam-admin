import { CustomVariable, SystemTemplateKey } from "../constants/system-template-registry";

export const BRANCH_SYSTEM_TEMPLATE_SNAPSHOT_VERSION = 1;

export interface BranchSystemTemplateSnapshotEntry {
    content: string;
    customVariables: CustomVariable[];
    id: string;
    createdAt: string;
    updatedAt: string;
}

export interface BranchSystemTemplateSnapshot {
    version: typeof BRANCH_SYSTEM_TEMPLATE_SNAPSHOT_VERSION;
    createdAt: string;
    createdBy: string;
    templates: Partial<Record<SystemTemplateKey, BranchSystemTemplateSnapshotEntry>>;
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
