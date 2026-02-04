---
name: no-moment
enabled: true
event: file
conditions:
  - field: file_path
    operator: regex_match
    pattern: \.(ts|tsx|js|jsx)$
  - field: new_text
    operator: regex_match
    pattern: from\s+['"]moment
action: block
---

🚫 **Moment.js Import Blocked**

You are attempting to import `moment`, which is **forbidden** in this project.

**Project rule:** Use date-fns instead of moment.js

**Why date-fns is used instead:**
- Tree-shakeable (only import what you need)
- Immutable (returns new Date objects)
- Much smaller bundle size
- Native Date objects (no wrapper)
- TypeScript-first

**Use date-fns instead:**
```typescript
// ❌ Moment.js (blocked)
import moment from 'moment';
const formatted = moment().format('YYYY-MM-DD');

// ✅ date-fns (use this)
import { format, addDays, parseISO } from 'date-fns';

const formatted = format(new Date(), 'yyyy-MM-dd');
const tomorrow = addDays(new Date(), 1);
const parsed = parseISO('2024-01-15');
```

**Common date-fns functions:**
- `format()` - Format dates
- `parseISO()` - Parse ISO strings
- `addDays/Months/Years()` - Date arithmetic
- `differenceInDays()` - Calculate differences
- `isAfter/isBefore()` - Comparisons

This action has been blocked. Please use date-fns for date operations.
