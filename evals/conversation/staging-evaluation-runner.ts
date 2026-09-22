#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { performance } from "node:perf_hooks";

import {
    CONVERSATION_ASSERTION_DIGEST,
    CONVERSATION_EVAL_CASES,
    CONVERSATION_EVAL_DIGEST,
    CONVERSATION_FIXTURE_VERSION,
    conversationDigest,
    type ConversationPartition,
    type ConversationScenario,
    type StructuredEventExpectation,
} from "./cases";
import {
    createConversationProviderRegistry,
    createGoogleConversationProviderAdapter,
    createOpenAIConversationProviderAdapter,
    type ConversationProviderAdapter,
} from "./providers";
import { ConversationProviderCodecError } from "./providers/errors";
import type {
    ConversationEvaluationRequest,
    ConversationProvider,
    ConversationProviderOutcome,
    ConversationProviderProfile,
    ConversationProviderResponse,
    ConversationUsageMetadata,
    JsonObject,
} from "./providers/types";
import type { ConversationTransport } from "./evaluation-policy";

export const STAGING_EVALUATION_SCHEMA_VERSION = "conversation-staging-evaluation-v1" as const;
export const DEFAULT_PROMPT_VERSION = "prompt-v1" as const;
export const DEFAULT_CURRENT_CONTEXT_VERSION = "context-current-v1" as const;
export const DEFAULT_IMPROVED_CONTEXT_VERSION = "context-improved-v1" as const;
export const DEFAULT_REPEAT_COUNT = 3;
export const MAX_REPEAT_COUNT = 20;
export const DEFAULT_TIMEOUT_MS = 30_000;
export const MAX_TIMEOUT_MS = 120_000;
export const DEFAULT_MAX_STEPS = 1;

type EvaluationProfileName = "current" | "improved";
type EvaluationPartition = ConversationPartition | "all";
type CostAmount = number | "unavailable";

export interface StagingCostRates {
    readonly inputUsdPer1k: number;
    readonly outputUsdPer1k: number;
}

export interface StagingProfileConfig {
    readonly name: EvaluationProfileName;
    readonly profileId: string;
    readonly modelId: string;
    readonly profileVersion: string;
    readonly reasoningContinuation: boolean;
}

export interface StagingProviderConfig {
    readonly provider: ConversationProvider;
    readonly apiKey?: string;
    readonly current: StagingProfileConfig;
    readonly improved: StagingProfileConfig;
    readonly costRates?: StagingCostRates;
}

export interface StagingEvaluationConfig {
    readonly providers: readonly StagingProviderConfig[];
    readonly repeatCount: number;
    readonly partition: EvaluationPartition;
    readonly fixtureVersion: typeof CONVERSATION_FIXTURE_VERSION;
    readonly promptVersion: string;
    readonly contextVersions: Readonly<Record<EvaluationProfileName, string>>;
    readonly timeoutMs: number;
    readonly maxSteps: number;
    readonly dryRun: boolean;
    readonly execute: boolean;
    readonly outputPath?: string;
}

export interface StagingEvaluationPlanItem {
    readonly case: ConversationScenario;
    readonly provider: StagingProviderConfig;
    readonly profile: StagingProfileConfig;
    readonly contextVersion: string;
    readonly runIndex: number;
}

export interface RequiredTokenScore {
    readonly required: number;
    readonly matched: number;
    readonly missing: readonly string[];
}

export interface StructuredEventScore {
    readonly required: number;
    readonly matched: number;
    readonly missing: readonly StructuredEventExpectation[];
}

export interface StagingUsageRecord {
    readonly inputTokens: number | "unavailable";
    readonly outputTokens: number | "unavailable";
    readonly totalTokens: number | "unavailable";
    readonly estimatedCostUsd: CostAmount;
}

export interface StagingEvaluationRecord {
    readonly caseId: string;
    readonly partition: ConversationPartition;
    readonly provider: ConversationProvider;
    readonly profile: EvaluationProfileName;
    readonly profileId: string;
    readonly profileVersion: string;
    readonly model: string;
    readonly fixtureVersion: string;
    readonly promptVersion: string;
    readonly contextVersion: string;
    readonly runIndex: number;
    readonly latencyMs: number;
    readonly usage: StagingUsageRecord;
    readonly outcome: ConversationProviderOutcome | "error";
    readonly requiredTokenScore: RequiredTokenScore;
    readonly structuredEventScore: StructuredEventScore;
    readonly responseHash: string;
    readonly errorCode?: string;
    readonly httpStatus?: number;
}

export interface StagingLatencyMetrics {
    readonly minMs: number;
    readonly p50Ms: number;
    readonly p95Ms: number;
    readonly maxMs: number;
    readonly meanMs: number;
}

export interface StagingAggregateMetrics {
    readonly runCount: number;
    readonly responseCount: number;
    readonly errorCount: number;
    readonly outcomes: Readonly<Record<string, number>>;
    readonly requiredTokens: RequiredTokenScore;
    readonly structuredEvents: Omit<StructuredEventScore, "missing"> & { readonly missing: readonly string[] };
    readonly latencyMs: StagingLatencyMetrics;
    readonly usage: {
        readonly inputTokens: number | "unavailable";
        readonly outputTokens: number | "unavailable";
        readonly totalTokens: number | "unavailable";
        readonly estimatedCostUsd: CostAmount;
    };
}

