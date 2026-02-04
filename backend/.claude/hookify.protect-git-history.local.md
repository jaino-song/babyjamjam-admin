---
name: protect-git-history
enabled: true
event: bash
pattern: git\s+(push\s+--force|push\s+-f|reset\s+--hard|clean\s+-fd)
action: block
---

🚫 **Destructive Git Command Blocked**

This command has been blocked because it could destroy git history:

- `git push --force` / `git push -f` — Overwrites remote history, can lose teammates' work
- `git reset --hard` — Discards all uncommitted changes permanently
- `git clean -fd` — Deletes untracked files/directories permanently

**What to do:**
- For push: Consider `git push --force-with-lease` (safer alternative)
- For reset: Use `git stash` to save changes before resetting
- For clean: Review untracked files with `git status` first
- Ask the user explicitly if they understand the consequences
