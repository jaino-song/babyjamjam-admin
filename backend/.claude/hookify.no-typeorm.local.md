---
name: no-typeorm
enabled: true
event: file
conditions:
  - field: file_path
    operator: regex_match
    pattern: \.(ts|tsx)$
  - field: new_text
    operator: regex_match
    pattern: from\s+['"]typeorm
action: block
---

🚫 **TypeORM Import Blocked**

You are attempting to import from `typeorm`, which is **forbidden** in this project.

**Project rule:** Prisma only - TypeORM/Sequelize/Mongoose are not allowed.

**Why Prisma is used instead:**
- Type-safe database client with auto-generated types
- Declarative schema with migrations
- Better developer experience
- Consistent with project architecture

**Use Prisma instead:**
```typescript
// ❌ TypeORM (blocked)
import { Entity, Column } from 'typeorm';

// ✅ Prisma (use this)
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

// Query example
const users = await prisma.user.findMany({
  where: { isActive: true }
});
```

This action has been blocked. Please use Prisma for all database operations.