export interface StagingEvaluationReport {
    readonly schemaVersion: typeof STAGING_EVALUATION_SCHEMA_VERSION;
    readonly dryRun: boolean;
    readonly fixtureVersion: string;
    readonly fixtureDigest: string;
    readonly assertionDigest: string;
    readonly selectionDigest: string;
    readonly promptVersion: string;
    readonly contextVersions: Readonly<Record<EvaluationProfileName, string>>;
    readonly partition: EvaluationPartition;
    readonly repeatCount: number;
    readonly planCount: number;
    readonly providers: readonly {
        readonly provider: ConversationProvider;
        readonly keyConfigured: boolean;
        readonly current: Omit<StagingProfileConfig, "name">;
        readonly improved: Omit<StagingProfileConfig, "name">;
        readonly costRatesConfigured: boolean;
    }[];
    readonly aggregate: StagingAggregateMetrics;
    readonly records: readonly StagingEvaluationRecord[];
}

export interface ParseStagingEvaluationConfigInput {
    readonly argv?: readonly string[];
    readonly env?: Readonly<Record<string, string | undefined>>;
}

export interface StagingEvaluationExecutionOptions {
    readonly cases?: readonly ConversationScenario[];
    readonly transportFactory?: (provider: ConversationProvider, timeoutMs: number) => ConversationTransport;
    readonly now?: () => number;
}

export class StagingEvaluationConfigError extends Error {
    readonly code: string;

    constructor(code: string) {
        super(`Staging conversation evaluation configuration error: ${code}`);
        this.name = "StagingEvaluationConfigError";
        this.code = code;
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

interface ParsedArguments {
    readonly values: Readonly<Record<string, string>>;
    readonly booleans: ReadonlySet<string>;
}

const VALUE_ARGUMENTS = new Set([
    "provider", "profile", "current-profile", "improved-profile", "current-model", "improved-model",
    "profile-version", "current-profile-version", "improved-profile-version", "current-context-version",
    "improved-context-version", "prompt-version", "fixture-version", "repeat", "partition", "timeout-ms",
    "output", "api-key", "key", "google-key", "google-api-key", "openai-key", "openai-api-key", "google-profile", "google-model", "openai-profile", "openai-model", "google-current-profile", "google-improved-profile",
    "google-current-model", "google-improved-model", "google-current-profile-version", "google-improved-profile-version",
    "google-input-rate", "google-output-rate", "openai-current-profile", "openai-improved-profile",
    "openai-current-model", "openai-improved-model", "openai-current-profile-version", "openai-improved-profile-version",
    "openai-input-rate", "openai-output-rate",
]);

const BOOLEAN_ARGUMENTS = new Set(["dry-run", "execute", "google-reasoning-continuation", "openai-reasoning-continuation", "help"]);
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const PROFILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/;
const SYNTHETIC_CASES = new Map(CONVERSATION_EVAL_CASES.map((scenario) => [scenario.id, scenario]));

function parseArguments(argv: readonly string[]): ParsedArguments {
    const values: Record<string, string> = {};
    const booleans = new Set<string>();
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (!argument?.startsWith("--")) throw new StagingEvaluationConfigError("INVALID_ARGUMENT");
        const name = argument.slice(2);
        if (BOOLEAN_ARGUMENTS.has(name)) {
            booleans.add(name);
            continue;
        }
        if (!VALUE_ARGUMENTS.has(name)) throw new StagingEvaluationConfigError("UNKNOWN_ARGUMENT");
        const value = argv[index + 1];
        if (value === undefined || value.startsWith("--") || value.length === 0) {
            throw new StagingEvaluationConfigError("MISSING_ARGUMENT_VALUE");
        }
        values[name] = value;
        index += 1;
    }
    return { values, booleans };
}

function firstDefined(...values: readonly (string | undefined)[]): string | undefined {
    return values.find((value) => value !== undefined && value.trim().length > 0)?.trim();
}

function envValue(env: Readonly<Record<string, string | undefined>>, ...names: readonly string[]): string | undefined {
    return firstDefined(...names.map((name) => env[name]));
}

function option(parsed: ParsedArguments, env: Readonly<Record<string, string | undefined>>, argument: string, ...environmentNames: readonly string[]): string | undefined {
    return firstDefined(parsed.values[argument], ...environmentNames.map((name) => env[name]));
}

function booleanOption(parsed: ParsedArguments, env: Readonly<Record<string, string | undefined>>, argument: string, ...environmentNames: readonly string[]): boolean {
    if (parsed.booleans.has(argument)) return true;
    const value = envValue(env, ...environmentNames);
    return value === "1" || value?.toLowerCase() === "true";
}

function requireIdentifier(value: string | undefined, code: string, pattern = IDENTIFIER_PATTERN): string {
    if (value === undefined || !pattern.test(value)) throw new StagingEvaluationConfigError(code);
    return value;
}

function parsePositiveInteger(value: string | undefined, fallback: number, max: number, code: string): number {
    if (value === undefined) return fallback;
    if (!/^\d+$/.test(value)) throw new StagingEvaluationConfigError(code);
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > max) throw new StagingEvaluationConfigError(code);
    return parsed;
}

