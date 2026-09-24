import { Injectable } from "@nestjs/common";
import { z } from "zod";

import { GetSettingUsecase } from "application/usecases/system-setting";

import {
    DECISION_KINDS,
    DECISION_MODES,
    type DecisionAcceptanceProfile,
    type DecisionKind,
    type DecisionMode,
} from "./decision-contracts";

/**
 * Read-only configuration view for the Jev semantic decision layer.
 *
 * The setting is written by existing operational mechanisms only: this
 * service deliberately exposes no update/setter method. Every read is
 * fail-closed — a missing value, malformed JSON, or schema failure returns
 * the all-off default (never throws, never partially applies). Returned
 * values contain only the bounded fields below: no provider key and no
 * credential ever flows through this service.
 */

export const AGENT_DECISION_SETTING_KEY = "agent.decisions.jev";

/**
 * Deployment-environment gate: JEV stays fully off (every kind resolves to
 * `off`, same as `globalDisabled`) unless this env var is set, non-empty
 * after trim, and its value is listed in the stored config's `environments`.
 * Preview and production share one DB row, so this is the mechanism that
 * lets an operator turn JEV on for one deployment without the other.
 */
export const AGENT_DECISION_ENVIRONMENT_ENV_VAR = "AGENT_DECISION_ENVIRONMENT";

/** Mirrors AgentFlagsService: 30s cache between setting reads. */
const CACHE_TTL_MS = 30_000;

/**
 * Fail-closed default model id. Kept as a literal (not imported from the
 * infrastructure adapter) so the application layer stays on the port only;
 * both must move together when the pinned model changes.
 */
const DEFAULT_MODEL_ID = "jev-1.13.0";

const DECISION_MODE_VALUES = Object.values(DECISION_MODES) as [DecisionMode, ...DecisionMode[]];
const DECISION_KIND_VALUES = Object.values(DECISION_KINDS) as [DecisionKind, ...DecisionKind[]];

/**
 * Strict acceptance-profile schema used by {@link getAcceptanceProfile}.
 * A profile is usable only when every governance reference is present and
 * non-empty, both thresholds are finite values in 0..1, and the scope is
 * non-empty; anything else degrades to `null` (enforce stays closed).
 */
export const AgentDecisionAcceptanceProfileSchema = z.object({
    profileVersion: z.string().min(1),
    decisionKind: z.enum(DECISION_KIND_VALUES),
    modelId: z.string().min(1),
    questionVersion: z.string().min(1),
    datasetDigest: z.string().min(1),
    thresholds: z.object({
        acceptProbability: z.number().min(0).max(1),
        minMargin: z.number().min(0).max(1),
    }),
    approvedScope: z.array(z.string().min(1)).min(1),
    evaluationReference: z.string().min(1),
    approvalReference: z.string().min(1),
});

const AgentDecisionLimitsSchema = z.object({
    /**
     * Per-call deadline budget in ms, applied fresh to each admitted port
     * call (`Date.now() + turnDeadlineMs` at admission time) — not a single
     * deadline for the whole turn. See AgentDecisionService.evaluate().
     */
    turnDeadlineMs: z.number().int().min(1).max(10000).default(800),
    maxP0PerTurn: z.number().int().min(0).max(10).default(2),
    maxP1PerTurn: z.number().int().min(0).max(10).default(1),
    maxConcurrentCalls: z.number().int().min(1).max(16).default(4),
    maxCandidates: z.number().int().min(1).max(50).default(10),
});

const AgentDecisionKindModeSchema = z.object({
    mode: z.enum(DECISION_MODE_VALUES),
});

const AgentDecisionKindModesSchema = z.record(z.string(), AgentDecisionKindModeSchema);
const AgentDecisionProfilesSchema = z.record(z.string(), z.unknown());

/**
 * Stored config schema. `limits`/`kinds`/`profiles` are optional at the top
 * level; when absent they are parsed from `{}` so every inner fail-closed
 * default applies. A stored value of the wrong type still fails the parse
 * and the caller maps any failure to the all-off default.
 */
