# Default SMS rule deletion correction (2026-10-31)

Scope: `si/f-sms`, correction `f-sms-fix2`. Defaults are disabled, not deleted.
`automation.delete` delegates to `MessageTriggerService.deleteRule` or
`deleteRuleApprovedTarget`; both reject defaults with the catalog-backed
`MESSAGE_DEFAULT_RULE_DELETE_BLOCKED` conflict (409 / NOT_APPLIED).
Repository paths preserve their existing reserved-rule refusal contract:
`delete` makes no change, and target-matched deletes return false.

## Regression coverage

`sms-rule-delete-cascade.real-db.spec.ts` adds SI-SMS-02 invariants for both
`CLIENT_GREETING` and `SERVICE_INFO`:

- All five deletion entry points leave the complete rule and pending job rows
  unchanged. Service paths also assert the Korean catalog refusal.
- Deactivate through `updateRule`, then call `listRules`: the default stays
  inactive, its pending job stays canceled, and all branch rule/job rows stay
  unchanged. Neither default provisioning path reactivates it.
- The previous recovery/recreation invariant now seeds a **legacy** deleted
  default directly. Its reader, scheduler, activation, and uniqueness assertions
  are retained; new default deletion is no longer a supported fixture setup.

Desktop/mobile component tests hide default deletion but retain activation
controls. Existing custom-rule deletion tests remain unchanged. Repository
delete fixtures that previously used defaults now use non-default rules;
default deletion is tested separately. Fixture catalog fields use the actual
catalog union types instead of unrestricted strings.

## Temporary mutation proofs

Only owned production files were temporarily edited. All mutations were
restored before final acceptance; no mutation switch is committed.

Use backend cwd and the throwaway database `bjj_fix_sms_throwaway`, with
`DATABASE_URL` and `DIRECT_URL` pointing to it, plus
`STATE_INTEGRITY_REAL_DB=1 E2E_VENDOR_STUBS=1 NODE_ENV=test`.

| Mutation | Focused command suffix after `pnpm test test/integrity/sms/sms-rule-delete-cascade.real-db.spec.ts --runInBand` | Observed result |
| --- | --- | --- |
| Remove the two service `isDefault` conflicts and repository `isDefault` deletion guards/predicate; leave reserved-id and soft-delete logic intact | `-t 'refuses deleting a default'` | Exit 1: all 10 cases fail. Service calls resolve instead of rejecting; plain repository deletion changes the row; target-matched paths return true instead of false. |
| Change `ensureDefaultTrigger`'s existing-rule early return to activate and persist the existing rule before returning | `-t 'deactivate then list'` | Exit 1: both cases fail with `Expected: false / Received: true`. |

Machine-local logs:
`/private/var/folders/gp/f0m_ydss2n15x64qrwdj_rrh0000gn/T/opencode/si/`
with prefix `f-sms-fix2-resume-`, suffixes `mutation-delete.log` and
`mutation-reactivation.log`.

## Acceptance results after restoration

- SMS integrity: 6 suites / 52 tests, default order, random seeds **61031** and
  **61032**, and `TZ=UTC`: all pass with zero skips.
- Nearby backend units, including the agent capability provider and automation
  record store: 8 suites / 762 tests pass.
- Desktop touched component + message-trigger feature: 12 suites / 121 tests
  pass. No desktop SMS integrity directory exists in this checkout.
- Mobile touched component + message-trigger feature + SMS integrity:
  8 suites / 64 tests pass (pre-existing expected-defect tests remain intact).
- Shared package's full test script passes: 42 Jest suites / 889 tests and
  92 Node test-runner checks.
- Backend, desktop, mobile, and shared `tsc --noEmit`: exit 0.
- ESLint on changed backend/desktop/mobile source and tests: exit 0, no warnings.
  Shared uses the backend TypeScript ESLint config because it has no own config:
  exit 0, one pre-existing unused `ProblemDetails` import warning in its test.
- SMS migration executes twice successfully; Prisma migration/schema drift
  check exits 0 (`No difference detected`).
- `pnpm lint:ui-architecture` exits 1 on the known contracts page baseline
  identities. None of this correction's files appears in its findings.
- No install, dependency/schema/auth changes, server, or external SMS call.
  The installed shared package is a pnpm symlink; both modified catalog files
  share inodes with the vendor files, so no installed-copy refresh is required.
  Vendor message types are untouched: backend checks the domain entity's
  `isDefault`, not the shared client rule interface.
- Local security checks: environment files remain Git-ignored; added lines
  contain no secret patterns, unsafe execution, or new HTML injection sinks.
  Repository predicates remain branch-scoped and parameterized. No network
  dependency audit was run because dependencies are unchanged.
- Existing design-system components only; no new custom UI, page-local
  component, or raw visual styling was added. Browser QA/builds are not part of
  this no-server correction run.
