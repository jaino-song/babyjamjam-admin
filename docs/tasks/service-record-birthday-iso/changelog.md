# Changelog

## 2026-09-21

- Changed momBirth and babyBirth labels and validation from YYMMDD to YYYY-MM-DD.
- Set both placeholders to exactly `1999-01-01` and added Korean automatic-hyphen guidance.
- Connected the existing shared birthday formatter to the wizard's birthday change callbacks; preserved other controls and form workflows.
- Regenerated backend vendored validation JS and declaration files.
- Updated policy, UI and DTO regression tests for full-year dates, automatic formatting, incomplete values, correction, leap years and future dates.
- Passed strict compilation of the two shared helper modules and 121 dependency-free Node regression tests.
- Kept application Jest, full checks, latest-SHA CI, real-browser behavior and stored-record roundtrips explicitly unverified. Preserved Draft PR #734 without merging or deploying.
