import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
    AgentAutomationConsentInputSchema, AgentAutomationConsentSchema, AgentAutomationQuestionSchema, AgentTaskEventIdSchema,
    type AgentAutomationConsent, type AgentAutomationQuestion,
} from "@babyjamjam/shared";
import type { AgentAutomationEffect, AgentTaskAutomationState } from "domain/entities/agent-automation-consent";
import { agentBindingHash } from "domain/repositories/agent-linked-action.types";
import { agentAutomationEffectDigest, agentAutomationPolicyDigest, canonicalAgentAutomationEffects } from "./agent-automation-consent";
import { AgentAutomationEffectStorageSchema } from "./agent-automation-storage.schema";

type Evaluation = {
    effects: readonly AgentAutomationEffect[];
    availability: AgentAutomationQuestion["availability"];
    reason?: AgentAutomationQuestion["reason"];
};

function sameQuestion(left: AgentAutomationQuestion | undefined, right: AgentAutomationQuestion): boolean {
    return !!left && AgentAutomationQuestionSchema.safeParse(left).success
        && agentBindingHash(left) === agentBindingHash(right);
}

function reuseQuestion(input: Evaluation & { previous?: AgentAutomationQuestion }, effects: AgentAutomationEffect[]): AgentAutomationQuestion | null {
    const effectDigest = agentAutomationEffectDigest(effects);
    const policyDigest = agentAutomationPolicyDigest(effects);
    const parsed = AgentAutomationQuestionSchema.safeParse(input.previous);
    if (parsed.success) {
        const previous = parsed.data;
        const recipientRefs = new Map<string, string>();
        let validRefs = true;
        const aggregateRefs = [previous.questionRef, previous.recipientSetRef, previous.templateSetRef];
        const memberRefs = previous.effects.flatMap(({ effectRef, recipientRef }) => [effectRef, recipientRef]);
        const summariesMatch = previous.effects.length === effects.length && effects.every((effect, index) => {
            const summary = previous.effects[index]!;
            const previousRef = recipientRefs.get(effect.recipientDigest);
            if ((previousRef && previousRef !== summary.recipientRef)
                || (!previousRef && [...recipientRefs.values()].includes(summary.recipientRef))) validRefs = false;
            recipientRefs.set(effect.recipientDigest, summary.recipientRef);
            return effect.kind === summary.kind && effect.recipientType === summary.recipientType
                && effect.change === summary.change && effect.templateKey === summary.templateKey;
        });
        if (previous.effectDigest === effectDigest && previous.policyDigest === policyDigest
            && previous.availability === input.availability && previous.reason === input.reason && summariesMatch
            && validRefs && new Set(aggregateRefs).size === 3
            && !aggregateRefs.some((ref) => memberRefs.includes(ref))
            && !previous.effects.some(({ effectRef }) => [...recipientRefs.values()].includes(effectRef))) {
            return previous;
        }
    }
    return null;
}

/** Canonical set references remain stable only while the complete displayed impact is unchanged. */
export function createAgentAutomationQuestion(input: Evaluation & {
    previous?: AgentAutomationQuestion;
    forceNew?: boolean;
}): AgentAutomationQuestion {
    const effects = canonicalAgentAutomationEffects(input.effects.map((effect) => AgentAutomationEffectStorageSchema.parse(effect)));
    const previous = input.forceNew ? null : reuseQuestion(input, effects);
    if (previous) return previous;
    const effectDigest = agentAutomationEffectDigest(effects);
    const policyDigest = agentAutomationPolicyDigest(effects);
    const recipients = new Map<string, string>();
    return AgentAutomationQuestionSchema.parse({
        questionRef: randomUUID(), recipientSetRef: randomUUID(), templateSetRef: randomUUID(),
        availability: input.availability, ...(input.reason ? { reason: input.reason } : {}), effectDigest, policyDigest,
        effects: effects.map((effect) => {
            let recipientRef = recipients.get(effect.recipientDigest);
            if (!recipientRef) {
                recipientRef = randomUUID();
                recipients.set(effect.recipientDigest, recipientRef);
            }
            return { effectRef: randomUUID(), recipientRef, kind: effect.kind, recipientType: effect.recipientType,
                change: effect.change, templateKey: effect.templateKey };
        }),
    });
}

