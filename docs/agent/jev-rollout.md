# Jev Rollout Runbook (operator-facing)

Scope: the Jev semantic decision layer (`agent.decisions.jev` runtime seam) and
its release gate. This runbook covers how rollout proceeds, how to stop it, and
what recovery must never touch.

**Read this first:** a release profile JSON — including its `approvalReference`
field — is **metadata, not authority**. It never approves anything by existing.
An actual operator approval and a protected-branch merge remain separate human
gates. `backend/scripts/agent/check-jev-readiness.ts` validates and reports
only; passing it does not enable, deploy, or merge anything, and the committed
draft profile (`evals/agent/jev/release-profile-v1.json`) is OFF by default
with a placeholder approval reference.

## 1. Preconditions and gate order

Rollout proceeds strictly in this order. Each gate is a separate, recorded
step; never skip or reorder:

1. **Repository readiness** — capability manifest/drift checks and the
   cutover guard pass (`pnpm --filter ./backend agent:manifest:check`,
   `agent:cutover:guard`); CI green on the protected branch.
2. **Synthetic evaluation + evidence bridge** — the evaluation CLI
   (`run-jev-evaluation.ts`) runs the committed synthetic fixture corpus and
   writes a versioned evaluation report; with an operator-authored
   attestation file it additionally emits the readiness evidence document
   (`schemaVersion: "jev-evidence-v1"`). See "Producing evidence" below for
   the exact commands and the attestation the operator must author.
