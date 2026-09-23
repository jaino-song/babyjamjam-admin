/**
 * CLI for the chat-quality evaluation harness. Wires the real `fetch`, a real
 * Gemini judge caller (via `ai`'s generateText + Output.object), and
 * `process.env` into the pure orchestration in `chat-quality-eval.ts`, then
 * writes a JSON report and a markdown transcript (or, in `--compare` mode, a
 * side-by-side comparison table).
 *
 * Usage:
 *   TS_NODE_COMPILER_OPTIONS='{"module":"commonjs"}' \
 *     pnpm --filter ./backend exec ts-node scripts/agent/run-chat-quality-eval.ts \
 *     --target=agent|legacy --label=<name> [--only=<id,id>] \
 *     [--judge-model=<id>] [--concurrency=<n>] --output=<path.json>
 *
 *   TS_NODE_COMPILER_OPTIONS='{"module":"commonjs"}' \
 *     pnpm --filter ./backend exec ts-node scripts/agent/run-chat-quality-eval.ts \
 *     --compare=<a.json>,<b.json>[,<c.json>]
 *
 * The `TS_NODE_COMPILER_OPTIONS` override matches the Jev CI step
 * (`run-jev-evaluation.ts`): ts-node otherwise resolves this file's module
 * output against the project's ESM-leaning tsconfig in a way that breaks a
 * bare `ts-node` invocation from the CLI.
 *
 * Environment (never echoed, including in error messages — E12):
 *   AGENT_EVAL_BASE_URL   Local backend base URL. Default http://127.0.0.1:3001.
 *                         Refused unless the host is 127.0.0.1/localhost/::1
 *                         (this suite runs against a local dev DB only).
 *   AGENT_EVAL_TOKEN      Bearer token for the local backend. Required unless
 *                         AGENT_EVAL_TOKEN_FILE/--token-file is given.
 *   AGENT_EVAL_TOKEN_FILE / --token-file=<path>
 *                         Path to a file holding the bearer token. When set,
 *                         the CLI re-reads and trims this file immediately
 *                         before EVERY request (agent and legacy), instead of
 *                         a fixed token — the access token this suite
 *                         authenticates with expires after 15 minutes
 *                         (ACCESS_TOKEN_EXPIRES_IN) and a full run can
 *                         outlast that. Either this or AGENT_EVAL_TOKEN must
 *                         resolve to a non-empty value before any request; a
 *                         missing or empty file at startup is a fail-loud exit.
 *   GEMINI_API_KEY        Judge model API key. Required.
 *   AGENT_RATE_LIMIT_PER_MINUTE
 *                         Can be raised in the local backend's own env if the
 *                         suite is hitting 429s (default 20/user/min).
 *
 * `dotenv` is not a backend dependency and ts-node does not load `.env`
 * automatically; run this from `backend/` with
 * `NODE_OPTIONS=--env-file=.env` if the required variables live there.
 *
 * PII: transcripts contain customer names, addresses, and phone numbers from
 * the local dev database. Point `--output` outside the repo (e.g. under
 * `$TMPDIR`) — the CLI refuses a path that resolves inside this git worktree.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import { generateText, Output } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";

import {
    JUDGE_SYSTEM_PROMPT,
    JudgeScoreSchema,
    LEGACY_EXCLUDED_CATEGORIES,
    LoopbackGuardError,
    extractManifestCapabilityNames,
    findUnknownCapabilities,
    parseScenarioFile,
    renderCompareMarkdown,
    renderMarkdownTranscript,
    runSuite,
    selectScenarios,
    validateLoopbackBaseUrl,
    buildRunReport,
    type ComparisonInput,
    type FetchLike,
    type JudgeCaller,
    type JudgeScore,
    type RunReport,
    type Scenario,
    type ScenarioFile,
    type TokenProvider,
} from "./chat-quality-eval";

// ---------------------------------------------------------------------------
// Defaults / constants
// ---------------------------------------------------------------------------

export const DEFAULT_BASE_URL = "http://127.0.0.1:3001";
export const DEFAULT_JUDGE_MODEL = "gemini-3.5-flash";
/** Documented fallback (E11): proven to work with this project's Gemini key if the default id ever moves. */
export const FALLBACK_JUDGE_MODEL = "gemini-2.5-flash";
export const DEFAULT_CONCURRENCY = 1;
/** Exit non-zero if more than this share of scenarios end in judgeError (E6). */
export const MAX_JUDGE_ERROR_RATE = 0.10;

