---
name: verify-build
enabled: true
event: stop
action: warn
---

⚠️ **Completion Check: Build Verification**

Before completing this task, verify that the code builds successfully.

**Why this matters:**
- TypeScript errors may not be visible during editing
- Build catches type mismatches and missing imports
- Prevents broken code from being committed

**Run the build command:**
```bash
pnpm build
```

**Common build issues to check:**
- [ ] No TypeScript compilation errors
- [ ] All imports resolve correctly
- [ ] No circular dependency issues
- [ ] Environment variables are properly typed

**If the build fails:**
1. Read the error messages carefully
2. Fix the issues before completing
3. Re-run the build to verify

**If the build passes or this is a non-code task, you may proceed.**
