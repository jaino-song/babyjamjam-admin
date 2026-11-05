import { normalizeEformsignStatusCode, normalizeEformsignStepType } from "../utils/eformsign-status-code";
import type { ContractMilestone, RecordMilestone } from "./manual-backup-scope";

type Projection =
    | { readonly kind: "contract"; readonly currentMilestone: ContractMilestone | null; readonly reasonCodes: readonly string[] }
    | { readonly kind: "record"; readonly currentMilestone: RecordMilestone | null; readonly reasonCodes: readonly string[] };

/** Positive evidence for the current stage only; export terminal codes are a separate policy. */
export function projectManualBackupMilestone(input: {
    kind: "contract" | "record"; statusType: string; stepType: string; stepIndex: string; voidedAt: Date | null;
}): Projection {
    const { kind } = input;
    if (input.voidedAt !== null) return { kind, currentMilestone: null, reasonCodes: ["voided", "stage-unverified"] };
    const status = normalizeEformsignStatusCode(input.statusType);
    const reasonCodes = status === "071" ? ["reviewer-rejected"] : [];
    if (status === "001" || status === "002") return { kind, currentMilestone: "created", reasonCodes };
    if (status === "003" || status === "050") return { kind, currentMilestone: "completed", reasonCodes };
    if (status === "072") return { kind, currentMilestone: "reviewed", reasonCodes };
    if (kind === "record") {
        if (status === "062") return { kind, currentMilestone: "completed", reasonCodes };
        if (["030", "060", "063", "034", "064", "070", "071"].includes(status)) return { kind, currentMilestone: "sent", reasonCodes };
    } else {
        if (["062", "070", "071"].includes(status)) return { kind, currentMilestone: "signed", reasonCodes };
        // Existing workflow evidence: the provider review step follows customer signature.
        const staffStep = normalizeEformsignStepType(input.stepType) === "06" || input.stepIndex.trim() === "3";
        if (status === "060" && staffStep) return { kind, currentMilestone: "signed", reasonCodes };
        if (["034", "064"].includes(status)) return { kind, currentMilestone: staffStep ? "signed" : "opened", reasonCodes };
        if (["030", "060", "063"].includes(status)) return { kind, currentMilestone: "sent", reasonCodes };
    }
    return { kind, currentMilestone: null, reasonCodes: ["stage-unverified"] };
}