const REPO_ROOT = resolve(__dirname, "..", "..", "..");
const DEFAULT_SCENARIOS_PATH = join(REPO_ROOT, "evals", "agent", "quality", "scenarios-v1.json");
const MANIFEST_PATH = join(REPO_ROOT, "backend", "agent-manifest.json");

export const USAGE = [
    "Usage:",
    '  TS_NODE_COMPILER_OPTIONS=\'{"module":"commonjs"}\' \\',
    "    pnpm --filter ./backend exec ts-node scripts/agent/run-chat-quality-eval.ts \\",
    "    --target=agent|legacy --label=<name> [--only=<id,id>] [--judge-model=<id>] \\",
    "    [--concurrency=<n>] --output=<path.json>",
    "",
    "  TS_NODE_COMPILER_OPTIONS='{\"module\":\"commonjs\"}' \\",
    "    pnpm --filter ./backend exec ts-node scripts/agent/run-chat-quality-eval.ts \\",
    "    --compare=<a.json>,<b.json>[,<c.json>]",
    "",
    "Scores the same Korean scenarios (evals/agent/quality/scenarios-v1.json by default) against",
    "either the new agent endpoint (POST /ai/agent/chat) or the legacy chat endpoint",
    "(POST /ai/chat/stream), with a Gemini judge model plus deterministic checks. Writes",
    "<output> and a companion <output without .json>.md transcript. --compare instead reads",
    "two or more previously written report JSON files and writes a side-by-side markdown table",
    "to stdout (redirect it yourself).",
    "",
    "Flags:",
    "  --target=agent|legacy   Which endpoint to evaluate. Required unless --compare is given.",
    "  --label=<name>          Free-form run label recorded in the report. Required unless --compare.",
    "  --output=<path.json>    Where to write the JSON report. Required unless --compare.",
    "  --only=<id,id>          Restrict to these scenario ids (comma-separated).",
    "  --token-file=<path>     Re-read the bearer token from this file (trimmed) before EVERY request,",
    "                          instead of a fixed AGENT_EVAL_TOKEN. The access token this suite",
    "                          authenticates with expires after 15 minutes and a full run can outlast",
    "                          that. Same effect as AGENT_EVAL_TOKEN_FILE; either this or",
    "                          AGENT_EVAL_TOKEN must resolve to a non-empty value before any request.",
    `  --judge-model=<id>      Default: ${DEFAULT_JUDGE_MODEL}. If that id ever stops resolving, pass`,
    `                          --judge-model=${FALLBACK_JUDGE_MODEL} (proven to work with this key).`,
    `  --concurrency=<n>       Scenarios run in parallel; turns within a scenario always run in order.`,
    `                          Default ${DEFAULT_CONCURRENCY} (the agent rate limit is per-user-per-minute;`,
    "                          raise AGENT_RATE_LIMIT_PER_MINUTE in the local backend env before raising this).",
    "  --compare=<a,b[,c]>     Comparison mode: read these report JSON files and print a table.",
    "  --help                  Print this usage text.",
    "",
    "Environment:",
    `  AGENT_EVAL_BASE_URL     Local backend base URL. Default ${DEFAULT_BASE_URL}. Refused unless the`,
    "                          host is 127.0.0.1/localhost/::1 — this suite runs against a local dev DB only.",
    "  AGENT_EVAL_TOKEN        Bearer token for the local backend. Required (not in --compare mode)",
    "                          unless AGENT_EVAL_TOKEN_FILE/--token-file is given.",
    "  AGENT_EVAL_TOKEN_FILE   Same as --token-file (the flag takes precedence over the env var).",
    "  GEMINI_API_KEY          Judge model API key. Required (not in --compare mode).",
    "  AGENT_RATE_LIMIT_PER_MINUTE",
    "                          Can be raised in the local backend's own env if this suite hits 429s.",
    "",
    "dotenv is not a backend dependency and ts-node does not load .env automatically; run this from",
    "backend/ with NODE_OPTIONS=--env-file=.env if the required variables live there.",
    "",
    "PII: transcripts contain real customer names, addresses, and phone numbers from the local dev",
    "database. Point --output outside the repo (e.g. under $TMPDIR) — this CLI warns when the path",
    "resolves inside the current git worktree.",
    "",
    "Legacy write-category scenarios are never run: legacy confirms writes over chat by design, so",
    `the following categories are skipped for --target=legacy: ${LEGACY_EXCLUDED_CATEGORIES.join(", ")}.`,
].join("\n");

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

