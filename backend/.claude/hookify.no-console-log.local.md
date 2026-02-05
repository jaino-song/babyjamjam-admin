---
name: no-console-log
enabled: true
event: file
conditions:
  - field: file_path
    operator: regex_match
    pattern: \.(ts|tsx|js|jsx)$
  - field: new_text
    operator: regex_match
    pattern: console\.(log|debug)\(
action: warn
---

⚠️ **Console Statement Detected**

You are adding `console.log()` or `console.debug()` to the code.

**Why this is flagged:**
- Console statements should not be in production code
- They can expose sensitive data in browser consoles
- They clutter logs and reduce performance

**What to do instead:**
- For debugging: Use a debugger or remove after testing
- For logging: Use a proper logging library (Winston, Pino, NestJS Logger)
- For development: Mark with `// TODO: remove` if temporary

**Example using NestJS Logger:**
```typescript
import { Logger } from '@nestjs/common';

private readonly logger = new Logger(MyService.name);
this.logger.log('Message here');
this.logger.error('Error occurred', error.stack);
```

If this is intentional for development, you may proceed.