3. **Approved shadow scope** — per-kind mode `shadow`, limited to the branches
   listed in `allowedBranchIds`, on a deployment whose
   `AGENT_DECISION_ENVIRONMENT` is listed in `environments` (see "Where JEV may
   run" below); disagreements and abstentions are observed, not applied.
4. **Calibration/holdout** — evidence must attest a non-empty held-out split
   and a human-reviewed reference, with coverage/agreement floors and the
   abstention ceiling from the profile.
5. **P0 enforcement** (`route-domains`, `classify-client-intent`) — enabled
   only after a readiness check with real evidence passes and an operator has
   approved.
6. **P1 activation** (`evaluate-clarification`, `rank-candidates`) — same
   gates, independently.
7. **Legacy retirement** — only after the cutover gate authorizes removal;
   legacy surfaces stay protected until then.
8. **Protected-branch merge** — the final human gate. No merge without the
   recorded operator approval.

Run the readiness gate before step 5/6 and record its output:

```bash
pnpm --filter ./backend exec ts-node scripts/agent/check-jev-readiness.ts \
  --profile=../evals/agent/jev/release-profile-v1.json \
  --evidence=../artifacts/jev-fixture-evidence.json
```

Exit code `0` and `ready: true` are required. A non-zero exit is the designed
fail-closed outcome, not a tool failure: with no evidence the checker reports
`evidence-missing`; with fixture-mode evidence it reports
`metric-denominator-zero` / `coverage-below-floor` (see below).

### Producing evidence (offline bridge)

The evidence document is **not** produced by hand and **not** produced by the
checker. `run-jev-evaluation.ts` converts its own evaluation report into the
`jev-evidence-v1` document when given `--evidence-out` together with
`--attestation`:

```bash
# Offline, no model call — certifies the corpus, never a model:
pnpm --filter ./backend exec ts-node scripts/agent/run-jev-evaluation.ts \
  --mode=fixture \
  --input=../evals/agent/jev/fixtures-v1.json \
  --output=../artifacts/jev-fixture-report.json \
  --evidence-out=../artifacts/jev-fixture-evidence.json \
  --attestation=../artifacts/jev-attestation.json

# Real model evidence — external calls; every live gate applies
# (--consent=live-provider-call, TYPESAFE_API_KEY, synthetic-only corpus
# inside evals/agent/jev/, pinned model id). Use TypeSafe direct: Vercel AI
# Gateway serves only the unpinned `typesafe-ai/jev` alias and answers the
# pinned jev-1.13.0 with 404 model_not_found (probed 2026-09-23), which the
# run records as provider-error:
pnpm --filter ./backend exec ts-node scripts/agent/run-jev-evaluation.ts \
  --mode=live \
  --input=../evals/agent/jev/fixtures-v1.json \
  --output=../artifacts/jev-live-report.json \
  --evidence-out=../artifacts/jev-live-evidence.json \
  --attestation=../artifacts/jev-attestation.json \
  --consent=live-provider-call
```

**The operator authors the attestation.** The conversion is offline and maps
per-kind raw counts and metric numerator/denominator triples from the report's
computed metrics only — it never invents a value. The facts a synthetic corpus
cannot provide come exclusively from an operator-authored JSON file
(schema `jev-attestation-v1`) at the `--attestation` path:

```json
{
  "schemaVersion": "jev-attestation-v1",
  "attestedBy": "<named operator>",
  "attestedAt": "YYYY-MM-DD",
  "modelId": "jev-1.13.0",
  "holdoutSplit": { "present": true, "caseCount": 12 },
  "humanReference": { "present": true, "caseCount": 29 },
  "humanReferenceComparisons": {
    "route-domains": { "comparableCount": 0, "agreedCount": 0 },
    "classify-client-intent": { "comparableCount": 0, "agreedCount": 0 },
    "evaluate-clarification": { "comparableCount": 0, "agreedCount": 0 },
    "rank-candidates": { "comparableCount": 0, "agreedCount": 0 }
  },
  "notes": "What was attested and why the counts are what they are."
}
```

- `holdoutSplit` attests that the corpus's `holdout` split was genuinely held
  out; its `caseCount` must match the report's own holdout count and the run
  is refused otherwise (a truncated `--max-cases` run counts only its selected
  cases).
- `humanReference` attests how many human-reviewed reference cases exist.
- `humanReferenceComparisons` attests, per decision kind, how many of the
  model's selections were comparable to the human reference and how many
  agreed. These counts can never exceed the cases the run actually evaluated.
- A missing, incomplete, incoherent, or mismatched attestation is a precise
  non-zero refusal naming the exact gap. The attestation's free-form `notes`
  are not copied into the evidence document; the evidence carries counts,
  tokens, and the attestation author/date only — no credentials, no raw text.

**What each kind of evidence can mean:**

- Fixture-mode evidence (`--mode=fixture`) contains no model predictions, so
  every abstention/precision/agreement denominator is zero and the readiness
  gate always blocks it. It proves the document **format**, nothing more.
- A synthetic corpus can satisfy the format, but a **real human reference
  requires a human-reviewed evaluation set**. Attesting invented comparison
  counts to pass the gate is evidence fabrication under §5 — every gate that
  consumed such evidence is treated as failed.
- Passing the checker is still not enablement: the approval reference in the
  profile is metadata, not authority (§6), and the human gates of §1 remain.
- **Question version.** Evidence and acceptance profiles are bound to the
  decision question version (`DECISION_QUESTION_VERSION` in
  `backend/application/agent/decision/decision-questions.ts`, currently `v3`;
  carried as `questionVersion` in reports, evidence, profiles and traces). A
  version bump invalidates every earlier evaluation report, evidence document
  and stored `agent.decisions.jev` acceptance profile for all four kinds:
  regenerate evidence at the new version and re-author the profiles before any
  shadow/enforce step, and move any kind running in `enforce` with an older
  profile to `shadow`/`off` before deploying. A stored profile at an older
  version is refused at runtime (fail closed): under `enforce`,
  `AgentDecisionService.evaluate` returns `not-evaluated` with reason
  `ineligible` and falls back to the baseline selection, and the observation is
  recorded before that compatibility check, so it carries no mismatch token.
  v3 (2026-09-24, BJJ-344) changed only `clarificationRequired`: it now judges
  the text together with the request state (`targetConfirmed`,
  `missingFields`), so a follow-up turn that supplies the value for an
  already-confirmed record is not *advised* to clarify. **BJJ-348 (2026-09-24)
  resolved the enforce-mode gate that previously blocked `evaluate-clarification`
  from going to `enforce`:** only an *unknown record* (`clients.update` with no
  confirmed target) still makes `decideClarification` deterministically
  suppress model writes (AC-18). A *missing value* never does — the model may
  extract it from the text, and every write still ends at the mandatory
  approval card, the sole point at which the user sees exactly what will
  change. So an update whose change has not been committed to the task yet, or
  a create missing name/phone, no longer hides the write tool by itself; a
  freeform follow-up can supply the value and the model's mutation reaches the
  approval flow unchanged. Only an update with no confirmed target still hides
  `clients_update`. The runtime's `missingFields` (`deriveMissingFields` in
  `agent-runtime.service.ts`) still lists only what the task still needs, from
  its `task.required` issues: for create, the unmet required fields (name,
  phone); for update, nothing once a target is confirmed and at least one
  change is given — but it is now sent to the provider as state only, never
  consulted by `decideClarification`. A malformed phone
  (`phone_must_be_11_digits`) is reported as `task.invalid`, not
  `task.required`, so it was never counted as "missing" either, and it still
  blocks create/apply through the same issues-based readiness gate regardless
  of which code it carries. Clarification fixtures carry that same state
  (`state: { missingFields, targetConfirmed }`, field names restricted to the
  client write fields), and the live runner sends it with the same redacted
  text the runtime sends.
  Clarification threshold: on the synthetic corpus (jev-1.13.0, two live runs,
  2026-09-24) `clarificationRequired` scored 0.85–0.97 where clarification is
  needed and 0.11–0.36 where it is not. The stored clarification profile's
  `thresholds.acceptProbability` must sit inside that window (e.g. 0.6), and
  must be re-derived from human-reviewed evidence before `enforce`.
  Treat `ineligible` under `enforce` as the stale-profile symptom and compare
  the stored profile's `questionVersion` with `DECISION_QUESTION_VERSION`.
  `question-mismatch` is a different failure: a permitted route domain has no
  question text in `ROUTE_DOMAIN_DESCRIPTIONS`.

