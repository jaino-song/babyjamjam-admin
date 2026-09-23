import { CLIENT_INTENTS, type ClientIntent } from "./decision-contracts";
import {
    decideClientIntent,
    type ClientIntentDecision,
    type ConversationTurnOwnership,
} from "./client-intent-decision";

const ALL_INTENTS: readonly (ClientIntent | null)[] = [
    CLIENT_INTENTS.create,
    CLIENT_INTENTS.updateRelated,
    CLIENT_INTENTS.read,
    CLIENT_INTENTS.ambiguous,
    CLIENT_INTENTS.unrelated,
    null,
];

const OFFERED_SETS: readonly { readonly offered: readonly ("clients.create" | "clients.update")[] }[] = [
    { offered: [] },
    { offered: ["clients.create"] },
    { offered: ["clients.update"] },
    { offered: ["clients.create", "clients.update"] },
];

const NO_OWNERSHIP: ConversationTurnOwnership = {
    replayed: false,
    activeTask: false,
    formBound: false,
    command: false,
    isQuestion: false,
};

const OWNERSHIP_FACTS: readonly {
    readonly fact: keyof ConversationTurnOwnership;
    readonly ownership: ConversationTurnOwnership;
}[] = [
    { fact: "replayed", ownership: { ...NO_OWNERSHIP, replayed: true } },
    { fact: "activeTask", ownership: { ...NO_OWNERSHIP, activeTask: true } },
    { fact: "formBound", ownership: { ...NO_OWNERSHIP, formBound: true } },
    { fact: "command", ownership: { ...NO_OWNERSHIP, command: true } },
    { fact: "isQuestion", ownership: { ...NO_OWNERSHIP, isQuestion: true } },
];

function expectNoCapabilityId(decision: ClientIntentDecision): void {
    expect(decision.capabilityId).toBeUndefined();
    expect(Object.keys(decision)).not.toContain("capabilityId");
}

describe("decideClientIntent", () => {
    describe("when any trusted ownership fact binds the turn", () => {
        for (const { fact, ownership } of OWNERSHIP_FACTS) {
            for (const intent of ALL_INTENTS) {
                for (const { offered } of OFFERED_SETS) {
                    it(`bypasses inference for ${fact} ownership, intent ${String(intent)}, offered: ${JSON.stringify(offered)}`, () => {
                        const decision = decideClientIntent({ intent, ownership, offeredTaskCapabilities: offered });

                        expect(decision).toEqual({
                            disposition: "inference-not-needed",
                            readOnly: fact === "isQuestion",
                        });
                        expectNoCapabilityId(decision);
                    });
                }
            }
        }
    });

    describe("when no ownership fact binds the turn (inference is needed)", () => {
        it("maps read intent to read-only handling with no capability id regardless of the offer set", () => {
            for (const { offered } of OFFERED_SETS) {
                const decision = decideClientIntent({
                    intent: CLIENT_INTENTS.read,
                    ownership: NO_OWNERSHIP,
                    offeredTaskCapabilities: offered,
                });

                expect(decision).toEqual({ disposition: "read", readOnly: true });
                expectNoCapabilityId(decision);
            }
        });

        it("maps create intent to the existing clients.create entry point only when it is offered", () => {
            for (const { offered } of OFFERED_SETS) {
                const decision = decideClientIntent({
                    intent: CLIENT_INTENTS.create,
                    ownership: NO_OWNERSHIP,
                    offeredTaskCapabilities: offered,
                });

                if (offered.includes("clients.create")) {
                    expect(decision).toEqual({
                        disposition: "create",
                        capabilityId: "clients.create",
                        readOnly: false,
                    });
                } else {
                    expect(decision).toEqual({ disposition: "abstain", readOnly: false });
                    expectNoCapabilityId(decision);
                }
            }
        });

        it("maps update_related intent to the existing clients.update entry point only when it is offered", () => {
            for (const { offered } of OFFERED_SETS) {
                const decision = decideClientIntent({
                    intent: CLIENT_INTENTS.updateRelated,
                    ownership: NO_OWNERSHIP,
                    offeredTaskCapabilities: offered,
                });

                if (offered.includes("clients.update")) {
                    expect(decision).toEqual({
                        disposition: "update",
                        capabilityId: "clients.update",
                        readOnly: false,
                    });
                } else {
                    expect(decision).toEqual({ disposition: "abstain", readOnly: false });
                    expectNoCapabilityId(decision);
                }
            }
        });

        it("abstains on ambiguous, unrelated, and missing intents regardless of the offer set", () => {
            for (const intent of [CLIENT_INTENTS.ambiguous, CLIENT_INTENTS.unrelated, null]) {
                for (const { offered } of OFFERED_SETS) {
                    const decision = decideClientIntent({ intent, ownership: NO_OWNERSHIP, offeredTaskCapabilities: offered });

                    expect(decision).toEqual({ disposition: "abstain", readOnly: false });
                    expectNoCapabilityId(decision);
                }
            }
        });
    });

    it("is pure: it never mutates its arguments and repeats deterministically", () => {
        const ownership: ConversationTurnOwnership = { ...NO_OWNERSHIP };
        const offered: ("clients.create" | "clients.update")[] = ["clients.create", "clients.update"];
        const ownershipSnapshot = JSON.stringify(ownership);
        const offeredSnapshot = JSON.stringify(offered);

        const first = decideClientIntent({ intent: CLIENT_INTENTS.create, ownership, offeredTaskCapabilities: offered });
        const second = decideClientIntent({ intent: CLIENT_INTENTS.create, ownership, offeredTaskCapabilities: offered });

        expect(ownership).toEqual(NO_OWNERSHIP);
        expect(JSON.stringify(ownership)).toBe(ownershipSnapshot);
        expect(JSON.stringify(offered)).toBe(offeredSnapshot);
        expect(second).toEqual(first);

        // Frozen inputs make any attempted mutation throw in strict mode.
        expect(() => decideClientIntent({
            intent: CLIENT_INTENTS.updateRelated,
            ownership: Object.freeze({ ...NO_OWNERSHIP }),
            offeredTaskCapabilities: Object.freeze(["clients.update"] as const),
        })).not.toThrow();
    });

    it("carries no operations, field values, approval, or evidence on any decision", () => {
        for (const intent of ALL_INTENTS) {
            for (const ownership of [NO_OWNERSHIP, ...OWNERSHIP_FACTS.map(({ ownership: value }) => value)]) {
                const decision = decideClientIntent({
                    intent,
                    ownership,
                    offeredTaskCapabilities: ["clients.create", "clients.update"],
                });
                expect(Object.keys(decision).sort()).toEqual(
                    decision.capabilityId === undefined
                        ? ["disposition", "readOnly"]
                        : ["capabilityId", "disposition", "readOnly"],
                );
            }
        }
    });
});
