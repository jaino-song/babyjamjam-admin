---
name: dangerous-commands
enabled: true
event: bash
pattern: rm\s+-rf|chmod\s+777|>\s*/dev/
action: block
---

🚫 **Dangerous Command Blocked**

This command has been blocked because it could cause irreversible damage:

- `rm -rf` — Recursively force-deletes files without confirmation
- `chmod 777` — Makes files world-readable/writable (security vulnerability)
- `> /dev/` — Redirecting to device files can corrupt system

**What to do:**
- For file deletion: Use more targeted commands or ask user for confirmation
- For permissions: Use appropriate permission levels (e.g., `chmod 755` or `chmod 644`)
- Ask the user explicitly if they want to proceed with this operation
