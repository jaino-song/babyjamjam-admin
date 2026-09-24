import { createHash } from "node:crypto";

import { DOMAIN_TERMS } from "../capability-router.service";
import {
    CLARIFICATION_JUDGMENT_KEYS,
    CLARIFICATION_JUDGMENT_QUESTIONS,
    DECISION_QUESTION_CATALOG,
    DECISION_QUESTION_VERSION,
    ROUTE_DOMAIN_DESCRIPTIONS,
    ROUTE_DOMAIN_QUESTION_TEMPLATE,
    routeDomainQuestion,
} from "./decision-questions";

// Serializes with keys sorted recursively (never relying on insertion
// order) so the digest below is stable regardless of how object literals
// are written in decision-questions.ts.
function sortKeysDeep(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sortKeysDeep);
    if (value !== null && typeof value === "object") {
        const record = value as Record<string, unknown>;
        const out: Record<string, unknown> = {};
        for (const key of Object.keys(record).sort()) {
            out[key] = sortKeysDeep(record[key]);
        }
        return out;
    }
    return value;
}

function currentQuestionDigest(): { version: string; digest: string } {
    const catalogEntries: Record<string, { questionText: string; labels: readonly string[] }> = {};
    for (const kind of Object.keys(DECISION_QUESTION_CATALOG).sort()) {
        const def =
            DECISION_QUESTION_CATALOG[kind as keyof typeof DECISION_QUESTION_CATALOG];
        catalogEntries[kind] = { questionText: def.questionText, labels: def.labels };
    }

    const canonical = sortKeysDeep({
        routeDomainQuestionTemplate: ROUTE_DOMAIN_QUESTION_TEMPLATE,
        routeDomainDescriptions: ROUTE_DOMAIN_DESCRIPTIONS,
        clarificationJudgmentQuestions: CLARIFICATION_JUDGMENT_QUESTIONS,
        catalog: catalogEntries,
    });

    const digest = createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
    return { version: DECISION_QUESTION_VERSION, digest };
}

// Question text changed — bump DECISION_QUESTION_VERSION, regenerate
// evaluation evidence and stored acceptance profiles, then re-pin this
// digest. This pin exists because rewording any description/question
// while leaving the version unchanged would otherwise keep every other test
// green: an acceptance profile calibrated on the old wording would then
// silently apply to different questions.
const PINNED_QUESTION_DIGEST = {
    version: "v3",
    digest: "39503218f3dead26f869f564d8fbd1aeb81a4d265e301b46f0eb8f47473404b2",
};

describe("question text is pinned to DECISION_QUESTION_VERSION", () => {
    it("matches the pinned digest for the current question version", () => {
        expect(currentQuestionDigest()).toEqual(PINNED_QUESTION_DIGEST);
    });
});

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
