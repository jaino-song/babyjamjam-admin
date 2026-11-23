# Owner service-record JSON writes

`POST /admin/service-records/clients/{clientId}/cases/{caseId}/owner-json` commits one batch of session content changes for one client and case. Send `Content-Type: application/json` and `Authorization: Bearer <access-token>`. The token must belong to a global owner with an active branch selected. The client and case must belong to that branch and to each other. The route requires a bearer token even when the caller has an authenticated browser cookie. Query parameters are rejected.

## Read the current target and preconditions

1. Call `GET /admin/service-records/client/{clientId}/editor` with the same branch selected. Use `record.id` as `caseId` and choose the `sessionIndex` and `serviceDate` from `scheduleProjection.entries`. The projection may list dates that still lack records.
2. Call `GET /admin/service-records/client/{clientId}/draft`. Use the top-level `sourceCaseVersion` and `sourceFingerprint` as `expectedCaseVersion` and `expectedSourceFingerprint`. The fingerprint also detects content saves that preserve the case version. If `draft` is present, the existing editor draft must be resolved before starting a JSON write.
3. Send a fresh UUID v4 as `idempotencyKey` for each distinct batch. Keep the original body for retry.

```json
{
  "idempotencyKey": "66666666-6666-4666-8666-666666666666",
  "expectedCaseVersion": 7,
  "expectedSourceFingerprint": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "operations": [
    {
      "op": "edit",
      "sessionIndex": 1,
      "serviceDate": "2026-09-01",
      "changes": {
        "notes": "Corrected notes",
        "answers": { "stool_color": "yellow" }
      }
    },
    {
      "op": "fill",
      "sessionIndex": 2,
      "serviceDate": "2026-09-02",
      "changes": { "notes": "Care details for the scheduled visit" }
    }
  ]
}
```

Each operation addresses a 1-based session index and its existing `YYYY-MM-DD` date. The date is a precondition. The batch accepts 1–100 operations and up to 64 KiB of JSON data. An index or a date may appear only once.

- `edit` requires an existing record with recorded content or submission evidence. Each operation must change at least one field.
- `fill` requires an unoccupied scheduled date within the case's existing count and assigned period. A missing row requires a valid persisted schedule entry. A materialized placeholder must match the stored session and assignment, with default empty answers and text and no evidence of payment confirmation, approval, submission, signatures, or lock. The fill must supply meaningful content. A filled row remains unsubmitted. Fills are allowed only when the case status is `SCHEDULED`, `IN_PROGRESS`, `WAITING_FOR_END`, or `AWAITING_COMPLETION`.
- `changes` accepts only `answers`, `etcService`, and `notes`. Answers use the existing daily form's keys and value types. Supplied answer keys replace those keys, and omitted keys retain their values. The existing limits are 40 characters for `etcService` and 80 for `notes`. An empty string clears either text field on an edit. Whitespace alone cannot fill a slot.

All operations succeed together or roll back together. The write preserves the case's scheduled dates, count, assignment periods, and existing signature and submission evidence. It records a revision through the existing editor confirmation path.

## Response and retry

HTTP 200 returns the committed identifiers and document state.

```json
{
  "status": "confirmed",
  "clientId": 115,
  "caseId": "22222222-2222-4222-8222-222222222222",
  "caseVersion": 8,
  "revisionId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "revisionNumber": 1,
  "documentStatus": "waiting_for_completion",
  "confirmedAt": "2026-09-01T04:00:00.000Z"
}
```

`documentStatus` describes the shared editor's document workflow at commit. For example, `waiting_for_completion` indicates a partial record. After a timeout or lost response, retry with the original preconditions, operation order, values, and key. A matching committed request returns its stored response without adding another revision. JSON object key order is immaterial. Reusing the key for a different batch or target in the same owner and branch scope returns a conflict.

| HTTP | Meaning |
| --- | --- |
| 400 | Malformed JSON, invalid or unknown fields, duplicate targets, invalid session index, or an index outside the case count. |
| 401 | Missing or invalid bearer access token. |
| 403 | The caller lacks the global owner role or the selected branch or session is no longer authorized. |
| 404 | The client and case could not be resolved together in the selected branch. |
| 409 | The preconditions are stale, the key conflicts, an active draft or document operation blocks the write, the schedule has drifted, or a requested operation cannot change its target. Read the case again before preparing a different batch. |
| 413 | The server's HTTP body limit was exceeded. |