function parseRate(value: string | undefined, code: string): number | undefined {
    if (value === undefined) return undefined;
    if (!/^\d+(?:\.\d+)?$/.test(value)) throw new StagingEvaluationConfigError(code);
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1_000_000) throw new StagingEvaluationConfigError(code);
    return parsed;
}

function parseProvider(value: string | undefined): readonly ConversationProvider[] {
    if (value === undefined) throw new StagingEvaluationConfigError("MISSING_PROVIDER");
    const providers = value.split(",").map((item) => item.trim()).filter(Boolean);
    if (providers.length === 0 || providers.some((item) => item !== "google" && item !== "openai" && item !== "both")) {
        throw new StagingEvaluationConfigError("INVALID_PROVIDER");
    }
    if (providers.includes("both")) return ["google", "openai"];
    return [...new Set(providers)] as ConversationProvider[];
}

function parsePartition(value: string | undefined): EvaluationPartition {
    const partition = value ?? "all";
    if (partition !== "all" && partition !== "development" && partition !== "holdout") {
        throw new StagingEvaluationConfigError("INVALID_PARTITION");
    }
    return partition;
}

function parseRates(
    parsed: ParsedArguments,
    env: Readonly<Record<string, string | undefined>>,
    provider: ConversationProvider,
): StagingCostRates | undefined {
    const prefix = provider.toUpperCase();
    const input = parseRate(
        option(parsed, env, `${provider}-input-rate`, `CONVERSATION_EVAL_${prefix}_INPUT_USD_PER_1K`),
        "INVALID_COST_RATE",
    );
    const output = parseRate(
        option(parsed, env, `${provider}-output-rate`, `CONVERSATION_EVAL_${prefix}_OUTPUT_USD_PER_1K`),
        "INVALID_COST_RATE",
    );
    if (input === undefined || output === undefined) return undefined;
    return { inputUsdPer1k: input, outputUsdPer1k: output };
}

function profileOption(
    parsed: ParsedArguments,
    env: Readonly<Record<string, string | undefined>>,
    provider: ConversationProvider,
    profile: EvaluationProfileName,
    field: "profile" | "model" | "profileVersion",
): string | undefined {
    const providerPrefix = provider;
    const upper = provider.toUpperCase();
    const fieldName = field === "profileVersion" ? "profile-version" : field;
    const profileName = profile === "current" ? "current" : "improved";
    const argument = `${providerPrefix}-${profileName}-${fieldName}`;
    const genericArgument = `${profileName}-${fieldName}`;
    const providerGenericArgument = `${providerPrefix}-${fieldName}`;
    const envSuffix = `${upper}_${profileName.toUpperCase()}_${field === "profileVersion" ? "PROFILE_VERSION" : field.toUpperCase()}`;
    return option(parsed, env, argument, `CONVERSATION_EVAL_${envSuffix}`)
        ?? option(
            parsed,
            env,
            genericArgument,
            `CONVERSATION_EVAL_${profileName.toUpperCase()}_${field === "profileVersion" ? "PROFILE_VERSION" : field.toUpperCase()}`,
        )
        ?? option(
            parsed,
            env,
            fieldName,
            `CONVERSATION_EVAL_${field === "profileVersion" ? "PROFILE_VERSION" : field.toUpperCase()}`,
        )
        ?? option(
            parsed,
            env,
            providerGenericArgument,
            `CONVERSATION_EVAL_${upper}_${field === "profileVersion" ? "PROFILE_VERSION" : field.toUpperCase()}`,
        );
}

