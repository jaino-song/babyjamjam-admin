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

## Execution status
1. Completed: inspected the shared birthday helper, the customer form import and its matching date-formatting implementation.
2. Completed: changed shared field definitions and validation; connected formatBirthdayInput to momBirth and babyBirth in the existing wizard.
3. Completed: updated policy, UI and DTO regression tests; regenerated the vendored JS and declarations from the real shared TypeScript sources.
4. Completed: strict compilation of the two shared helper modules and 121 dependency-free Node regression cases passed. The wizard-specific commit changes only six added lines and one removed line.
5. Pending: application Jest suites, full lint/typecheck/build and latest-SHA CI completion; real-browser typing, caret and IME checks; existing saved-record load/edit/save roundtrips.

## Verification and risks
The execution container cannot resolve npm or GitHub hosts and does not contain application dependencies. Standalone helper tests are not React, DTO integration, browser or full-application test results. The existing legacy read normalizer remains unchanged, and no database migration or application-wide stored-data conversion is included. Six-digit values are not accepted by the new strict input validator, so callers that restore legacy values must use their read normalization path before saving, or the user must enter the full year. Verify these existing-record paths before merge.

## Status
Implementation committed to Draft PR #734. Focused helper checks passed; full application and browser verification remains pending. Do not merge or deploy on the basis of the standalone checks alone.