### Where JEV may run (environment and branch gate)

The `agent.decisions.jev` setting is one database row, and preview shares the
production database, so a mode stored there reaches every deployment that
reads it. Two fields in the setting decide where it applies, and both fail
closed:

- `environments` — a deployment uses the stored modes only when its
  `AGENT_DECISION_ENVIRONMENT` env var is set, non-empty and listed here.
  Unset, blank or unlisted → every kind is `off` on that deployment, whatever
  the stored modes say. The variable is unset on every deployment by default.
  Preview is deployed from the committed `backend/deploy/cloudrun/service.preview.yaml`,
  so enabling preview means adding the variable to that manifest; a console
  edit is wiped by the next deploy.
- `allowedBranchIds` — only turns from these branch ids are evaluated. A turn
  from any other branch behaves exactly as if every kind were `off`: no
  provider call, no enforce behaviour. Empty → no branch is in scope.

Example (preview pilot on one branch):

```json
{
  "environments": ["preview"],
  "allowedBranchIds": ["<branch uuid>"],
  "samplingFraction": 0.1,
  "kinds": { "route-domains": { "mode": "shadow" } }
}
```

Profiles' `approvedScope` (`["branch", "internal"]`) is readiness metadata
checked by `check-jev-readiness.ts`; it is not the runtime allowlist.

**Time budget.** `limits.turnDeadlineMs` (default 800 ms) is a per-call
budget, started when a call is admitted. A runtime turn awaits at most three
decision calls (route, intent, clarification), each a single attempt, so JEV
can add up to about 3 × `turnDeadlineMs` to a turn — in `shadow` too. Calls
skipped for `budget-exhausted` (per-turn cap) or `concurrency-saturated`
record a trace event with `missing: true`; `disabled` and `not-sampled` record
nothing.

## 2. Disable first (recovery order)

When anything looks wrong, disable before investigating. In order of blast
radius, smallest first:

0. **Deployment disable** — remove the deployment from `environments` in
   `agent.decisions.jev`, or unset its `AGENT_DECISION_ENVIRONMENT`. Every kind
   is `off` there on the next config read (≤ 30 s cache) when you edit
   `environments`; unsetting the variable takes effect only after a redeploy
   (on preview: a manifest commit and a CI deploy).
