# BJJ-486: existing guarded QA handoff

This dependency-free adapter connects CI impact assessment to the operator's existing QA runner. It prepares data only: it does not open a run, call a model/network, start a browser/server, deploy, read credentials, alter product state or approve a release. The operator's configurable `--playbook-root` identifies the canonical private role at `domains/common/agents/qa.md`. Read that file separately; its contents are not bundled here.

## Main's route from an event to QA

1. Obtain `impact-<component>/impact.json` from the **same workflow run** for the event/candidate. Preserve its full schemaVersion 1 payload, including actual tested `candidate.sha` (which may differ from PR `candidate.head`). CI publishes an assessment request only; it cannot dispatch QA.
2. Independently verify exact-SHA workflow/job results from the provider, or exact local command exit results. Fix the required verification inventory before preparing; selected apps need successful required evidence. All required results must be completed `success`; local entries need `exitCode: 0`. Review must be independent and approving `PASS` or `SHIP` for that same SHA. Preserve evidence references and actual result summaries. A caller can lie consistently: this script does **not** authenticate provider results, reviewer identity, completeness of Main's inventory or deployment claims.
3. Assess browser impact explicitly as Main. `assessment-required` includes backend user flows and uncertain tooling changes; uncertainty is never automatic exemption. An `exempt` decision requires an identified Main assessor, reason and reviewable reference. UI impact cannot be exempted. A CI-tooling integration demonstration may explicitly require QA without claiming a product UI change.
4. Host the exact candidate in an isolated non-production environment. Main provisions/verifies deployment ID, served SHA, build digest, process/origin identity, fixture snapshot and account roles. Check these against the actual running system; a successful build alone does not establish hosting identity. Prepare evidence storage and the affected plus regression case matrix. Anonymous READ scenarios are legitimate; successful authentication is not mandatory. Local `NODE_ENV=production` describes build mode, not production target identity.
5. Prepare the handoff below. Main inspects it and executes the existing lifecycle argv only after authenticating the facts. New candidate/build/deployment invalidates earlier evidence and observations: obtain fresh verification/review where applicable and a fresh handoff/run. Do not reuse output directories.
6. Main opens the guarded run, invokes the chosen existing runner once, reconciles its report against guarded receipts, then closes the run with the reconciled verdict. The agent's report remains a proposal until reconciliation. A QA pass grants no merge, deployment or release authority.

The canonical lifecycle retains ownership of origins, browser state, receipts, run budgets and verdict enforcement. Budget is one initial run plus one Main-approved targeted retest per target; a new session or handoff does not reset it. Do not blindly retry unknown side effects. Infrastructure, unsupported required tooling, missing evidence storage or unrestorable fixtures must be reported as BLOCKED/INCONCLUSIVE as applicable, with unexecuted coverage, never success.

## CLI

```text
node scripts/ci/qa-handoff.mjs --help
node scripts/ci/qa-handoff.mjs --impact /absolute/impact.json --manifest /absolute/manifest.json --worktree /absolute/candidate --output-dir /absolute/new-handoff --playbook-root /operator/.agents/playbook --lane codex
```

`--lane` is `codex` or `claude`. All six options are required. Output is `dispatch.md` and `readiness.json`, created only after validation. The output directory must not already exist. Invalid inputs return nonzero without writing a dispatch/readiness or producing start argv. Errors deliberately omit input content. Git HEAD must match the actual tested candidate and tracked files must be clean; untracked local evidence is not claimed to be tested source.

The readiness record binds candidate identity and source paths/SHA-256 digests, assessment, supplied verification/review/deployment data, every unexecuted case/assertion/viewport and optional/nonrequired verification results. `status: prepared` means consistency checks passed, never browser QA PASS. `lifecycle: null` means a reviewed exemption, with all browser coverage still unexecuted.

Lifecycle records are **structured argv**, not shell commands. Execute them using an argument-preserving process API with `shell: false`; never concatenate or `eval` them. The adapter executes only local Git inspection, not these commands. Given `/operator/.agents/playbook`, they point to:

- `bash /operator/.agents/claude/bin/qa-run.sh start --target <target> --candidate <sha> --origins <semicolon-separated-origins> --build <digest> --read-root <candidate-root> [--storage-state <external-path>]`
- `node /operator/.agents/bin/qa-runner/<lane>.mjs --dispatch <dispatch.md>`
- Main reconciles existing receipts and report using the canonical role's procedure.
- `bash /operator/.agents/claude/bin/qa-run.sh finish --verdict <Main-reconciled-verdict>`

The finish placeholder must be replaced by Main after reconciliation; it is intentionally not a runnable verdict. Runners, role files and lifecycle script must already be installed by the operator. The adapter neither installs nor copies them.

## Manifest schema and minimal complete example

Replace the example SHA with actual clean worktree HEAD, and supply real authenticated evidence references. This example fits a frontend-selected artifact. For every additional selected app add required successful evidence with its `component`. Main may record cross-cutting verification without a component, but it cannot replace selected-app evidence.