function buildProviderConfig(
    parsed: ParsedArguments,
    env: Readonly<Record<string, string | undefined>>,
    provider: ConversationProvider,
    providerCount: number,
): StagingProviderConfig {
    const currentProfileId = requireIdentifier(profileOption(parsed, env, provider, "current", "profile"), "MISSING_CURRENT_PROFILE", PROFILE_PATTERN);
    const improvedProfileId = requireIdentifier(profileOption(parsed, env, provider, "improved", "profile"), "MISSING_IMPROVED_PROFILE", PROFILE_PATTERN);
    const currentModelId = requireIdentifier(profileOption(parsed, env, provider, "current", "model"), "MISSING_CURRENT_MODEL");
    const improvedModelId = requireIdentifier(profileOption(parsed, env, provider, "improved", "model"), "MISSING_IMPROVED_MODEL");
    const currentProfileVersion = requireIdentifier(
        profileOption(parsed, env, provider, "current", "profileVersion") ?? "current-v1",
        "INVALID_PROFILE_VERSION",
    );
    const improvedProfileVersion = requireIdentifier(
        profileOption(parsed, env, provider, "improved", "profileVersion") ?? "improved-v1",
        "INVALID_PROFILE_VERSION",
    );
    const providerPrefix = provider.toUpperCase();
    const genericKey = providerCount === 1
        ? firstDefined(
            option(parsed, env, "api-key", "CONVERSATION_EVAL_API_KEY"),
            option(parsed, env, "key"),
        )
        : undefined;
    const apiKey = firstDefined(
        option(parsed, env, `${provider}-key`, `CONVERSATION_EVAL_${providerPrefix}_API_KEY`, `CONVERSATION_EVAL_${providerPrefix}_KEY`),
        option(parsed, env, `${provider}-api-key`),
        provider === "google" ? envValue(env, "GOOGLE_API_KEY") : envValue(env, "OPENAI_API_KEY"),
        genericKey,
    );
    const reasoningContinuation = booleanOption(
        parsed,
        env,
        `${provider}-reasoning-continuation`,
        `CONVERSATION_EVAL_${providerPrefix}_REASONING_CONTINUATION`,
    );
    if (provider === "google" && reasoningContinuation) throw new StagingEvaluationConfigError("GOOGLE_REASONING_UNSUPPORTED");
    const current: StagingProfileConfig = {
        name: "current",
        profileId: currentProfileId,
        modelId: currentModelId,
        profileVersion: currentProfileVersion,
        reasoningContinuation,
    };
    const improved: StagingProfileConfig = {
        name: "improved",
        profileId: improvedProfileId,
        modelId: improvedModelId,
        profileVersion: improvedProfileVersion,
        reasoningContinuation,
    };
    return { provider, apiKey, current, improved, costRates: parseRates(parsed, env, provider) };
}

export function parseStagingEvaluationConfig(input: ParseStagingEvaluationConfigInput = {}): StagingEvaluationConfig {
    const argv = input.argv ?? process.argv.slice(2);
    const env = input.env ?? process.env;
    const parsed = parseArguments(argv);
    if (parsed.booleans.has("help")) throw new StagingEvaluationConfigError("HELP");
    const dryRun = parsed.booleans.has("dry-run");
    const execute = parsed.booleans.has("execute");
    const providers = parseProvider(option(parsed, env, "provider", "CONVERSATION_EVAL_PROVIDER"));
    const providerConfigs = providers.map((provider) => buildProviderConfig(parsed, env, provider, providers.length));
    const repeatCount = parsePositiveInteger(option(parsed, env, "repeat", "CONVERSATION_EVAL_REPEAT"), DEFAULT_REPEAT_COUNT, MAX_REPEAT_COUNT, "INVALID_REPEAT");
    const timeoutMs = parsePositiveInteger(option(parsed, env, "timeout-ms", "CONVERSATION_EVAL_TIMEOUT_MS"), DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS, "INVALID_TIMEOUT");
    const fixtureVersion = option(parsed, env, "fixture-version", "CONVERSATION_EVAL_FIXTURE_VERSION") ?? CONVERSATION_FIXTURE_VERSION;
    if (fixtureVersion !== CONVERSATION_FIXTURE_VERSION) throw new StagingEvaluationConfigError("FIXTURE_VERSION_MISMATCH");
    const promptVersion = requireIdentifier(option(parsed, env, "prompt-version", "CONVERSATION_EVAL_PROMPT_VERSION") ?? DEFAULT_PROMPT_VERSION, "INVALID_PROMPT_VERSION");
    const contextVersions = {
        current: requireIdentifier(option(parsed, env, "current-context-version", "CONVERSATION_EVAL_CURRENT_CONTEXT_VERSION") ?? DEFAULT_CURRENT_CONTEXT_VERSION, "INVALID_CONTEXT_VERSION"),
        improved: requireIdentifier(option(parsed, env, "improved-context-version", "CONVERSATION_EVAL_IMPROVED_CONTEXT_VERSION") ?? DEFAULT_IMPROVED_CONTEXT_VERSION, "INVALID_CONTEXT_VERSION"),
    } as const;
    const partition = parsePartition(option(parsed, env, "partition", "CONVERSATION_EVAL_PARTITION"));
    const outputPath = option(parsed, env, "output", "CONVERSATION_EVAL_OUTPUT");
    if (!dryRun && !execute) throw new StagingEvaluationConfigError("EXECUTE_OR_DRY_RUN_REQUIRED");
    if (!dryRun && outputPath === undefined) throw new StagingEvaluationConfigError("OUTPUT_REQUIRED");
    if (!dryRun && providerConfigs.some((provider) => provider.apiKey === undefined)) throw new StagingEvaluationConfigError("MISSING_API_KEY");
    return {
        providers: providerConfigs,
        repeatCount,
        partition,
        fixtureVersion,
        promptVersion,
        contextVersions,
        timeoutMs,
        maxSteps: DEFAULT_MAX_STEPS,
        dryRun,
        execute,
        ...(outputPath === undefined ? {} : { outputPath }),
    };
}

function selectedCases(config: StagingEvaluationConfig, cases: readonly ConversationScenario[]): readonly ConversationScenario[] {
    if (config.partition === "development") return cases.filter((item) => item.partition === "development");
    if (config.partition === "holdout") return cases.filter((item) => item.partition === "holdout");
    return cases;
}

