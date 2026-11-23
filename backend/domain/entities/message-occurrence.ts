import { createHash } from "node:crypto";

export const OCCURRENCE_ALREADY_ACCEPTED = "OCCURRENCE_ALREADY_ACCEPTED";
export const OCCURRENCE_ON_HOLD = "OCCURRENCE_ON_HOLD";

export type SmsTemplateReference = { kind: "system"; key: string } | { kind: "branch"; id: string };

export interface MessageOccurrence {
    branchId: string;
    serviceClientId: number;
    recipientKind: "client" | "employee";
    recipientId: number;
    template: SmsTemplateReference;
    event?: string;
    slot?: string;
}

export function occurrenceLevels(occurrence: MessageOccurrence) {
    const { branchId, serviceClientId, recipientKind, recipientId, template, event, slot } = occurrence;
    const templateId = template.kind === "system" ? template.key : template.id;
    const shared = [branchId, serviceClientId, recipientKind, recipientId, template.kind, templateId];
    const level = (suffix: string[], eventType: string | null, slot: string | null) => ({
        branchId, occurrenceKey: createHash("sha256").update(JSON.stringify([...shared, ...suffix])).digest("hex"),
        lifecycleId: serviceClientId, recipientKind, recipientId, templateKey: `${template.kind}:${templateId}`, eventType, slot,
    });
    const levels = [level(["*"], null, null)];
    if (event) {
        levels.push(level([`event:${event}`], event, null));
        if (slot) levels.push(level([`event:${event}`, `slot:${slot}`], event, slot));
    }
    return levels;
}

export type OccurrenceAdmission = "admitted" | "accepted" | "held";
