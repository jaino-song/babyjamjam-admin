---
name: no-raw-sql
enabled: true
event: file
conditions:
  - field: file_path
    operator: regex_match
    pattern: \.(ts|tsx)$
  - field: new_text
    operator: regex_match
    pattern: \$queryRaw|\$executeRaw|\$queryRawUnsafe|\$executeRawUnsafe
action: warn
---

⚠️ **Prisma Raw SQL Query Detected**

You are using Prisma's raw SQL methods:
- `$queryRaw` / `$queryRawUnsafe`
- `$executeRaw` / `$executeRawUnsafe`

**Why this is flagged:**
- Bypasses Prisma's type safety
- SQL injection risk if parameters aren't properly escaped
- Makes code harder to maintain
- Loses the benefits of the ORM

**Prefer Prisma's query builder:**
```typescript
// ❌ Raw SQL
const users = await prisma.$queryRaw`SELECT * FROM users WHERE age > ${age}`;

// ✅ Prisma query
const users = await prisma.user.findMany({
  where: { age: { gt: age } }
});
```

**If raw SQL is truly necessary:**
- Use parameterized queries (tagged template literals)
- Never use `$queryRawUnsafe` with user input
- Document why ORM queries won't work

Proceed only if Prisma's query builder cannot achieve the required query.
