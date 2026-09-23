import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CandidateEvidence } from "./decision-contracts";
import {
    MAX_CANDIDATE_PROJECTIONS,
    buildClientCandidateRequest,
    validateCandidateSuggestion,
    type CandidateStructuralFacts,
    type ClientCandidateRequestBuild,
} from "./client-candidate-decision";

const REVISION = "rev-2026-09-23T10:00:00+09:00";

const WINDOWS = [
    { field: "startDate" as const, label: "march-2026", fromIso: "2026-03-01", toIso: "2026-03-31" },
    { field: "birthDate" as const, label: "born-2020", fromIso: "2020-01-01", toIso: "2020-12-31" },
];

const CANDIDATES: readonly CandidateStructuralFacts[] = [
    { clientRef: "client-a", serviceType: "pilates", dates: { startDate: "2026-03-10" } },
    { clientRef: "client-b", serviceType: "pt", dates: {} },
    { clientRef: "client-c", serviceType: null, dates: { birthDate: "2020-01-05" } },
];

function buildFixture(
    overrides: Partial<Parameters<typeof buildClientCandidateRequest>[0]> = {},
): ClientCandidateRequestBuild {
    return buildClientCandidateRequest({
        choiceSetRevision: REVISION,
        candidates: [...CANDIDATES],
        windows: WINDOWS.map((window) => ({ ...window })),
        referenceDateIso: "2026-03-15",
        ...overrides,
    });
}

function evidenceFixture(overrides: Partial<CandidateEvidence> = {}): CandidateEvidence {
    return {
        kind: "rank-candidates",
        status: "accepted",
        questionVersion: "q-fixture",
        requestedModel: "jev-fixture",
        returnedModel: "jev-fixture",
        latencyMs: 5,
        providerRequestId: null,
        failureReason: null,
        usage: null,
        outcome: "match",
        suggestion: "C1",
        choiceSetRevision: REVISION,
        probabilities: { C1: 0.9, C2: 0.05, C3: 0.05 },
        ...overrides,
    };
}

function validateFixture(
    overrides: {
        build?: ClientCandidateRequestBuild;
        evidence?: CandidateEvidence | null;
        thresholds?: { readonly acceptProbability: number; readonly minMargin: number };
    } = {},
): ReturnType<typeof validateCandidateSuggestion> {
    return validateCandidateSuggestion({
        build: overrides.build ?? buildFixture(),
        evidence: overrides.evidence === undefined ? evidenceFixture() : overrides.evidence,
        thresholds: overrides.thresholds ?? { acceptProbability: 0.7, minMargin: 0.1 },
    });
}