export interface RunCliArgs {
    readonly mode: "run";
    readonly target: "agent" | "legacy";
    readonly label: string;
    readonly output: string;
    readonly only: readonly string[] | undefined;
    readonly judgeModel: string;
    readonly concurrency: number;
    readonly tokenFile: string | undefined;
}

export interface CompareCliArgs {
    readonly mode: "compare";
    readonly inputs: readonly string[];
}

export interface HelpCliArgs {
    readonly mode: "help";
}

export type CliArgs = RunCliArgs | CompareCliArgs | HelpCliArgs;

export class CliUsageError extends Error {}

export function parseCliArgs(argv: readonly string[]): CliArgs {
    if (argv.includes("--help") || argv.includes("-h")) {
        return { mode: "help" };
    }

    let target: string | undefined;
    let label: string | undefined;
    let output: string | undefined;
    let only: string | undefined;
    let judgeModel = DEFAULT_JUDGE_MODEL;
    let concurrency = DEFAULT_CONCURRENCY;
    let compare: string | undefined;
    let tokenFile: string | undefined;

    for (const arg of argv) {
        const match = /^(--target|--label|--output|--only|--judge-model|--concurrency|--compare|--token-file)=(.*)$/.exec(arg);
        if (match === null) {
            throw new CliUsageError(`Unrecognized argument "${arg}"\n\n${USAGE}`);
        }
        const flag = match[1] ?? "";
        const value = match[2] ?? "";
        switch (flag) {
            case "--target":
                target = value;
                break;
            case "--label":
                label = value;
                break;
            case "--output":
                output = value;
                break;
            case "--only":
                only = value;
                break;
            case "--judge-model":
                judgeModel = value;
                break;
            case "--concurrency": {
                const parsed = Number(value);
                if (!Number.isInteger(parsed) || parsed <= 0) {
                    throw new CliUsageError(`--concurrency must be a positive integer, got "${value}"\n\n${USAGE}`);
                }
                concurrency = parsed;
                break;
            }
            case "--compare":
                compare = value;
                break;
            case "--token-file":
                tokenFile = value;
                break;
        }
    }

    if (compare !== undefined) {
        const inputs = compare.split(",").map((entry) => entry.trim()).filter((entry) => entry.length > 0);
        if (inputs.length < 2) {
            throw new CliUsageError(`--compare requires at least two report files\n\n${USAGE}`);
        }
        return { mode: "compare", inputs };
    }

    if (target !== "agent" && target !== "legacy") {
        throw new CliUsageError(`--target must be "agent" or "legacy"\n\n${USAGE}`);
    }
    if (!label) throw new CliUsageError(`--label is required\n\n${USAGE}`);
    if (!output) throw new CliUsageError(`--output is required\n\n${USAGE}`);

    return {
        mode: "run",
        target,
        label,
        output,
        only: only ? only.split(",").map((id) => id.trim()).filter((id) => id.length > 0) : undefined,
        judgeModel,
        concurrency,
        tokenFile,
    };
}

// ---------------------------------------------------------------------------
// Environment / I/O wiring
// ---------------------------------------------------------------------------

function requireEnv(name: string, env: NodeJS.ProcessEnv): string {
    const value = env[name];
    if (typeof value !== "string" || value.trim().length === 0) {
        // Never echo the (absent) value; just name the missing key.
        throw new Error(`Missing required environment variable ${name}`);
    }
    return value;
}

