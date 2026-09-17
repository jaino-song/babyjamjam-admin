import type { AgentAutomationEffect } from "domain/entities/agent-automation-consent";
import { answerAgentAutomationQuestion, createAgentAutomationQuestion, parseAgentTaskAutomationState, reconcileAgentAutomationConsent } from "./agent-automation-question";

const eventId = "74000000-0000-4000-8000-000000000001";
const hash = (letter: string) => letter.repeat(64);
function effect(ruleId: string, recipientDigest = hash("a")): AgentAutomationEffect {
    return { kind: "client-rule", ruleId, scheduleId: null, recipientType: "client", templateKey: "SERVICE_INFO",
        change: "create", recipientDigest, sourceDigest: hash("b"), templateDigest: hash("c"), policyDigest: hash("d"), recipeDigest: hash("e") };
}
const unanswered = { choice: "unanswered" as const, binding: null };

describe("server automation questions and aggregate consent", () => {
    it("strictly restores protected state and rejects substituted descriptors or public metadata", () => {
        const effects = [effect("rule-a"), effect("rule-b")];
        const question = createAgentAutomationQuestion({ effects, availability: "available" });
        const state = { version: 1 as const, question, effects, noSendAtPresentation: false };
        expect(parseAgentTaskAutomationState(JSON.parse(JSON.stringify(state)))).toEqual(state);
        expect(parseAgentTaskAutomationState({ ...state, approved: true })).toBeNull();
        expect(parseAgentTaskAutomationState({ ...state, effects: [effects[0]] })).toBeNull();
        expect(parseAgentTaskAutomationState({ ...state, effects: [effects[0], effects[0]] })).toBeNull();
        expect(parseAgentTaskAutomationState({ ...state, effects: effects.map((entry) => ({ ...entry, recipientDigest: hash("f") })) })).toBeNull();
        expect(parseAgentTaskAutomationState(null)).toBeNull();
    });

    it("preserves refs for an equivalent reordered set and binds yes to the whole set", () => {
        const effects = [effect("rule-b"), effect("rule-a", hash("f"))];
        const first = createAgentAutomationQuestion({ effects, availability: "available" });
        const current = createAgentAutomationQuestion({ effects: [...effects].reverse(), availability: "available", previous: first });
        expect(current).toEqual(first);
        expect(new Set(first.effects.map(({ recipientRef }) => recipientRef)).size).toBe(2);
        const answer = answerAgentAutomationQuestion({ presented: first, current, choice: "yes", noSend: false, clientEventId: eventId });
        expect(answer).toEqual({ status: "accepted", consent: { choice: "yes", binding: {
            recipientRef: current.recipientSetRef, templateRef: current.templateSetRef,
            effectDigest: current.effectDigest, policyDigest: current.policyDigest, consentEventId: eventId,
        } } });
        expect(first.effects.map(({ recipientRef }) => recipientRef)).not.toContain(first.recipientSetRef);
    });

    it("rejects the complete answer when any effect or availability changes", () => {
        const original = effect("rule-a");
        const first = createAgentAutomationQuestion({ effects: [original], availability: "available" });
        for (const effects of [[{ ...original, recipientDigest: hash("f") }], [{ ...original, templateDigest: hash("f") }],
            [{ ...original, policyDigest: hash("f") }], [original, effect("rule-b")], []]) {
            const current = createAgentAutomationQuestion({ effects, availability: effects.length ? "available" : "none", previous: first });
            expect(current.questionRef).not.toBe(first.questionRef);
            for (const choice of ["yes", "no"] as const) {
                expect(answerAgentAutomationQuestion({ presented: first, current, choice, noSend: false, clientEventId: eventId }))
                    .toEqual({ status: "stale-question" });
            }
        }
    });

    it("cannot mint yes from absent questions, unavailable effects or noSend", () => {
        const current = createAgentAutomationQuestion({ effects: [effect("rule-a")], availability: "available" });
        expect(answerAgentAutomationQuestion({ current, choice: "yes", noSend: false, clientEventId: eventId }))
            .toEqual({ status: "question-required" });
        expect(answerAgentAutomationQuestion({ presented: current, current, choice: "yes", noSend: true, clientEventId: eventId }))
            .toEqual({ status: "sending-forbidden" });
        const unavailable = createAgentAutomationQuestion({ effects: [], availability: "unavailable", reason: "missing-default-rules" });
        expect(answerAgentAutomationQuestion({ presented: unavailable, current: unavailable, choice: "yes", noSend: false, clientEventId: eventId }))
            .toEqual({ status: "automation-unavailable" });
        expect(answerAgentAutomationQuestion({ current: unavailable, choice: "no", noSend: false, clientEventId: eventId }))
            .toEqual({ status: "accepted", consent: { choice: "no", binding: null } });
    });

    it("retains same-impact answers, resets stale yes and never revives yes after noSend", () => {
        const question = createAgentAutomationQuestion({ effects: [effect("rule-a")], availability: "available" });
        const answer = answerAgentAutomationQuestion({ presented: question, current: question, choice: "yes", noSend: false, clientEventId: eventId });
        if (answer.status !== "accepted") throw new Error("positive control did not bind consent");
        const input = { previous: question, current: question, consent: answer.consent, noSend: false, previousNoSend: false };
        expect(reconcileAgentAutomationConsent(input)).toEqual(answer.consent);
        expect(reconcileAgentAutomationConsent({ ...input, noSend: true })).toEqual({ choice: "no", binding: null });
        expect(reconcileAgentAutomationConsent({ ...input, previousNoSend: true })).toEqual(unanswered);
        const changed = createAgentAutomationQuestion({ effects: [effect("rule-b")], availability: "available", previous: question });
        expect(reconcileAgentAutomationConsent({ ...input, current: changed })).toEqual(unanswered);
        const singleMember = { ...answer.consent, binding: { ...answer.consent.binding!, recipientRef: question.effects[0]!.recipientRef } };
        expect(reconcileAgentAutomationConsent({ ...input, consent: singleMember })).toEqual(unanswered);
    });

    it("replaces malformed presentation mappings and preserves early no without positive authority", () => {
        const effects = [effect("rule-a"), effect("rule-b")];
        const first = createAgentAutomationQuestion({ effects, availability: "available" });
        expect(first.effects[0]!.recipientRef).toBe(first.effects[1]!.recipientRef);
        const bad = { ...first, effects: first.effects.map((entry, index) => ({ ...entry, templateKey: index ? "PRICE_INFO" as const : entry.templateKey })) };
        const current = createAgentAutomationQuestion({ effects, availability: "available", previous: bad });
        expect(current.questionRef).not.toBe(first.questionRef);
        expect(reconcileAgentAutomationConsent({ current, consent: { choice: "no", binding: null }, noSend: false, previousNoSend: false }))
            .toEqual({ choice: "no", binding: null });
    });
});
