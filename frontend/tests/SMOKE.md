# Smoke Tests

Run the real-tenant smoke test before release or during manual pre-release verification.

Use:

```bash
RUN_SMOKE_TESTS=1 pnpm --dir frontend exec playwright test tests/contract-creation.smoke.spec.ts --headed --timeout=120000
```

Side effects:

- The test queues a real creation job (POST /api/eformsign-docs/jobs/creation); the backend job creates the eformsign document in the dev tenant, and the test waits for the job to complete.
- The test sends a real SMS to the selected client's phone number.
- Use a dev-only test customer. When the contract's values differ from the client record the test answers "계약서에만 반영", so the client record stays as it is, except that a client with no assigned provider gets the selected provider saved.
- The test cleans up the document the job created (its `documentId`) with `deleteDocument(..., true)` via `/api/eformsign/documents?is_permanent=true`.
