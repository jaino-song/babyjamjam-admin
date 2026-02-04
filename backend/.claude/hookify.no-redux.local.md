---
name: no-redux
enabled: true
event: file
conditions:
  - field: file_path
    operator: regex_match
    pattern: \.(ts|tsx)$
  - field: new_text
    operator: regex_match
    pattern: from\s+['"](@reduxjs/toolkit|redux|react-redux)
action: block
---

🚫 **Redux Import Blocked**

You are attempting to import Redux, which is **forbidden** in this project.

**Project rule:** Zustand only - Redux/MobX/Recoil are not allowed.

**Why Zustand is used instead:**
- Minimal boilerplate
- No providers required
- Simple API with hooks
- Better TypeScript support
- Smaller bundle size

**Use Zustand instead:**
```typescript
// ❌ Redux (blocked)
import { createStore } from 'redux';
import { configureStore } from '@reduxjs/toolkit';

// ✅ Zustand (use this)
import { create } from 'zustand';

const useStore = create((set) => ({
  count: 0,
  increment: () => set((state) => ({ count: state.count + 1 })),
}));

// In component
const count = useStore((state) => state.count);
```

This action has been blocked. Please use Zustand for state management.