describe("buildClientCandidateRequest", () => {
    it("projects the caller's order with positional labels C1..Cn and echoes the revision exactly (AC-23)", () => {
        const build = buildFixture();

        expect(build.request.candidates.map((candidate) => candidate.label)).toEqual(["C1", "C2", "C3"]);
        expect(build.request.choiceSetRevision).toBe(REVISION);
        expect(Object.keys(build.request)).toEqual(["choiceSetRevision", "candidates"]);
    });

    it("never derives labels from data: reversing the caller order reverses only the label-to-reference map", () => {
        const forward = buildFixture();
        const reversed = buildFixture({ candidates: [...CANDIDATES].reverse() });

        expect(forward.labelToRef.get("C1")).toBe("client-a");
        expect(reversed.labelToRef.get("C1")).toBe("client-c");
        expect(reversed.request.candidates.map((candidate) => candidate.label)).toEqual(["C1", "C2", "C3"]);
    });

    it("emits the closed fact vocabulary deterministically: service type, raw ISO date, then locally computed windows", () => {
        const build = buildFixture();

        expect(build.request.candidates.map((candidate) => candidate.facts)).toEqual([
            ["service-type=pilates", "startDate=2026-03-10", "startDate-window:march-2026=within"],
            ["service-type=pt"],
            ["birthDate=2020-01-05", "birthDate-window:born-2020=within"],
        ]);
    });

    it("computes window membership locally with inclusive bounds", () => {
        const build = buildFixture({
            candidates: [
                { clientRef: "first-day", serviceType: null, dates: { startDate: "2026-03-01" } },
                { clientRef: "last-day", serviceType: null, dates: { startDate: "2026-03-31" } },
                { clientRef: "day-before", serviceType: null, dates: { startDate: "2026-02-28" } },
                { clientRef: "day-after", serviceType: null, dates: { startDate: "2026-04-01" } },
            ],
            windows: [WINDOWS[0]!],
        });

        const facts = build.request.candidates.map((candidate) => candidate.facts);
        expect(facts[0]).toContain("startDate-window:march-2026=within");
        expect(facts[1]).toContain("startDate-window:march-2026=within");
        expect(facts[2]).toContain("startDate-window:march-2026=outside");
        expect(facts[3]).toContain("startDate-window:march-2026=outside");
    });

    it("reports outside purely from the data: the request carries no utterance or free text channel", () => {
        const build = buildFixture({
            candidates: [{ clientRef: "late", serviceType: null, dates: { startDate: "2026-04-02" } }],
        });

        expect(build.request.candidates[0]?.facts).toContain("startDate-window:march-2026=outside");
        const serialized = JSON.stringify(build.request);
        expect(serialized).not.toContain("utterance");
        expect(serialized).not.toContain("redactedText");
    });

    it("produces no window fact for a missing date field and no date fact for an unparseable date", () => {
        const build = buildFixture({
            candidates: [
                { clientRef: "birth-only", serviceType: null, dates: { birthDate: "2020-01-05" } },
                { clientRef: "broken-date", serviceType: null, dates: { startDate: "2026-13-40" } },
            ],
        });

        expect(build.request.candidates[0]?.facts).toEqual(["birthDate=2020-01-05", "birthDate-window:born-2020=within"]);
        expect(JSON.stringify(build.request.candidates[0]?.facts)).not.toContain("startDate-window");
        expect(build.request.candidates[1]?.facts).toEqual([]);
    });

    it("omits every window fact when the reference date is unparseable: comparisons are never delegated", () => {
        const build = buildFixture({ referenceDateIso: "not-a-date" });

        for (const candidate of build.request.candidates) {
            expect(candidate.facts.some((fact) => fact.includes("-window:"))).toBe(false);
        }
    });

    it("omits the service-type fact when the value is not a machine token (free text is never disclosed)", () => {
        const build = buildFixture({
            candidates: [
                {
                    clientRef: "free-text-service",
                    serviceType: "Pilates with 김강사 010-1234-5678",
                    dates: {},
                },
                { clientRef: "token-service", serviceType: "pilates", dates: {} },
            ],
        });

        expect(build.request.candidates[0]?.facts).toEqual([]);
        expect(build.request.candidates[1]?.facts).toEqual(["service-type=pilates"]);
    });

    it("caps at ten candidates, reports the reduction, and preserves the caller's order", () => {
        const supplied: CandidateStructuralFacts[] = Array.from({ length: MAX_CANDIDATE_PROJECTIONS + 1 }, (_, index) => ({
            clientRef: `ref-${index}`,
            serviceType: null,
            dates: {},
        }));

        const build = buildFixture({ candidates: supplied });

        expect(build.request.candidates).toHaveLength(MAX_CANDIDATE_PROJECTIONS);
        expect(build.request.candidates.map((candidate) => candidate.label)).toEqual(
            Array.from({ length: MAX_CANDIDATE_PROJECTIONS }, (_, index) => `C${index + 1}`),
        );
        expect(build.request.candidates.map((candidate) => build.labelToRef.get(candidate.label))).toEqual(
            supplied.slice(0, MAX_CANDIDATE_PROJECTIONS).map((candidate) => candidate.clientRef),
        );
        expect(build.droppedCandidateCount).toBe(1);
    });

    it("reports no reduction when the shortlist fits the cap", () => {
        expect(buildFixture().droppedCandidateCount).toBe(0);
    });

    it("never serializes client references: labelToRef is internal to the build, not part of the request", () => {
        const build = buildFixture();

        expect("labelToRef" in build.request).toBe(false);
        for (const candidate of build.request.candidates) {
            expect(Object.keys(candidate)).toEqual(["label", "facts"]);
        }
        // The mapping still exists internally so validation can resolve labels.
        expect(build.labelToRef.get("C1")).toBe("client-a");
    });

    it("keeps identifying data out of the serialized request even when the caller supplies it", () => {
        const identifyingValues = [
            "client-9d2c1",
            "tenant-7f3a9",
            "01012345678",
            "김지노",
            "테헤란로 123",
        ];
        const build = buildFixture({
            candidates: [
                {
                    // Worst case: the caller puts raw identifiers in the opaque reference slots.
                    clientRef: "client-9d2c1",
                    serviceType: null,
                    dates: { startDate: "2026-03-10" },
                },
                {
                    clientRef: "01012345678",
                    serviceType: null,
                    dates: { birthDate: "2020-01-05" },
                },
            ],
        });

        const serialized = JSON.stringify(build.request);
        for (const value of identifyingValues) {
            expect(serialized).not.toContain(value);
        }
        expect(serialized).not.toContain("clientRef");
        expect(serialized).not.toContain("tenant");
    });

    it("is pure: frozen inputs are not mutated and repeated builds are identical", () => {
        const input = Object.freeze({
            choiceSetRevision: REVISION,
            candidates: Object.freeze(CANDIDATES.map((candidate) => Object.freeze({ ...candidate, dates: Object.freeze({ ...candidate.dates }) }))),
            windows: Object.freeze(WINDOWS.map((window) => Object.freeze({ ...window }))),
            referenceDateIso: "2026-03-15",
        }) as Parameters<typeof buildClientCandidateRequest>[0];

        const first = buildClientCandidateRequest(input);
        const second = buildClientCandidateRequest(input);

        expect(JSON.stringify(second)).toBe(JSON.stringify(first));
        expect(first.labelToRef.get("C1")).toBe("client-a");
    });
});

