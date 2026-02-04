---
name: lock-file-changes
enabled: true
event: file
conditions:
  - field: file_path
    operator: regex_match
    pattern: (package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$
action: warn
---

⚠️ **Lock File Modification Detected**

You are about to modify a package lock file directly.

**Lock files affected:**
- `package-lock.json` (npm)
- `pnpm-lock.yaml` (pnpm)
- `yarn.lock` (yarn)

**Why this is flagged:**
- Lock files should only change via package manager commands
- Manual edits can corrupt dependency resolution
- This could cause "works on my machine" issues

**What to do instead:**
- Add/remove packages: `pnpm add <pkg>` or `pnpm remove <pkg>`
- Update packages: `pnpm update <pkg>`
- Regenerate lock: Delete lock file and run `pnpm install`

**If this change is from a package manager command, you may proceed.**
