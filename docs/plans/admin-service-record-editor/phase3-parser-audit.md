Model: gpt-5.6-sol | Effort: high

FINAL_VERDICT: FIX_REQUIRED

- #3 — CLOSED. Shared/vendor types enforce `completed | rejected | in_progress | unknown | null`; the adapter rejects other values, and the producer is constrained to the non-null union.
- #5 — REMAINS. Malformed or omitted `requiredSessionCount` is normalized to `null` at `frontend/src/features/service-records/api/admin-service-record-edit.api.ts:453` but its raw validity is not checked by the envelope validation at `:465`. With valid metadata, a server blocker, empty vectors, and empty provenance, `:476-497` treats this malformed response as legitimate and omits `INVALID_PREVIEW_RESPONSE`.
  - Preserve explicit `null` for genuinely unsupported counts, but track and reject missing/invalid non-null values as malformed envelope data.
  - Add a blocked-empty-vector regression case using an omitted or string-valued `requiredSessionCount`.

The duplicate-date, shifted-original-date, provenance-identity/range, and chunk-index-0 corrections are sound and meaningfully tested. Supplied verification receipts were accepted without rerunning them.