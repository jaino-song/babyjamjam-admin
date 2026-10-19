# BJJ-486 component CI routing

This unit supplies CI impact evidence and preserves the three existing required check names:

- Backend CI: `backend · type-check · lint · test`
- Frontend CI: `frontend · type-check · lint · test · build`
- Mobile CI: `type-check · lint · test · build`

Each graph is `impact -> checks -> verify`, with a direct `impact -> verify` edge.
The stable `verify` gate always evaluates completion, including failed classification and skipped
checks. The backend read-only `lightnode-status` manual operation retains its special skip behavior.
Auth E2E depends on `[verify, impact]`, runs its unchanged observe/enforce matrix when backend is
selected, and never becomes a predecessor of verify. Mobile real-backend E2E retains its full suite
and advisory status; docs-only/empty PRs do not start its services. Deployment jobs are unchanged.

## Routing and authority

`ci-impact.yml` is reused by the three component workflows. It runs with `contents: read`, full
history, no persisted checkout token, no dependencies and no secrets. PRs use their actual
`pull_request.base.sha` and `pull_request.head.sha`; merge queues use the explicit
`merge_group.base_sha` and `merge_group.head_sha`. The diff starts at their merge-base. Added and
deleted paths are included, and both old and new paths of renames are classified. Exact 40-digit
commit IDs are validated and resolved (fetching the exact object when needed); invalid or
unavailable comparisons fail. Event values are passed as data to Git argument arrays, never as
shell code. Summary contents are JSON escaped.

For PR and merge-group events, **both routing and completion** execute the exact
`scripts/ci/impact.mjs` blob from the protected event base. The helper is self-contained and uses
only Node built-ins. It is extracted into a fresh runner-temp directory; nothing is imported from
the candidate checkout. Verify loads that protected helper independently and recomputes routing,
then checks the impact result, selected-output value and application result. A selected job must
succeed. An unselected job may intentionally skip or succeed, but failure, cancellation and absent
results fail the gate. Missing or inconsistent routing fails. The loader requires a fresh validated routing artifact and
an explicit protected completion proof, so a truncated/no-op helper cannot succeed by exiting zero.

A successful Git tree listing that genuinely lacks the helper selects **FULL** with an explicit
bootstrap reason. The workflow-owned bootstrap completion path requires successful impact and
successful selected checks; it never authorizes skips. A corrupt helper, invalid base or failed
Git/read operation fails. Push, manual and unknown events always use workflow-owned FULL behavior,
including zero/missing push `before`. They cannot load candidate rules to authorize exemptions.
After the helper lands on protected `dev`, normal PRs can use that reviewed version. Candidate
rule/workflow changes conservatively run full checks until separately reviewed and landed.

Caller workflow changes still require independent review. This protects helper authority within
the reviewed caller; it is **not** repository-admin or branch-protection enforcement. The staged
aggregate evaluator/workflow remains unchanged and disabled; this adds no cross-workflow aggregate.

## Selection and QA meaning

| Change | Checks | QA assessment |
|---|---|---|
| Empty comparison or only non-executable `.md`/`.txt`/`.rst` under `docs/`, `backend/docs/`, `frontend/docs/` or `mobile/docs/` | Skip application jobs; stable gates report | Not applicable, with reason |
| Backend source, tests, maintenance or operational text outside its docs root | Backend including auth E2E, plus frontend | Browser-impact assessment required; paths cannot prove a maintenance exemption |
| Frontend/mobile UI surface outside the special consumer paths below | Respective complete app suite | Interaction, visual and responsive QA required |
| Root `README.md` (backend db-seed test input) | Backend including auth E2E | Browser-impact assessment required |
| `frontend/src/components/app/clients/client-update-payload.ts` | Frontend and mobile (payload parity test) | Interaction, visual and responsive QA required |
| `frontend/src/components/app/chat/parts/AgentPartRegistry.tsx` | Frontend and backend (agent manifest check) | Interaction, visual and responsive QA required |
| `mobile/src/components/app/chat/MobileAgentPartRegistry.tsx` | Mobile and backend (agent manifest check) | Interaction, visual and responsive QA required |
| `packages/shared` | Backend (including vendored runtime), frontend, mobile | Assessment required |
| `packages/service-record-ui` | Frontend and mobile | Interaction, visual and responsive QA required |
| Dependency/config/tooling/policy, unknown, native, executable, symlink or submodule changes | All three apps conservatively | Assessment required, or UI QA when UI also changed |

