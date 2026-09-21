# Service-record ISO birthday input follow-up

## Goal
Change both service-record birth-date inputs to YYYY-MM-DD, automatically inserting hyphens while users type digits. Use the exact placeholder `1999-01-01` and the existing shared birthday input formatter.

## Scope
- Existing shared ServiceRecordWizard used by employee and administrator screens.
- Shared header validation and backend vendored runtime artifacts.
- Focused policy, UI and DTO regression tests.
- No changes to signatures, locking, schedules, payment logic or database schema.

## Acceptance criteria
- `19990101` is displayed and passed to the parent as `1999-01-01`.
- Both birthday inputs show `1999-01-01` as their placeholder and a persistent Korean helper explaining automatic hyphens.
- Partial input stays editable; a date must be complete, real and not in the future to pass validation.
- Names retain their existing strict whitespace policy.
- Existing stored birth dates are not destructively rewritten or assigned a new century while typing.
- UI and server validation agree on the YYYY-MM-DD submission contract.

## Execution
1. Inspect existing shared birthday helpers and customer form input behavior.
2. Update shared field definitions and strict validation; connect the formatter to the existing wizard inputs.
3. Update relevant regression tests and compile vendored runtime artifacts from the real shared TypeScript sources.
4. Run available focused checks; inspect committed file contents and PR state.

## Verification and risks
Full application dependency installation is currently blocked by DNS failures to npm and GitHub in the execution container. Run strict compilation and dependency-free regression checks where possible. Do not claim Jest, browser, CI, IME or complete build success without observed results. Keep the existing PR in Draft and do not merge or deploy.

## Status
In progress. The existing shared birthday utility and customer form imports have been inspected.
