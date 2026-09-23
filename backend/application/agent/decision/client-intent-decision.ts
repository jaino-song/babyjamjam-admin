import { CLIENT_INTENTS, type ClientIntent } from "./decision-contracts";

/**
 * Trusted structural facts about the current conversation turn. Every field
 * is derived from committed server state or the finite utterance grammar —
 * never from model output. Any single fact outranks intent inference
 * (AC-09/AC-10/AC-12): trusted structure binds the turn before a classifier
 * is ever consulted.
 */
export interface ConversationTurnOwnership {
    /** The exact turn already has a durable intake/replay outcome. */
    readonly replayed: boolean;
    /** A live task owns the continuation. */
    readonly activeTask: boolean;
    /** A structured form submission binds the turn. */
    readonly formBound: boolean;
    /** A finite command utterance binds the turn. */
    readonly command: boolean;
    /** Question-like utterance: read-only handling, never a mutation. */
    readonly isQuestion: boolean;
}

export type ClientIntentDisposition = "inference-not-needed" | "create" | "update" | "read" | "abstain";

export interface ClientIntentDecision {
    readonly disposition: ClientIntentDisposition;
    /** Existing task entry point only; absent unless a write intent was mapped. */
    readonly capabilityId?: "clients.create" | "clients.update";
    /** Read handling (no write tools, no mutation). */
    readonly readOnly: boolean;
}

export interface ClientIntentDecisionInput {
    readonly intent: ClientIntent | null;
    readonly ownership: ConversationTurnOwnership;
    /** Caller-supplied offer set derived from the existing capability/task-mode gating. */
    readonly offeredTaskCapabilities: readonly ("clients.create" | "clients.update")[];
}

/**
 * Map an accepted client intent onto an existing task entry point.
 *
 * Contract: the returned object carries **no operations, no field values,
 * no approval, and no evidence**. A mapped capability id grants at most the
 * possibility of entering the existing task flow — it never proves a new
 * value ("the phone changed" is not the new phone), never confirms a target,
 * and never authorizes a mutation. `extractExplicitUserOperations` and the
 * orchestrator remain the only mutation paths. This function is pure: it
 * reads no clock, no store, and no mutable state, and mutates nothing.
 */
export function decideClientIntent(input: ClientIntentDecisionInput): ClientIntentDecision {
    const { intent, ownership, offeredTaskCapabilities } = input;
    if (ownership.replayed || ownership.activeTask || ownership.formBound || ownership.command || ownership.isQuestion) {
        // Trusted structure outranks inference; a question turn stays read-only.
        return { disposition: "inference-not-needed", readOnly: ownership.isQuestion };
    }
    // `read` is an intent category, never a capability id: read handling is
    // read-only and exposes no write entry point.
    if (intent === CLIENT_INTENTS.read) {
        return { disposition: "read", readOnly: true };
    }
    if (intent === CLIENT_INTENTS.create && offeredTaskCapabilities.includes("clients.create")) {
        return { disposition: "create", capabilityId: "clients.create", readOnly: false };
    }
    if (intent === CLIENT_INTENTS.updateRelated && offeredTaskCapabilities.includes("clients.update")) {
        return { disposition: "update", capabilityId: "clients.update", readOnly: false };
    }
    // Ambiguous/unrelated/missing intent, or the needed capability is not
    // offered, abstains: no entry point, no inference-driven write.
    return { disposition: "abstain", readOnly: false };
}