function assertSyntheticCases(cases: readonly ConversationScenario[]): void {
    for (const scenario of cases) {
        if (SYNTHETIC_CASES.get(scenario.id) !== scenario) {
            throw new StagingEvaluationConfigError("SYNTHETIC_CASE_REQUIRED");
        }
    }
}

export function createStagingEvaluationPlan(
    config: StagingEvaluationConfig,
    cases: readonly ConversationScenario[] = CONVERSATION_EVAL_CASES,
): readonly StagingEvaluationPlanItem[] {
    assertSyntheticCases(cases);
    const selected = selectedCases(config, cases);
    const plan: StagingEvaluationPlanItem[] = [];
    for (const provider of config.providers) {
        for (const profileName of ["current", "improved"] as const) {
            const profile = provider[profileName];
            for (const scenario of selected) {
                for (let runIndex = 1; runIndex <= config.repeatCount; runIndex += 1) {
                    plan.push({
                        case: scenario,
                        provider,
                        profile,
                        contextVersion: config.contextVersions[profileName],
                        runIndex,
                    });
                }
            }
        }
    }
    return plan;
}

function contextSnapshot(profile: EvaluationProfileName, scenario: ConversationScenario): JsonObject {
    const base: Record<string, unknown> = {
        syntheticTokens: scenario.syntheticTokens,
        currentState: scenario.oracle.currentState,
    };
    if (profile === "improved") {
        base["requiredEvents"] = scenario.oracle.requiredEvents;
        base["completionExpectation"] = scenario.oracle.completion;
    }
    return base as JsonObject;
}

function buildSystemMessage(profile: EvaluationProfileName, contextVersion: string, scenario: ConversationScenario): string {
    const profileInstruction = profile === "improved"
        ? "Emit every applicable structured event through emit_structured_event and keep the final answer concise."
        : "Answer from the synthetic snapshot and preserve the synthetic identifiers in your answer when relevant.";
    return [
        "This is a staging-only synthetic conversation evaluation.",
        "Use only the synthetic snapshot below. Do not access products, customers, databases, SMS, or external tools.",
        `Context version: ${contextVersion}.`,
        profileInstruction,
        "The emit_structured_event function is a scoring-only event channel; it has no side effects.",
        `Synthetic snapshot: ${JSON.stringify(contextSnapshot(profile, scenario))}`,
    ].join("\n");
}

function eventTool(): { readonly name: string; readonly description: string; readonly parameters: JsonObject; readonly strict: boolean } {
    return {
        name: "emit_structured_event",
        description: "Emit one synthetic conversation event for evaluation scoring only.",
        parameters: {
            type: "object",
            properties: {
                type: { type: "string" },
                token: { type: "string" },
                value: { type: "string" },
            },
            required: ["type"],
            additionalProperties: false,
        },
        strict: true,
    };
}

export function buildStagingEvaluationRequest(
    planItem: StagingEvaluationPlanItem,
    config: StagingEvaluationConfig,
): ConversationEvaluationRequest {
    return {
        fixtureVersion: config.fixtureVersion,
        promptVersion: config.promptVersion,
        contextVersion: planItem.contextVersion,
        maxSteps: config.maxSteps,
        messages: [
            { role: "system", text: buildSystemMessage(planItem.profile.name, planItem.contextVersion, planItem.case) },
            ...planItem.case.turns.map((turn) => ({
                role: "user" as const,
                text: `${turn.userText}\nSynthetic input events: ${JSON.stringify(turn.inputEvents)}`,
            })),
        ],
        tools: [eventTool()],
    };
}

function createProviderAdapter(
    provider: StagingProviderConfig,
    profile: StagingProfileConfig,
    transport: ConversationTransport,
): ConversationProviderAdapter {
    const profileValue: ConversationProviderProfile = {
        provider: provider.provider,
        profileId: profile.profileId,
        modelId: profile.modelId,
        profileVersion: profile.profileVersion,
        reasoningContinuation: profile.reasoningContinuation,
        testOnly: false,
    };
    const registry = createConversationProviderRegistry([profileValue]);
    const options = { registry, profileId: profile.profileId, transport, ...(provider.apiKey === undefined ? {} : { apiKey: provider.apiKey }) };
    return provider.provider === "google"
        ? createGoogleConversationProviderAdapter(options)
        : createOpenAIConversationProviderAdapter(options);
}

export function createFetchConversationTransport(timeoutMs = DEFAULT_TIMEOUT_MS): ConversationTransport {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) throw new StagingEvaluationConfigError("INVALID_TIMEOUT");
    let calls = 0;
    return {
        get calls() { return calls; },
        get networkCalls() { return calls; },
        async request<T = never>(input: string, init?: unknown): Promise<T> {
            calls += 1;
            const response = await fetch(input, {
                ...(init as RequestInit | undefined),
                signal: AbortSignal.timeout(timeoutMs),
            });
            let body: unknown;
            try {
                body = await response.json();
            } catch {
                body = undefined;
            }
            return { status: response.status, body } as T;
        },
    };
}

function stableValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(stableValue);
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value as Record<string, unknown>)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, entry]) => [key, stableValue(entry)]));
    }
    return value;
}