const unanswered = (): AgentAutomationConsent => ({ choice: "unanswered", binding: null });

const protectedStateSchema = z.object({
    version: z.literal(1), question: AgentAutomationQuestionSchema,
    effects: z.array(AgentAutomationEffectStorageSchema).max(500), noSendAtPresentation: z.boolean(),
}).strict();

/** Absence is handled by the legacy row parser; malformed present state is never legacy. */
export function parseAgentTaskAutomationState(value: unknown): AgentTaskAutomationState | null {
    const result = protectedStateSchema.safeParse(value);
    if (!result.success) return null;
    const state = result.data;
    try {
        const effects = canonicalAgentAutomationEffects(state.effects);
        return reuseQuestion({ effects, previous: state.question, availability: state.question.availability,
            reason: state.question.reason }, effects) ? { ...state, effects } : null;
    } catch {
        return null;
    }
}

export function reconcileAgentAutomationConsent(input: {
    previous?: AgentAutomationQuestion;
    current: AgentAutomationQuestion;
    consent: AgentAutomationConsent;
    previousNoSend: boolean;
    noSend: boolean;
}): AgentAutomationConsent {
    if (input.noSend) return { choice: "no", binding: null };
    if (input.previousNoSend) return unanswered();
    const parsed = AgentAutomationConsentSchema.safeParse(input.consent);
    if (!parsed.success) return unanswered();
    const consent = parsed.data;
    // An early negative answer is a constraint; only a displayed question can grant consent.
    if (!input.previous) return consent.choice === "no" ? consent : unanswered();
    if (!sameQuestion(input.previous, input.current)) return unanswered();
    if (consent.choice !== "yes") return consent;
    const binding = consent.binding!;
    return input.current.availability === "available"
        && binding.recipientRef === input.current.recipientSetRef && binding.templateRef === input.current.templateSetRef
        && binding.effectDigest === input.current.effectDigest && binding.policyDigest === input.current.policyDigest
        ? consent : unanswered();
}

export type AgentAutomationAnswerResult =
    | { status: "accepted"; consent: AgentAutomationConsent }
    | { status: "stale-question" | "question-required" | "sending-forbidden" | "automation-unavailable" };

/**
 * This binds input, not execution. The caller must ground the answer in the
 * original user event, persist under task CAS, and separately require action approval.
 */
export function answerAgentAutomationQuestion(input: {
    presented?: AgentAutomationQuestion;
    current: AgentAutomationQuestion;
    choice: AgentAutomationConsent["choice"];
    noSend: boolean;
    clientEventId: string;
}): AgentAutomationAnswerResult {
    const { choice } = AgentAutomationConsentInputSchema.parse({ choice: input.choice });
    const current = AgentAutomationQuestionSchema.parse(input.current);
    const consentEventId = AgentTaskEventIdSchema.parse(input.clientEventId);
    if (input.presented && !sameQuestion(input.presented, current)) return { status: "stale-question" };
    if (choice !== "yes") return { status: "accepted", consent: { choice: input.noSend ? "no" : choice, binding: null } };
    if (input.noSend) return { status: "sending-forbidden" };
    if (!input.presented) return { status: "question-required" };
    if (current.availability !== "available") return { status: "automation-unavailable" };
    return { status: "accepted", consent: { choice: "yes", binding: {
        recipientRef: current.recipientSetRef, templateRef: current.templateSetRef,
        effectDigest: current.effectDigest, policyDigest: current.policyDigest, consentEventId,
    } } };
}