function readJsonFile(path: string, description: string): unknown {
    let raw: string;
    try {
        raw = readFileSync(path, "utf8");
    } catch (error) {
        throw new Error(`Failed to read ${description} at "${path}": ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
        return JSON.parse(raw) as unknown;
    } catch (error) {
        throw new Error(`${description} at "${path}" is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
}

function loadScenarios(): { scenarios: readonly Scenario[]; version: string; manifestCapabilities: ReadonlySet<string> } {
    const scenarioFile = parseScenarioFile(readJsonFile(DEFAULT_SCENARIOS_PATH, "scenario file")) as ScenarioFile;
    const manifestCapabilities = extractManifestCapabilityNames(readJsonFile(MANIFEST_PATH, "agent manifest"));
    const unknown = findUnknownCapabilities(scenarioFile.scenarios, manifestCapabilities);
    if (unknown.length > 0) {
        throw new Error(`Scenario file references capabilities not in ${MANIFEST_PATH}: ${unknown.join(", ")}`);
    }
    return { scenarios: scenarioFile.scenarios, version: scenarioFile.version, manifestCapabilities };
}

function currentGitSha(): string | null {
    try {
        return execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim();
    } catch {
        return null;
    }
}

/** Real fetch adapter matching FetchLike; `fetch` is a global in the backend's Node runtime. */
const realFetch: FetchLike = async (url, init) => {
    const response = await fetch(url, init);
    return {
        ok: response.ok,
        status: response.status,
        headers: { get: (name: string) => response.headers.get(name) },
        text: () => response.text(),
    };
};

function realSleep(ms: number): Promise<void> {
    return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

/**
 * Builds the bearer-token provider handed to the harness. With a token file
 * (`--token-file` or `AGENT_EVAL_TOKEN_FILE`), the file is read and trimmed
 * once here to fail loud before any request if it is missing or empty, and
 * then re-read on every subsequent call — the access token this suite
 * authenticates with expires after 15 minutes (ACCESS_TOKEN_EXPIRES_IN) and a
 * full run can outlast that. Otherwise falls back to a fixed AGENT_EVAL_TOKEN.
 * `readFile` is injected so tests can observe a changed value between calls
 * without touching the real filesystem.
 */
export function buildTokenProvider(
    tokenFile: string | undefined,
    env: NodeJS.ProcessEnv,
    readFile: (path: string) => string = (path) => readFileSync(path, "utf8"),
): TokenProvider {
    const envTokenFile = env["AGENT_EVAL_TOKEN_FILE"]?.trim();
    const resolvedFile = tokenFile ?? (envTokenFile && envTokenFile.length > 0 ? envTokenFile : undefined);

    if (resolvedFile !== undefined) {
        const readTrimmed = (): string => {
            let raw: string;
            try {
                raw = readFile(resolvedFile);
            } catch (error) {
                // Never include file contents; only the path and the underlying error.
                throw new Error(`Failed to read token file "${resolvedFile}": ${error instanceof Error ? error.message : String(error)}`);
            }
            const trimmed = raw.trim();
            if (trimmed.length === 0) {
                throw new Error(`Token file "${resolvedFile}" is empty`);
            }
            return trimmed;
        };
        // Fail loud now, before any request, if the file is missing or empty.
        readTrimmed();
        return () => readTrimmed();
    }

    const staticToken = requireEnv("AGENT_EVAL_TOKEN", env);
    return () => staticToken;
}

function buildJudgeCaller(apiKey: string, modelId: string): JudgeCaller {
    const google = createGoogleGenerativeAI({ apiKey });
    const model = google(modelId);
    return async (prompt: string): Promise<JudgeScore> => {
        const result = await generateText({
            model,
            temperature: 0,
            system: JUDGE_SYSTEM_PROMPT,
            prompt,
            output: Output.object({ schema: JudgeScoreSchema }),
        });
        return JudgeScoreSchema.parse(result.output);
    };
}

/** Refuses an output path inside this worktree — transcripts carry real customer PII and must never be committed. */
function refuseOutputInsideRepo(outputPath: string): void {
    const resolved = resolve(outputPath);
    const rel = relative(REPO_ROOT, resolved);
    const insideRepo = rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
    if (insideRepo) {
        throw new Error(
            `--output "${outputPath}" resolves inside this git worktree. Report transcripts contain `
            + "real customer names, addresses, and phone numbers from the local dev database; "
            + "point --output outside the repo (e.g. under $TMPDIR).",
        );
    }
}

// ---------------------------------------------------------------------------
// Run mode
// ---------------------------------------------------------------------------

async function runOnce(args: RunCliArgs): Promise<number> {
    let getToken: TokenProvider;
    try {
        getToken = buildTokenProvider(args.tokenFile, process.env);
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        return 1;
    }
    const geminiApiKey = requireEnv("GEMINI_API_KEY", process.env);

    const rawBaseUrl = process.env["AGENT_EVAL_BASE_URL"]?.trim() || DEFAULT_BASE_URL;
    let baseUrl: URL;
    try {
        baseUrl = validateLoopbackBaseUrl(rawBaseUrl);
    } catch (error) {
        if (error instanceof LoopbackGuardError) {
            console.error(error.message);
            return 1;
        }
        throw error;
    }

    refuseOutputInsideRepo(args.output);

    const { scenarios, version, manifestCapabilities } = loadScenarios();
    const selected = selectScenarios(scenarios, args.target, args.only);
    if (selected.length === 0) {
        console.error("No scenarios selected (check --only and --target's category exclusions)");
        return 1;
    }

    const judgeCall = buildJudgeCaller(geminiApiKey, args.judgeModel);

    // One judge probe call before any scenario runs; a failing probe aborts
    // the whole run before spending any agent/legacy requests (E6).
    try {
        await judgeCall(
            "Scenario id: probe\nCategory: smalltalk\nUser intent: probe\nRubric: probe\n\nTranscript:\n"
            + "Turn 1\nUser: 안녕\nAssistant: 안녕하세요!",
        );
    } catch (error) {
        console.error(
            `Judge probe call failed before any scenario ran (judge-model="${args.judgeModel}"): `
            + `${error instanceof Error ? error.message : String(error)}`,
        );
        return 1;
    }

    const rateLimitEnv = process.env["AGENT_RATE_LIMIT_PER_MINUTE"];
    console.error(
        `Running ${selected.length} scenario(s) against target=${args.target} at ${baseUrl.origin} `
        + `(concurrency=${args.concurrency}). Current AGENT_RATE_LIMIT_PER_MINUTE=${rateLimitEnv ?? "20 (default)"}; `
        + "raise it in the local backend env if this run hits 429s.",
    );

    const results = await runSuite({
        scenarios,
        target: args.target,
        baseUrl: baseUrl.toString().replace(/\/$/, ""),
        getToken,
        manifestCapabilities,
        fetchImpl: realFetch,
        sleepImpl: realSleep,
        judgeCall,
        concurrency: args.concurrency,
        only: args.only,
    });

    const report = buildRunReport({
        target: args.target,
        label: args.label,
        judgeModel: args.judgeModel,
        scenarioVersion: version,
        gitSha: currentGitSha(),
        now: () => new Date(),
        results,
    });

    const outputPath = resolve(args.output);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    const mdPath = outputPath.endsWith(".json") ? `${outputPath.slice(0, -".json".length)}.md` : `${outputPath}.md`;
    writeFileSync(mdPath, renderMarkdownTranscript(report), "utf8");

    console.log(`Chat quality report written to ${outputPath}`);
    console.log(`Transcript written to ${mdPath}`);
    console.log(
        `judged ${report.aggregate.judgedScenarioCount}/${report.aggregate.totalScenarioCount}, `
        + `judgeError ${report.aggregate.judgeErrorCount}, transportError ${report.aggregate.transportErrorCount}, `
        + `deterministic pass rate ${report.aggregate.deterministicPassRate === null ? "n/a" : `${(report.aggregate.deterministicPassRate * 100).toFixed(1)}%`}`,
    );

    const judgeErrorRate = report.aggregate.totalScenarioCount === 0
        ? 0
        : report.aggregate.judgeErrorCount / report.aggregate.totalScenarioCount;
    if (judgeErrorRate > MAX_JUDGE_ERROR_RATE) {
        console.error(
            `judgeError rate ${(judgeErrorRate * 100).toFixed(1)}% exceeds the ${(MAX_JUDGE_ERROR_RATE * 100).toFixed(0)}% threshold`,
        );
        return 1;
    }
    return 0;
}

// ---------------------------------------------------------------------------
// Compare mode
// ---------------------------------------------------------------------------

function loadReport(path: string): RunReport {
    return readJsonFile(path, "comparison report file") as RunReport;
}

function runCompare(args: CompareCliArgs): number {
    const inputs: ComparisonInput[] = args.inputs.map((path) => {
        const report = loadReport(path);
        return { label: report.label || path, report };
    });
    console.log(renderCompareMarkdown(inputs));
    return 0;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function main(argv: readonly string[]): Promise<number> {
    let args: CliArgs;
    try {
        args = parseCliArgs(argv);
    } catch (error) {
        if (error instanceof CliUsageError) {
            console.error(error.message);
            return 1;
        }
        throw error;
    }
    if (args.mode === "help") {
        console.log(USAGE);
        return 0;
    }
    return args.mode === "compare" ? runCompare(args) : runOnce(args);
}

if (require.main === module) {
    void (async () => {
        try {
            process.exitCode = await main(process.argv.slice(2));
        } catch (error) {
            console.error(error instanceof Error ? error.message : String(error));
            process.exitCode = 1;
        }
    })();
}
