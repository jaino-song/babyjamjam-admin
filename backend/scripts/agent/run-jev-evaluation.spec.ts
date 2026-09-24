/**
 * Tests for the Jev evaluation runner CLI (Task 9.1).
 *
 * Fixture-mode specs prove the network-free guarantee with a fetch stub that
 * throws on any call (plus a global fetch guard). Live-mode specs prove the
 * refusal gates with precise messages and zero provider calls, and prove the
 * success path entirely through the SDK's injected fetch seam — no test
 * touches the network and no real credential is ever read.
 *
 * Evidence-bridge specs prove the offline report → jev-evidence-v1
 * conversion end-to-end: the emitted document parses under the readiness
 * checker's own strict schema and, with a synthetic attestation and a
 * synthetic profile fixture, reaches ready:true through the checker's own
 * evaluation. Every attestation count in this file is SYNTHETIC and labelled
 * as such — none of it is production evidence.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { Fetch } from "@typesafe-ai/sdk";

import { CLIENT_WRITE_FIELD_NAMES } from "@babyjamjam/shared";
import { buildRedactedDecisionText } from "../../application/agent/decision/decision-input";
import { DECISION_KINDS } from "../../application/agent/decision/decision-contracts";
import { DECISION_QUESTION_VERSION } from "../../application/agent/decision/decision-questions";
import {
    PINNED_MODEL_ID,
} from "../../infrastructure/agent/typesafe-jev-decision.service";
import {
    EVIDENCE_REPORT_SCHEMA_VERSION,
    evaluateJevReadiness,
    parseEvidenceReport,
    READINESS_REASONS,
    RELEASE_PROFILE_SCHEMA_VERSION,
} from "./check-jev-readiness";
import {
    ATTESTATION_SCHEMA_VERSION,
    CLARIFICATION_BINARIZATION_THRESHOLD,
    computeLiveDeadline,
    EVAL_DIR_RELATIVE,
    LIVE_CONSENT_FLAG,
    LIVE_CONSENT_VALUE,
    LIVE_DEADLINE_MS,
    RUBRIC_FILENAME,
    runJevEvaluation,
    type JevRunOptions,
    type JevRunReport,
    type JevRunResult,
} from "./run-jev-evaluation";

const FIXTURE_PATH = resolve(__dirname, "../../../evals/agent/jev/fixtures-v1.json");
const RUBRIC_PATH = resolve(__dirname, "../../../evals/agent/jev/judge-rubric-v1.json");
const WORKFLOW_PATH = resolve(__dirname, "../../../.github/workflows/agent-evals.yml");
const DRAFT_PROFILE_PATH = resolve(__dirname, "../../../evals/agent/jev/release-profile-v1.json");

const FIXED_NOW = new Date("2026-09-23T00:00:00.000Z");
const LATER_NOW = new Date("2026-09-23T12:34:56.789Z");
const CANARY_KEY = "canary-secret-api-key-do-not-leak";
const TEST_ENV: Record<string, string> = {
    TYPESAFE_API_KEY: CANARY_KEY,
    TYPESAFE_BASE_URL: "https://typesafe.test",
};

const RAW_FIXTURE = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as {
    domains: string[];
    cases: Array<{
        id: string;
        labelProvenance: string;
        text: string;
        decisionKind: string;
        split: string;
        state?: { missingFields: string[]; targetConfirmed: boolean };
    }>;
};
const RAW_CASES_BY_ID = new Map(RAW_FIXTURE.cases.map((item) => [item.id, item]));
const CORPUS_TEXTS = new Set(RAW_FIXTURE.cases.map((item) => item.text));
const FULL_KIND_COUNTS: Record<string, number> = {};
for (const item of RAW_FIXTURE.cases) {
    FULL_KIND_COUNTS[item.decisionKind] = (FULL_KIND_COUNTS[item.decisionKind] ?? 0) + 1;
}
const HOLDOUT_COUNT = RAW_FIXTURE.cases.filter((item) => item.split === "holdout").length;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let workDir: string | null = null;

function newWorkDir(): string {
    workDir = mkdtempSync(join(tmpdir(), "jev-run-spec-"));
    return workDir;
}

afterEach(() => {
    if (workDir !== null) {
        rmSync(workDir, { recursive: true, force: true });
        workDir = null;
    }
});

/** Fetch stub that fails the test if anything ever calls it. */
function throwingFetch(): { fetch: Fetch; calls: string[] } {
    const calls: string[] = [];
    const fetch: Fetch = (url) => {
        calls.push(String(url));
        throw new Error(`provider transport must never be reached (saw ${String(url)})`);
    };
    return { fetch, calls };
}

/** Request body shape captured by {@link liveStubFetch}, loose enough to cover every decision kind's `state`. */
interface CapturedRequestBody {
    readonly state?: {
        readonly text?: string;
        readonly missingFields?: readonly string[];
        readonly targetConfirmed?: boolean;
    };
    readonly questions: Record<string, { type?: string; criteria?: Record<string, unknown> }>;
}

/**
 * Generic live stub: answers every noul question with 0.5 and every choice
 * question with the first criteria label at argmax, so the whole fixture
 * corpus completes through the production adapter deterministically. Every
 * request body is captured verbatim in `bodies` so a test can assert exactly
 * what state/text the adapter sent, without re-parsing `init.body` itself.
 */
