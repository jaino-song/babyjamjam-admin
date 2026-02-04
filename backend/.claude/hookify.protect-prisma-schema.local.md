---
name: protect-prisma-schema
enabled: true
event: file
conditions:
  - field: file_path
    operator: regex_match
    pattern: prisma/schema\.prisma$
action: warn
---

⚠️ **Prisma Schema Modification Detected**

You are about to modify `prisma/schema.prisma`.

**Why this requires attention (per project rules):**
- Schema changes require database migrations
- Changes affect the generated Prisma Client types
- Destructive changes can cause data loss in production

**Before proceeding, verify:**
1. ✅ Is this change discussed with the team?
2. ✅ Will you create a migration after this change?
3. ✅ Are you aware of the impact on existing data?
4. ✅ Have you considered backward compatibility?

**After modifying the schema:**
```bash
# Generate migration
pnpm prisma migrate dev --name descriptive_name

# Generate updated client
pnpm prisma generate
```

**Per project rules: Ask before prisma/schema.prisma changes.**
