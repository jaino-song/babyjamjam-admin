import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ClarificationAdvice } from "./decision-policy";
import {
    CLARIFICATION_DECISION_REASONS,
    decideClarification,
    type ClarificationDecision,
    type ClarificationFacts,
} from "./clarification-decision";

const TASK_REVISION = 7;

/** No missing fields, no block, no accepted input, nothing asked yet. */
const CLEAN_FACTS: ClarificationFacts = {
    taskRevision: TASK_REVISION,
    missingFields: [],
    targetConfirmed: true,
    hasAcceptedUserInput: false,
    mutationBlocked: false,
    clarificationAskedAtRevision: null,
};

const ADVICE_CASES: readonly (ClarificationAdvice | null)[] = [
    null,
    { recommendClarification: true },
    { recommendClarification: false },
];

const MISSING_FIELD_SETS: ReadonlyArray<readonly string[]> = [
    ["phoneNumber"],
    ["phoneNumber", "guardianContact"],
];

const ASKED_REVISION_CASES: readonly (number | null)[] = [
    null,
    TASK_REVISION,
    TASK_REVISION - 1,
];

function expectClosedShape(decision: ClarificationDecision): void {
    expect(Object.keys(decision).sort()).toEqual([
        "deterministicRecovery",
        "reason",
        "recommendClarification",
        "suppressModelMutation",
    ]);
    expect(CLARIFICATION_DECISION_REASONS).toContain(decision.reason);
}

function allFactCombinations(): ClarificationFacts[] {
    const combinations: ClarificationFacts[] = [];
    const missingFieldSets: ReadonlyArray<readonly string[]> = [[], ...MISSING_FIELD_SETS];
    for (const missingFields of missingFieldSets) {
        for (const targetConfirmed of [true, false]) {
            for (const hasAcceptedUserInput of [true, false]) {
                for (const mutationBlocked of [true, false]) {
                    for (const askedAt of ASKED_REVISION_CASES) {
                        combinations.push({
                            taskRevision: TASK_REVISION,
                            missingFields,
                            targetConfirmed,
                            hasAcceptedUserInput,
                            mutationBlocked,
                            clarificationAskedAtRevision: askedAt,
                        });
                    }
                }
            }
        }
    }
    return combinations;
}