function liveStubFetch(): { fetch: Fetch; calls: string[]; bodies: CapturedRequestBody[] } {
    const calls: string[] = [];
    const bodies: CapturedRequestBody[] = [];
    const fetch: Fetch = async (url, init) => {
        calls.push(String(url));
        const body = JSON.parse(String(init?.body ?? "{}")) as CapturedRequestBody;
        bodies.push(body);
        const answers: Record<string, unknown> = {};
        for (const [key, question] of Object.entries(body.questions)) {
            if (question.type === "choice") {
                const labels = Object.keys(question.criteria ?? {});
                const probabilities: Record<string, number> = {};
                for (const label of labels) probabilities[label] = 0.5;
                const chosen = labels[0] ?? "";
                probabilities[chosen] = 0.9;
                answers[key] = { type: "choice", choice: chosen, confidence: 0.9, probabilities };
            } else {
                answers[key] = { type: "noul", noul: 0.5 };
            }
        }
        return new Response(
            JSON.stringify({
                answers,
                model: PINNED_MODEL_ID,
                usage: { input_tokens: 11, output_tokens: 7 },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
        );
    };
    return { fetch, calls, bodies };
}

function requireOk(result: JevRunResult): Extract<JevRunResult, { ok: true }> {
    if (!result.ok) throw new Error(`expected an ok run, got [${result.errorCode}] ${result.message}`);
    return result;
}

function requireRefusal(result: JevRunResult): Extract<JevRunResult, { ok: false }> {
    if (result.ok) throw new Error("expected a refusal but the run succeeded");
    return result;
}

function fixtureOptions(output: string, overrides: Partial<JevRunOptions> = {}): JevRunOptions {
    return {
        mode: "fixture",
        input: FIXTURE_PATH,
        output,
        now: () => FIXED_NOW,
        env: { ...TEST_ENV },
        fetchImpl: throwingFetch().fetch,
        ...overrides,
    };
}

function liveOptions(output: string, overrides: Partial<JevRunOptions> = {}): JevRunOptions {
    return {
        mode: "live",
        input: FIXTURE_PATH,
        output,
        consent: LIVE_CONSENT_VALUE,
        now: () => FIXED_NOW,
        env: { ...TEST_ENV },
        ...overrides,
    };
}

function writeCorpusVariant(dir: string, name: string, mutate: (root: {
    domains: string[];
    cases: Array<Record<string, unknown>>;
}) => void): string {
    const root = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as {
        domains: string[];
        cases: Array<Record<string, unknown>>;
    };
    mutate(root);
    const path = join(dir, name);
    writeFileSync(path, JSON.stringify(root, null, 2), "utf8");
    return path;
}

function readReport(path: string): JevRunReport {
    return JSON.parse(readFileSync(path, "utf8")) as JevRunReport;
}

// ---------------------------------------------------------------------------
// Evidence-bridge helpers (all counts SYNTHETIC, labelled as such)
// ---------------------------------------------------------------------------

function writeJsonFile(dir: string, name: string, value: unknown): string {
    const path = join(dir, name);
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    return path;
}

/**
 * Synthetic attestation fixture. The comparison counts are invented for the
 * tests: "none" fits a fixture run (nothing evaluated, so nothing comparable),
 * "all" fits a fully-evaluated live-stub run. None of this is real evidence.
 */
function syntheticAttestation(comparisons: "none" | "all"): Record<string, unknown> {
    const perKind: Record<string, { agreedCount: number; comparableCount: number }> = {};
    for (const [kind, count] of Object.entries(FULL_KIND_COUNTS)) {
        perKind[kind] = comparisons === "all"
            ? { agreedCount: count, comparableCount: count }
            : { agreedCount: 0, comparableCount: 0 };
    }
    return {
        schemaVersion: ATTESTATION_SCHEMA_VERSION,
        attestedBy: "synthetic spec operator (not a real person)",
        attestedAt: "2026-09-23",
        modelId: PINNED_MODEL_ID,
        holdoutSplit: { present: true, caseCount: HOLDOUT_COUNT },
        humanReference: { present: true, caseCount: RAW_FIXTURE.cases.length },
        humanReferenceComparisons: perKind,
        notes: "SYNTHETIC spec fixture — invented counts for tests only, never production evidence.",
    };
}

/** Writes an attestation variant and runs a fixture-mode evidence conversion, expecting a refusal. */
async function fixtureEvidenceRefusal(
    dir: string,
    name: string,
    mutate: (root: Record<string, unknown>) => void,
): Promise<Extract<JevRunResult, { ok: false }>> {
    const root = syntheticAttestation("none");
    mutate(root);
    const attestationPath = writeJsonFile(dir, name, root);
    return requireRefusal(await runJevEvaluation(fixtureOptions(join(dir, `report-${name}.json`), {
        evidenceOut: join(dir, `evidence-${name}.json`),
        attestation: attestationPath,
    })));
}

// ---------------------------------------------------------------------------
// Fixture mode
// ---------------------------------------------------------------------------

describe("fixture mode", () => {
    it("exits 0, writes the versioned report envelope with the dataset digest, and never calls fetch", async () => {
        const dir = newWorkDir();
        const output = join(dir, "report.json");
        const guard = throwingFetch();

        // Belt and braces: even a global fetch must blow up if fixture mode
        // ever tried to reach anything.
        const originalFetch = globalThis.fetch;
        globalThis.fetch = (() => {
            throw new Error("global fetch must never be called in fixture mode");
        }) as typeof fetch;
        let result: JevRunResult;
        try {
            result = await runJevEvaluation(fixtureOptions(output, { fetchImpl: guard.fetch }));
        } finally {
            globalThis.fetch = originalFetch;
        }

        const ok = requireOk(result);
        expect(ok.exitCode).toBe(0);
        expect(existsSync(output)).toBe(true);
        expect(guard.calls).toEqual([]);

        const report = readReport(output);
        expect(report.schemaVersion).toBe(1);
        expect(report.mode).toBe("fixture");
        expect(report.model).toBeNull();
        expect(report.datasetDigest).toMatch(/^[0-9a-f]{64}$/);
        expect(report.generatedAt).toBe(FIXED_NOW.toISOString());
        expect(report.rubricVersion).toBe("judge-rubric-v1");
        expect(report.evaluatedCaseCount).toBe(RAW_FIXTURE.cases.length);
        expect(Object.keys(report.summary.byKind).sort()).toEqual(Object.values(DECISION_KINDS).sort());
        expect(report.cases).toHaveLength(RAW_FIXTURE.cases.length);
        expect(report.live).toBeNull();
    });

    it("fabricates no model scores: every prediction is null and precision/coverage are null", async () => {
        const dir = newWorkDir();
        const output = join(dir, "report.json");
        const ok = requireOk(await runJevEvaluation(fixtureOptions(output)));
        const report = ok.report;

        expect(report.summary.overall.labeledCount).toBe(RAW_FIXTURE.cases.length);
        expect(report.summary.overall.evaluatedCount).toBe(0);
        expect(report.summary.overall.acceptedCount).toBe(0);
        expect(report.summary.overall.precision).toBeNull();
        // Coverage is accepted/labeled = 0 by the 3.2 math; precision stays
        // null because there is no accepted denominator to claim.
        expect(report.summary.overall.coverage).toBe(0);
        expect(report.summary.overall.precisionWilson95).toBeNull();
        for (const kind of Object.values(DECISION_KINDS)) {
            expect(report.summary.byKind[kind].precision).toBeNull();
        }
        for (const entry of report.cases) {
            expect(entry.prediction).toBeNull();
            expect(entry.scores).toBeNull();
        }
        // Reference labels are the corpus labels, untouched.
        const byId = new Map(report.cases.map((entry) => [entry.id, entry]));
        for (const raw of RAW_FIXTURE.cases) {
            const entry = byId.get(raw.id);
            expect(entry).toBeDefined();
            expect(entry?.reference.labelProvenance).toBe("synthetic-authored");
        }
    });

    it("is byte-stable for a fixed corpus and clock; only generatedAt varies", async () => {
        const dir = newWorkDir();
        const first = join(dir, "first.json");
        const second = join(dir, "second.json");
        const third = join(dir, "third.json");

        await runJevEvaluation(fixtureOptions(first));
        await runJevEvaluation(fixtureOptions(second, { now: () => new Date(FIXED_NOW) }));
        await runJevEvaluation(fixtureOptions(third, { now: () => LATER_NOW }));

        expect(readFileSync(first, "utf8")).toBe(readFileSync(second, "utf8"));

        const stable = readFileSync(first, "utf8");
        const shifted = readFileSync(third, "utf8");
        expect(shifted).not.toBe(stable);
        const normalized = shifted.replace(LATER_NOW.toISOString(), FIXED_NOW.toISOString());
        expect(normalized).toBe(stable);
    });

    it("certifies the clean fixture corpus (no scenario leakage) and the full dataset digest", async () => {
        const dir = newWorkDir();
        const ok = requireOk(await runJevEvaluation(fixtureOptions(join(dir, "report.json"))));
        expect(ok.report.summary.corpus.scenarioLeakage).toEqual([]);
        expect(ok.report.summary.corpus.byProvenance).toEqual({ "synthetic-authored": RAW_FIXTURE.cases.length });
        expect(ok.report.summary.corpus.byKind).toEqual(FULL_KIND_COUNTS);
    });

    it("supports --max-cases truncation while keeping the full-corpus digest", async () => {
        const dir = newWorkDir();
        const ok = requireOk(await runJevEvaluation(
            fixtureOptions(join(dir, "report.json"), { maxCases: 3 }),
        ));
        expect(ok.report.maxCases).toBe(3);
        expect(ok.report.evaluatedCaseCount).toBe(3);
        expect(ok.report.cases).toHaveLength(3);
        expect(ok.report.datasetCaseCount).toBe(RAW_FIXTURE.cases.length);
        const full = requireOk(await runJevEvaluation(fixtureOptions(join(dir, "full.json"))));
        expect(ok.report.datasetDigest).toBe(full.report.datasetDigest);
    });
});

// ---------------------------------------------------------------------------
// Live mode refusals
// ---------------------------------------------------------------------------

describe("live mode refusals", () => {
    it("refuses without the explicit operator consent", async () => {
        const dir = newWorkDir();
        const guard = throwingFetch();
        const result = requireRefusal(await runJevEvaluation(liveOptions(
            join(dir, "report.json"),
            { consent: undefined, fetchImpl: guard.fetch },
        )));
        expect(result.errorCode).toBe("consent-required");
        expect(result.message).toContain(LIVE_CONSENT_FLAG);
        expect(result.message).toContain("never reused");
        expect(guard.calls).toEqual([]);
    });

    it("refuses a wrong consent value", async () => {
        const dir = newWorkDir();
        const guard = throwingFetch();
        const result = requireRefusal(await runJevEvaluation(liveOptions(
            join(dir, "report.json"),
            { consent: "yes", fetchImpl: guard.fetch },
        )));
        expect(result.errorCode).toBe("consent-required");
        expect(result.message).toContain(LIVE_CONSENT_FLAG);
        expect(guard.calls).toEqual([]);
    });

    it("refuses without TYPESAFE_API_KEY", async () => {
        const dir = newWorkDir();
        const guard = throwingFetch();
        const result = requireRefusal(await runJevEvaluation(liveOptions(
            join(dir, "report.json"),
            {
                env: { TYPESAFE_BASE_URL: "https://typesafe.test" },
                fetchImpl: guard.fetch,
            },
        )));
        expect(result.errorCode).toBe("missing-api-key");
        expect(result.message).toContain("TYPESAFE_API_KEY");
        expect(guard.calls).toEqual([]);
    });

    it("refuses a moving model alias", async () => {
        const dir = newWorkDir();
        const guard = throwingFetch();
        const result = requireRefusal(await runJevEvaluation(liveOptions(
            join(dir, "report.json"),
            { model: "jev-latest", fetchImpl: guard.fetch },
        )));
        expect(result.errorCode).toBe("model-not-pinned");
        expect(result.message).toContain("jev-latest");
        expect(result.message).toContain(PINNED_MODEL_ID);
        expect(result.message).toContain("moving aliases");
        expect(guard.calls).toEqual([]);
    });

    it("refuses a corpus with non-synthetic provenance, naming the case", async () => {
        const dir = newWorkDir();
        const guard = throwingFetch();
        const corpus = writeCorpusVariant(dir, "mixed-provenance.json", (root) => {
            const first = root.cases[0];
            if (first) first["labelProvenance"] = "human-reviewed";
        });
        const result = requireRefusal(await runJevEvaluation(liveOptions(
            join(dir, "report.json"),
            { input: corpus, fetchImpl: guard.fetch },
        )));
        expect(result.errorCode).toBe("provenance-not-synthetic");
        expect(result.message).toContain(RAW_FIXTURE.cases[0]?.id ?? "");
        expect(result.message).toContain("human-reviewed");
        expect(result.message).toContain("synthetic-only");
        expect(guard.calls).toEqual([]);
    });

    it("refuses an input outside evals/agent/jev/", async () => {
        const dir = newWorkDir();
        const guard = throwingFetch();
        const corpus = writeCorpusVariant(dir, "outside.json", () => undefined);
        const result = requireRefusal(await runJevEvaluation(liveOptions(
            join(dir, "report.json"),
            { input: corpus, fetchImpl: guard.fetch },
        )));
        expect(result.errorCode).toBe("input-outside-eval-dir");
        expect(result.message).toContain(EVAL_DIR_RELATIVE);
        expect(result.message).toContain(resolve(corpus));
        expect(guard.calls).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// Live mode success (injected fetch stub)
// ---------------------------------------------------------------------------

describe("live mode with an injected fetch stub", () => {
    it("runs every case through the production adapter and records the live section", async () => {
        const dir = newWorkDir();
        const output = join(dir, "live-report.json");
        const stub = liveStubFetch();

        const ok = requireOk(await runJevEvaluation(liveOptions(output, { fetchImpl: stub.fetch })));
        const report = ok.report;

        expect(stub.calls).toHaveLength(RAW_FIXTURE.cases.length);
        for (const url of stub.calls) {
            expect(url.startsWith("https://typesafe.test/")).toBe(true);
        }

        expect(report.mode).toBe("live");
        expect(report.model).toBe(PINNED_MODEL_ID);
        expect(report.live).not.toBeNull();
        expect(report.live?.model).toBe(PINNED_MODEL_ID);
        expect(report.live?.perKindCalls).toEqual({
            "route-domains": FULL_KIND_COUNTS["route-domains"],
            "classify-client-intent": FULL_KIND_COUNTS["classify-client-intent"],
            "evaluate-clarification": FULL_KIND_COUNTS["evaluate-clarification"],
            "rank-candidates": FULL_KIND_COUNTS["rank-candidates"],
        });
        // The stub answers every question validly, so nothing failed.
        expect(report.live?.failures).toEqual([]);
        expect(report.live?.perKindUnavailable).toEqual({
            "route-domains": 0,
            "classify-client-intent": 0,
            "evaluate-clarification": 0,
            "rank-candidates": 0,
        });
        expect(report.live?.perKindAccepted).toEqual(report.live?.perKindCalls);

        // Deterministic stub answers map to the documented conventions:
        // intent → first criteria label (create), routing → first domain by
        // argmax (clients), clarification → 0.5 binarizes to
        // clarification-required, rank → first criteria (a candidate) means
        // the outcome token match.
        const byId = new Map(report.cases.map((entry) => [entry.id, entry]));
        expect(byId.get("intent-001")?.prediction).toMatchObject({
            status: "accepted",
            selection: "create",
            failureReason: null,
        });
        expect(byId.get("route-001")?.prediction).toMatchObject({
            status: "accepted",
            selection: "clients",
        });
        expect(byId.get("clarify-001")?.prediction).toMatchObject({
            status: "accepted",
            selection: "clarification-required",
        });
        expect(byId.get("rank-001")?.prediction).toMatchObject({
            status: "accepted",
            selection: "match",
        });
        // Scores live in their own field, separate from reference labels.
        expect(byId.get("clarify-002")?.scores).toMatchObject({
            type: "evaluate-clarification",
            judgments: { clarificationRequired: CLARIFICATION_BINARIZATION_THRESHOLD },
        });
        expect(byId.get("intent-001")?.reference.acceptable).toEqual(["update_related"]);
    });

    it("passes each clarification case's declared state through to the live request, defaulting when the case declares none, with the runtime's own text redaction applied", async () => {
        const dir = newWorkDir();
        const output = join(dir, "live-report.json");
        const stub = liveStubFetch();

        requireOk(await runJevEvaluation(liveOptions(output, { fetchImpl: stub.fetch })));

        // Only evaluate-clarification requests carry missingFields/targetConfirmed
        // in `state` (typesafe-jev-decision.service.ts:434-438); other kinds'
        // state shapes never include targetConfirmed, so this filter isolates
        // exactly the clarification calls. `selected`/`stub.bodies` both
        // iterate the corpus in file order (run-jev-evaluation.ts's
        // `for (const item of selected)`), so zipping the clarification
        // cases against the clarification bodies by position pairs each
        // case with its own request deterministically — text alone can no
        // longer key this map now that the request carries redacted, not
        // raw, text.
        const clarificationCases = RAW_FIXTURE.cases.filter((item) => item.decisionKind === "evaluate-clarification");
        const clarificationBodies = stub.bodies
            .filter((body) => typeof body.state?.targetConfirmed === "boolean")
            .map((body) => body.state);
        expect(clarificationBodies.length).toBe(FULL_KIND_COUNTS["evaluate-clarification"]);
        expect(clarificationBodies.length).toBe(clarificationCases.length);
        const stateByCaseId = new Map(clarificationCases.map((item, index) => [item.id, clarificationBodies[index]]));

        // The request's `state.text` is the runtime's own redaction
        // (`buildRedactedDecisionText`, decision-input.ts) applied to the
        // case's raw text with no known values — never the raw corpus text.
        for (const item of clarificationCases) {
            expect(stateByCaseId.get(item.id)?.text).toBe(buildRedactedDecisionText(item.text, []));
        }

        // clarify-006 declares an explicit state in the corpus
        // (targetConfirmed: true, no proposed change still missing) — the
        // live request must carry it verbatim, not the harness's old
        // hardcoded targetConfirmed: false.
        const case006 = RAW_CASES_BY_ID.get("clarify-006");
        expect(case006?.state).toEqual({ missingFields: [], targetConfirmed: true });
        expect(stateByCaseId.get("clarify-006")).toEqual({
            text: buildRedactedDecisionText(case006?.text ?? "", []),
            missingFields: [],
            targetConfirmed: true,
        });

        // clarify-007: target confirmed but no proposed change was given
        // this turn — `deriveMissingFields` (agent-runtime.service.ts)
        // reports the full CLIENT_WRITE_FIELD_NAMES set in that state, not
        // an invented field-shaped token like "value".
        const case007 = RAW_CASES_BY_ID.get("clarify-007");
        expect(case007?.state?.missingFields).toEqual(CLIENT_WRITE_FIELD_NAMES);
        expect(case007?.state?.targetConfirmed).toBe(true);
        expect(stateByCaseId.get("clarify-007")).toEqual({
            text: buildRedactedDecisionText(case007?.text ?? "", []),
            missingFields: CLIENT_WRITE_FIELD_NAMES,
            targetConfirmed: true,
        });

        // clarify-004 is a pure lookup with no client-write task at all, so
        // it declares no state — the request must fall back to the
        // documented default (missingFields: [], targetConfirmed: false),
        // so cases authored before this field existed evaluate unchanged.
        const case004 = RAW_CASES_BY_ID.get("clarify-004");
        expect(case004?.state).toBeUndefined();
        expect(stateByCaseId.get("clarify-004")).toEqual({
            text: buildRedactedDecisionText(case004?.text ?? "", []),
            missingFields: [],
            targetConfirmed: false,
        });
    });

    it("shares the fixture report shape so both modes are comparable", async () => {
        const dir = newWorkDir();
        const fixture = requireOk(await runJevEvaluation(
            fixtureOptions(join(dir, "fixture.json"), { fetchImpl: liveStubFetch().fetch }),
        )).report;
        const live = requireOk(await runJevEvaluation(liveOptions(
            join(dir, "live.json"),
            { fetchImpl: liveStubFetch().fetch },
        ))).report;

        expect(Object.keys(live)).toEqual(Object.keys(fixture));
        expect(Object.keys(live.summary)).toEqual(Object.keys(fixture.summary));
        expect(Object.keys(live.summary.overall)).toEqual(Object.keys(fixture.summary.overall));
        expect(Object.keys(live.summary.byKind)).toEqual(Object.keys(fixture.summary.byKind));
        expect(live.datasetDigest).toBe(fixture.datasetDigest);
        expect(live.rubricVersion).toBe(fixture.rubricVersion);
        expect(live.summary.questionVersion).toBe(fixture.summary.questionVersion);

        // The live metrics flow through the same 3.2 math.
        expect(live.summary.overall.labeledCount).toBe(fixture.summary.overall.labeledCount);
        expect(live.summary.overall.evaluatedCount).toBe(RAW_FIXTURE.cases.length);
        expect(live.summary.overall.missingPredictionCount).toBe(0);
        expect(live.summary.overall.precision).not.toBeNull();
    });

    it("keeps serialization safe: no credential material and only synthetic corpus text", async () => {
        const dir = newWorkDir();
        const output = join(dir, "live-report.json");
        const ok = requireOk(await runJevEvaluation(liveOptions(output, {
            fetchImpl: liveStubFetch().fetch,
        })));

        const serialized = readFileSync(output, "utf8");
        expect(serialized).not.toContain(CANARY_KEY);

        const forbiddenKey = /api[-_]?key|secret|token|authorization|password|bearer/i;
        const keys: string[] = [];
        const walk = (value: unknown, path: string): void => {
            if (Array.isArray(value)) {
                for (const item of value) walk(item, path);
                return;
            }
            if (typeof value === "object" && value !== null) {
                for (const [key, item] of Object.entries(value)) {
                    keys.push(`${path}.${key}`);
                    walk(item, `${path}.${key}`);
                }
            }
        };
        walk(ok.report, "$");
        const offenders = keys.filter((key) => forbiddenKey.test(key));
        expect(offenders).toEqual([]);

        for (const entry of ok.report.cases) {
            expect(CORPUS_TEXTS.has(entry.text)).toBe(true);
        }
    });

    it("records provider failures as unavailable evidence without inventing answers", async () => {
        const dir = newWorkDir();
        const failing: Fetch = async () => new Response(JSON.stringify({ error: "boom" }), {
            status: 500,
            headers: { "content-type": "application/json" },
        });
        const ok = requireOk(await runJevEvaluation(liveOptions(join(dir, "report.json"), {
            fetchImpl: failing,
            maxCases: 2,
        })));

        expect(ok.report.live?.failures).toHaveLength(2);
        for (const entry of ok.report.cases) {
            expect(entry.prediction?.status).toBe("unavailable");
            expect(entry.prediction?.selection).toBeNull();
        }
        expect(ok.report.summary.overall.unavailableCount).toBe(2);
        expect(ok.report.summary.overall.precision).toBeNull();
    });

    it("derives per-case deadlines from the real wall clock, not the injected report clock", async () => {
        // Regression for the mixed-clock bomb: an injected `now` far in the
        // past or far in the future must never affect whether the adapter
        // sees a case as already past its deadline. Only `generatedAt`
        // should track the injected clock.
        for (const injectedNow of [
            new Date("2000-01-01T00:00:00.000Z"),
            new Date("2100-01-01T00:00:00.000Z"),
        ]) {
            const dir = newWorkDir();
            const output = join(dir, "live-report.json");
            const stub = liveStubFetch();

            const ok = requireOk(await runJevEvaluation(liveOptions(output, {
                fetchImpl: stub.fetch,
                now: () => injectedNow,
            })));

            expect(stub.calls).toHaveLength(RAW_FIXTURE.cases.length);
            expect(ok.report.generatedAt).toBe(injectedNow.toISOString());
            expect(ok.report.live?.failures).toEqual([]);
        }
    });

    it("bounds the live per-case deadline to now + LIVE_DEADLINE_MS, never an effectively-infinite value", () => {
        // runLiveCase computes `computeLiveDeadline(Date.now())` on the real
        // wall clock for every corpus case (never the injected report clock —
        // see the comment at that call site). Pin the pure computation
        // directly: it must stay a finite, near-term budget, not something an
        // unbounded-deadline mutation could silently pass as.
        const now = Date.now();
        const deadline = computeLiveDeadline(now);
        expect(deadline).toBe(now + LIVE_DEADLINE_MS);
        expect(deadline).toBeGreaterThan(now);
        expect(deadline).toBeLessThanOrEqual(now + LIVE_DEADLINE_MS);
    });
});

// ---------------------------------------------------------------------------
// Evidence bridge: report + operator attestation → jev-evidence-v1
// ---------------------------------------------------------------------------

describe("evidence bridge", () => {
    it("fixture mode: --evidence-out with an attestation emits a checker-parseable evidence document without inventing values", async () => {
        const dir = newWorkDir();
        const output = join(dir, "report.json");
        const evidenceOut = join(dir, "evidence.json");
        const attestationPath = writeJsonFile(dir, "attestation.json", syntheticAttestation("none"));
        const guard = throwingFetch();

        const ok = requireOk(await runJevEvaluation(fixtureOptions(output, {
            evidenceOut,
            attestation: attestationPath,
            fetchImpl: guard.fetch,
        })));

        // The conversion is offline: the transport is never reached.
        expect(guard.calls).toEqual([]);
        expect(ok.evidencePath).toBe(resolve(evidenceOut));
        expect(existsSync(evidenceOut)).toBe(true);

        // The report itself is unchanged: still schemaVersion 1, fixture shape.
        const report = readReport(output);
        expect(report.schemaVersion).toBe(1);
        expect(report.mode).toBe("fixture");

        const evidence: unknown = JSON.parse(readFileSync(evidenceOut, "utf8"));
        // The checker's own strict schema (exact keys, closed vocab) accepts it.
        expect(() => parseEvidenceReport(evidence)).not.toThrow();
        const parsed = parseEvidenceReport(evidence);
        expect((evidence as Record<string, unknown>)["schemaVersion"]).toBe(EVIDENCE_REPORT_SCHEMA_VERSION);
        // Fixture mode runs no model, so the modelId is the operator's
        // attested declaration of what the bundle is for.
        expect(parsed.modelId).toBe(PINNED_MODEL_ID);
        expect(Object.keys(evidence as object).sort()).toEqual([
            "datasetDigest",
            "kinds",
            "modelId",
            "notes",
            "questionVersion",
            "schemaVersion",
        ]);

        const byKind = new Map(parsed.kinds.map((entry) => [entry.decisionKind, entry]));
        for (const kind of Object.values(DECISION_KINDS)) {
            const entry = byKind.get(kind);
            expect(entry).toBeDefined();
            const row = report.summary.byKind[kind];
            // Raw counts are mapped from the report, never invented; the
            // human-reference comparisons come from the attestation (zero
            // here: a fixture run evaluates nothing, so nothing is comparable).
            expect(entry?.rawCounts).toEqual({
                acceptedCount: row.acceptedCount,
                abstainedCount: row.abstainedCount,
                correctCount: row.correctCount,
                evaluatedCount: row.evaluatedCount,
                humanReferenceComparisons: { agreedCount: 0, comparableCount: 0 },
                labeledCount: row.labeledCount,
                missingPredictionCount: row.missingPredictionCount,
                unavailableCount: row.unavailableCount,
            });
            // Zero denominators carry their true counts but no value: the
            // report computed null there and nothing is fabricated instead.
            expect(entry?.metrics.abstentionRate).toEqual({ denominator: 0, numerator: 0 });
            expect(entry?.metrics.precision).toEqual({ denominator: 0, numerator: 0 });
            expect(entry?.metrics.agreement).toEqual({ denominator: 0, numerator: 0 });
            expect(entry?.metrics.coverage).toEqual({
                denominator: row.labeledCount,
                numerator: row.acceptedCount,
                value: 0,
            });
            // Holdout presence/count agree with the report's own split counts.
            expect(entry?.holdoutSplit).toEqual({ caseCount: HOLDOUT_COUNT, present: true });
        }

        // Byte-stable: the evidence carries no timestamps of its own.
        const evidenceOut2 = join(dir, "evidence-2.json");
        await runJevEvaluation(fixtureOptions(join(dir, "report-2.json"), {
            evidenceOut: evidenceOut2,
            attestation: attestationPath,
            fetchImpl: throwingFetch().fetch,
        }));
        expect(readFileSync(evidenceOut, "utf8")).toBe(readFileSync(evidenceOut2, "utf8"));
    });

    it("fixture-mode evidence fails the readiness gate closed against the committed draft profile (by design)", async () => {
        const dir = newWorkDir();
        const attestationPath = writeJsonFile(dir, "attestation.json", syntheticAttestation("none"));
        await runJevEvaluation(fixtureOptions(join(dir, "report.json"), {
            evidenceOut: join(dir, "evidence.json"),
            attestation: attestationPath,
        }));

        const evidence: unknown = JSON.parse(readFileSync(join(dir, "evidence.json"), "utf8"));
        const profile: unknown = JSON.parse(readFileSync(DRAFT_PROFILE_PATH, "utf8"));
        const result = evaluateJevReadiness(profile, evidence, LATER_NOW);

        expect(result.ready).toBe(false);
        const tokens = new Set(result.reasons.map((item) => item.token));
        // Fixture evidence has no evaluated cases, so its zero metric
        // denominators and zero coverage block — the designed fail-closed
        // outcome, not a tool failure.
        expect(tokens.has(READINESS_REASONS.metricDenominatorZero)).toBe(true);
        expect(tokens.has(READINESS_REASONS.coverageBelowFloor)).toBe(true);
        // Blocked for the right reasons: nothing mismatched, and the attested
        // holdout/human-reference presences are honored.
        expect(tokens.has(READINESS_REASONS.evidenceModelMismatch)).toBe(false);
        expect(tokens.has(READINESS_REASONS.evidenceQuestionVersionMismatch)).toBe(false);
        expect(tokens.has(READINESS_REASONS.evidenceDatasetDigestMismatch)).toBe(false);
        expect(tokens.has(READINESS_REASONS.holdoutSplitMissing)).toBe(false);
        expect(tokens.has(READINESS_REASONS.humanReferenceMissing)).toBe(false);
    });

    it("reaches ready: true end-to-end through the checker's own evaluation on synthetic fixtures", async () => {
        const dir = newWorkDir();
        const stub = liveStubFetch();
        const attestationPath = writeJsonFile(dir, "attestation.json", syntheticAttestation("all"));
        const ok = requireOk(await runJevEvaluation(liveOptions(join(dir, "live-report.json"), {
            evidenceOut: join(dir, "live-evidence.json"),
            attestation: attestationPath,
            fetchImpl: stub.fetch,
        })));

        const evidence: unknown = JSON.parse(readFileSync(join(dir, "live-evidence.json"), "utf8"));
        expect(() => parseEvidenceReport(evidence)).not.toThrow();

        // Synthetic profile fixture (never the committed draft profile): the
        // pinned ids come from this very run; the thresholds mirror the
        // draft's proposed examples. enabled:false + a placeholder approval
        // reference keeps the approval boundary intact.
        const report = ok.report;
        const profile = {
            enabled: false,
            kinds: Object.values(DECISION_KINDS).map((kind) => ({
                approvalReference: "PENDING: synthetic placeholder, not an approval",
                approvedScope: ["branch", "internal"],
                datasetDigest: report.datasetDigest,
                decisionKind: kind,
                modelId: PINNED_MODEL_ID,
                questionVersion: report.summary.questionVersion,
                thresholds: {
                    maxAbstentionRate: 0.5,
                    minAgreement: 0.95,
                    minCoverage: 0.9,
                    requireHoldoutSplit: true,
                    requireHumanReference: true,
                },
            })),
            notes: "SYNTHETIC spec profile — proves the gate math, not a real release configuration",
            profileVersion: "synthetic-ready-profile",
            schemaVersion: RELEASE_PROFILE_SCHEMA_VERSION,
        };
        const result = evaluateJevReadiness(profile, evidence, LATER_NOW);
        expect(result.ready).toBe(true);
        expect(result.reasons).toEqual([]);
    });

    it("readiness blocks on a mismatched model, question version, and dataset digest", async () => {
        const dir = newWorkDir();
        const attestationPath = writeJsonFile(dir, "attestation.json", syntheticAttestation("all"));
        await runJevEvaluation(liveOptions(join(dir, "live-report.json"), {
            evidenceOut: join(dir, "live-evidence.json"),
            attestation: attestationPath,
            fetchImpl: liveStubFetch().fetch,
        }));
        const evidence = JSON.parse(readFileSync(join(dir, "live-evidence.json"), "utf8")) as Record<string, unknown>;
        const report = readReport(join(dir, "live-report.json"));
        const profile = {
            enabled: false,
            kinds: Object.values(DECISION_KINDS).map((kind) => ({
                approvalReference: "PENDING: synthetic placeholder, not an approval",
                approvedScope: ["branch", "internal"],
                datasetDigest: report.datasetDigest,
                decisionKind: kind,
                modelId: PINNED_MODEL_ID,
                questionVersion: report.summary.questionVersion,
                thresholds: {
                    maxAbstentionRate: 0.5,
                    minAgreement: 0.95,
                    minCoverage: 0.9,
                    requireHoldoutSplit: true,
                    requireHumanReference: true,
                },
            })),
            profileVersion: "synthetic-ready-profile",
            schemaVersion: RELEASE_PROFILE_SCHEMA_VERSION,
        };

        const cases: Array<[string, unknown, string]> = [
            ["modelId", "synthetic-other-model-2.0.0", READINESS_REASONS.evidenceModelMismatch],
            ["questionVersion", "v9", READINESS_REASONS.evidenceQuestionVersionMismatch],
            ["datasetDigest", "b".repeat(64), READINESS_REASONS.evidenceDatasetDigestMismatch],
        ];
        for (const [field, value, token] of cases) {
            const mutated = { ...evidence, [field]: value };
            const result = evaluateJevReadiness(profile, mutated, LATER_NOW);
            expect(result.ready).toBe(false);
            expect(result.reasons.map((item) => item.token)).toContain(token);
        }
    });

    it("keeps the evidence document free of credentials, corpus text, and per-case data", async () => {
        const dir = newWorkDir();
        const attestationPath = writeJsonFile(dir, "attestation.json", syntheticAttestation("all"));
        await runJevEvaluation(liveOptions(join(dir, "live-report.json"), {
            evidenceOut: join(dir, "live-evidence.json"),
            attestation: attestationPath,
            fetchImpl: liveStubFetch().fetch,
        }));
        const serialized = readFileSync(join(dir, "live-evidence.json"), "utf8");
        const evidence = JSON.parse(serialized) as Record<string, unknown>;

        expect(serialized).not.toContain(CANARY_KEY);
        for (const text of CORPUS_TEXTS) {
            expect(serialized).not.toContain(text);
        }

        const keys: string[] = [];
        const walk = (value: unknown): void => {
            if (Array.isArray(value)) {
                for (const item of value) walk(item);
                return;
            }
            if (typeof value === "object" && value !== null) {
                for (const [key, item] of Object.entries(value)) {
                    keys.push(key);
                    walk(item);
                }
            }
        };
        walk(evidence);
        expect(keys.filter((key) => /api[-_]?key|secret|token|authorization|password|bearer/i.test(key))).toEqual([]);

        // Counts and tokens only — no cases, predictions, or score payloads.
        expect(evidence["cases"]).toBeUndefined();
        for (const entry of evidence["kinds"] as Array<Record<string, unknown>>) {
            expect(Object.keys(entry).sort()).toEqual([
                "decisionKind",
                "holdoutSplit",
                "humanReference",
                "metrics",
                "rawCounts",
            ]);
        }
    });

    it("refuses --evidence-out without --attestation and --attestation without --evidence-out", async () => {
        const dir = newWorkDir();
        const guard = throwingFetch();
        const missingAttestation = requireRefusal(await runJevEvaluation(fixtureOptions(
            join(dir, "report.json"),
            { evidenceOut: join(dir, "evidence.json"), fetchImpl: guard.fetch },
        )));
        expect(missingAttestation.errorCode).toBe("evidence-out-requires-attestation");
        expect(missingAttestation.message).toContain("--attestation");
        expect(guard.calls).toEqual([]);

        const orphanAttestation = requireRefusal(await runJevEvaluation(fixtureOptions(
            join(dir, "report-2.json"),
            { attestation: join(dir, "attestation.json"), fetchImpl: guard.fetch },
        )));
        expect(orphanAttestation.errorCode).toBe("attestation-requires-evidence-out");
        expect(orphanAttestation.message).toContain("--evidence-out");
        expect(guard.calls).toEqual([]);
    });

    it("refuses a missing or unparseable attestation file", async () => {
        const dir = newWorkDir();
        const missingPath = join(dir, "no-such-attestation.json");
        const missing = requireRefusal(await runJevEvaluation(fixtureOptions(join(dir, "report.json"), {
            evidenceOut: join(dir, "evidence.json"),
            attestation: missingPath,
        })));
        expect(missing.errorCode).toBe("attestation-unreadable");
        expect(missing.message).toContain(missingPath);

        const brokenPath = join(dir, "broken.json");
        writeFileSync(brokenPath, "{ not json", "utf8");
        const broken = requireRefusal(await runJevEvaluation(fixtureOptions(join(dir, "report-2.json"), {
            evidenceOut: join(dir, "evidence-2.json"),
            attestation: brokenPath,
        })));
        expect(broken.errorCode).toBe("attestation-invalid");
        expect(broken.message).toContain("not valid JSON");
    });

    it("refuses incomplete attestations with a precise field-level reason", async () => {
        const dir = newWorkDir();

        const missingAuthor = await fixtureEvidenceRefusal(dir, "a1.json", (root) => {
            delete root["attestedBy"];
        });
        expect(missingAuthor.errorCode).toBe("attestation-invalid");
        expect(missingAuthor.message).toContain('"attestedBy"');

        const wrongSchema = await fixtureEvidenceRefusal(dir, "a2.json", (root) => {
            root["schemaVersion"] = "attestation-v9";
        });
        expect(wrongSchema.errorCode).toBe("attestation-invalid");
        expect(wrongSchema.message).toContain(ATTESTATION_SCHEMA_VERSION);

        const unknownKey = await fixtureEvidenceRefusal(dir, "a3.json", (root) => {
            root["extra"] = "not allowed";
        });
        expect(unknownKey.errorCode).toBe("attestation-invalid");
        expect(unknownKey.message).toContain('Unknown attestation key "extra"');

        const missingKind = await fixtureEvidenceRefusal(dir, "a4.json", (root) => {
            delete (root["humanReferenceComparisons"] as Record<string, unknown>)["rank-candidates"];
        });
        expect(missingKind.errorCode).toBe("attestation-invalid");
        expect(missingKind.message).toContain('"rank-candidates"');

        const badDate = await fixtureEvidenceRefusal(dir, "a5.json", (root) => {
            root["attestedAt"] = "09/2026";
        });
        expect(badDate.errorCode).toBe("attestation-invalid");
        expect(badDate.message).toContain("YYYY-MM-DD");

        const agreedBeyondComparable = await fixtureEvidenceRefusal(dir, "a6.json", (root) => {
            (root["humanReferenceComparisons"] as Record<string, unknown>)["route-domains"] = {
                agreedCount: 2,
                comparableCount: 1,
            };
        });
        expect(agreedBeyondComparable.errorCode).toBe("attestation-invalid");
        expect(agreedBeyondComparable.message).toContain("exceeds");

        const presentWithoutCases = await fixtureEvidenceRefusal(dir, "a7.json", (root) => {
            root["holdoutSplit"] = { caseCount: 0, present: true };
        });
        expect(presentWithoutCases.errorCode).toBe("attestation-invalid");
        expect(presentWithoutCases.message).toContain("positive case count");

        const absentWithCases = await fixtureEvidenceRefusal(dir, "a8.json", (root) => {
            root["holdoutSplit"] = { caseCount: 5, present: false };
        });
        expect(absentWithCases.errorCode).toBe("attestation-invalid");
        expect(absentWithCases.message).toContain("caseCount 0");
    });

    it("refuses attestations that do not describe this exact report", async () => {
        const dir = newWorkDir();

        // A fixture run evaluates nothing, so attested comparisons cannot exist.
        const comparisonsWithoutPredictions = await fixtureEvidenceRefusal(dir, "b1.json", (root) => {
            (root["humanReferenceComparisons"] as Record<string, unknown>)["classify-client-intent"] = {
                agreedCount: 1,
                comparableCount: 16,
            };
        });
        expect(comparisonsWithoutPredictions.errorCode).toBe("attestation-mismatch");
        expect(comparisonsWithoutPredictions.message).toContain("evaluated only 0 case(s)");

        // A stale holdout count (truncated run or changed corpus) is refused.
        const staleHoldout = await fixtureEvidenceRefusal(dir, "b2.json", (root) => {
            root["holdoutSplit"] = { caseCount: HOLDOUT_COUNT - 1, present: true };
        });
        expect(staleHoldout.errorCode).toBe("attestation-mismatch");
        expect(staleHoldout.message).toContain("holdout");

        // A live run whose attestation names a different model is refused
        // before any provider call happens.
        const liveDir = newWorkDir();
        const stub = liveStubFetch();
        const attestationPath = writeJsonFile(liveDir, "attestation.json", {
            ...syntheticAttestation("all"),
            modelId: "synthetic-other-model-9.9.9",
        });
        const modelMismatch = requireRefusal(await runJevEvaluation(liveOptions(
            join(liveDir, "report.json"),
            {
                attestation: attestationPath,
                evidenceOut: join(liveDir, "evidence.json"),
                fetchImpl: stub.fetch,
            },
        )));
        expect(modelMismatch.errorCode).toBe("attestation-mismatch");
        expect(modelMismatch.message).toContain("synthetic-other-model-9.9.9");
        expect(modelMismatch.message).toContain(PINNED_MODEL_ID);
        expect(stub.calls).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// Judge rubric
// ---------------------------------------------------------------------------

describe("judge rubric", () => {
    it("is versioned, covers all four decision kinds, and binds the advisory invariants", () => {
        const rubric = JSON.parse(readFileSync(RUBRIC_PATH, "utf8")) as {
            schemaVersion: number;
            rubricVersion: string;
            binding: Record<string, string>;
            decisionKinds: Record<string, {
                questionVersion: string;
                criteria: string[];
                acceptableOutcomes: string[];
                notes: string;
            }>;
        };

        expect(rubric.schemaVersion).toBe(1);
        expect(rubric.rubricVersion).toBe("judge-rubric-v1");

        // AC-16: judge scores are advisory and never replace reference labels.
        expect(rubric.binding["advisoryOnly"]).toContain("NEVER replace reference labels");
        // AC-15: agreement with the incumbent is not accuracy.
        expect(rubric.binding["agreementIsNotAccuracy"]).toContain("is NOT accuracy");

        expect(Object.keys(rubric.decisionKinds).sort()).toEqual(Object.values(DECISION_KINDS).sort());
        for (const [kind, entry] of Object.entries(rubric.decisionKinds)) {
            expect(entry.questionVersion).toBe(DECISION_QUESTION_VERSION);
            expect(entry.criteria.length).toBeGreaterThan(0);
            expect(entry.acceptableOutcomes.length).toBeGreaterThan(0);
            expect(entry.notes.length).toBeGreaterThan(0);
            if (kind === "evaluate-clarification") {
                expect(entry.notes).toContain("clarificationRequired >= 0.5");
            }
        }
    });
});

// ---------------------------------------------------------------------------
// Workflow inventory
// ---------------------------------------------------------------------------

interface WorkflowView {
    raw: string;
    triggers: string[];
    dispatchInputs: string[];
    permissionLines: string[];
    jobNames: string[];
}

/**
 * Minimal indentation-aware parser for this workflow's fixed structure. It
 * reads the literal text (so `on:` stays `on`, unlike YAML 1.1 loaders that
 * coerce it to `true`) and fails loudly on structural drift — which is the
 * point of an inventory guard.
 */
function parseWorkflow(text: string): WorkflowView {
    const lines = text.split("\n");
    const triggers: string[] = [];
    const dispatchInputs: string[] = [];
    const permissionLines: string[] = [];
    const jobNames: string[] = [];
    let section: string | null = null;
    let dispatchSection: "header" | "inputs" = "header";

    for (const line of lines) {
        const top = /^([A-Za-z_-]+):\s*$/.exec(line);
        if (top !== null) {
            section = top[1] ?? null;
            dispatchSection = "header";
            continue;
        }
        if (/^\S/.test(line)) continue; // top-level key with inline value: none expected
        if (section === "on") {
            const trigger = /^  ([A-Za-z_]+):\s*$/.exec(line);
            if (trigger !== null) {
                const name = trigger[1] ?? "";
                if (name === "workflow_dispatch") dispatchSection = "header";
                triggers.push(name);
                continue;
            }
            if (triggers[triggers.length - 1] === "workflow_dispatch") {
                const inputsKey = /^    ([A-Za-z_]+):\s*$/.exec(line);
                if (inputsKey !== null && inputsKey[1] === "inputs") {
                    dispatchSection = "inputs";
                    continue;
                }
                if (dispatchSection === "inputs") {
                    const input = /^      ([A-Za-z_]+):\s*$/.exec(line);
                    if (input !== null) dispatchInputs.push(input[1] ?? "");
                }
            }
        }
        if (section === "permissions") {
            if (/^  \S/.test(line)) permissionLines.push(line.trim());
        }
        if (section === "jobs") {
            const job = /^  ([A-Za-z0-9_-]+):\s*$/.exec(line);
            if (job !== null) jobNames.push(job[1] ?? "");
        }
    }
    return { raw: text, triggers, dispatchInputs, permissionLines, jobNames };
}

function jobBlock(view: WorkflowView, name: string): string {
    const lines = view.raw.split("\n");
    const start = lines.findIndex((line) => line === `  ${name}:`);
    expect(start).toBeGreaterThanOrEqual(0);
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
        if (/^  [A-Za-z0-9_-]+:\s*$/.test(lines[i] ?? "")) {
            end = i;
            break;
        }
    }
    return lines.slice(start, end).join("\n");
}

describe("agent-evals workflow inventory", () => {
    // Snapshot of the pre-existing inventory this workflow must preserve.
    const EXISTING_SECRETS = [
        "AGENT_EVAL_TOKEN",
        "AGENT_EVAL_LOW_PRIVILEGE_TOKEN",
        "AGENT_EVAL_OTHER_BRANCH_TOKEN",
        "AGENT_EVAL_FORBIDDEN_MARKER",
        "AGENT_EVAL_ALLOWED_MARKER",
        "AGENT_EVAL_CLIENT_ENTITY_MARKER",
        "AGENT_EVAL_EMPLOYEE_ENTITY_MARKER",
        "AGENT_EVAL_PROVIDER_LEDGER_URL",
        "AGENT_EVAL_PROVIDER_LEDGER_TOKEN",
        "AGENT_EVAL_UNCERTAIN_ACTION_ID",
        "AGENT_EVAL_CONTRACT_CLIENT_ID",
        "AGENT_EVAL_CONTRACT_TEMPLATE_ID",
        "AGENT_EVAL_SMS_RECEIVER",
        "AGENT_EVAL_SCHEDULED_SMS_RECEIVER",
        "AGENT_EVAL_RETRY_JOB_ID",
        "AGENT_EVAL_NOTIFICATION_USER_ID",
        "AGENT_EVAL_AUTOMATION_RULE_NAME",
        "AGENT_EVAL_SIDE_EFFECT_CONFIRMATION",
    ];
    const EXISTING_PINS = [
        "actions/checkout@11d5960a326750d5838078e36cf38b85af677262",
        "pnpm/action-setup@a7487c7e89a18df4991f7f222e4898a00d66ddda",
        "actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020",
        "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02",
    ];
    const EXISTING_EVALUATE_COMMAND = "pnpm --filter ./backend exec ts-node ../evals/agent/run-evaluation.ts";

    it("preserves the existing trigger, input, job, permission, secret, and pin inventory", () => {
        const view = parseWorkflow(readFileSync(WORKFLOW_PATH, "utf8"));

        // Triggers: workflow_dispatch only — nothing else was added.
        expect(view.triggers).toEqual(["workflow_dispatch"]);
        // Inputs: the existing model input plus exactly one additive input.
        expect([...view.dispatchInputs].sort()).toEqual(["jev_evaluation", "model"]);
        // Jobs: the existing release-a plus exactly two additive jobs.
        expect(view.jobNames).toEqual(["release-a", "jev-fixture", "jev-live"]);
        // Top-level permissions unchanged.
        expect(view.permissionLines).toEqual(["contents: read"]);

        const release = jobBlock(view, "release-a");
        for (const secret of EXISTING_SECRETS) {
            expect(release).toContain(`secrets.${secret}`);
        }
        expect(release).toContain("vars.AGENT_EVAL_BASE_URL");
        expect(release).toContain("vars.AGENT_EVAL_ALLOWED_ORIGIN");
        expect(release).toContain("AGENT_EVAL_LIVE: '1'");
        expect(release).toContain(EXISTING_EVALUATE_COMMAND);
        for (const pin of EXISTING_PINS) {
            expect(release).toContain(pin);
        }
        // release-a still uploads its report with failure reporting.
        expect(release).toContain("if: always()");
        expect(release).toContain("if-no-files-found: error");
    });

    it("keeps every action reference pinned to a full commit SHA", () => {
        const view = parseWorkflow(readFileSync(WORKFLOW_PATH, "utf8"));
        const uses = [...view.raw.matchAll(/uses:\s*(\S+)/g)].map((match) => match[1] ?? "");
        expect(uses.length).toBeGreaterThan(0);
        const shaPattern = /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/;
        for (const reference of uses) {
            expect(reference).toMatch(shaPattern);
        }
    });

    it("never lets a pull_request or push trigger run any job, and the paid job is dispatch-gated", () => {
        const view = parseWorkflow(readFileSync(WORKFLOW_PATH, "utf8"));
        const text = view.raw;

        // No PR/push/schedule trigger exists anywhere in the file, so no PR
        // can ever start a paid or nondeterministic provider request.
        expect(text).not.toContain("pull_request");
        expect(text).not.toMatch(/^  (push|schedule|release):/m);
        expect(view.triggers).toEqual(["workflow_dispatch"]);

        const fixture = jobBlock(view, "jev-fixture");
        expect(fixture).toContain("inputs.jev_evaluation == 'fixture'");
        expect(fixture).toContain("--mode=fixture");
        // The offline job declares no secret references at all (comment prose
        // may name the credential; references are `secrets.` expressions).
        expect(fixture).not.toMatch(/secrets\./);
        expect(fixture).toContain("--input=../evals/agent/jev/fixtures-v1.json");

        const live = jobBlock(view, "jev-live");
        expect(live).toContain("inputs.jev_evaluation == 'live'");
        expect(live).toContain("--mode=live");
        expect(live).toContain(LIVE_CONSENT_FLAG);
        expect(live).toContain("environment:");
        expect(live).toContain("secrets.TYPESAFE_API_KEY");
        expect(live).toContain("if: always()");
        // The credential is referenced exactly once, only in the live job,
        // and never printed (no echo/run line carries it).
        expect(text.match(/secrets\.TYPESAFE_API_KEY/g)).toHaveLength(1);
        expect(live).not.toMatch(/echo[^\n]*TYPESAFE_API_KEY/);
    });
});
