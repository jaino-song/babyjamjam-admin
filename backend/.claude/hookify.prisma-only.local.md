---
name: prisma-only
enabled: true
event: file
conditions:
  - field: file_path
    operator: regex_match
    pattern: \.(ts|tsx)$
  - field: new_text
    operator: regex_match
    pattern: from\s+['"](typeorm|sequelize|mongoose)
action: block
---

🚫 **Forbidden ORM Import Blocked**

You are attempting to import from a forbidden ORM library.

**Project rule:** Prisma only - TypeORM/Sequelize/Mongoose are not allowed.

**Blocked libraries:**
- `typeorm` - Use Prisma instead
- `sequelize` - Use Prisma instead
- `mongoose` - Use Prisma instead (even for MongoDB)

**Why Prisma is the standard:**
- Type-safe database client with auto-generated types
- Declarative schema with version-controlled migrations
- Consistent patterns across the codebase
- Great developer experience with IDE support

**Prisma usage patterns:**
```typescript
// Import
import { PrismaClient } from '@prisma/client';

// In NestJS, inject via module
constructor(private prisma: PrismaService) {}

// Queries
const user = await this.prisma.user.findUnique({
  where: { id },
  include: { posts: true }
});

// Transactions
await this.prisma.$transaction([
  this.prisma.user.update({ ... }),
  this.prisma.post.create({ ... })
]);
```

This action has been blocked. All database access must go through Prisma.
