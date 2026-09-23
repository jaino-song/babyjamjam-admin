import { DOMAIN_TERMS } from "../capability-router.service";
import {
    CLARIFICATION_JUDGMENT_KEYS,
    ROUTE_DOMAIN_DESCRIPTIONS,
    routeDomainQuestion,
} from "./decision-questions";

// The router's static domain terms and the routeDomains question
// descriptions must cover exactly the same domain set: a domain the router
// can select but that has no question text would silently fail closed at
// runtime, and a stray description with no router term would be dead code.
describe("ROUTE_DOMAIN_DESCRIPTIONS / DOMAIN_TERMS lock-step", () => {
    it("has exactly the same key set as the router's DOMAIN_TERMS", () => {
        expect(Object.keys(ROUTE_DOMAIN_DESCRIPTIONS).sort()).toEqual(
            Object.keys(DOMAIN_TERMS).sort(),
        );
    });

    // At runtime `permittedDomains` comes from
    // `enabledCapabilities.map(c => c.meta.domain)`
    // (capability-router.service.ts:93, :216), not from DOMAIN_TERMS — so
    // this is the check that actually protects runtime routing from a new
    // capability domain silently failing closed with question-mismatch.
    it("covers every capability domain declared in agent-manifest.json", () => {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const manifest = require("../../../agent-manifest.json") as {
            capabilities: readonly { domain: string }[];
        };
        const manifestDomains = new Set(manifest.capabilities.map((c) => c.domain));
        expect(manifestDomains.size).toBeGreaterThan(0);
        for (const domain of manifestDomains) {
            expect(Object.prototype.hasOwnProperty.call(ROUTE_DOMAIN_DESCRIPTIONS, domain)).toBe(
                true,
            );
        }
    });
});

describe("routeDomainQuestion", () => {
    it("returns a question that contains the domain's description for a known domain", () => {
        const question = routeDomainQuestion("clients");
        expect(question).not.toBeNull();
        expect(question).toContain(ROUTE_DOMAIN_DESCRIPTIONS["clients"]);
    });

    it("returns null for a domain with no description", () => {
        expect(routeDomainQuestion("nope")).toBeNull();
    });

    it("returns null for prototype-chain keys instead of resolving them", () => {
        expect(routeDomainQuestion("__proto__")).toBeNull();
        expect(routeDomainQuestion("constructor")).toBeNull();
    });

    it("produces a distinct question per domain", () => {
        const questions = Object.keys(ROUTE_DOMAIN_DESCRIPTIONS).map((domain) =>
            routeDomainQuestion(domain),
        );
        expect(new Set(questions).size).toBe(questions.length);
    });
});

describe("CLARIFICATION_JUDGMENT_KEYS", () => {
    it("stays in sync with the five documented judgment keys", () => {
        expect([...CLARIFICATION_JUDGMENT_KEYS].sort()).toEqual(
            [
                "mutationRequested",
                "targetUnambiguous",
                "valueUnambiguous",
                "sufficientEvidence",
                "clarificationRequired",
            ].sort(),
        );
    });
});
