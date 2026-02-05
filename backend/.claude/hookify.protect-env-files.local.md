---
name: protect-env-files
enabled: true
event: file
conditions:
  - field: file_path
    operator: regex_match
    pattern: \.env(\.(local|development|production|test))?$
action: warn
---

⚠️ **Environment File Modification Detected**

You are about to modify an environment configuration file.

**Why this needs attention:**
- `.env` files contain sensitive configuration and secrets
- Changes can break local development or production environments
- Values may differ across team members' machines

**Before proceeding, verify:**
1. Is this change intentional?
2. Will this affect other developers?
3. Are you adding any real secrets? (Use placeholders instead)
4. Is the `.env` file properly gitignored?

**Best practices:**
- Use `.env.example` for documenting required variables
- Never commit real secrets to version control
