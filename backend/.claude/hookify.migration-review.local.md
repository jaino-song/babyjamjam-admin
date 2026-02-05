---
name: migration-review
enabled: true
event: file
conditions:
  - field: file_path
    operator: regex_match
    pattern: (migrations?|prisma/migrations)/.*\.(sql|ts)$
action: warn
---

⚠️ **Database Migration File Detected**

You are creating or modifying a database migration file.

**Why this requires careful review:**
- Migrations are applied to production databases
- Destructive operations (DROP, DELETE, TRUNCATE) are irreversible
- Incorrect migrations can cause data loss or downtime

**Checklist before proceeding:**

1. **Data Safety:**
   - [ ] No `DROP TABLE` without data backup plan
   - [ ] No `DROP COLUMN` with important data
   - [ ] No `TRUNCATE` or mass `DELETE`

2. **Performance:**
   - [ ] Large tables have indexes for new columns
   - [ ] No full table scans during migration
   - [ ] Consider running during low-traffic periods

3. **Rollback Plan:**
   - [ ] Can this migration be reversed?
   - [ ] Is there a down migration?

4. **Testing:**
   - [ ] Tested on development database
   - [ ] Tested with production-like data volume

**Destructive keywords to watch for:**
`DROP`, `DELETE`, `TRUNCATE`, `ALTER COLUMN` (type change)
