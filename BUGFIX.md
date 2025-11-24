# Bug Fixes & Improvements log

## 2025-11-24

### 1. Missing `framer-motion` Dependency
- **Issue:** `Cannot find module 'framer-motion'` error in `layout.tsx`.
- **Cause:** The package was missing from `package.json`.
- **Fix:** Installed `framer-motion` via `npm install framer-motion`.

### 2. Server Component Animation Error
- **Issue:** Using `motion.div` directly in `layout.tsx` (Server Component) caused runtime errors.
- **Cause:** `framer-motion` components use React hooks and require client-side rendering, but `layout.tsx` is a Server Component (exports metadata).
- **Fix:** Extracted animation logic to a new Client Component `AnimatedContainer.tsx` (originally `AnimatedMessagesContainer.tsx`) and wrapped the layout content with it.

### 3. Suspense Fallback Not Visible on Navigation
- **Issue:** The `Suspense` fallback was not triggering when navigating between message tabs (sibling routes).
- **Cause:** Next.js App Router performs soft navigation between sibling routes sharing the same layout, so the `Suspense` boundary in `layout.tsx` was not resetting.
- **Fix:**
    1.  Created `loading.tsx` in `app/messages/` to leverage Next.js's automatic loading boundary handling.
    2.  Removed the manual `Suspense` wrapper from `layout.tsx`.

### 4. Forced Loading Delay for UX
- **Issue:** The loading state was too fast to be perceived, or flickering.
- **Fix:**
    1.  Created a `delay` utility in `app/lib/delay.ts`.
    2.  Added `await delay(500)` to all message page Server Components (`greeting`, `service-info`, etc.) to force the `loading.tsx` spinner to show for at least 0.5 seconds.

### 5. `loading.tsx` Client Context
- **Issue:** `react-spinners` (MoonLoader) caused errors in `loading.tsx`.
- **Cause:** The library relies on CSS-in-JS (Emotion) and hooks, which require a client context.
- **Fix:** Added `"use client"` directive to `app/messages/loading.tsx`.

### 6. Layout Shift During Loading
- **Issue:** The container height would jump between the loading state (fixed height) and the loaded content (variable height), causing a jarring user experience.
- **Fix:**
    1.  Updated `AnimatedContainer.tsx` to use `flex-col` and correctly apply `minHeight` via style prop.
    2.  Updated `loading.tsx` to use `flexGrow: 1` to fill the available container space.
    3.  Updated all message forms (`ContractCreationForm`, `GreetingMessageForm`, etc.) to use `flexGrow: 1` to ensure they also fill the container height, providing a consistent visual experience.
