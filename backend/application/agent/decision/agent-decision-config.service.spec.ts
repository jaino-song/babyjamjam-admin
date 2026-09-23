import { GetSettingUsecase } from "application/usecases/system-setting";

import { DECISION_KINDS, type DecisionAcceptanceProfile } from "./decision-contracts";
import {
    AGENT_DECISION_SETTING_KEY,
    AgentDecisionConfigService,
} from "./agent-decision-config.service";

const DEFAULT_LIMITS = {
    turnDeadlineMs: 800,
    maxP0PerTurn: 2,
    maxP1PerTurn: 1,
    maxConcurrentCalls: 4,
    maxCandidates: 10,
};

const ALL_OFF_DEFAULT = {
    globalDisabled: false,
    modelId: "jev-1.13.0",
    samplingFraction: 0,
    limits: DEFAULT_LIMITS,
    kinds: {},
    profiles: {},
};

function makeService(stored: string | null): {
    service: AgentDecisionConfigService;
    execute: jest.Mock;
} {
    const execute = jest.fn().mockResolvedValue(stored);
    const service = new AgentDecisionConfigService({ execute } as unknown as GetSettingUsecase);
    return { service, execute };
}

function validStoredProfile(
    decisionKind: string = DECISION_KINDS.routeDomains,
    overrides: Record<string, unknown> = {},
): Record<string, unknown> {
    return {
        profileVersion: "2026-09-route-v1",
        decisionKind,
        modelId: "jev-1.13.0",
        questionVersion: "v1",
        datasetDigest: "sha256:abcdef1234",
        thresholds: { acceptProbability: 0.8, minMargin: 0.1 },
        approvedScope: ["route-domains"],
        evaluationReference: "evals/agent/jev/route-v1",
        approvalReference: "APPROVAL-2026-09-001",
        ...overrides,
    };
}