describe("decideClarification", () => {
    describe("rule 1: missing required fields own the turn (deterministic recovery, AC-18)", () => {
        it("ignores advice entirely whenever required fields are missing", () => {
            for (const missingFields of MISSING_FIELD_SETS) {
                for (const advice of ADVICE_CASES) {
                    for (const targetConfirmed of [true, false]) {
                        const decision = decideClarification({
                            facts: { ...CLEAN_FACTS, missingFields, targetConfirmed },
                            advice,
                        });

                        expect(decision).toEqual({
                            recommendClarification: false,
                            suppressModelMutation: true,
                            deterministicRecovery: true,
                            reason: "deterministic-recovery",
                        });
                        expectClosedShape(decision);
                    }
                }
            }
        });
    });

    describe("rule 2: an existing mutation block is never cleared (AC-19)", () => {
        it("always suppresses model mutation while blocked, regardless of advice", () => {
            for (const advice of ADVICE_CASES) {
                const decision = decideClarification({
                    facts: { ...CLEAN_FACTS, mutationBlocked: true },
                    advice,
                });

                expect(decision.suppressModelMutation).toBe(true);
                expect(decision.deterministicRecovery).toBe(false);
                expect(decision.reason).toBe("mutation-blocked");
                // The block may not erase the advice; advice may only add a
                // question on top of the suppressed turn.
                expect(decision.recommendClarification).toBe(advice?.recommendClarification === true);
            }
        });
    });

    describe("rule 3: accepted user input is retained", () => {
        it("never suppresses a turn whose explicit input was accepted, even when advice recommends asking", () => {
            for (const advice of ADVICE_CASES) {
                const decision = decideClarification({
                    facts: { ...CLEAN_FACTS, hasAcceptedUserInput: true },
                    advice,
                });

                expect(decision.suppressModelMutation).toBe(false);
                expect(decision.deterministicRecovery).toBe(false);
                expect(decision.reason).toBe("accepted-input-retained");
                expect(decision.recommendClarification).toBe(advice?.recommendClarification === true);
            }
        });
    });

    describe("rule 4: no repeated-question loop (AC-20)", () => {
        it("declines to ask the same clarification twice at the same task revision", () => {
            const decision = decideClarification({
                facts: { ...CLEAN_FACTS, clarificationAskedAtRevision: TASK_REVISION },
                advice: { recommendClarification: true },
            });

            expect(decision).toEqual({
                recommendClarification: false,
                suppressModelMutation: false,
                deterministicRecovery: false,
                reason: "already-asked",
            });
            expectClosedShape(decision);
        });

        it("re-allows advice once the task has moved to a different revision", () => {
            for (const askedAt of ASKED_REVISION_CASES) {
                const decision = decideClarification({
                    facts: { ...CLEAN_FACTS, clarificationAskedAtRevision: askedAt },
                    advice: { recommendClarification: true },
                });

                if (askedAt === TASK_REVISION) {
                    expect(decision).toEqual({
                        recommendClarification: false,
                        suppressModelMutation: false,
                        deterministicRecovery: false,
                        reason: "already-asked",
                    });
                } else {
                    expect(decision).toEqual({
                        recommendClarification: true,
                        suppressModelMutation: false,
                        deterministicRecovery: false,
                        reason: "advice-accepted",
                    });
                }
            }
        });
    });

    describe("rule 5: unavailable advice preserves current recovery", () => {
        it("changes nothing when advice is null: no recommendation, no suppression", () => {
            const decision = decideClarification({ facts: CLEAN_FACTS, advice: null });

            expect(decision).toEqual({
                recommendClarification: false,
                suppressModelMutation: false,
                deterministicRecovery: false,
                reason: "advice-unavailable",
            });
            expectClosedShape(decision);
        });
    });

    describe("rule 6: accepted advice adds exactly one question on clean facts", () => {
        it("asks a useful clarification: advice true on clean facts", () => {
            const decision = decideClarification({
                facts: CLEAN_FACTS,
                advice: { recommendClarification: true },
            });

            expect(decision).toEqual({
                recommendClarification: true,
                suppressModelMutation: false,
                deterministicRecovery: false,
                reason: "advice-accepted",
            });
        });

        it("allows continuation: advice false on clean facts asks nothing and suppresses nothing", () => {
            const decision = decideClarification({
                facts: CLEAN_FACTS,
                advice: { recommendClarification: false },
            });

            expect(decision).toEqual({
                recommendClarification: false,
                suppressModelMutation: false,
                deterministicRecovery: false,
                reason: "advice-accepted",
            });
        });
    });

    describe("global invariants over the full input space", () => {
        const FACTS = allFactCombinations();

        it("exhaustively: no combination relaxes deterministic recovery while fields are missing (AC-18)", () => {
            for (const facts of FACTS) {
                if (facts.missingFields.length === 0) continue;
                for (const advice of ADVICE_CASES) {
                    const decision = decideClarification({ facts, advice });

                    expect(decision.deterministicRecovery).toBe(true);
                    expect(decision.suppressModelMutation).toBe(true);
                    expect(decision.recommendClarification).toBe(false);
                    expect(decision.reason).toBe("deterministic-recovery");
                }
            }
        });

        it("exhaustively: no combination clears a mutation block while blocked (AC-19)", () => {
            for (const facts of FACTS) {
                if (!facts.mutationBlocked) continue;
                for (const advice of ADVICE_CASES) {
                    const decision = decideClarification({ facts, advice });

                    expect(decision.suppressModelMutation).toBe(true);
                }
            }
        });

        it("exhaustively: accepted input is never suppressed unless a pre-existing deterministic rule owns the turn", () => {
            for (const facts of FACTS) {
                if (!facts.hasAcceptedUserInput) continue;
                if (facts.missingFields.length > 0) continue;
                for (const advice of ADVICE_CASES) {
                    const decision = decideClarification({ facts, advice });

                    // Suppression may only originate from the caller's own
                    // pre-existing block, never from advice or this helper.
                    expect(decision.suppressModelMutation).toBe(facts.mutationBlocked);
                }
            }
        });

        it("exhaustively: reasons stay inside the closed vocabulary and the output keeps exactly four keys", () => {
            expect([...CLARIFICATION_DECISION_REASONS]).toEqual([
                "advice-accepted",
                "advice-unavailable",
                "deterministic-recovery",
                "mutation-blocked",
                "accepted-input-retained",
                "already-asked",
            ]);

            for (const facts of FACTS) {
                for (const advice of ADVICE_CASES) {
                    expectClosedShape(decideClarification({ facts, advice }));
                }
            }
        });
    });

    describe("purity", () => {
        it("returns deep-equal results for repeated calls and mutates neither input nor output", () => {
            const sampleInputs: readonly {
                readonly facts: ClarificationFacts;
                readonly advice: ClarificationAdvice | null;
            }[] = [
                { facts: CLEAN_FACTS, advice: { recommendClarification: true } },
                { facts: { ...CLEAN_FACTS, missingFields: ["phoneNumber"] }, advice: { recommendClarification: true } },
                { facts: { ...CLEAN_FACTS, mutationBlocked: true }, advice: null },
                { facts: { ...CLEAN_FACTS, hasAcceptedUserInput: true }, advice: { recommendClarification: false } },
                { facts: { ...CLEAN_FACTS, clarificationAskedAtRevision: TASK_REVISION }, advice: { recommendClarification: true } },
            ];

            for (const input of sampleInputs) {
                const frozenFacts: ClarificationFacts = Object.freeze({
                    ...input.facts,
                    missingFields: Object.freeze([...input.facts.missingFields]),
                });
                const frozenAdvice: ClarificationAdvice | null =
                    input.advice === null ? null : Object.freeze({ ...input.advice });
                const factsSnapshot = JSON.stringify(frozenFacts);
                const adviceSnapshot = JSON.stringify(frozenAdvice);

                const first = decideClarification({ facts: frozenFacts, advice: frozenAdvice });
                const second = decideClarification({ facts: frozenFacts, advice: frozenAdvice });

                expect(second).toEqual(first);
                expect(first).not.toBe(second);
                expect(JSON.stringify(frozenFacts)).toBe(factsSnapshot);
                expect(JSON.stringify(frozenAdvice)).toBe(adviceSnapshot);
            }
        });

        it("throws nowhere on frozen inputs and keeps decisions independent across calls", () => {
            const frozenFacts: ClarificationFacts = Object.freeze({ ...CLEAN_FACTS });
            expect(() => decideClarification({
                facts: frozenFacts,
                advice: Object.freeze({ recommendClarification: true }),
            })).not.toThrow();

            // One call's advice does not leak into a later call's decision.
            const asked = decideClarification({
                facts: Object.freeze({ ...CLEAN_FACTS, clarificationAskedAtRevision: TASK_REVISION }),
                advice: { recommendClarification: true },
            });
            expect(asked.recommendClarification).toBe(false);
        });

        it("contains no clock, randomness, environment, or IO in the module source", () => {
            const source = readFileSync(join(__dirname, "clarification-decision.ts"), "utf8");

            expect(source).not.toMatch(/\bDate\b/);
            expect(source).not.toMatch(/Math\.random/);
            expect(source).not.toMatch(/\bperformance\b/);
            expect(source).not.toMatch(/process\.env/);
            expect(source).not.toMatch(/console\./);
        });
    });
});
