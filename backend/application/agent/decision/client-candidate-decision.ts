import type { CandidateProjection } from "./agent-decision.port";
// `CandidateEvidence` is declared in the decision contracts and re-used by the
// port; the port file does not re-export it, so the type is imported from its
// declaring contract module (same pattern as `client-intent-decision.ts`).
import type { CandidateEvidence } from "./decision-contracts";

/**
 * Bounded client candidate suggestion helper (AC-21..AC-24).
 *
 * `buildClientCandidateRequest` projects the current bounded client shortlist
 * into an anonymous, allowlisted candidate request: labels are positional
 * (`C1`..`C10`) and never derived from data, and facts are a closed vocabulary
 * of machine tokens or comparisons computed locally from the server reference
 * date. The existing client references never enter the model request — they
 * live only in the internal `labelToRef` map of the returned build.
 *
 * `validateCandidateSuggestion` turns façade evidence back into at most an
 * advisory reference. It can never fabricate one: a suggestion is accepted
 * only when it is a label of the original choice set at the same revision,
 * and the mapped reference comes from the caller's own input set. No-match,
 * insufficient evidence, an invalid label, a below-threshold score/margin,
 * and a stale revision all return no suggestion. Nothing here commits,
 * selects a write target, writes, persists, or logs: selection remains with
 * the existing explicit user command, and this helper is pure and
 * synchronous (no I/O is even expressible).
 */

/** Closed vocabulary of locally computed fact kinds. */
export const CANDIDATE_FACT_KINDS = ["service-type", "date-window"] as const;

export type CandidateFactKind = (typeof CANDIDATE_FACT_KINDS)[number];

/**
 * Hard ceiling on projected candidates. The caller's order is kept; excess
 * candidates are dropped tail-first and the reduction is reported on the
 * build instead of being applied silently.
 */
export const MAX_CANDIDATE_PROJECTIONS = 10;

export type CandidateDateField = "startDate" | "endDate" | "dueDate" | "birthDate";

/** Fixed field order for deterministic fact emission. */
const CANDIDATE_DATE_FIELDS: readonly CandidateDateField[] = [
    "startDate",
    "endDate",
    "dueDate",
    "birthDate",
];

/**
 * Facts must be machine tokens: no whitespace, no `=`/`:` separators that
 * would corrupt the `key=value` fact encoding, bounded length. Anything that
 * does not conform (free text, names, addresses, phone digits) cannot be
 * represented as a fact and is omitted rather than disclosed.
 */
const MACHINE_TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function isMachineToken(value: string): boolean {
    return MACHINE_TOKEN_PATTERN.test(value);
}

/**
 * Parse the `YYYY-MM-DD` prefix of an ISO timestamp and validate it as a
 * real calendar date. Returns the canonical `YYYY-MM-DD` form, or `null`
 * when the value is not a parseable date (never guessed, never delegated).
 */
function parseIsoDate(value: string): string | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (match === null || match.length < 4) {
        return null;
    }
    const yearText = match[1];
    const monthText = match[2];
    const dayText = match[3];
    if (yearText === undefined || monthText === undefined || dayText === undefined) {
        return null;
    }
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    if (
        parsed.getUTCFullYear() !== year ||
        parsed.getUTCMonth() !== month - 1 ||
        parsed.getUTCDate() !== day
    ) {
        return null;
    }
    return `${yearText}-${monthText}-${dayText}`;
}

export interface CandidateWindow {
    readonly field: CandidateDateField;
    /** Machine token, e.g. "march-2026"; never free text. */
    readonly label: string;
    /** Inclusive ISO dates in the server timezone. */
    readonly fromIso: string;
    readonly toIso: string;
}

/** Structural facts supplied by the caller; never raw client records. */
export interface CandidateStructuralFacts {
    /** Opaque server-side reference (existing clientId). Never sent to the model. */
    readonly clientRef: string;
    readonly serviceType: string | null;
    readonly dates: Readonly<Partial<Record<CandidateDateField, string>>>;
}

export interface ClientCandidateRequestBuild {
    readonly request: {
        readonly choiceSetRevision: string;
        readonly candidates: readonly CandidateProjection[];
    };
    /** Internal, never serialized into the request. */
    readonly labelToRef: ReadonlyMap<string, string>;
    /**
     * How many supplied candidates were dropped by the ten-candidate cap
     * (0 when everything fit). Reported so a reduction is never silent.
     */
    readonly droppedCandidateCount: number;
}

