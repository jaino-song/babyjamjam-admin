---
name: no-npm-install
enabled: true
event: bash
pattern: npm\s+install\s+(?!.*-[dD])
action: warn
---

⚠️ **npm install Detected**

You are about to install a package using `npm install`.

**Why this is flagged:**
- This project uses **pnpm** as the package manager
- Adding production dependencies should be intentional
- New dependencies increase bundle size

**Use pnpm instead:**
```bash
# Install as production dependency
pnpm add <package>

# Install as dev dependency
pnpm add -D <package>
```

**Before adding any dependency, consider:**
1. Is this package necessary?
2. Is it actively maintained?
3. What's the bundle size impact?
4. Are there lighter alternatives?

Per project rules: Ask before modifying package.json dependencies.
