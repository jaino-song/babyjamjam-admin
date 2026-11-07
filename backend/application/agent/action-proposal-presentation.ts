import { AgentActionPreviewSchema } from "@babyjamjam/shared";
import type { AgentActionEntity } from "domain/entities/agent-action.entity";
import { redactModelValue } from "./agent-model-redaction";

function redactApprovalValue(value: unknown, key = ""): unknown {
    if (Array.isArray(value)) return value.map((item) => redactApprovalValue(item, key));
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value as Record<string, unknown>)
            .filter(([nestedKey]) => !/(?:token|secret|password|signedurl|documentcontent|storageurl)/i.test(nestedKey.replace(/[^a-z0-9]/gi, "")))
            .map(([nestedKey, nestedValue]) => [nestedKey, redactApprovalValue(nestedValue, nestedKey)]));
    }
    if (typeof value === "string" && /(?:phone|mobile|receiver|account|accnum)/i.test(key.replace(/[^a-z0-9]/gi, ""))) {
        const digits = value.replace(/\D/g, "");
        return digits.length >= 4 ? `••••${digits.slice(-4)}` : "[masked]";
    }
    return value;
}


/** UI-only snapshot. Credentials and acknowledgement tokens never belong in persisted cards. */
export function buildActionProposalPresentation(
    action: AgentActionEntity,
    fallbackDescription = action.capability,
    onInvalidPreview?: (warning: string) => void,
) {
    const stored = action.proposal["preview"];
    const parsed = stored === undefined ? undefined : AgentActionPreviewSchema.safeParse(stored);
    if (parsed && !parsed.success) {
        onInvalidPreview?.(`agent action ${action.id} (${action.capability}) has a stored approval preview that failed validation; omitting it from the proposal part`);
    }
    return {
        actionId: action.id,
        capability: action.capability,
        title: typeof action.proposal["title"] === "string" ? action.proposal["title"] : fallbackDescription,
        summary: typeof action.proposal["summary"] === "string" ? action.proposal["summary"] : fallbackDescription,
        expiresAt: action.expiresAt.toISOString(),
        expectedRevision: action.proposalRevision,
        risk: action.risk,
        branchId: action.branchId,
        ...(action.targetSnapshot ? { target: redactModelValue(action.targetSnapshot) as Record<string, unknown> } : {}),
        changes: redactApprovalValue(action.proposal["input"]) as Record<string, unknown>,
        ...(typeof action.proposal["provider"] === "string" ? { provider: action.proposal["provider"] } : {}),
        ...(typeof action.proposal["estimatedCost"] === "string" ? { estimatedCost: action.proposal["estimatedCost"] } : {}),
        ...(parsed?.success ? { preview: parsed.data } : {}),
    };
}
