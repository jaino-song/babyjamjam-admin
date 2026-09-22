/**
 * Tests for the Jev evaluation runner CLI (Task 9.1).
 *
 * Fixture-mode specs prove the network-free guarantee with a fetch stub that
 * throws on any call (plus a global fetch guard). Live-mode specs prove the
 * refusal gates with precise messages and zero provider calls, and prove the
 * success path entirely through the SDK's injected fetch seam — no test
 * touches the network and no real credential is ever read.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import type { Fetch } from "@typesafe-ai/sdk";

import { DECISION_KINDS } from "../../application/agent/decision/decision-contracts";
import {
    PINNED_MODEL_ID,
} from "../../infrastructure/agent/typesafe-jev-decision.service";
import {
    CLARIFICATION_BINARIZATION_THRESHOLD,
    EVAL_DIR_RELATIVE,
    LIVE_CONSENT_FLAG,
    LIVE_CONSENT_VALUE,
    RUBRIC_FILENAME,
    runJevEvaluation,
    type JevRunOptions,
    type JevRunReport,
    type JevRunResult,
} from "./run-jev-evaluation";

const FIXTURE_PATH = resolve(__dirname, "../../../evals/agent/jev/fixtures-v1.json");
const RUBRIC_PATH = resolve(__dirname, "../../../evals/agent/jev/judge-rubric-v1.json");
const WORKFLOW_PATH = resolve(__dirname, "../../../.github/workflows/agent-evals.yml");

const FIXED_NOW = new Date("2026-09-23T00:00:00.000Z");
const LATER_NOW = new Date("2026-09-23T12:34:56.789Z");
const CANARY_KEY = "canary-secret-api-key-do-not-leak";
const TEST_ENV: Record<string, string> = {
    TYPESAFE_API_KEY: CANARY_KEY,
    TYPESAFE_BASE_URL: "https://typesafe.test",
};

const RAW_FIXTURE = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as {
    domains: string[];
    cases: Array<{ id: string; labelProvenance: string; text: string; decisionKind: string }>;
};
const CORPUS_TEXTS = new Set(RAW_FIXTURE.cases.map((item) => item.text));
const FULL_KIND_COUNTS: Record<string, number> = {};
for (const item of RAW_FIXTURE.cases) {
    FULL_KIND_COUNTS[item.decisionKind] = (FULL_KIND_COUNTS[item.decisionKind] ?? 0) + 1;
}

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

/**
 * Generic live stub: answers every noul question with 0.5 and every choice
 * question with the first criteria label at argmax, so the whole fixture
 * corpus completes through the production adapter deterministically.
 */
function liveStubFetch(): { fetch: Fetch; calls: string[] } {
    const calls: string[] = [];
    const fetch: Fetch = async (url, init) => {
        calls.push(String(url));
        const body = JSON.parse(String(init?.body ?? "{}")) as {
            questions: Record<string, { type?: string; criteria?: Record<string, unknown> }>;
        };
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
    return { fetch, calls };
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
            expect(entry.questionVersion).toBe("v1");
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