Markdown under executable policy locations (`.agents`, `.codex`, `.github`, `rules`, `policies`) and
policy entry points (`AGENTS.md`, `CLAUDE.md`, `SKILL.md`) is never a docs exemption. Executable Git
modes are inspected at both comparison endpoints. Config/dependency changes anywhere are
conservative. The classifier describes potential impact rather than claiming source-code semantics.
Text extensions alone never establish a docs-only exemption. For example,
`backend/deploy/cloudrun/excluded-keys.txt` selects backend and frontend;
`frontend/src/content/help.md` and `mobile/src/content/help.md` select their owning app;
`registry/authorization.txt` and `unrecognized/new-policy.md` conservatively select all apps.
These inputs require QA assessment rather than an exemption. Ordinary `docs/guide.md` and
`docs/nested/help.md` remain exempt, subject to policy/config and Git-mode checks above.

Frontend imports backend DTOs through its `@/backend/*` alias. All non-exempt backend paths
therefore also select frontend, conservatively paying for extra frontend checks on backend-only
maintenance instead of claiming a complete transitive DTO dependency map. The payload and renderer
edges are keyed to actual changed paths. Selecting backend because a mobile registry changed does
not imply backend source changed, so that case does not also select frontend. Unrelated paths such
as `frontend/src/components/app/clients/unrelated.ts` and
`mobile/src/components/app/clients/unrelated.ts` retain single-app selection. New cross-app
consumers must be added to this routing contract when introduced.

Non-required mobile-unit and shared-contract workflow path filters include service-record-ui.
Existing full-suite coverage and push/manual behavior remain intact.

## Machine-readable handoff

Each component publishes `impact-<component>/impact.json` and an equivalent human-readable job
summary. The schema is version 1:

```json
{
  "schemaVersion": 1,
  "candidate": {"event": "pull_request", "sha": "tested checkout SHA", "base": "event base SHA", "head": "PR head SHA", "mergeBase": "comparison ancestor SHA"},
  "comparison": {"kind": "merge-base", "reason": "comparison explanation"},
  "paths": ["changed/path"],
  "categories": {"backend": true, "frontend": false, "mobile": false, "shared": false, "native": false, "infra": false, "docs": false, "dependencies": false, "config": false, "uncertain": false},
  "selected": {"backend": true, "frontend": false, "mobile": false},
  "reasons": ["selection explanation"],
  "qa": {"status": "assessment-required", "reasons": ["Main must assess browser impact"]}
}
```

`candidate.sha` is `GITHUB_SHA`, the actual checked-out/tested candidate; on PRs this can be the
synthetic merge commit, distinct from `candidate.head`. `base` and `mergeBase` may be null for FULL
runs; bootstrap comparisons have kind `full` and an explicit reason. Categories include affected
consumers, while `paths` identifies actual changed files; FULL categories are conservative and do
not claim a file inventory. QA status is `not-applicable`, `assessment-required` or
`interaction-visual-responsive-required`. It is an applicability signal, never a QA verdict.
The artifact contains no fabricated verification, review, deployment, run, screenshot or release
facts. A downstream consumer must validate the artifact's run and candidate identity.

## Existing-agent QA integration: subsequent dependent unit

Canonical contract: `.agents/playbook/domains/common/agents/qa.md` in the shared playbook
(`~/.agents/playbook/domains/common/agents/qa.md` locally). Only Main dispatches existing QA agents:

1. Finish required verification and independent review of the exact candidate.
2. Fix the approved test contract, matching served build/deployment identity, isolated URL,
   fixtures/accounts, allowed origins/effects, viewports and evidence location.
3. Open the canonical run through its run-state owner (`qa-run.sh start`), then invoke the
   lane's existing QA runner once with the dispatch document.
4. Reconcile the returned verdict with receipts, close with `qa-run.sh finish --verdict`, and
   route findings to ordinary fix units. At most one Main-approved targeted re-verification
   follows the initial run; stale candidate/deployment evidence cannot pass.

CI may produce a handoff request. It must never start QA or assert that verification, independent
review or matching deployment has happened. Actual existing-agent wiring and an isolated browser
demonstration are a **subsequent dependent unit**, not completed by this document or PR checklist.

## Validation and rollback

Run `node --test scripts/ci/impact*.test.mjs` and `node --test scripts/ci/*.test.mjs`. Tests execute
the actual workflow loader against temporary real Git histories, malicious candidate replacements,
protected-helper bootstrap/corruption and completion refusals. Parsed workflow tests check job
graphs, unchanged required names, app steps, auth matrix, full advisory suite, permissions and
byte-identical deployment blocks against base `e92aca0a18b14b072a2b70f54a557a67673f63a8`.

Roll back this routing unit as a reviewed revert to restore always-running application jobs and
keep existing required names. No branch-protection or deployment rollback is required by this
change. Local tests do not establish remote Actions success, browser QA or release readiness.
