# Context: service-record ISO birthdays

## User decision
Birth dates must use YYYY-MM-DD with automatic hyphens matching the customer form. The exact placeholder is `1999-01-01`. This replaces the earlier six-digit input requirement for both momBirth and babyBirth.

## Implementation
Shared header metadata and strict validation live in packages/shared/src/utils/service-record-input.ts. The existing formatBirthdayInput and isValidBirthdayIsoDate helpers are reused from packages/shared/src/utils/birthday.ts. ServiceRecordWizard now formats birthday changes before passing them to onHeaderChange. Other inputs retain their existing behavior. The backend vendored service-record-input JS and declarations were regenerated; its birthday runtime already exports the required validator.

The customer form's formatIsoDateInput has the same digit-only, eight-digit cap and four/two/two grouping behavior. No dependency on a frontend-only component was introduced into the shared package.

## Verification
The shared birthday module and updated service-record policy compiled with TypeScript strict mode, ES2020 and CommonJS output. A dependency-free Node test run passed 121 cases covering progressive input, deletion, formatted/spaced input, date validation, leap years, Korean midnight, required/partial values, names and weights. These are not React or class-validator integration results.

Policy, wizard UI and DTO Jest tests were updated but not executed in the container because application dependencies are unavailable and DNS resolution to npm and GitHub fails. Full lint, typecheck, builds, current CI and real-browser behavior are not claimed as passing. The wizard implementation commit was compared with its parent and contains only six additions and one deletion.

## Compatibility and release gate
The existing legacy birthday read utility is unchanged; no stored-data migration was run. New strict validation accepts YYYY-MM-DD only. Verify legacy stored header normalization at load/edit/save boundaries, public and administrator paths, actual cursor behavior and mobile input before merging Draft PR #734. No merge or production deployment was performed.