export const AgentDecisionConfigSchema = z.object({
    globalDisabled: z.boolean().default(false),
    modelId: z.string().default(DEFAULT_MODEL_ID),
    samplingFraction: z.number().min(0).max(1).default(0),
    /**
     * Deployment environments where JEV may run at all. Empty (the default)
     * means all-off everywhere: see {@link AGENT_DECISION_ENVIRONMENT_ENV_VAR}.
     */
    environments: z.array(z.string().min(1)).default([]),
    /**
     * Branch allowlist. Empty (the default) means no branch is in scope, so
     * every kind resolves as if disabled for every turn.
     */
    allowedBranchIds: z.array(z.string().min(1)).default([]),
    limits: AgentDecisionLimitsSchema
        .optional()
        .transform((value) => AgentDecisionLimitsSchema.parse(value ?? {})),
    kinds: AgentDecisionKindModesSchema
        .optional()
        .transform((value) => AgentDecisionKindModesSchema.parse(value ?? {})),
    profiles: AgentDecisionProfilesSchema
        .optional()
        .transform((value) => AgentDecisionProfilesSchema.parse(value ?? {})),
});

export type AgentDecisionConfig = z.infer<typeof AgentDecisionConfigSchema>;

@Injectable()
export class AgentDecisionConfigService {
    private cache: { raw: AgentDecisionConfig; expiresAt: number } | null = null;

    constructor(private readonly getSettingUsecase: GetSettingUsecase) {}

    async getConfig(): Promise<AgentDecisionConfig> {
        const now = Date.now();
        if (this.cache !== null && this.cache.expiresAt > now) {
            return this.cache.raw;
        }
        const config = await this.readAndParseConfig();
        this.cache = { raw: config, expiresAt: now + CACHE_TTL_MS };
        return config;
    }

    /**
     * `globalDisabled` is authoritative: it forces every kind to `off`.
     * The environment gate is checked next, with the same effect: it never
     * partially applies a stored per-kind mode.
     */
    async getKindMode(kind: DecisionKind): Promise<DecisionMode> {
        const config = await this.getConfig();
        if (config.globalDisabled) return DECISION_MODES.off;
        if (!this.isEnvironmentInScope(config)) return DECISION_MODES.off;
        const entry = config.kinds[kind];
        return entry?.mode ?? DECISION_MODES.off;
    }

    /**
     * True only when {@link AGENT_DECISION_ENVIRONMENT_ENV_VAR} is set,
     * non-empty after trim, and listed in the stored config's `environments`.
     * An empty `environments` array can never match anything.
     */
    private isEnvironmentInScope(config: AgentDecisionConfig): boolean {
        const raw = process.env[AGENT_DECISION_ENVIRONMENT_ENV_VAR];
        const trimmed = typeof raw === "string" ? raw.trim() : "";
        if (trimmed.length === 0) return false;
        return config.environments.includes(trimmed);
    }

    /**
     * Returns the stored acceptance profile for `kind` only when it passes
     * the strict profile schema and its `decisionKind` matches; otherwise
     * `null`. A broken profile never turns a kind off — it only keeps the
     * enforce gate closed.
     */
    async getAcceptanceProfile(kind: DecisionKind): Promise<DecisionAcceptanceProfile | null> {
        const config = await this.getConfig();
        const stored = config.profiles[kind];
        if (stored === null || typeof stored !== "object" || Array.isArray(stored)) return null;
        const parsed = AgentDecisionAcceptanceProfileSchema.safeParse(stored);
        if (!parsed.success) return null;
        if (parsed.data.decisionKind !== kind) return null;
        return parsed.data;
    }

    /** Never throws: every failure mode below lands on the all-off default. */
    private async readAndParseConfig(): Promise<AgentDecisionConfig> {
        try {
            const stored = await this.getSettingUsecase.execute(AGENT_DECISION_SETTING_KEY);
            if (stored === null) return AgentDecisionConfigSchema.parse({});
            return AgentDecisionConfigSchema.parse(JSON.parse(stored));
        } catch {
            // Fail closed: the default is all-off, so a parse failure can
            // never partially apply a stored value.
            return AgentDecisionConfigSchema.parse({});
        }
    }
}