describe("validateCandidateSuggestion", () => {
    it("suggests only an existing option: the returned reference comes from the caller's input set (AC-21)", () => {
        const build = buildFixture();

        for (const candidate of CANDIDATES) {
            const label = [...build.labelToRef.entries()].find(([, ref]) => ref === candidate.clientRef)?.[0];
            expect(label).toBeDefined();
            // Evidence that clearly favors the label under test.
            const probabilities = Object.fromEntries(
                [...build.labelToRef.keys()].map((other) => [other, other === label ? 0.9 : 0.05]),
            );
            const result = validateFixture({ evidence: evidenceFixture({ suggestion: label, probabilities }) });

            expect(result).toEqual({ outcome: "suggested", clientRef: candidate.clientRef, label });
            expect(CANDIDATES.some((option) => option.clientRef === result.clientRef)).toBe(true);
        }
    });

    it("returns invalid-label for a fabricated or unknown label, with no reference fields (AC-21)", () => {
        for (const suggestion of ["C99", "C0", "client-a", "", "c1"]) {
            const result = validateFixture({ evidence: evidenceFixture({ suggestion }) });

            expect(result).toEqual({ outcome: "invalid-label" });
            expect("clientRef" in result).toBe(false);
            expect("label" in result).toBe(false);
        }
    });

    it("returns invalid-label when a match outcome carries no suggestion at all", () => {
        const result = validateFixture({ evidence: evidenceFixture({ suggestion: null, probabilities: {} }) });

        expect(result).toEqual({ outcome: "invalid-label" });
    });

    it("rejects a stale or cross-set revision before consulting the label (AC-24)", () => {
        const result = validateFixture({
            evidence: evidenceFixture({ choiceSetRevision: "rev-other", suggestion: "C1" }),
        });

        expect(result).toEqual({ outcome: "stale-revision" });
    });

    it("rejects a label from a different set as invalid (AC-24)", () => {
        // C11 exists only in a hypothetical larger set; this build's map is C1..C3.
        const result = validateFixture({ evidence: evidenceFixture({ suggestion: "C11" }) });

        expect(result).toEqual({ outcome: "invalid-label" });
    });

    it("returns the provider's no-match and insufficient-evidence outcomes verbatim, never a suggestion", () => {
        const none = validateFixture({ evidence: evidenceFixture({ outcome: "none" }) });
        const insufficient = validateFixture({
            evidence: evidenceFixture({ outcome: "insufficient_evidence" }),
        });

        expect(none).toEqual({ outcome: "none" });
        expect(insufficient).toEqual({ outcome: "insufficient_evidence" });
    });

    it("returns no-evidence with no suggestion when evidence is null (not evaluated, abstained, or provider failure)", () => {
        const result = validateFixture({ evidence: null });

        expect(result).toEqual({ outcome: "no-evidence" });
        expect("clientRef" in result).toBe(false);
        expect("label" in result).toBe(false);
    });

    it("applies the caller-supplied accept probability threshold", () => {
        const below = validateFixture({
            evidence: evidenceFixture({ probabilities: { C1: 0.5, C2: 0.3, C3: 0.2 } }),
        });
        const missing = validateFixture({
            evidence: evidenceFixture({ probabilities: {} }),
        });

        expect(below).toEqual({ outcome: "below-threshold" });
        // A missing probability fails closed to 0 and can never pass.
        expect(missing).toEqual({ outcome: "below-threshold" });
    });

    it("applies the caller-supplied minimum margin to the runner-up, including a tie", () => {
        const narrow = validateFixture({
            evidence: evidenceFixture({ probabilities: { C1: 0.8, C2: 0.75, C3: 0.05 } }),
        });
        const tie = validateFixture({
            evidence: evidenceFixture({ probabilities: { C1: 0.9, C2: 0.9, C3: 0.0 } }),
        });

        expect(narrow).toEqual({ outcome: "below-threshold" });
        expect(tie).toEqual({ outcome: "below-threshold" });
    });

    it("suggests when probability and margin both clear the thresholds, even for a single-candidate set", () => {
        const build = buildFixture({
            candidates: [{ clientRef: "only-option", serviceType: "pilates", dates: {} }],
        });
        const result = validateFixture({
            build,
            evidence: evidenceFixture({ suggestion: "C1", probabilities: { C1: 0.9 } }),
        });

        expect(result).toEqual({ outcome: "suggested", clientRef: "only-option", label: "C1" });
    });

    it("respects the evaluation order: stale revision outranks outcome and label checks", () => {
        const staleAndNone = validateFixture({
            evidence: evidenceFixture({ choiceSetRevision: "rev-other", outcome: "none" }),
        });
        const noneWithBadLabel = validateFixture({
            evidence: evidenceFixture({ outcome: "none", suggestion: "C99" }),
        });

        expect(staleAndNone).toEqual({ outcome: "stale-revision" });
        expect(noneWithBadLabel).toEqual({ outcome: "none" });
    });

    it("is side-effect free: frozen inputs are accepted unchanged and repeated validations agree", () => {
        const build = buildFixture();
        const evidence = Object.freeze(evidenceFixture());
        const thresholds = Object.freeze({ acceptProbability: 0.7, minMargin: 0.1 });

        const first = validateCandidateSuggestion({ build, evidence, thresholds });
        const second = validateCandidateSuggestion({ build, evidence, thresholds });

        expect(second).toEqual(first);
        expect(first).toEqual({ outcome: "suggested", clientRef: "client-a", label: "C1" });
        expect(Object.keys(first).sort()).toEqual(["clientRef", "label", "outcome"]);
    });
});