function hashResponse(response: ConversationProviderResponse | undefined, errorCode?: string): string {
    const safePayload = response === undefined
        ? { outcome: "error", errorCode: errorCode ?? "UNKNOWN" }
        : { outcome: response.outcome, text: response.text ?? "", toolCalls: response.toolCalls ?? [] };
    return createHash("sha256").update(JSON.stringify(stableValue(safePayload))).digest("hex");
}

function jsonCandidates(text: string): readonly unknown[] {
    const candidates: unknown[] = [];
    const seen = new Set<string>();
    const add = (value: string): void => {
        try {
            const parsed = JSON.parse(value) as unknown;
            const key = JSON.stringify(stableValue(parsed));
            if (!seen.has(key)) {
                seen.add(key);
                candidates.push(parsed);
            }
        } catch {
            // Provider prose is allowed; an absent JSON envelope scores zero events.
        }
    };
    const trimmed = text.trim();
    if (trimmed.length > 0) add(trimmed);
    const fenced = /```(?:json)?\s*([\s\S]*?)```/gi;
    for (const match of text.matchAll(fenced)) if (match[1]) add(match[1].trim());
    const objectStart = text.indexOf("{");
    const objectEnd = text.lastIndexOf("}");
    if (objectStart >= 0 && objectEnd > objectStart) add(text.slice(objectStart, objectEnd + 1));
    return candidates;
}

