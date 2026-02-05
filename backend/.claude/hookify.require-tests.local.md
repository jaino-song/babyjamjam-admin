---
name: require-tests
enabled: true
event: stop
action: warn
---

⚠️ **Completion Check: Tests Required**

Before completing this task, verify that tests are in place.

**Per project rules (TDD: Red → Green → Refactor):**
- [ ] Unit tests written for new business logic
- [ ] Integration tests for API endpoints
- [ ] E2E tests for critical user flows
- [ ] 80%+ coverage for business logic

**Check if tests were created/modified:**
```bash
# Find recently modified test files
git status | grep -E '\.(spec|test)\.(ts|tsx)$'

# Run tests to verify they pass
pnpm test
```

**Testing stack for this project:**
- Unit tests: Jest
- E2E tests: Playwright

**If tests are not applicable to this task, you may proceed.**
Otherwise, please write the necessary tests first.