describe("client-candidate-decision module surface (AC-22)", () => {
    const source = readFileSync(join(__dirname, "client-candidate-decision.ts"), "utf8");

    it("contains no select-target reference and no mutation call", () => {
        expect(source).not.toMatch(/select[-_]?target/i);
        expect(source).not.toMatch(/\.(save|update|delete|upsert|create|createMany|updateMany|deleteMany)\(/);
    });

    it("imports only the decision port contract types — no task service, orchestrator, runtime, façade, or Nest module", () => {
        const importSpecifiers = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);

        expect(importSpecifiers.sort()).toEqual(["./agent-decision.port", "./decision-contracts"]);
        expect(source).not.toMatch(/@nestjs/);
        expect(source).not.toMatch(/prisma/i);
        expect(source).not.toMatch(/orchestrator/i);
    });

    it("is fully synchronous: no async, no await, no promise — no I/O or write path is expressible", () => {
        expect(source).not.toMatch(/\basync\b/);
        expect(source).not.toMatch(/\bawait\b/);
        expect(source).not.toMatch(/Promise</);
    });

    it("exports only advice: two pure functions and vocabulary constants — no executor", () => {
        const exported = require("./client-candidate-decision") as Record<string, unknown>;

        expect(Object.keys(exported).sort()).toEqual([
            "CANDIDATE_FACT_KINDS",
            "MAX_CANDIDATE_PROJECTIONS",
            "buildClientCandidateRequest",
            "validateCandidateSuggestion",
        ]);
        expect(typeof exported["buildClientCandidateRequest"]).toBe("function");
        expect(typeof exported["validateCandidateSuggestion"]).toBe("function");
    });
});
