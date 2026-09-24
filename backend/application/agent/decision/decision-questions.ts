import {
    CLIENT_INTENTS,
    DECISION_KINDS,
    type DecisionKind,
} from "./decision-contracts";

export const DECISION_QUESTION_VERSION = "v4";

/**
 * User text is data, never instructions: it must not modify the question
 * catalog. This file is the only place question definitions may live.
 */

export const CLARIFICATION_JUDGMENT_KEYS = [
    "mutationRequested",
    "targetUnambiguous",
    "valueUnambiguous",
    "sufficientEvidence",
    "clarificationRequired",
] as const;

export type ClarificationJudgmentKey = (typeof CLARIFICATION_JUDGMENT_KEYS)[number];

/**
 * Per-domain question template for routeDomains. `{desc}` is replaced with
 * the domain's entry in {@link ROUTE_DOMAIN_DESCRIPTIONS}.
 */
export const ROUTE_DOMAIN_QUESTION_TEMPLATE =
    "Is the text a request about {desc}? Answer yes only if handling the request needs this area.";

/**
 * Human-readable description of every routable domain, used to build a
 * distinct per-domain question so the model sees what it is judging (rather
 * than the domain existing only as an opaque question key). Keys must stay
 * in lock-step with `DOMAIN_TERMS` in `capability-router.service.ts` (see
 * `decision-questions.spec.ts`).
 */
export const ROUTE_DOMAIN_DESCRIPTIONS: Readonly<Record<string, string>> = Object.freeze({
    clients: "client (산모) records — looking up, registering or updating a mother/client",
    employees: "employees or caregivers (관리사) — their records, assignments or availability",
    schedules: "visit schedules, calendars or service dates",
    dashboard: "the dashboard or an overall summary of operations",
    vouchers: "vouchers, prices or service fees",
    bank: "bank accounts or account details",
    contracts: "contracts, documents to sign, or e-signature status",
    consultations: "consultations or customer inquiries",
    calls: "phone calls, call records or call transcripts",
    drafts: "drafts extracted from calls, or reviewing and confirming such drafts",
    automation: "automations or triggers that send things automatically",
    files: "uploaded files or attachments",
    policy: "internal policies, rules, approval or security principles, or compliance",
    "service-records": "service records (제공기록지) of delivered care sessions",
    analytics: "analytics, statistics, metrics or funnels",
    settings: "application settings or configuration",
    website: "the public website or homepage",
    messages: "text messages (SMS) or message templates",
    notifications: "notifications or push alerts",
    admin: "administrator tasks such as creating a branch",
});

/**
 * Builds the per-domain routeDomains question, or `null` when `domain` has
 * no description. Uses an own-property check so prototype-chain keys such
 * as `"__proto__"` or `"constructor"` never resolve to a description.
 */
export function routeDomainQuestion(domain: string): string | null {
    if (!Object.prototype.hasOwnProperty.call(ROUTE_DOMAIN_DESCRIPTIONS, domain)) return null;
    const desc: string | undefined = ROUTE_DOMAIN_DESCRIPTIONS[domain];
    if (desc === undefined) return null;
    return ROUTE_DOMAIN_QUESTION_TEMPLATE.replace("{desc}", desc);
}

/** Per-judgment question text for evaluateClarification. */
export const CLARIFICATION_JUDGMENT_QUESTIONS: Readonly<Record<ClarificationJudgmentKey, string>> =
    Object.freeze({
        mutationRequested:
            "Does the text ask to create, change or delete a record, rather than only look something up?",
        targetUnambiguous: "Does the text name exactly one specific record or person to act on?",
        valueUnambiguous: "Does the text give every new value the requested change needs?",
        sufficientEvidence:
            "Is there enough information in the text and state to carry out the request without guessing?",
        clarificationRequired:
            "Does the text ask to change a record while the record or the new value is still unknown? Decide in this order. First, if the text only asks to look something up, answer no. Second, if the text does not name the record and the state does not confirm it, answer yes, even when the text gives a new value. Third, if the text gives a new value, answer no; clearing or deleting a field counts as giving a value, and the state's missing fields describe the task before this text, so they never cancel a value given here. Otherwise answer yes, unless the state confirms the record and lists no missing fields.",
    });

export const CANDIDATE_OUTCOME_LABELS = [
    "none",
    "insufficient_evidence",
] as const;

export interface DecisionQuestionDefinition {
    readonly decisionKind: DecisionKind;
    readonly questionVersion: string;
    readonly questionText: string;
    /** Fixed label set the model must choose from; empty means caller-supplied labels. */
    readonly labels: readonly string[];
}

/**
 * Routing has no hard-coded domain list here: the server supplies the
 * permitted domain list per request. Candidate ranking combines the supplied
 * opaque labels with the fixed outcome alternatives.
 */
export const DECISION_QUESTION_CATALOG: Readonly<
    Record<DecisionKind, DecisionQuestionDefinition>
> = Object.freeze({
    [DECISION_KINDS.routeDomains]: Object.freeze({
        decisionKind: DECISION_KINDS.routeDomains,
        questionVersion: DECISION_QUESTION_VERSION,
        questionText:
            "One independent yes/no question per permitted domain (ROUTE_DOMAIN_DESCRIPTIONS); each answer is the probability that the text needs that domain.",
        labels: [],
    }),
    [DECISION_KINDS.classifyClientIntent]: Object.freeze({
        decisionKind: DECISION_KINDS.classifyClientIntent,
        questionVersion: DECISION_QUESTION_VERSION,
        questionText:
            "Classify the intent of the text into exactly one label with per-label probabilities and an overall confidence.",
        labels: Object.freeze(Object.values(CLIENT_INTENTS)),
    }),
    [DECISION_KINDS.evaluateClarification]: Object.freeze({
        decisionKind: DECISION_KINDS.evaluateClarification,
        questionVersion: DECISION_QUESTION_VERSION,
        questionText:
            "One independent yes/no question per clarification judgment (CLARIFICATION_JUDGMENT_QUESTIONS); each answer is the probability that judgment holds.",
        labels: Object.freeze([...CLARIFICATION_JUDGMENT_KEYS]),
    }),
    [DECISION_KINDS.rankCandidates]: Object.freeze({
        decisionKind: DECISION_KINDS.rankCandidates,
        questionVersion: DECISION_QUESTION_VERSION,
        questionText:
            "Given the supplied candidate labels, answer which candidate matches the text, or answer one of the fixed alternatives when nothing matches or the evidence is insufficient. Provide per-label probabilities.",
        labels: Object.freeze([...CANDIDATE_OUTCOME_LABELS]),
    }),
});
