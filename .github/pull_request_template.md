## Change and purpose

What behavior changes, why, and which issue/acceptance criteria does it address?

## Impact and downstream consumers

List backend/frontend/mobile/shared/native/infra/docs/dependency/config impact, downstream
consumers (including vendored shared runtime or service-record-ui), and uncertain impact.

## Selected checks and actual results

Link the run and `impact-<component>/impact.json`; state comparison base/head and tested candidate.
Record each selected check's actual command/run and result. List intentionally skipped and
unexecuted checks separately, with reasons. Selection is not proof of execution.

## QA applicability and evidence

State applicability and justification: backend maintenance still needs browser-impact assessment;
UI changes need interaction, visual and responsive QA. Record exact candidate SHA, independently
reviewed SHA/verdict, test URL, deployment/build ID and served commit, fixture/account-role
references, case/viewport coverage and evidence. Mark missing evidence explicitly; never include
credentials. Applicability is not a QA PASS.

Only Main dispatches existing QA after exact-candidate verification and independent review,
following `.agents/playbook/domains/common/agents/qa.md`: open the canonical run, invoke the existing
runner once, reconcile receipts and close with a verdict. CI can request a handoff; it cannot
start QA or fabricate verification/review/deployment facts. Actual existing-agent wiring and the
isolated browser demonstration remain a subsequent dependent unit until separately evidenced;
this checklist does not complete them. See [CI routing](../docs/ci/bjj-486-routing.md).

## Release and rollback

State release target/identity, migration or operational risk, rollback action and verification.
Distinguish local checks, remote CI, browser QA, deployment and production verification.