describe("AgentDecisionConfigService", () => {
    it("reads the agent.decisions.jev key through GetSettingUsecase", async () => {
        const { service, execute } = makeService(null);
        await service.getConfig();
        expect(execute).toHaveBeenCalledWith(AGENT_DECISION_SETTING_KEY);
    });

    it("returns the all-off default when the setting is missing", async () => {
        const { service } = makeService(null);
        await expect(service.getConfig()).resolves.toEqual(ALL_OFF_DEFAULT);
        for (const kind of Object.values(DECISION_KINDS)) {
            await expect(service.getKindMode(kind)).resolves.toBe("off");
        }
        await expect(service.getAcceptanceProfile(DECISION_KINDS.routeDomains)).resolves.toBeNull();
    });

    it.each([
        ["malformed JSON", "{not-json"],
        ["a JSON array", "[]"],
        ["JSON null", "null"],
        ["a non-string globalDisabled", JSON.stringify({ globalDisabled: "yes" })],
        ["an out-of-range samplingFraction", JSON.stringify({ samplingFraction: 1.5 })],
        ["an unknown per-kind mode", JSON.stringify({ kinds: { "route-domains": { mode: "live" } } })],
        ["an out-of-range limit", JSON.stringify({ limits: { turnDeadlineMs: 0 } })],
        ["a non-object limits value", JSON.stringify({ limits: "fast" })],
    ])("fails closed to the all-off default on %s", async (_label, stored) => {
        const { service } = makeService(stored as string);
        await expect(service.getConfig()).resolves.toEqual(ALL_OFF_DEFAULT);
        await expect(service.getKindMode(DECISION_KINDS.routeDomains)).resolves.toBe("off");
        await expect(service.getKindMode(DECISION_KINDS.rankCandidates)).resolves.toBe("off");
    });

    it("fails closed to the all-off default when the setting read rejects", async () => {
        const execute = jest.fn().mockRejectedValue(new Error("db down"));
        const service = new AgentDecisionConfigService({ execute } as unknown as GetSettingUsecase);
        await expect(service.getConfig()).resolves.toEqual(ALL_OFF_DEFAULT);
        await expect(service.getKindMode(DECISION_KINDS.routeDomains)).resolves.toBe("off");
    });

    it("gives globalDisabled precedence over a per-kind enforce mode", async () => {
        const { service } = makeService(JSON.stringify({
            globalDisabled: true,
            kinds: { [DECISION_KINDS.routeDomains]: { mode: "enforce" } },
        }));
        await expect(service.getKindMode(DECISION_KINDS.routeDomains)).resolves.toBe("off");
    });

    it("resolves per-kind modes and defaults unlisted kinds to off", async () => {
        const { service } = makeService(JSON.stringify({
            kinds: {
                [DECISION_KINDS.routeDomains]: { mode: "shadow" },
                [DECISION_KINDS.classifyClientIntent]: { mode: "enforce" },
            },
        }));
        await expect(service.getKindMode(DECISION_KINDS.routeDomains)).resolves.toBe("shadow");
        await expect(service.getKindMode(DECISION_KINDS.classifyClientIntent)).resolves.toBe("enforce");
        await expect(service.getKindMode(DECISION_KINDS.evaluateClarification)).resolves.toBe("off");
        await expect(service.getKindMode(DECISION_KINDS.rankCandidates)).resolves.toBe("off");
    });

    it.each([
        ["an empty modelId", { modelId: "" }],
        ["a missing questionVersion", { questionVersion: undefined }],
        ["an empty datasetDigest", { datasetDigest: "" }],
        ["an empty profileVersion", { profileVersion: "" }],
        ["an empty approvedScope", { approvedScope: [] }],
        ["an empty evaluationReference", { evaluationReference: "" }],
        ["an empty approvalReference", { approvalReference: "" }],
        ["an out-of-range acceptProbability", { thresholds: { acceptProbability: 1.2, minMargin: 0.1 } }],
        ["a negative minMargin", { thresholds: { acceptProbability: 0.8, minMargin: -0.1 } }],
        ["a non-finite threshold", { thresholds: { acceptProbability: 0.8, minMargin: Number.NaN } }],
    ])("returns null for a profile with %s", async (_label, overrides) => {
        const { service } = makeService(JSON.stringify({
            profiles: {
                [DECISION_KINDS.routeDomains]: validStoredProfile(DECISION_KINDS.routeDomains, overrides),
            },
        }));
        await expect(service.getAcceptanceProfile(DECISION_KINDS.routeDomains)).resolves.toBeNull();
    });

    it("returns null when a profile is stored under a mismatching kind key", async () => {
        const { service } = makeService(JSON.stringify({
            profiles: {
                [DECISION_KINDS.routeDomains]: validStoredProfile(DECISION_KINDS.rankCandidates),
            },
        }));
        await expect(service.getAcceptanceProfile(DECISION_KINDS.routeDomains)).resolves.toBeNull();
    });

    it("returns null when no profile is configured for the kind", async () => {
        const { service } = makeService(JSON.stringify({
            profiles: {
                [DECISION_KINDS.rankCandidates]: validStoredProfile(DECISION_KINDS.rankCandidates),
            },
        }));
        await expect(service.getAcceptanceProfile(DECISION_KINDS.routeDomains)).resolves.toBeNull();
    });

    it("returns the parsed profile when it passes the strict schema for the kind", async () => {
        const stored = validStoredProfile(DECISION_KINDS.routeDomains);
        const { service } = makeService(JSON.stringify({
            kinds: { [DECISION_KINDS.routeDomains]: { mode: "enforce" } },
            profiles: { [DECISION_KINDS.routeDomains]: stored },
        }));
        const profile: DecisionAcceptanceProfile | null =
            await service.getAcceptanceProfile(DECISION_KINDS.routeDomains);
        expect(profile).toEqual(stored);
    });

    it("keeps mode resolution working when a stored profile is invalid", async () => {
        const { service } = makeService(JSON.stringify({
            kinds: { [DECISION_KINDS.routeDomains]: { mode: "shadow" } },
            profiles: { [DECISION_KINDS.routeDomains]: { modelId: "" } },
        }));
        await expect(service.getKindMode(DECISION_KINDS.routeDomains)).resolves.toBe("shadow");
        await expect(service.getAcceptanceProfile(DECISION_KINDS.routeDomains)).resolves.toBeNull();
    });

    it("fills fail-closed limit defaults for a partial limits object", async () => {
        const { service } = makeService(JSON.stringify({ limits: { turnDeadlineMs: 250 } }));
        const config = await service.getConfig();
        expect(config.limits).toEqual({ ...DEFAULT_LIMITS, turnDeadlineMs: 250 });
    });

    it("caches the setting for the TTL and re-reads afterwards", async () => {
        jest.useFakeTimers();
        try {
            jest.setSystemTime(new Date("2026-09-22T00:00:00Z"));
            const { service, execute } = makeService(JSON.stringify({
                kinds: { [DECISION_KINDS.routeDomains]: { mode: "shadow" } },
            }));

            await service.getConfig();
            expect(execute).toHaveBeenCalledTimes(1);

            // Inside the TTL: no re-read, including via getKindMode.
            await service.getConfig();
            await service.getKindMode(DECISION_KINDS.routeDomains);
            expect(execute).toHaveBeenCalledTimes(1);

            jest.advanceTimersByTime(29_999);
            await service.getConfig();
            expect(execute).toHaveBeenCalledTimes(1);

            jest.advanceTimersByTime(1);
            await service.getConfig();
            expect(execute).toHaveBeenCalledTimes(2);
        } finally {
            jest.useRealTimers();
        }
    });
});