interface StructuredEventCandidate {
    readonly type: string;
    readonly token?: string;
    readonly value?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectEvents(value: unknown, output: StructuredEventCandidate[]): void {
    if (Array.isArray(value)) {
        for (const item of value) collectEvents(item, output);
        return;
    }
    if (!isRecord(value)) return;
    const type = value["type"];
    if (typeof type === "string" && type.length > 0) {
        const token = typeof value["token"] === "string" ? value["token"] : undefined;
        const eventValue = typeof value["value"] === "string" ? value["value"] : undefined;
        output.push({ type, ...(token === undefined ? {} : { token }), ...(eventValue === undefined ? {} : { value: eventValue }) });
    }
    for (const key of ["events", "structuredEvents", "structured_events", "event"]) {
        if (Object.prototype.hasOwnProperty.call(value, key)) collectEvents(value[key], output);
    }
}

function responseEvents(response: ConversationProviderResponse): readonly StructuredEventCandidate[] {
    const events: StructuredEventCandidate[] = [];
    for (const candidate of jsonCandidates(response.text ?? "")) collectEvents(candidate, events);
    for (const call of response.toolCalls ?? []) collectEvents(call.arguments, events);
    const unique = new Map<string, StructuredEventCandidate>();
    for (const event of events) unique.set(JSON.stringify(event), event);
    return [...unique.values()];
}

function requiredTokenScore(scenario: ConversationScenario, response: ConversationProviderResponse | undefined): RequiredTokenScore {
    const required = scenario.oracle.currentState.requiredTokens;
    if (response === undefined) return { required: required.length, matched: 0, missing: [...required] };
    const evidence = [response.text ?? "", ...(response.toolCalls ?? []).map((call) => JSON.stringify(call.arguments))].join("\n");
    const matched = required.filter((token) => evidence.includes(token));
    return { required: required.length, matched: matched.length, missing: required.filter((token) => !matched.includes(token)) };
}

function eventMatches(expected: StructuredEventExpectation, actual: StructuredEventCandidate): boolean {
    return expected.type === actual.type
        && (expected.token === undefined || expected.token === actual.token)
        && (expected.value === undefined || expected.value === actual.value);
}

function structuredEventScore(scenario: ConversationScenario, response: ConversationProviderResponse | undefined): StructuredEventScore {
    const required = scenario.oracle.requiredEvents;
    if (response === undefined) return { required: required.length, matched: 0, missing: [...required] };
    const events = responseEvents(response);
    const used = new Set<number>();
    const missing: StructuredEventExpectation[] = [];
    let matched = 0;
    for (const expected of required) {
        const index = events.findIndex((actual, eventIndex) => !used.has(eventIndex) && eventMatches(expected, actual));
        if (index < 0) missing.push(expected);
        else {
            matched += 1;
            used.add(index);
        }
    }
    return { required: required.length, matched, missing };
}

export function scoreStagingResponse(
    scenario: ConversationScenario,
    response: ConversationProviderResponse | undefined,
): { readonly requiredTokenScore: RequiredTokenScore; readonly structuredEventScore: StructuredEventScore } {
    return { requiredTokenScore: requiredTokenScore(scenario, response), structuredEventScore: structuredEventScore(scenario, response) };
}

function usageRecord(usage: ConversationUsageMetadata, rates: StagingCostRates | undefined): StagingUsageRecord {
    const estimatedCostUsd = typeof usage.inputTokens === "number"
        && typeof usage.outputTokens === "number"
        && rates !== undefined
        ? (usage.inputTokens * rates.inputUsdPer1k + usage.outputTokens * rates.outputUsdPer1k) / 1_000
        : "unavailable";
    return {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
        estimatedCostUsd,
    };
}

function safeError(error: unknown): { readonly code: string; readonly status?: number } {
    if (error instanceof ConversationProviderCodecError) {
        return { code: error.code, ...(error.status === undefined ? {} : { status: error.status }) };
    }
    return { code: "RUN_FAILURE" };
}

function buildRecord(
    planItem: StagingEvaluationPlanItem,
    config: StagingEvaluationConfig,
    latencyMs: number,
    response: ConversationProviderResponse | undefined,
    error: { readonly code: string; readonly status?: number } | undefined,
): StagingEvaluationRecord {
    const scores = scoreStagingResponse(planItem.case, response);
    const usage = response?.metadata.usage ?? { inputTokens: "unavailable", outputTokens: "unavailable", totalTokens: "unavailable", cost: "unavailable" };
    return {
        caseId: planItem.case.id,
        partition: planItem.case.partition,
        provider: planItem.provider.provider,
        profile: planItem.profile.name,
        profileId: planItem.profile.profileId,
        profileVersion: planItem.profile.profileVersion,
        model: planItem.profile.modelId,
        fixtureVersion: config.fixtureVersion,
        promptVersion: config.promptVersion,
        contextVersion: planItem.contextVersion,
        runIndex: planItem.runIndex,
        latencyMs: Math.max(0, Math.round(latencyMs)),
        usage: usageRecord(usage, planItem.provider.costRates),
        outcome: response?.outcome ?? "error",
        requiredTokenScore: scores.requiredTokenScore,
        structuredEventScore: scores.structuredEventScore,
        responseHash: hashResponse(response, error?.code),
        ...(error === undefined ? {} : { errorCode: error.code, ...(error.status === undefined ? {} : { httpStatus: error.status }) }),
    };
}

function unavailableOrSum(values: readonly (number | "unavailable")[]): number | "unavailable" {
    if (values.some((value) => value === "unavailable")) return "unavailable";
    return (values as number[]).reduce((sum, value) => sum + value, 0);
}

function percentile(values: readonly number[], ratio: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((left, right) => left - right);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
    return sorted[index] ?? 0;
}

function aggregateMetrics(records: readonly StagingEvaluationRecord[]): StagingAggregateMetrics {
    const latencies = records.map((record) => record.latencyMs);
    const requiredTokens = records.reduce((score, record) => ({
        required: score.required + record.requiredTokenScore.required,
        matched: score.matched + record.requiredTokenScore.matched,
        missing: [...score.missing, ...record.requiredTokenScore.missing],
    }), { required: 0, matched: 0, missing: [] as string[] });
    const structuredEvents = records.reduce((score, record) => ({
        required: score.required + record.structuredEventScore.required,
        matched: score.matched + record.structuredEventScore.matched,
        missing: [...score.missing, ...record.structuredEventScore.missing.map((event) => event.type)],
    }), { required: 0, matched: 0, missing: [] as string[] });
    const outcomes: Record<string, number> = {};
    for (const record of records) outcomes[record.outcome] = (outcomes[record.outcome] ?? 0) + 1;
    return {
        runCount: records.length,
        responseCount: records.filter((record) => record.outcome !== "error").length,
        errorCount: records.filter((record) => record.outcome === "error").length,
        outcomes,
        requiredTokens,
        structuredEvents,
        latencyMs: {
            minMs: latencies.length === 0 ? 0 : Math.min(...latencies),
            p50Ms: percentile(latencies, 0.5),
            p95Ms: percentile(latencies, 0.95),
            maxMs: latencies.length === 0 ? 0 : Math.max(...latencies),
            meanMs: latencies.length === 0 ? 0 : Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length),
        },
        usage: {
            inputTokens: unavailableOrSum(records.map((record) => record.usage.inputTokens)),
            outputTokens: unavailableOrSum(records.map((record) => record.usage.outputTokens)),
            totalTokens: unavailableOrSum(records.map((record) => record.usage.totalTokens)),
            estimatedCostUsd: unavailableOrSum(records.map((record) => record.usage.estimatedCostUsd)),
        },
    };
}

function safeProviderSummary(provider: StagingProviderConfig): StagingEvaluationReport["providers"][number] {
    const stripName = ({ name: _name, ...profile }: StagingProfileConfig): Omit<StagingProfileConfig, "name"> => profile;
    return {
        provider: provider.provider,
        keyConfigured: provider.apiKey !== undefined,
        current: stripName(provider.current),
        improved: stripName(provider.improved),
        costRatesConfigured: provider.costRates !== undefined,
    };
}

function emptyReport(config: StagingEvaluationConfig, planCount: number): StagingEvaluationReport {
    const selected = selectedCases(config, CONVERSATION_EVAL_CASES);
    return {
        schemaVersion: STAGING_EVALUATION_SCHEMA_VERSION,
        dryRun: config.dryRun,
        fixtureVersion: config.fixtureVersion,
        fixtureDigest: CONVERSATION_EVAL_DIGEST,
        assertionDigest: CONVERSATION_ASSERTION_DIGEST,
        selectionDigest: conversationDigest(selected.map(({ id, digest }) => ({ id, digest }))),
        promptVersion: config.promptVersion,
        contextVersions: config.contextVersions,
        partition: config.partition,
        repeatCount: config.repeatCount,
        planCount,
        providers: config.providers.map(safeProviderSummary),
        aggregate: aggregateMetrics([]),
        records: [],
    };
}

