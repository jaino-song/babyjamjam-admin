---
name: no-secrets-in-code
enabled: true
event: file
pattern: (API_KEY|SECRET|PASSWORD|PRIVATE_KEY|ACCESS_TOKEN)\s*[=:]\s*['"][^'"]{8,}
action: warn
---

⚠️ **Potential Secret Detected in Code**

You may be adding a hardcoded secret or credential to the code:

```
API_KEY = "actual-value"
SECRET = "actual-value"
PASSWORD = "actual-value"
```

**Why this is a problem:**
- Secrets in code can be leaked via git history
- They may be exposed in logs or error messages
- Rotating compromised secrets becomes difficult

**What to do instead:**
- Use environment variables: `process.env.API_KEY`
- Store secrets in `.env` files (which are gitignored)
- Use a secrets manager for production

If this is a placeholder or example value, you may proceed.
