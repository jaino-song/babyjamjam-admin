/**
 * Offline tests for the Jev evaluation tooling. These specs exercise the
 * strict corpus parser, digest stability, leakage detection, and the metric
 * math against hand-computed expectations. No network, no credentials, no DB.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { DECISION_KINDS } from "../../application/agent/decision/decision-contracts";
import {
    DECISION_QUESTION_VERSION,
    ROUTE_DOMAIN_DESCRIPTIONS,
} from "../../application/agent/decision/decision-questions";
import {
    computeEvaluationReport,
    detectScenarioLeakage,
    JevEvaluationError,
    parseJevCorpus,
    parsePredictionsFile,
    type EvaluationReport,
    type JevCorpus,
    type JevPrediction,
    wilsonInterval95,
} from "./jev-evaluation";

const FIXTURE_PATH = resolve(__dirname, "../../../evals/agent/jev/fixtures-v1.json");

// Hand-computed with z = 1.959963984540054 (two-sided 95% normal quantile):
// wilson(k, n) center = (p + z^2/2n) / (1 + z^2/n),
// spread = (z / (1 + z^2/n)) * sqrt(p(1-p)/n + z^2/4n^2), p = k/n.
const WILSON_2_OF_3 = { lower: 0.20765960080204765, upper: 0.9385080552796037 };
const WILSON_3_OF_4 = { lower: 0.30064184258240184, upper: 0.9544127391902995 };
const WILSON_1_OF_1 = { lower: 0.20654931437723745, upper: 1 };

interface MutableCase {
    id: string;
    decisionKind: string;
    split: string;
    scenarioFamily: string;
    language: string;
    text: string;
    acceptable: string[];
    unacceptable?: string[];
    labelProvenance: string;
    notes?: string;
    state?: unknown;
}

function baseCase(overrides: Partial<MutableCase> = {}): MutableCase {
    return {
        id: "t-1",
        decisionKind: "classify-client-intent",
        split: "calibration",
        scenarioFamily: "t-family-1",
        language: "ko",
        text: "테스트 발화를 보여줘",
        acceptable: ["read"],
        labelProvenance: "synthetic-authored",
        ...overrides,
    };
}

function parseCases(cases: unknown[], domains: string[] = ["clients", "schedules"]): JevCorpus {
    return parseJevCorpus({ domains, cases });
}

function parseRaw(raw: unknown): JevCorpus {
    return parseJevCorpus(raw);
}

function expectCorpusError(action: () => unknown, expectedCaseId: string | null, messagePart?: string): JevEvaluationError {
    let caught: unknown = null;
    try {
        action();
    } catch (error) {
        caught = error;
    }
    expect(caught).toBeInstanceOf(JevEvaluationError);
    const error = caught as JevEvaluationError;
    expect(error.code).toBe("invalid-corpus");
    expect(error.caseId).toBe(expectedCaseId);
    if (messagePart !== undefined) expect(error.message).toContain(messagePart);
    return error;
}

function prediction(caseId: string, status: JevPrediction["status"], selection: string | null): JevPrediction {
    return { caseId, status, selection };
}

describe("parseJevCorpus", () => {
    it("parses the committed fixture corpus with a stable digest and question version", () => {
        const corpus = parseRaw(JSON.parse(readFileSync(FIXTURE_PATH, "utf8")));
        expect(corpus.cases.length).toBeGreaterThanOrEqual(24);
        expect(corpus.datasetDigest).toMatch(/^[0-9a-f]{64}$/);
        expect(corpus.questionVersion).toBe(DECISION_QUESTION_VERSION);
    });

    it("produces the same digest for the same content regardless of key and array order", () => {
        const raw = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as { cases: Array<Record<string, unknown>> };
        const baseline = parseRaw(raw).datasetDigest;

        const reorderedCases = [...raw.cases]
            .reverse()
            .map((entry) => {
                const reordered: Record<string, unknown> = {};
                for (const key of Object.keys(entry).reverse()) reordered[key] = entry[key];
                return reordered;
            });
        const reordered = parseRaw({ domains: ["clients", "employees", "messages", "schedules"], cases: reorderedCases });
        expect(reordered.datasetDigest).toBe(baseline);
    });

    it("produces a different digest when content changes", () => {
        const raw = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as { cases: Array<Record<string, unknown>> };
        const baseline = parseRaw(raw).datasetDigest;

        const textChanged = parseRaw({
            ...raw,
            cases: raw.cases.map((entry) => (
                entry["id"] === "intent-001" ? { ...entry, text: "김민지 산모 연락처가 바뀌었어" } : entry
            )),
        });
        expect(textChanged.datasetDigest).not.toBe(baseline);

        const labelChanged = parseRaw({
            ...raw,
            cases: raw.cases.map((entry) => (
                entry["id"] === "intent-001" ? { ...entry, acceptable: ["update_related", "ambiguous"] } : entry
            )),
        });
        expect(labelChanged.datasetDigest).not.toBe(baseline);
    });

    it("keeps every rejection typed as invalid-corpus with the offending case id", () => {
        const error = expectCorpusError(
            () => parseCases([
                baseCase({ id: "ok-1" }),
                baseCase({ id: "bad-1", split: "validate" }),
                baseCase({ id: "bad-2", scenarioFamily: "t-family-3" }),
            ]),
            "bad-1",
            "split",
        );
        expect(error.name).toBe("JevEvaluationError");
    });

    it("rejects duplicate case ids", () => {
        expectCorpusError(
            () => parseCases([baseCase({ id: "dup" }), baseCase({ id: "dup", scenarioFamily: "t-family-2" })]),
            "dup",
            "Duplicate case id",
        );
    });

    it("rejects an empty acceptable list and a missing acceptable key", () => {
        expectCorpusError(() => parseCases([baseCase({ acceptable: [] })]), "t-1", "\"acceptable\" must not be empty");
        const missing = baseCase() as Partial<MutableCase>;
        delete (missing as Record<string, unknown>)["acceptable"];
        expectCorpusError(() => parseCases([missing as MutableCase]), "t-1", "missing required key \"acceptable\"");
    });

    it("rejects labels outside the vocabulary of the case's decision kind", () => {
        expectCorpusError(
            () => parseCases([baseCase({ acceptable: ["schedule"] })]),
            "t-1",
            "not valid for decision kind \"classify-client-intent\"",
        );
        expectCorpusError(
            () => parseCases([baseCase({ decisionKind: "evaluate-clarification", acceptable: ["clarify"] })]),
            "t-1",
            "not valid for decision kind \"evaluate-clarification\"",
        );
        expectCorpusError(
            () => parseCases([baseCase({ decisionKind: "rank-candidates", acceptable: ["best"] })]),
            "t-1",
            "not valid for decision kind \"rank-candidates\"",
        );
        expectCorpusError(
            () => parseCases([baseCase({ decisionKind: "route-domains", acceptable: ["contracts"] })]),
            "t-1",
            "not valid for decision kind \"route-domains\"",
        );
    });

    it("accepts every decision kind with a valid label from its own vocabulary", () => {
        const corpus = parseCases([
            baseCase({ id: "c-intent", acceptable: ["ambiguous"], unacceptable: ["read"] }),
            baseCase({ id: "c-clarify", decisionKind: "evaluate-clarification", acceptable: ["clarification-required"], scenarioFamily: "t-family-2" }),
            baseCase({ id: "c-rank", decisionKind: "rank-candidates", acceptable: ["insufficient_evidence"], scenarioFamily: "t-family-3" }),
            baseCase({ id: "c-route", decisionKind: "route-domains", acceptable: ["clients"], unacceptable: ["schedules"], scenarioFamily: "t-family-4" }),
        ]);
        expect(corpus.cases).toHaveLength(4);
    });

    it("rejects invalid split, language, provenance, and decision kind values", () => {
        expectCorpusError(() => parseCases([baseCase({ split: "validate" })]), "t-1", "\"split\"");
        expectCorpusError(() => parseCases([baseCase({ language: "fr" })]), "t-1", "\"language\"");
        expectCorpusError(() => parseCases([baseCase({ labelProvenance: "guessed" })]), "t-1", "\"labelProvenance\"");
        expectCorpusError(() => parseCases([baseCase({ decisionKind: "classify-vibes" })]), "t-1", "\"decisionKind\"");
    });

    it("rejects a case with no label provenance", () => {
        const missing = baseCase() as Partial<MutableCase>;
        delete (missing as Record<string, unknown>)["labelProvenance"];
        expectCorpusError(() => parseCases([missing as MutableCase]), "t-1", "missing required key \"labelProvenance\"");
    });

    it("rejects intersecting acceptable and unacceptable labels", () => {
        expectCorpusError(
            () => parseCases([baseCase({ acceptable: ["read"], unacceptable: ["read"] })]),
            "t-1",
            "both acceptable and unacceptable",
        );
    });

    it("rejects duplicate labels inside one list", () => {
        expectCorpusError(
            () => parseCases([baseCase({ acceptable: ["read", "read"] })]),
            "t-1",
            "duplicate label",
        );
    });

    it("accepts a well-formed clarification state and defaults it to null when absent", () => {
        const withState = parseCases([
            baseCase({
                id: "clar-state-1",
                decisionKind: "evaluate-clarification",
                acceptable: ["clarification-not-required"],
                state: { missingFields: ["value"], targetConfirmed: true },
            }),
        ]);
        expect(withState.cases[0]?.state).toEqual({ missingFields: ["value"], targetConfirmed: true });

        const withoutState = parseCases([
            baseCase({
                id: "clar-state-2",
                decisionKind: "evaluate-clarification",
                acceptable: ["clarification-not-required"],
            }),
        ]);
        expect(withoutState.cases[0]?.state).toBeNull();
    });

    it("accepts an empty missingFields array on a clarification state", () => {
        const corpus = parseCases([
            baseCase({
                id: "clar-state-empty",
                decisionKind: "evaluate-clarification",
                acceptable: ["clarification-not-required"],
                state: { missingFields: [], targetConfirmed: false },
            }),
        ]);
        expect(corpus.cases[0]?.state).toEqual({ missingFields: [], targetConfirmed: false });
    });

    it("rejects a state field on any decision kind other than evaluate-clarification", () => {
        expectCorpusError(
            () => parseCases([
                baseCase({
                    id: "t-1",
                    state: { missingFields: [], targetConfirmed: false },
                }),
            ]),
            "t-1",
            "\"state\" is only valid for decisionKind \"evaluate-clarification\"",
        );
    });

    it("rejects malformed clarification state shapes", () => {
        const clarificationCase = (state: unknown) =>
            ({
                ...baseCase({ id: "t-1", decisionKind: "evaluate-clarification", acceptable: ["clarification-not-required"] }),
                state,
            }) as unknown as MutableCase;

        expectCorpusError(() => parseCases([clarificationCase("not-an-object")]), "t-1", "\"state\" must be a JSON object");
        expectCorpusError(() => parseCases([clarificationCase(["array"])]), "t-1", "\"state\" must be a JSON object");
        expectCorpusError(
            () => parseCases([clarificationCase({ missingFields: [] })]),
            "t-1",
            "missing required key \"targetConfirmed\"",
        );
        expectCorpusError(
            () => parseCases([clarificationCase({ targetConfirmed: false })]),
            "t-1",
            "missing required key \"missingFields\"",
        );
        expectCorpusError(
            () => parseCases([clarificationCase({ missingFields: [], targetConfirmed: false, extra: 1 })]),
            "t-1",
            "Unknown state key \"extra\"",
        );
        expectCorpusError(
            () => parseCases([clarificationCase({ missingFields: "value", targetConfirmed: false })]),
            "t-1",
            "\"state.missingFields\" must be an array of strings",
        );
        expectCorpusError(
            () => parseCases([clarificationCase({ missingFields: [""], targetConfirmed: false })]),
            "t-1",
            "\"state.missingFields\" must contain only non-empty strings",
        );
        expectCorpusError(
            () => parseCases([clarificationCase({ missingFields: ["a", "a"], targetConfirmed: false })]),
            "t-1",
            "duplicate label",
        );
        expectCorpusError(
            () => parseCases([clarificationCase({ missingFields: [], targetConfirmed: "false" })]),
            "t-1",
            "\"state.targetConfirmed\" must be a boolean",
        );
    });

    it("includes state in the dataset digest so a state-only edit changes the digest", () => {
        const baseline = parseCases([
            baseCase({
                id: "clar-digest",
                decisionKind: "evaluate-clarification",
                acceptable: ["clarification-not-required"],
                state: { missingFields: [], targetConfirmed: false },
            }),
        ]);
        const changed = parseCases([
            baseCase({
                id: "clar-digest",
                decisionKind: "evaluate-clarification",
                acceptable: ["clarification-not-required"],
                state: { missingFields: [], targetConfirmed: true },
            }),
        ]);
        expect(changed.datasetDigest).not.toBe(baseline.datasetDigest);
    });

    it("rejects unknown keys at the corpus root and inside cases", () => {
        const raw = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Record<string, unknown>;
        expectCorpusError(() => parseRaw({ ...raw, extra: true }), null, "Unknown corpus root key \"extra\"");
        expectCorpusError(() => parseCases([{ ...baseCase(), suspicious: 1 }]), "t-1", "Unknown case key \"suspicious\"");
    });

    it("rejects malformed roots and empty case lists", () => {
        expectCorpusError(() => parseRaw([baseCase()]), null, "Corpus root must be a JSON object");
        expectCorpusError(() => parseRaw("nope"), null, "Corpus root must be a JSON object");
        expectCorpusError(() => parseRaw({ cases: [baseCase()] }), null, "missing required key \"domains\"");
        expectCorpusError(
            () => parseRaw({ domains: ["clients"], cases: [] }),
            null,
            "at least one labeled case",
        );
        expectCorpusError(
            () => parseRaw({ domains: ["clients", "clients"], cases: [baseCase()] }),
            null,
            "duplicate domain",
        );
    });
});

describe("detectScenarioLeakage", () => {
    it("finds the committed fixture corpus clean", () => {
        const corpus = parseRaw(JSON.parse(readFileSync(FIXTURE_PATH, "utf8")));
        expect(detectScenarioLeakage(corpus)).toEqual([]);
    });

    it("detects families that appear in both splits and reports them sorted", () => {
        const corpus = parseCases([
            baseCase({ id: "a", scenarioFamily: "shared-family" }),
            baseCase({ id: "b", split: "holdout", scenarioFamily: "shared-family" }),
            baseCase({ id: "c", scenarioFamily: "z-shared" }),
            baseCase({ id: "d", split: "holdout", scenarioFamily: "z-shared" }),
            baseCase({ id: "e", split: "holdout", scenarioFamily: "holdout-only" }),
        ]);
        expect(detectScenarioLeakage(corpus)).toEqual(["shared-family", "z-shared"]);
    });

    it("reports an empty list when the splits are family-disjoint", () => {
        const corpus = parseCases([
            baseCase({ id: "a", scenarioFamily: "calibration-only" }),
            baseCase({ id: "b", split: "holdout", scenarioFamily: "holdout-only" }),
        ]);
        expect(detectScenarioLeakage(corpus)).toEqual([]);
    });
});

describe("computeEvaluationReport", () => {
    // Hand-computed fixture:
    //   intent cases t-1..t-6, clarification case k-1.
    //   predictions: t-1 accepted create (correct), t-2 accepted create (wrong),
    //   t-3 accepted read (correct), t-4 abstain, t-5 unavailable, t-6 missing,
    //   k-1 accepted clarification-required (correct).
    const metricCases = [
        baseCase({ id: "t-1", scenarioFamily: "f-1", acceptable: ["create"] }),
        baseCase({ id: "t-2", scenarioFamily: "f-2", acceptable: ["read"] }),
        baseCase({ id: "t-3", scenarioFamily: "f-3", acceptable: ["read"] }),
        baseCase({ id: "t-4", scenarioFamily: "f-4", acceptable: ["create"] }),
        baseCase({ id: "t-5", scenarioFamily: "f-5", acceptable: ["read"] }),
        baseCase({ id: "t-6", scenarioFamily: "f-6", acceptable: ["update_related"] }),
        baseCase({
            id: "k-1",
            decisionKind: "evaluate-clarification",
            scenarioFamily: "f-7",
            acceptable: ["clarification-required"],
        }),
    ];

    const metricPredictions: JevPrediction[] = [
        prediction("t-1", "accepted", "create"),
        prediction("t-2", "accepted", "create"),
        prediction("t-3", "accepted", "read"),
        prediction("t-4", "abstain", null),
        prediction("t-5", "unavailable", null),
        prediction("k-1", "accepted", "clarification-required"),
    ];

    function metricCorpus(): JevCorpus {
        return parseCases(metricCases);
    }

    it("matches hand-computed metrics for precision, coverage, abstention, missing, and unavailable", () => {
        const report = computeEvaluationReport(metricCorpus(), metricPredictions);

        const intent = report.byKind["classify-client-intent"];
        expect(intent.labeledCount).toBe(6);
        expect(intent.evaluatedCount).toBe(5);
        expect(intent.acceptedCount).toBe(3);
        expect(intent.abstainedCount).toBe(1);
        expect(intent.unavailableCount).toBe(1);
        expect(intent.missingPredictionCount).toBe(1);
        expect(intent.correctCount).toBe(2);
        expect(intent.precision).toBeCloseTo(2 / 3, 12);
        expect(intent.coverage).toBeCloseTo(0.5, 12);
        expect(intent.abstentionRate).toBeCloseTo(0.2, 12);
        expect(intent.precisionWilson95).not.toBeNull();

        const clarification = report.byKind["evaluate-clarification"];
        expect(clarification.labeledCount).toBe(1);
        expect(clarification.acceptedCount).toBe(1);
        expect(clarification.correctCount).toBe(1);
        expect(clarification.precision).toBe(1);
        expect(clarification.coverage).toBe(1);
        expect(clarification.abstentionRate).toBe(0);

        expect(report.overall.labeledCount).toBe(7);
        expect(report.overall.evaluatedCount).toBe(6);
        expect(report.overall.acceptedCount).toBe(4);
        expect(report.overall.abstainedCount).toBe(1);
        expect(report.overall.unavailableCount).toBe(1);
        expect(report.overall.missingPredictionCount).toBe(1);
        expect(report.overall.correctCount).toBe(3);
        expect(report.overall.precision).toBe(0.75);
        expect(report.overall.coverage).toBeCloseTo(4 / 7, 12);
        expect(report.overall.abstentionRate).toBeCloseTo(1 / 6, 12);
    });

    it("reports a 95% Wilson interval equal to hand-computed bounds", () => {
        const report = computeEvaluationReport(metricCorpus(), metricPredictions);

        expect(report.byKind["classify-client-intent"].precisionWilson95?.lower).toBeCloseTo(WILSON_2_OF_3.lower, 12);
        expect(report.byKind["classify-client-intent"].precisionWilson95?.upper).toBeCloseTo(WILSON_2_OF_3.upper, 12);
        expect(report.byKind["evaluate-clarification"].precisionWilson95?.lower).toBeCloseTo(WILSON_1_OF_1.lower, 12);
        expect(report.byKind["evaluate-clarification"].precisionWilson95?.upper).toBeCloseTo(WILSON_1_OF_1.upper, 12);
        expect(report.overall.precisionWilson95?.lower).toBeCloseTo(WILSON_3_OF_4.lower, 12);
        expect(report.overall.precisionWilson95?.upper).toBeCloseTo(WILSON_3_OF_4.upper, 12);
    });

    it("covers every decision kind, with null rates for kinds that have no labeled cases", () => {
        const report = computeEvaluationReport(metricCorpus(), metricPredictions);
        for (const kind of Object.values(DECISION_KINDS)) {
            expect(report.byKind[kind]).toBeDefined();
        }
        const rank = report.byKind["rank-candidates"];
        expect(rank.labeledCount).toBe(0);
        expect(rank.evaluatedCount).toBe(0);
        expect(rank.missingPredictionCount).toBe(0);
        expect(rank.precision).toBeNull();
        expect(rank.coverage).toBeNull();
        expect(rank.abstentionRate).toBeNull();
        expect(rank.precisionWilson95).toBeNull();

        const routing = report.byKind["route-domains"];
        expect(routing.labeledCount).toBe(0);
        expect(routing.precision).toBeNull();
    });

    it("never claims precision without an accepted denominator", () => {
        const corpus = parseCases([baseCase({ id: "only", acceptable: ["read"] })]);
        const report: EvaluationReport = computeEvaluationReport(corpus, [prediction("only", "abstain", null)]);
        expect(report.overall.acceptedCount).toBe(0);
        expect(report.overall.correctCount).toBe(0);
        expect(report.overall.precision).toBeNull();
        expect(report.overall.precisionWilson95).toBeNull();
        expect(report.overall.precision).not.toBe(1);
    });

    it("rejects a corpus with zero labeled cases", () => {
        const empty: JevCorpus = { cases: [], datasetDigest: "x", questionVersion: "v1" };
        expect(() => computeEvaluationReport(empty, [])).toThrow(JevEvaluationError);
        try {
            computeEvaluationReport(empty, []);
        } catch (error) {
            expect((error as JevEvaluationError).code).toBe("empty-corpus");
        }
    });

    it("counts baseline disagreement as selection identity, not accuracy", () => {
        const corpus = parseCases([
            baseCase({ id: "b-1", scenarioFamily: "g-1", acceptable: ["read"] }),
            baseCase({ id: "b-2", scenarioFamily: "g-2", acceptable: ["create"] }),
            baseCase({ id: "b-3", scenarioFamily: "g-3", acceptable: ["update_related"] }),
            baseCase({ id: "b-4", scenarioFamily: "g-4", acceptable: ["read"] }),
        ]);
        const jev: JevPrediction[] = [
            prediction("b-1", "accepted", "read"),
            prediction("b-2", "accepted", "create"),
            prediction("b-3", "abstain", null),
        ];
        const baseline: JevPrediction[] = [
            prediction("b-1", "accepted", "read"), // identical selection -> agree
            prediction("b-2", "abstain", null), // selection vs none -> disagree
            prediction("b-3", "accepted", "update_related"), // none vs selection -> disagree
            prediction("b-4", "accepted", "read"), // no Jev prediction -> not comparable
        ];
        const report = computeEvaluationReport(corpus, jev, baseline);

        expect(report.overall.baselineComparison).toEqual({ comparableCount: 3, agreedCount: 1, disagreedCount: 2 });
        expect(report.byKind["classify-client-intent"].baselineComparison).toEqual({
            comparableCount: 3,
            agreedCount: 1,
            disagreedCount: 2,
        });
        // Without baseline input there is no comparison at all.
        const plain = computeEvaluationReport(corpus, jev);
        expect(plain.overall.baselineComparison).toBeNull();
    });

    it("rejects malformed prediction inputs", () => {
        const corpus = metricCorpus();

        const unknownCase = [...metricPredictions, prediction("ghost", "accepted", "read")];
        expect(() => computeEvaluationReport(corpus, unknownCase)).toThrow(JevEvaluationError);
        try {
            computeEvaluationReport(corpus, unknownCase);
        } catch (error) {
            const jevError = error as JevEvaluationError;
            expect(jevError.code).toBe("invalid-predictions");
            expect(jevError.caseId).toBe("ghost");
        }

        const duplicated = [...metricPredictions, prediction("t-1", "accepted", "create")];
        expect(() => computeEvaluationReport(corpus, duplicated)).toThrow(/Duplicate prediction/);

        expect(() => computeEvaluationReport(corpus, [prediction("t-1", "accepted", null)]))
            .toThrow(/accepted but has no selection/);
        expect(() => computeEvaluationReport(corpus, [prediction("t-1", "abstain", "read")]))
            .toThrow(/a selection is only valid with status "accepted"/);
        expect(() => computeEvaluationReport(corpus, [prediction("t-1", "evaluated" as JevPrediction["status"], null)]))
            .toThrow(/must be one of/);
        expect(() => computeEvaluationReport(corpus, [prediction("t-1", "not-evaluated", null)]))
            .toThrow(/trace-only status/);
        expect(() => computeEvaluationReport(corpus, [{ ...prediction("t-1", "accepted", "read"), extra: 1 } as JevPrediction]))
            .toThrow(/Unknown prediction key/);
        expect(() => computeEvaluationReport(corpus, "not-an-array" as unknown as JevPrediction[]))
            .toThrow(/must be an array/);
    });
});

describe("parsePredictionsFile", () => {
    function predictionsCorpus(): JevCorpus {
        return { cases: [], datasetDigest: "x", questionVersion: DECISION_QUESTION_VERSION };
    }

    const predictionsArray: JevPrediction[] = [prediction("t-1", "accepted", "create")];

    it("returns the predictions array unchanged when questionVersion matches the corpus", () => {
        const raw = { questionVersion: DECISION_QUESTION_VERSION, predictions: predictionsArray };
        expect(parsePredictionsFile(raw, predictionsCorpus())).toBe(raw.predictions);
    });

    it("refuses a missing questionVersion field, naming it", () => {
        const raw = { predictions: predictionsArray };
        expect(() => parsePredictionsFile(raw, predictionsCorpus())).toThrow(JevEvaluationError);
        try {
            parsePredictionsFile(raw, predictionsCorpus());
            throw new Error("expected parsePredictionsFile to throw");
        } catch (error) {
            expect(error).toBeInstanceOf(JevEvaluationError);
            expect((error as JevEvaluationError).code).toBe("invalid-predictions");
            expect((error as Error).message).toContain("questionVersion");
        }
    });

    it("refuses a missing predictions field, naming it", () => {
        const raw = { questionVersion: DECISION_QUESTION_VERSION };
        try {
            parsePredictionsFile(raw, predictionsCorpus());
            throw new Error("expected parsePredictionsFile to throw");
        } catch (error) {
            expect(error).toBeInstanceOf(JevEvaluationError);
            expect((error as Error).message).toContain("predictions");
        }
    });

    it("refuses a stale questionVersion, naming both the file's and the corpus's version", () => {
        const raw = { questionVersion: "v1", predictions: predictionsArray };
        try {
            parsePredictionsFile(raw, predictionsCorpus());
            throw new Error("expected parsePredictionsFile to throw");
        } catch (error) {
            expect(error).toBeInstanceOf(JevEvaluationError);
            expect((error as Error).message).toContain("v1");
            expect((error as Error).message).toContain(DECISION_QUESTION_VERSION);
        }
    });

    it("refuses an unknown extra key", () => {
        const raw = { questionVersion: DECISION_QUESTION_VERSION, predictions: predictionsArray, extra: 1 };
        expect(() => parsePredictionsFile(raw, predictionsCorpus())).toThrow(/Unknown predictions file key "extra"/);
    });

    it("refuses a non-object root", () => {
        expect(() => parsePredictionsFile(null, predictionsCorpus())).toThrow(JevEvaluationError);
        expect(() => parsePredictionsFile([], predictionsCorpus())).toThrow(JevEvaluationError);
    });

    it("refuses a non-array predictions field", () => {
        const raw = { questionVersion: DECISION_QUESTION_VERSION, predictions: "not-an-array" };
        expect(() => parsePredictionsFile(raw, predictionsCorpus())).toThrow(/must be an array/);
    });
});

describe("wilsonInterval95", () => {
    it("returns null without an accepted denominator", () => {
        expect(wilsonInterval95(0, 0)).toBeNull();
    });

    it("matches hand-computed 95% bounds", () => {
        expect(wilsonInterval95(2, 3)?.lower).toBeCloseTo(WILSON_2_OF_3.lower, 12);
        expect(wilsonInterval95(2, 3)?.upper).toBeCloseTo(WILSON_2_OF_3.upper, 12);
        expect(wilsonInterval95(3, 4)?.lower).toBeCloseTo(WILSON_3_OF_4.lower, 12);
        expect(wilsonInterval95(3, 4)?.upper).toBeCloseTo(WILSON_3_OF_4.upper, 12);
    });

    it("stays inside [0, 1] at the extremes", () => {
        const allFailures = wilsonInterval95(0, 5);
        expect(allFailures?.lower).toBe(0);
        expect((allFailures?.upper ?? -1) < 1).toBe(true);
        const allSuccesses = wilsonInterval95(5, 5);
        expect(allSuccesses?.upper).toBe(1);
        expect((allSuccesses?.lower ?? 2) > 0).toBe(true);
    });
});

describe("committed fixtures-v1.json invariants", () => {
    const raw = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as { cases: Array<Record<string, unknown>> };

    it("carries a label provenance on every case", () => {
        for (const entry of raw.cases) {
            expect(typeof entry["labelProvenance"]).toBe("string");
            expect((entry["labelProvenance"] as string).length).toBeGreaterThan(0);
        }
    });

    it("covers all four decision kinds and both splits", () => {
        const corpus = parseRaw(raw);
        const kinds = new Set(corpus.cases.map((item) => item.decisionKind));
        expect([...kinds].sort()).toEqual(Object.values(DECISION_KINDS).sort());
        const splits = new Set(corpus.cases.map((item) => item.split));
        expect([...splits].sort()).toEqual(["calibration", "holdout"]);
    });

    it("keeps scenario families disjoint across splits", () => {
        const calibration = new Set<string>();
        const holdout = new Set<string>();
        for (const entry of raw.cases) {
            const family = entry["scenarioFamily"] as string;
            if (entry["split"] === "calibration") calibration.add(family);
            else holdout.add(family);
        }
        for (const family of calibration) expect(holdout.has(family)).toBe(false);
    });

    it("contains no real-looking phone numbers or long digit runs", () => {
        for (const entry of raw.cases) {
            expect(String(entry["text"])).not.toMatch(/\d{4,}/);
        }
    });

    it("uses only synthetic-name utterances with no customer data markers", () => {
        for (const entry of raw.cases) {
            const text = String(entry["text"]);
            expect(text.toLowerCase()).not.toContain("010-");
            expect(text).not.toMatch(/{{\s*EVAL_/);
        }
    });

    // run-jev-evaluation.ts uses this file's top-level `domains` array as
    // `permittedDomains` for every live routeDomains case. A domain added
    // here without a matching ROUTE_DOMAIN_DESCRIPTIONS entry would make
    // every live route-domains case fail closed with question-mismatch,
    // while fixture (non-live) mode would never notice.
    it("declares only domains that have routeDomains question text", () => {
        const domains = (raw as unknown as { domains: unknown }).domains;
        expect(Array.isArray(domains)).toBe(true);
        expect((domains as unknown[]).length).toBeGreaterThan(0);
        for (const domain of domains as unknown[]) {
            expect(typeof domain).toBe("string");
            expect(
                Object.prototype.hasOwnProperty.call(ROUTE_DOMAIN_DESCRIPTIONS, domain as string),
            ).toBe(true);
        }
    });
});
