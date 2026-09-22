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
2. **Synthetic live evaluation** — the evaluation CLI (Task 9.1) runs the
   committed synthetic fixture corpus against the pinned model and produces an
   evidence report (`schemaVersion: "jev-evidence-v1"`).
3. **Approved shadow scope** — per-kind mode `shadow` under the branch/internal
   allowlist; disagreements and abstentions are observed, not applied.
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
  --evidence=<evaluation-report.json>
```

Exit code `0` and `ready: true` are required. A non-zero exit on the draft
profile (`evidence-missing`) is the designed fail-closed state, not a tool
failure.

## 2. Disable first (recovery order)

When anything looks wrong, disable before investigating. In order of blast
radius, smallest first:

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

Shadow-mode ("observational") decision calls are canceled at the turn
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
conservative: on any decision failure (timeout, transport, invalid output,
policy miss) the runtime falls back to the incumbent/baseline decision and
abstains rather than guessing. Re-enabling requires re-running the readiness
gate with current evidence and a fresh operator approval.

## 5. Evidence retention and incident investigation

- Keep every readiness check output (the versioned JSON result) and its input
  evidence report with the release record; they are the audit trail for why a
  profile was considered ready.
- Evidence reports are immutable artifacts: investigate incidents against the
  retained report and the decision trace events (`semantic-decision-v1`),
  never by regenerating numbers after the fact.
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