```json
{
  "schemaVersion": 1,
  "candidateSha": "1111111111111111111111111111111111111111",
  "target": "isolated-login",
  "evidencePath": "/operator/evidence/login",
  "assessment": {
    "by": "Main",
    "reference": "assessment:login",
    "decision": "required",
    "reason": "Approved login interaction demonstration"
  },
  "verification": [{
    "id": "frontend-checks", "component": "frontend", "kind": "local",
    "required": true, "sha": "1111111111111111111111111111111111111111",
    "status": "success", "exitCode": 0,
    "reference": "log:frontend-checks", "result": "Required commands completed successfully"
  }],
  "review": {
    "sha": "1111111111111111111111111111111111111111",
    "independent": true, "reviewer": "independent-reviewer",
    "verdict": "SHIP", "reference": "review:exact-candidate", "result": "Approved"
  },
  "deployment": {
    "deploymentId": "local-login-build-1", "environmentId": "isolated-local",
    "buildDigest": "sha256:verified-build-digest",
    "servedCommit": "1111111111111111111111111111111111111111",
    "fixtureSnapshotId": "fresh-anonymous-context-1",
    "isolated": true, "production": false,
    "accountRoleRefs": ["anonymous"],
    "allowedOrigins": ["http://localhost:4000"], "approvedOrigins": [],
    "allowedEffects": ["READ"],
    "viewportProfiles": [{"id": "desktop", "width": 1440, "height": 900, "deviceScaleFactor": 1}],
    "locale": "ko-KR", "timezone": "Asia/Seoul",
    "designReferenceRefs": ["spec:approved-login-design"],
    "testCases": [{
      "id": "LOGIN-D1440", "criterionId": "AC-login", "required": true,
      "preconditions": ["Fresh anonymous page; no saved storage"],
      "fixtureRefs": ["fixture:fresh-anonymous-context-1"],
      "actions": ["Open /login and observe rendered controls"],
      "assertions": [{
        "id": "FORM", "oracleKind": "DRIVER",
        "expected": "Login form is visible and pathname is /login",
        "evidenceKinds": ["screenshot", "snapshot", "resulting-state"]
      }, {
        "id": "COMPOSITION", "oracleKind": "VISUAL_RUBRIC",
        "expected": "Form grouping and primary action match approved reference",
        "evidenceKinds": ["screenshot"]
      }],
      "viewportIds": ["desktop"], "cleanupRef": "none:read-only"
    }]
  }
}
```

Rules:

- IDs for verification, cases, viewports and assertions within a case are unique. Each case includes all shown fields, nonempty actions/preconditions/fixture references/assertions and valid unique viewport IDs. Optional `requiredCaseIds` must reference existing required cases. Assertions use `DRIVER`, `TRUSTED_STATE` or `VISUAL_RUBRIC`; expected outcomes and evidence kinds are nonempty.
- Every required case needs screenshot evidence and an explicit resulting-state oracle (`DRIVER` or `TRUSTED_STATE`, with `resulting-state` evidence kind). A toast alone is insufficient. For UI impact the required matrix includes visual rubric coverage, and all declared viewports are collectively covered by required cases. A functional case may rely on a separate required visual case; the adapter preserves the assigned assertions. Case-specific assignments are preserved: mobile, tablet and desktop may be different cases. No width/count minimum is invented. Main fixes the complete matrix; the script cannot discover omitted product scenarios.
- Verification entries require unique `id`, `kind` (`local` or `ci`), Boolean `required`, exact `sha`, nonempty `reference`, `result`, `status`, and optional application `component`. Every required entry succeeds, except an intentional deselected CI app job: `status: skipped`, `intentionalSkip: true`, nonempty `skipReason`, `component`, and a separate same-component `required: true`, `stableGate: true`, `status: success` entry. A selected app, full/bootstrap comparison, or skipped stable gate never gets a skip exemption. Nonrequired not-run/failure coverage remains explicit, never normalized into success.
- `allowedEffects` contains only `READ` or `TEST_FIXTURE_WRITE`. No production targets, real messaging/email/payment effects or credentials are allowed. `isolated: true` and `production: false` explicitly declare environment identity. Remote origins require an exact `approvedOrigins` entry by Main and actual non-production isolation; loopback needs no remote approval. Main verifies the declarations.
- Optional `autoLogin: true` requires loopback origins, no `deployment.tunnel`/`reverseProxy`, and no production-mode server. Follow root `AGENTS.md`: authenticated local automatic-login QA uses `pnpm qa:fe` / `pnpm qa:mobile`; never use a tunnel, reverse proxy, non-loopback host or `next start` for automatic login. Manual/anonymous local production-mode READ tests are allowed.
- Optional `storageStatePath` is an absolute **external file reference only**, not inline state. It is passed to lifecycle start and never read by this adapter. Keep role references free of credentials. Credential-shaped fields and common secret-shaped content are refused; detection is deliberately limited, not a promise to find arbitrary secrets. Main must sanitize every supplied string, evidence reference and output. Do not put credentials in prompts, logs, commands or manifests.

Capture screenshots, console/network summaries and actual resulting state for each assigned case, assertion and viewport. Observe supported measurements; do not claim computed geometry from screenshots. Report unexecuted coverage honestly, including successful authentication/backend writes when the demo is anonymous READ only. Guarded receipts, not this readiness file, support Main's final verdict reconciliation.

## Verification, rollout and rollback

Run `node --test scripts/ci/impact-qa-handoff.test.mjs`; it is also registered by the existing required backend impact command `node --test scripts/ci/impact*.test.mjs`. Tests use temporary Git repositories, permitting/refusing independent examples without invoking QA. No dependencies or workflows change.

Roll out by preparing one exact-candidate handoff and inspecting its records before Main's one guarded integration demonstration. Any failure leaves QA unexecuted; fix the contract/evidence or report the blocking infrastructure. Revert the adapter, its test and this document to roll back. The existing guarded runner, lifecycle, CI checks and application remain unchanged.