export async function runStagingEvaluation(
    config: StagingEvaluationConfig,
    options: StagingEvaluationExecutionOptions = {},
): Promise<StagingEvaluationReport> {
    const cases = options.cases ?? CONVERSATION_EVAL_CASES;
    const plan = createStagingEvaluationPlan(config, cases);
    const selectionDigest = conversationDigest(selectedCases(config, cases).map(({ id, digest }) => ({ id, digest })));
    if (config.dryRun) return { ...emptyReport(config, plan.length), selectionDigest };
    if (!config.execute) throw new StagingEvaluationConfigError("EXECUTE_OR_DRY_RUN_REQUIRED");
    if (config.providers.some((provider) => provider.apiKey === undefined)) throw new StagingEvaluationConfigError("MISSING_API_KEY");
    const now = options.now ?? (() => performance.now());
    const transportFactory = options.transportFactory ?? ((_: ConversationProvider, timeoutMs: number) => createFetchConversationTransport(timeoutMs));
    const transports = new Map<ConversationProvider, ConversationTransport>();
    const adapters = new Map<string, ConversationProviderAdapter>();
    const records: StagingEvaluationRecord[] = [];
    for (const planItem of plan) {
        const transport = transports.get(planItem.provider.provider) ?? transportFactory(planItem.provider.provider, config.timeoutMs);
        transports.set(planItem.provider.provider, transport);
        const adapterKey = `${planItem.provider.provider}:${planItem.profile.name}`;
        const adapter = adapters.get(adapterKey) ?? createProviderAdapter(planItem.provider, planItem.profile, transport);
        adapters.set(adapterKey, adapter);
        const request = buildStagingEvaluationRequest(planItem, config);
        const started = now();
        let response: ConversationProviderResponse | undefined;
        let error: { readonly code: string; readonly status?: number } | undefined;
        try {
            response = await adapter.run(request);
        } catch (caught) {
            error = safeError(caught);
        }
        records.push(buildRecord(planItem, config, now() - started, response, error));
    }
    return {
        ...emptyReport(config, plan.length),
        selectionDigest,
        aggregate: aggregateMetrics(records),
        records,
    };
}

export async function writeStagingEvaluationReport(path: string, report: StagingEvaluationReport): Promise<void> {
    if (path.trim().length === 0) throw new StagingEvaluationConfigError("OUTPUT_REQUIRED");
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
}

export function formatStagingEvaluationUsage(): string {
    return [
        "Staging-only synthetic conversation evaluation.",
        "Dry run:",
        "  pnpm --filter ./backend exec ts-node --transpile-only --compiler-options '{\"module\":\"CommonJS\"}' ../evals/conversation/staging-evaluation-runner.ts --dry-run --provider both --google-current-profile google-current --google-improved-profile google-improved --google-current-model gemini-2.5-flash --google-improved-model gemini-2.5-flash --openai-current-profile openai-current --openai-improved-profile openai-improved --openai-current-model gpt-4.1-mini --openai-improved-model gpt-4.1-mini",
        "Live run (explicit --execute; keys are read from CONVERSATION_EVAL_GOOGLE_API_KEY / CONVERSATION_EVAL_OPENAI_API_KEY):",
        "  ... --execute --output /tmp/bjj-conversation-eval.json --repeat 3 --partition holdout",
        "Optional cost rates are USD per 1K tokens: CONVERSATION_EVAL_GOOGLE_INPUT_USD_PER_1K, CONVERSATION_EVAL_GOOGLE_OUTPUT_USD_PER_1K, CONVERSATION_EVAL_OPENAI_INPUT_USD_PER_1K, CONVERSATION_EVAL_OPENAI_OUTPUT_USD_PER_1K.",
        "The report stores only synthetic case IDs, metadata, scores, usage, timings, hashes, and aggregate metrics; prompts, responses, headers, and keys are never written.",
    ].join("\n");
}

async function main(): Promise<void> {
    const argv = process.argv.slice(2);
    if (argv.includes("--help")) {
        process.stdout.write(`${formatStagingEvaluationUsage()}\n`);
        return;
    }
    try {
        const config = parseStagingEvaluationConfig({ argv });
        const report = await runStagingEvaluation(config);
        if (config.dryRun) {
            process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
            return;
        }
        if (config.outputPath === undefined) throw new StagingEvaluationConfigError("OUTPUT_REQUIRED");
        await writeStagingEvaluationReport(config.outputPath, report);
        process.stdout.write(`staging evaluation written: ${config.outputPath}; runs=${report.aggregate.runCount}; errors=${report.aggregate.errorCount}\n`);
    } catch (error) {
        const code = error instanceof StagingEvaluationConfigError ? error.code : "RUN_FAILURE";
        process.stderr.write(`staging evaluation refused: ${code}\n`);
        process.exitCode = 1;
    }
}

if (require.main === module) void main();
