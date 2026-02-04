---
name: prefer-named-exports
enabled: true
event: file
conditions:
  - field: file_path
    operator: regex_match
    pattern: \.(ts|tsx|js|jsx)$
  - field: new_text
    operator: regex_match
    pattern: export\s+default\s+(function|class|const)
action: warn
---

⚠️ **Default Export Detected**

You are using `export default` which is discouraged in this project.

**Why named exports are preferred:**
- Better for tree-shaking and dead code elimination
- Easier to refactor (rename is consistent across imports)
- IDE autocomplete works better with named exports
- Prevents naming inconsistencies across files

**Instead of:**
```typescript
// ❌ Default export
export default function UserService() { }
export default class UserController { }
```

**Use named exports:**
```typescript
// ✅ Named export
export function UserService() { }
export class UserController { }
```

**Importing named exports:**
```typescript
// ✅ Consistent naming
import { UserService } from './user.service';
```

If this is required for a framework (e.g., Next.js pages), you may proceed.