export function buildClientCandidateRequest(input: {
    readonly choiceSetRevision: string;
    readonly candidates: readonly CandidateStructuralFacts[];
    readonly windows: readonly CandidateWindow[];
    /** Server reference date (ISO, server timezone) used for local comparisons. */
    readonly referenceDateIso: string;
}): ClientCandidateRequestBuild {
    // Project at most ten candidates, keeping the caller's order; labels are
    // positional over that order and never derived from data.
    const projected = input.candidates.slice(0, MAX_CANDIDATE_PROJECTIONS);
    const droppedCandidateCount = input.candidates.length - projected.length;

    // Windows are validated once per build. A window whose label is not a
    // machine token, or whose bounds are not parseable dates, is omitted:
    // its comparison could not be computed locally, and comparisons are
    // never delegated to the model. An unparseable reference date disables
    // window facts entirely (same rule).
    const referenceDate = parseIsoDate(input.referenceDateIso);
    const windows: readonly { readonly field: CandidateDateField; readonly label: string; readonly from: string; readonly to: string }[] =
        referenceDate === null
            ? []
            : input.windows.flatMap((window) => {
                  const from = parseIsoDate(window.fromIso);
                  const to = parseIsoDate(window.toIso);
                  if (!isMachineToken(window.label) || from === null || to === null) {
                      return [];
                  }
                  return [{ field: window.field, label: window.label, from, to }];
              });

    const labelToRef = new Map<string, string>();
    const candidates: CandidateProjection[] = projected.map((candidate, index) => {
        const label = `C${index + 1}`;
        labelToRef.set(label, candidate.clientRef);

        const facts: string[] = [];
        // `service-type=<value>` only when a machine-token service type exists.
        if (candidate.serviceType !== null && isMachineToken(candidate.serviceType)) {
            facts.push(`service-type=${candidate.serviceType}`);
        }
        for (const field of CANDIDATE_DATE_FIELDS) {
            const raw = candidate.dates[field];
            if (raw === undefined) {
                // A missing date field produces no date fact and no window fact.
                continue;
            }
            const date = parseIsoDate(raw);
            if (date === null) {
                continue;
            }
            facts.push(`${field}=${date}`);
            for (const window of windows) {
                if (window.field !== field) {
                    continue;
                }
                // Inclusive bounds, computed locally from the server reference data.
                const within = date >= window.from && date <= window.to;
                facts.push(`${field}-window:${window.label}=${within ? "within" : "outside"}`);
            }
        }
        return { label, facts };
    });

    return {
        request: {
            choiceSetRevision: input.choiceSetRevision,
            candidates,
        },
        labelToRef,
        droppedCandidateCount,
    };
}

export type CandidateSuggestionOutcome =
    | "suggested"
    | "none"
    | "insufficient_evidence"
    | "no-evidence"
    | "invalid-label"
    | "stale-revision"
    | "below-threshold";

export interface CandidateSuggestionResult {
    readonly outcome: CandidateSuggestionOutcome;
    /** Present only when outcome === "suggested". */
    readonly clientRef?: string;
    /** Present only when outcome === "suggested". */
    readonly label?: string;
}

/** Missing or non-finite probabilities fail closed to 0 (clamped to 0..1). */
function sanitizeProbability(value: number | undefined): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        return 0;
    }
    return Math.min(1, Math.max(0, value));
}

export function validateCandidateSuggestion(input: {
    readonly build: ClientCandidateRequestBuild;
    /** Façade evidence; null when not evaluated, abstained, or unavailable. */
    readonly evidence: CandidateEvidence | null;
    /** Caller-supplied advisory thresholds (the rank-candidates policy does not enforce them). */
    readonly thresholds: { readonly acceptProbability: number; readonly minMargin: number };
}): CandidateSuggestionResult {
    const { build, evidence, thresholds } = input;
    // 1. Not evaluated / abstained / unavailable: no suggestion exists.
    if (evidence === null) {
        return { outcome: "no-evidence" };
    }
    // 2. Evidence about a different choice set is stale.
    if (evidence.choiceSetRevision !== build.request.choiceSetRevision) {
        return { outcome: "stale-revision" };
    }
    // 3. Provider-level no-match and insufficient evidence are verbatim.
    if (evidence.outcome === "none") {
        return { outcome: "none" };
    }
    if (evidence.outcome === "insufficient_evidence") {
        return { outcome: "insufficient_evidence" };
    }
    // 4. The suggestion must be an ephemeral label of THIS build's choice
    // set. A raw reference, a cross-set label, or a fabricated string is not
    // a key of the internal map, so no reference can be smuggled in.
    const label = evidence.suggestion;
    if (label === null || !build.labelToRef.has(label)) {
        return { outcome: "invalid-label" };
    }
    // 5. Advisory probability/margin thresholds, evaluated locally against
    // the runner-up among the same choice set. Missing probabilities fail
    // closed to 0.
    const probability = sanitizeProbability(evidence.probabilities[label]);
    let runnerUp = 0;
    for (const other of build.labelToRef.keys()) {
        if (other === label) {
            continue;
        }
        runnerUp = Math.max(runnerUp, sanitizeProbability(evidence.probabilities[other]));
    }
    if (probability < thresholds.acceptProbability || probability - runnerUp < thresholds.minMargin) {
        return { outcome: "below-threshold" };
    }
    // 6. Suggested: the reference comes only from the caller's input set.
    const clientRef = build.labelToRef.get(label);
    if (clientRef === undefined) {
        return { outcome: "invalid-label" };
    }
    return { outcome: "suggested", clientRef, label };
}