1. **Per-kind disable** — set the offending kind's mode to `off` in the
   `agent.decisions.jev` setting (`kinds.<kind>.mode: "off"`). Other kinds
   keep running.
2. **Global decision disable** — set `globalDisabled: true` in
   `agent.decisions.jev` (authoritative: forces every kind to `off`).
3. **Capability/agent kill switches (superior)** — these outrank everything
   above:
   - `agent.flags.emergency-disabled` setting → `true`, or
   - `agent.flags` setting with `enabled: false`, or
   - environment kill switches: `AGENT_ENABLED=false`
     (plus `AGENT_READ_ENABLED=false` / risk-specific switches) — these apply
     regardless of the stored settings.

All of these are fail-closed: a missing or malformed setting disables, never
enables.

## 3. Observational calls and what must never change

Shadow-mode ("observational") decision calls are canceled at their per-call
deadline (caller-owned `AbortSignal`); results that arrive after cancellation
are discarded as trace-only. They never influence the turn.

Regardless of mode or recovery action, the following are immutable and are
never rewritten by rollout or rollback: task records, service-record
revisions, candidate choices, clarification proposals, approvals, action
outcomes, and idempotency records. Recovery changes routing/mode only — never
history.

## 4. Rollback

Roll back to the recorded incumbent mode: set the affected kinds back to
`off`/`shadow` (per section 2) and the incumbent rule-based path resumes
immediately — it never stopped running. An enforce-mode failure stays
conservative. On any decision failure (timeout, transport, invalid output,
low confidence, policy or profile miss) the decision abstains, and an enforce
abstention never falls back to the incumbent generative classifier, the
incumbent regex, or the default `clients` domain — only switching the kind
back to `off`/`shadow` restores incumbent behavior. Per kind:

- **Route domains:** the router returns `disposition: "clarify"` with no
  capabilities (also when more than two domains match deterministically). With
  no live task owning the turn, the runtime answers with a traced, zero-tool
  turn that asks the user one clarifying question; a live task keeps its
  continuation unchanged. `disposition: "disabled"` (no enabled domain) keeps
  the 403 `ACCESS_DENIED` refusal.
- **Client intent:** no create/update task entry point is derived from the
  text; a `read` result narrows the turn to read-only capabilities. Trusted
  turn ownership (active task, bound form, command, replay, question) always
  bypasses inference.
- **Clarification advice:** missing or failed advice adds no restriction;
  deterministic completeness checks and existing refusals still apply, and
  advice can never clear them.
- **Candidate ranking:** advisory only; the runtime integration is not built,
  so the existing chooser and explicit user selection are unchanged.

Re-enabling requires re-running the readiness gate with current evidence and a
fresh operator approval.

## 5. Evidence retention and incident investigation

- Keep every readiness check output (the versioned JSON result), its input
  evidence document, and the operator attestation behind it with the release
  record; they are the audit trail for why a profile was considered ready —
  and for who attested the holdout split and the human-reference counts.
- Evidence documents are immutable artifacts: investigate incidents against
  the retained report, the attestation, and the decision trace events
  (`semantic-decision-v1`), never by regenerating numbers after the fact.
- If evidence is found to be wrong or fabricated, treat every gate that
  consumed it as failed: disable (section 2), roll back (section 4), and
  re-run the full gate order.

## 6. Approval is a human gate

A JSON `approvalReference` — any string in any file — is not authority to
operate production. The committed draft profile's `PENDING: …` placeholder is
by construction not an approval, and even a real-looking reference only
*records* an approval made elsewhere. Two gates remain permanently separate:

1. A **named operator's recorded approval** for the specific profile version
   and evidence bundle.
2. The **protected-branch merge** performed by a human with merge rights.

The readiness checker cannot grant either. If a profile claims enforcement
(`enabled: true`) while its approval reference is a placeholder, the checker
blocks with `enforcement-without-approval` — and the runbook still requires
the human gates above.
