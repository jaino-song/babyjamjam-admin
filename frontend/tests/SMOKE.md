# Smoke Tests

Run the real-tenant smoke test before release or during manual pre-release verification.

Use:

```bash
RUN_SMOKE_TESTS=1 pnpm --dir frontend exec playwright test tests/contract-creation.smoke.spec.ts --headed --timeout=120000
```

Side effects:

- The test creates a real eformsign document in the dev tenant.
- The test sends a real SMS to the selected client's phone number.
- Use a dev-only test customer.
- The test cleans up the created eformsign document with `deleteDocument(..., true)` via `/api/eformsign/documents?is_permanent=true`.
