/**
 * Offline tests for the Jev release-readiness checker. Every fixture in this
 * file is SYNTHETIC (labelled as such) and internally consistent: no real
 * model output, no production scores, no network, no database, no settings.
 * The committed draft profile is checked only against the real committed
 * fixture state (no evidence yet), which must fail closed.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
    EVIDENCE_REPORT_SCHEMA_VERSION,
    evaluateJevReadiness,
    isPlaceholderApprovalReference,
    READINESS_RESULT_SCHEMA_VERSION,
    READINESS_REASONS,
    RELEASE_PROFILE_SCHEMA_VERSION,
    type JevReadinessResult,
} from "./check-jev-readiness";

const CHECKER_PATH = resolve(__dirname, "./check-jev-readiness.ts");
const TS_NODE_BIN = resolve(__dirname, "../../node_modules/.bin/ts-node");
const BACKEND_TSCONFIG = resolve(__dirname, "../../tsconfig.json");
const DRAFT_PROFILE_PATH = resolve(__dirname, "../../../evals/agent/jev/release-profile-v1.json");

/** Synthetic digest constant — never a real dataset digest. */
const SYNTHETIC_DIGEST = "a".repeat(64);
const SYNTHETIC_OTHER_DIGEST = "b".repeat(64);
/** Synthetic model id matching the pinned-versioned-id shape, not a real model. */
const SYNTHETIC_MODEL_ID = "synthetic-eval-model-1.0.0";
const FIXED_CLOCK = new Date("2026-01-15T09:30:00.000Z");

// ---------------------------------------------------------------------------
// Synthetic fixture builders (isolated; internally consistent by construction)
// ---------------------------------------------------------------------------

interface MutableRecord {
    [key: string]: unknown;
}

function syntheticProfile(): MutableRecord {
    return {
        schemaVersion: RELEASE_PROFILE_SCHEMA_VERSION,
        profileVersion: "synthetic-profile-1",
        enabled: false,
        notes: "SYNTHETIC test profile — not a real release configuration",
        kinds: [
            {
                decisionKind: "classify-client-intent",
                modelId: SYNTHETIC_MODEL_ID,
                questionVersion: "v1",
                datasetDigest: SYNTHETIC_DIGEST,
                thresholds: {
                    minCoverage: 0.5,
                    minAgreement: 0.8,
                    maxAbstentionRate: 0.5,
                    requireHoldoutSplit: true,
                    requireHumanReference: true,
                },
                approvedScope: ["branch", "internal"],
                approvalReference: "PENDING: synthetic placeholder, not an approval",
            },
        ],
    };
}

function syntheticEvidence(): MutableRecord {
    return {
        schemaVersion: EVIDENCE_REPORT_SCHEMA_VERSION,
        modelId: SYNTHETIC_MODEL_ID,
        questionVersion: "v1",
        datasetDigest: SYNTHETIC_DIGEST,
        notes: "SYNTHETIC evaluation evidence — hand-computed counts, not a real run",
        kinds: [
            {
                decisionKind: "classify-client-intent",
                rawCounts: {
                    labeledCount: 10,
                    evaluatedCount: 10,
                    acceptedCount: 8,
                    abstainedCount: 2,
                    unavailableCount: 0,
                    missingPredictionCount: 0,
                    correctCount: 7,
                    humanReferenceComparisons: { comparableCount: 10, agreedCount: 9 },
                },
                metrics: {
                    coverage: { numerator: 8, denominator: 10, value: 0.8 },
                    abstentionRate: { numerator: 2, denominator: 10, value: 0.2 },
                    precision: { numerator: 7, denominator: 8, value: 0.875 },
                    agreement: { numerator: 9, denominator: 10, value: 0.9 },
                },
                holdoutSplit: { present: true, caseCount: 4 },
                humanReference: { present: true, caseCount: 10 },
            },
        ],
    };
}

function check(
    profile: unknown = syntheticProfile(),
    evidence: unknown | null = syntheticEvidence(),
    clock: Date = FIXED_CLOCK,
): JevReadinessResult {
    return evaluateJevReadiness(profile, evidence, clock);
}

