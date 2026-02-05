---
name: no-wip-commits
enabled: true
event: bash
pattern: git\s+commit.*["'].*WIP.*["']|git\s+commit\s+-m\s+["']?WIP
action: warn
---

⚠️ **WIP Commit Detected**

You are about to create a commit with "WIP" (Work In Progress) in the message.

**Why this is flagged:**
- WIP commits indicate incomplete work
- They should not be pushed to shared branches
- They clutter git history

**What to do instead:**

1. **If work is truly incomplete:**
   - Use `git stash` to save changes temporarily
   - Don't commit until the feature is complete

2. **If you want to save progress locally:**
   - Use a more descriptive message
   - Squash WIP commits before pushing

3. **If pushing to a feature branch:**
   - Consider using draft PRs instead
   - Rewrite commit message before merge

**Commit message best practices:**
```bash
# ❌ Avoid
git commit -m "WIP"
git commit -m "WIP: working on feature"

# ✅ Prefer
git commit -m "feat: add user authentication (partial)"
git commit -m "wip(auth): implement login form - needs validation"
```

If this is for a local branch you'll squash later, you may proceed.