function tokens(result: JevReadinessResult): string[] {
    return result.reasons.map((item) => item.token);
}

function mutatedProfile(mutate: (profile: MutableRecord) => void): MutableRecord {
    const profile = syntheticProfile();
    mutate(profile);
    return profile;
}

function mutatedEvidence(mutate: (evidence: MutableRecord) => void): MutableRecord {
    const evidence = syntheticEvidence();
    mutate(evidence);
    return evidence;
}

// ---------------------------------------------------------------------------
// 1. Valid synthetic evidence passes
// ---------------------------------------------------------------------------

describe("valid synthetic evidence", () => {
    it("is ready with no reasons for an internally consistent synthetic profile + report", () => {
        const result = check();
        expect(result.ready).toBe(true);
        expect(result.reasons).toEqual([]);
        expect(result.schemaVersion).toBe(READINESS_RESULT_SCHEMA_VERSION);
        expect(result.profileVersion).toBe("synthetic-profile-1");
        expect(result.checkedAt).toBe(FIXED_CLOCK.toISOString());
    });

    it("stays ready when enforcement is requested with a non-placeholder approval reference", () => {
        const profile = mutatedProfile((item) => {
            item["enabled"] = true;
            const kind = (item["kinds"] as MutableRecord[])[0]!;
            kind["approvalReference"] = "OP-APPROVAL-2026-0001";
        });
        expect(check(profile).ready).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// 2. Every failure mode blocks with its precise machine-token reason
// ---------------------------------------------------------------------------

describe("failure modes block with precise reasons", () => {
    it("blocks on a mismatched model id", () => {
        const evidence = mutatedEvidence((item) => {
            item["modelId"] = "different-synthetic-model-2.0.0";
        });
        const result = check(syntheticProfile(), evidence);
        expect(result.ready).toBe(false);
        expect(tokens(result)).toEqual([READINESS_REASONS.evidenceModelMismatch]);
        expect(result.reasons[0]!.detail).toContain("modelId");
    });

    it("blocks on a mismatched question version", () => {
        const evidence = mutatedEvidence((item) => {
            item["questionVersion"] = "v0";
        });
        const result = check(syntheticProfile(), evidence);
        expect(result.ready).toBe(false);
        expect(tokens(result)).toEqual([READINESS_REASONS.evidenceQuestionVersionMismatch]);
        expect(result.reasons[0]!.detail).toContain("questionVersion");
    });

    it("blocks on a mismatched dataset digest", () => {
        const evidence = mutatedEvidence((item) => {
            item["datasetDigest"] = SYNTHETIC_OTHER_DIGEST;
        });
        const result = check(syntheticProfile(), evidence);
        expect(result.ready).toBe(false);
        expect(tokens(result)).toEqual([READINESS_REASONS.evidenceDatasetDigestMismatch]);
        expect(result.reasons[0]!.detail).toContain("datasetDigest");
    });

    it("blocks when the evidence is keyed to the wrong decision kind", () => {
        const profile = syntheticProfile();
        const evidence = mutatedEvidence((item) => {
            const kind = (item["kinds"] as MutableRecord[])[0]!;
            kind["decisionKind"] = "rank-candidates";
        });
        const result = check(profile, evidence);
        expect(result.ready).toBe(false);
        // The undeclared evidence kind and the uncovered profile kind are
        // both reported as kind mismatches.
        expect(tokens(result)).toEqual([
            READINESS_REASONS.evidenceKindMismatch,
            READINESS_REASONS.evidenceKindMismatch,
        ]);
        expect(result.reasons[0]!.detail).toContain("rank-candidates");
        expect(result.reasons[1]!.detail).toContain("classify-client-intent");
    });

    it("blocks when a required metric is missing its numerator/denominator", () => {
        const evidence = mutatedEvidence((item) => {
            const metrics = ((item["kinds"] as MutableRecord[])[0]!["metrics"]) as MutableRecord;
            delete metrics["precision"];
        });
        const result = check(syntheticProfile(), evidence);
        expect(result.ready).toBe(false);
        expect(tokens(result)).toEqual([READINESS_REASONS.metricDenominatorMissing]);
    });

    it("blocks when a metric is a bare percentage without numerator/denominator", () => {
        const evidence = mutatedEvidence((item) => {
            const metrics = ((item["kinds"] as MutableRecord[])[0]!["metrics"]) as MutableRecord;
            metrics["precision"] = 0.875;
        });
        const result = check(syntheticProfile(), evidence);
        expect(result.ready).toBe(false);
        expect(tokens(result)).toEqual([READINESS_REASONS.metricDenominatorMissing]);
    });

    it("blocks on a zero denominator", () => {
        const evidence = mutatedEvidence((item) => {
            const metrics = ((item["kinds"] as MutableRecord[])[0]!["metrics"]) as MutableRecord;
            metrics["precision"] = { numerator: 0, denominator: 0, value: 0 };
        });
        const result = check(syntheticProfile(), evidence);
        expect(result.ready).toBe(false);
        expect(tokens(result)).toEqual([READINESS_REASONS.metricDenominatorZero]);
    });

    it("blocks when a reported value disagrees with numerator/denominator", () => {
        const evidence = mutatedEvidence((item) => {
            const metrics = ((item["kinds"] as MutableRecord[])[0]!["metrics"]) as MutableRecord;
            metrics["precision"] = { numerator: 7, denominator: 8, value: 0.9 };
        });
        const result = check(syntheticProfile(), evidence);
        expect(result.ready).toBe(false);
        expect(tokens(result)).toEqual([READINESS_REASONS.metricValueDisagreement]);
    });

    it("blocks when numerator/denominator disagree with the raw counts", () => {
        const evidence = mutatedEvidence((item) => {
            const metrics = ((item["kinds"] as MutableRecord[])[0]!["metrics"]) as MutableRecord;
            // Internally consistent triple (6/8 = 0.75) that contradicts the
            // raw correctCount of 7 over an acceptedCount of 8.
            metrics["precision"] = { numerator: 6, denominator: 8, value: 0.75 };
        });
        const result = check(syntheticProfile(), evidence);
        expect(result.ready).toBe(false);
        expect(tokens(result)).toEqual([READINESS_REASONS.metricCountsDisagreement]);
        expect(result.reasons[0]!.detail).toContain("raw counts");
    });

    it("blocks on structurally impossible raw counts", () => {
        const evidence = mutatedEvidence((item) => {
            const counts = ((item["kinds"] as MutableRecord[])[0]!["rawCounts"]) as MutableRecord;
            counts["unavailableCount"] = 1; // 8 + 2 + 1 != evaluated 10
        });
        const result = check(syntheticProfile(), evidence);
        expect(result.ready).toBe(false);
        expect(tokens(result)).toEqual([READINESS_REASONS.rawCountsInconsistent]);
    });

    it("blocks when coverage is below the profile floor", () => {
        const profile = mutatedProfile((item) => {
            const kind = (item["kinds"] as MutableRecord[])[0]!;
            (kind["thresholds"] as MutableRecord)["minCoverage"] = 0.9;
        });
        const result = check(profile, syntheticEvidence());
        expect(result.ready).toBe(false);
        expect(tokens(result)).toEqual([READINESS_REASONS.coverageBelowFloor]);
    });

    it("blocks when abstention is above the profile ceiling", () => {
        const profile = mutatedProfile((item) => {
            const kind = (item["kinds"] as MutableRecord[])[0]!;
            (kind["thresholds"] as MutableRecord)["maxAbstentionRate"] = 0.1;
        });
        const result = check(profile, syntheticEvidence());
        expect(result.ready).toBe(false);
        expect(tokens(result)).toEqual([READINESS_REASONS.abstentionAboveCeiling]);
    });

    it("blocks when agreement is below the profile floor", () => {
        const profile = mutatedProfile((item) => {
            const kind = (item["kinds"] as MutableRecord[])[0]!;
            (kind["thresholds"] as MutableRecord)["minAgreement"] = 0.95;
        });
        const result = check(profile, syntheticEvidence());
        expect(result.ready).toBe(false);
        expect(tokens(result)).toEqual([READINESS_REASONS.agreementBelowFloor]);
    });

    it("blocks when the held-out split is missing", () => {
        const evidence = mutatedEvidence((item) => {
            const kind = (item["kinds"] as MutableRecord[])[0]!;
            kind["holdoutSplit"] = { present: false, caseCount: 0 };
        });
        const result = check(syntheticProfile(), evidence);
        expect(result.ready).toBe(false);
        expect(tokens(result)).toEqual([READINESS_REASONS.holdoutSplitMissing]);
    });

    it("blocks when the human reference is missing", () => {
        const evidence = mutatedEvidence((item) => {
            const kind = (item["kinds"] as MutableRecord[])[0]!;
            kind["humanReference"] = { present: false, caseCount: 0 };
        });
        const result = check(syntheticProfile(), evidence);
        expect(result.ready).toBe(false);
        expect(tokens(result)).toEqual([READINESS_REASONS.humanReferenceMissing]);
    });

    it("blocks on a wildcard rollout scope", () => {
        const profile = mutatedProfile((item) => {
            const kind = (item["kinds"] as MutableRecord[])[0]!;
            kind["approvedScope"] = ["*"];
        });
        const result = check(profile, syntheticEvidence());
        expect(result.ready).toBe(false);
        expect(tokens(result)).toEqual([READINESS_REASONS.scopeNotAllowlist]);
        expect(result.reasons[0]!.detail).toContain('"*"');
        expect(result.reasons[0]!.detail).toContain("branch/internal");
    });

    it("blocks on an unknown rollout scope", () => {
        const profile = mutatedProfile((item) => {
            const kind = (item["kinds"] as MutableRecord[])[0]!;
            kind["approvedScope"] = ["production"];
        });
        const result = check(profile, syntheticEvidence());
        expect(result.ready).toBe(false);
        expect(tokens(result)).toEqual([READINESS_REASONS.scopeNotAllowlist]);
    });

    it("blocks enforcement requested without a real approval reference", () => {
        const profile = mutatedProfile((item) => {
            item["enabled"] = true; // approvalReference stays the PENDING placeholder
        });
        const result = check(profile, syntheticEvidence());
        expect(result.ready).toBe(false);
        expect(tokens(result)).toEqual([READINESS_REASONS.enforcementWithoutApproval]);
    });

    it("blocks on a malformed profile", () => {
        expect(check({}, syntheticEvidence()).reasons.map((item) => item.token))
            .toEqual([READINESS_REASONS.profileInvalid]);
        expect(check(null, syntheticEvidence()).reasons.map((item) => item.token))
            .toEqual([READINESS_REASONS.profileInvalid]);
        expect(check({ schemaVersion: "nope" }, syntheticEvidence()).reasons.map((item) => item.token))
            .toEqual([READINESS_REASONS.profileInvalid]);
        const unknownKey = mutatedProfile((item) => {
            item["surprise"] = true;
        });
        expect(check(unknownKey, syntheticEvidence()).reasons.map((item) => item.token))
            .toEqual([READINESS_REASONS.profileInvalid]);
        const aliasModel = mutatedProfile((item) => {
            const kind = (item["kinds"] as MutableRecord[])[0]!;
            kind["modelId"] = "gemini-flash-latest"; // moving alias, no pinned version
        });
        expect(check(aliasModel, syntheticEvidence()).reasons.map((item) => item.token))
            .toEqual([READINESS_REASONS.profileInvalid]);
        const malformed = check({ schemaVersion: "nope" }, syntheticEvidence(), FIXED_CLOCK);
        expect(malformed.profileVersion).toBeNull();
    });

    it("blocks on malformed evidence", () => {
        const result = check(syntheticProfile(), { schemaVersion: "nope" });
        expect(result.ready).toBe(false);
        expect(tokens(result)).toEqual([READINESS_REASONS.evidenceInvalid]);

        const unknownMetric = mutatedEvidence((item) => {
            const metrics = ((item["kinds"] as MutableRecord[])[0]!["metrics"]) as MutableRecord;
            metrics["f1Score"] = { numerator: 1, denominator: 2, value: 0.5 };
        });
        expect(check(syntheticProfile(), unknownMetric).reasons.map((item) => item.token))
            .toEqual([READINESS_REASONS.evidenceInvalid]);
    });
});

// ---------------------------------------------------------------------------
// 3. The committed draft profile must fail closed with the exact reason token
// ---------------------------------------------------------------------------

describe("committed draft profile", () => {
    it("is off by default with a placeholder approval reference", () => {
        const raw = JSON.parse(readFileSync(DRAFT_PROFILE_PATH, "utf8")) as MutableRecord;
        expect(raw["schemaVersion"]).toBe(RELEASE_PROFILE_SCHEMA_VERSION);
        expect(raw["enabled"]).toBe(false);
        const kinds = raw["kinds"] as MutableRecord[];
        expect(kinds.length).toBeGreaterThan(0);
        for (const kind of kinds) {
            expect(isPlaceholderApprovalReference(kind["approvalReference"] as string)).toBe(true);
        }
    });

    it("is not ready against the committed fixture state (no evidence yet) with reason 'evidence-missing'", () => {
        const raw = JSON.parse(readFileSync(DRAFT_PROFILE_PATH, "utf8"));
        const result = check(raw, null, FIXED_CLOCK);
        expect(result.ready).toBe(false);
        expect(result.profileVersion).toBe("release-profile-v1-draft");
        expect(tokens(result)).toEqual([READINESS_REASONS.evidenceMissing]);
    });
});

// ---------------------------------------------------------------------------
// 4. The checker performs no writes, no network, no settings access
// ---------------------------------------------------------------------------

describe("no mutation", () => {
    function checkerSource(): string {
        return readFileSync(CHECKER_PATH, "utf8");
    }

    it("imports nothing beyond node:fs readFileSync and the decision contracts", () => {
        const source = checkerSource();
        const importModules = [
            ...source.matchAll(/import\s+(?:type\s+)?(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+"([^"]+)"/g),
        ].map((match) => match[1]!);
        expect(importModules.length).toBeGreaterThan(0);
        for (const module of importModules) {
            expect(["node:fs", "../../application/agent/decision/decision-contracts"]).toContain(module);
        }
        // The only node builtin import is readFileSync — no write-capable fs API.
        expect(source).toContain('import { readFileSync } from "node:fs";');
        expect(source.match(/from "node:fs"/g)).toHaveLength(1);
    });

    it("contains no write, network, or settings/database access anywhere in the module", () => {
        const source = checkerSource();
        expect(source).not.toMatch(/writeFileSync|appendFileSync|mkdirSync|rmSync|unlinkSync|rmdirSync|fs\/promises/);
        expect(source).not.toMatch(/node:(http|https|net|tls|dns|child_process)|\bfetch\s*\(/);
        expect(source).not.toMatch(/GetSettingUsecase|AgentDecisionConfigService|PrismaService|ConfigService/);
    });

    it("writes nothing when run as a CLI from an empty temp working directory", () => {
        const tmp = mkdtempSync(join(tmpdir(), "jev-readiness-mutation-"));
        try {
            const profilePath = join(tmp, "profile.json");
            const evidencePath = join(tmp, "evidence.json");
            writeFileSync(profilePath, JSON.stringify(syntheticProfile()), "utf8");
            writeFileSync(evidencePath, JSON.stringify(syntheticEvidence()), "utf8");
            const before = readdirSync(tmp).sort();

            const spawned = spawnSync(
                TS_NODE_BIN,
                [CHECKER_PATH, `--profile=${profilePath}`, `--evidence=${evidencePath}`],
                {
                    cwd: tmp,
                    encoding: "utf8",
                    env: { ...process.env, TS_NODE_PROJECT: BACKEND_TSCONFIG },
                },
            );
            expect(spawned.error).toBeUndefined();
            expect(spawned.status).toBe(0);

            // The temp cwd is unchanged and holds only the two input files.
            expect(readdirSync(tmp).sort()).toEqual(before);

            const parsed = JSON.parse(spawned.stdout ?? "") as JevReadinessResult;
            expect(parsed.ready).toBe(true);
            expect(parsed.schemaVersion).toBe(READINESS_RESULT_SCHEMA_VERSION);
        } finally {
            if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
        }
    }, 120000);

    it("exits non-zero for the committed draft profile when run as a CLI (designed fail-closed)", () => {
        const tmp = mkdtempSync(join(tmpdir(), "jev-readiness-draft-"));
        try {
            const spawned = spawnSync(
                TS_NODE_BIN,
                [CHECKER_PATH, `--profile=${DRAFT_PROFILE_PATH}`],
                {
                    encoding: "utf8",
                    env: { ...process.env, TS_NODE_PROJECT: BACKEND_TSCONFIG },
                },
            );
            expect(spawned.status).toBe(1);
            const parsed = JSON.parse(spawned.stdout ?? "") as JevReadinessResult;
            expect(parsed.ready).toBe(false);
            expect(tokens(parsed)).toEqual([READINESS_REASONS.evidenceMissing]);
        } finally {
            rmSync(tmp, { recursive: true, force: true });
        }
    }, 120000);
});

// ---------------------------------------------------------------------------
// 5. Determinism: identical inputs produce an identical result
// ---------------------------------------------------------------------------

describe("determinism", () => {
    it("produces byte-identical results for identical inputs and an injected clock", () => {
        const first = check();
        const second = check();
        expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    });

    it("changes only checkedAt when the injected clock changes", () => {
        const first = check(syntheticProfile(), syntheticEvidence(), FIXED_CLOCK);
        const later = check(syntheticProfile(), syntheticEvidence(), new Date("2026-02-01T00:00:00.000Z"));
        expect(later.checkedAt).toBe("2026-02-01T00:00:00.000Z");
        const withoutClock = { ...later, checkedAt: first.checkedAt };
        expect(JSON.stringify(withoutClock)).toBe(JSON.stringify(first));
    });

    it("keeps reason order stable across repeated failing evaluations", () => {
        const profile = mutatedProfile((item) => {
            item["enabled"] = true;
            const kind = (item["kinds"] as MutableRecord[])[0]!;
            kind["approvedScope"] = ["*"];
        });
        const evidence = mutatedEvidence((item) => {
            item["modelId"] = "different-synthetic-model-2.0.0";
        });
        const first = check(profile, evidence);
        const second = check(profile, evidence);
        expect(second.ready).toBe(false);
        expect(tokens(second)).toEqual(tokens(first));
        expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    });
});

// ---------------------------------------------------------------------------
// Placeholder approval reference detection
// ---------------------------------------------------------------------------

describe("isPlaceholderApprovalReference", () => {
    it("recognizes reserved placeholder prefixes and empty references", () => {
        expect(isPlaceholderApprovalReference("PENDING: operator approval required")).toBe(true);
        expect(isPlaceholderApprovalReference("NOT-APPROVED: draft")).toBe(true);
        expect(isPlaceholderApprovalReference("placeholder reference")).toBe(true);
        expect(isPlaceholderApprovalReference("TBD")).toBe(true);
        expect(isPlaceholderApprovalReference("   ")).toBe(true);
        expect(isPlaceholderApprovalReference("")).toBe(true);
    });

    it("does not treat a real reference token as a placeholder", () => {
        expect(isPlaceholderApprovalReference("OP-APPROVAL-2026-0001")).toBe(false);
        expect(isPlaceholderApprovalReference("decision-record/jev/2026-01-15")).toBe(false);
    });
});
