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

## 2025-11-26

### 7. Backend Auth Controller - Frontend URL Fallback Bug
- **Issue:** After Kakao login, users were always redirected to production URL even when `PRODUCTION_FRONTEND_URL` was undefined.
- **Cause:** The code used template literals with `||` operator:
  ```typescript
  const frontendUrl = `${PRODUCTION_FRONTEND_URL}/dashboard` || `${DEVELOPMENT_FRONTEND_URL}/dashboard`;
  ```
  Template literals always produce strings, so even with `undefined`, it became `"undefined/dashboard"` (truthy), and the fallback was never used.
- **Fix:** Applied `||` operator on the environment variables before string interpolation:
  ```typescript
  const frontendUrl = process.env.PRODUCTION_FRONTEND_URL || process.env.DEVELOPMENT_FRONTEND_URL;
  res.redirect(`${frontendUrl}/dashboard`);
  ```
- **File:** `backend/interface/controllers/auth.controller.ts`

### 8. Frontend Login Page - Undefined API_BASE_URL
- **Issue:** `/login` page redirected to `https://...vercel.app/undefined/auth/kakao` instead of the backend API URL.
- **Cause:** Environment variables `RAILWAY_PUBLIC_API_BASE_URL` and `DEVELOPMENT_API_BASE_URL` were not available on the client side because they lacked the `NEXT_PUBLIC_` prefix required by Next.js.
- **Fix:** Changed environment variable to use `NEXT_PUBLIC_API_BASE_URL` which is exposed to the browser.
- **Files:** `frontend/app/login/page.tsx`, `frontend/app/lib/axios.ts`

### 9. useGetAuthUser Hook - Enabled Logic Issue
- **Issue:** The `enabled` option in the query had confusing logic that was always truthy.
- **Cause:** The expression `!!window.location.pathname.includes('/dashboard') || !window.location.pathname.includes('/login')` is almost always `true` due to operator precedence.
- **Recommendation:** Simplify to `enabled: !pathname?.includes('/login')` and use `usePathname()` hook for SSR safety.
- **File:** `frontend/app/hooks/useGetAuthUser.ts`

## 2025-11-27

### 10. Header Rendering on Login Page
- **Issue:** The header was visible on the login page, which should be a standalone page.
- **Fix:** Updated `ConditionalHeader.tsx` to include `/login` in the `hiddenPaths` array, preventing the header from mounting on that route.
- **Files:** `frontend/app/(components)/root/ConditionalHeader.tsx`, `frontend/app/(components)/root/Header.tsx` (reverted logic)

### 11. Page Transition Animation Skipped on Redirect
- **Issue:** When redirecting (e.g., from `/` to `/login`), the page transition animation defined in `AnimatedContainer` was skipped.
- **Cause:** React was not unmounting and remounting the `AnimatedContainer` because it persisted in the `RootLayout` across route changes.
- **Fix:** Added `key={pathname}` to the `motion.div` component in `AnimatedContainer.tsx`. This forces React to treat the component as a new instance on every route change, triggering the `initial` animation.
- **File:** `frontend/app/(components)/root/AnimatedContainer.tsx`

### 12. Mobile Web Login Header Token Fetch Issue
- **Issue:** On mobile web, the header was failing to fetch the user token, causing a redirect loop to `/login`, even though server components had access to the token.
- **Cause:** Cross-site cookie restrictions (ITP) prevented the browser from sending the `auth_token` cookie (set by the backend domain) when the frontend client-side code made direct requests to the backend API.
- **Fix:**
    1.  Implemented Next.js Rewrites in `next.config.ts` to proxy requests from `/api/*` on the frontend domain to the backend API.
    2.  Updated `axios` configuration to use the relative path `/api` for client-side requests. This ensures the browser treats the request as same-site, successfully sending the cookie to the Next.js server, which then forwards it to the backend.
- **Files:** `frontend/next.config.ts`, `frontend/app/lib/axios.ts`

## 2025-11-28

### 13. Mobile Safari OAuth Callback Network Error
- **Issue:** On mobile Safari, the OAuth callback page failed with `ERR_NETWORK` / "Network Error" when exchanging the authorization code for tokens. Mobile Chrome worked fine.
- **Cause:** Safari's Intelligent Tracking Prevention (ITP) blocks or interferes with client-side network requests (fetch/axios) made immediately after a cross-origin OAuth redirect. When the user returns from Kakao's OAuth page, Safari treats subsequent client-side requests with heightened scrutiny, causing them to fail silently with network errors.
- **Why Chrome worked:** Chrome does not have the same aggressive tracking prevention that Safari's ITP implements, so client-side requests after OAuth redirects succeed normally.
- **Fix:** Replaced the client-side fetch/axios call with a **Next.js Server Action**. Server Actions execute entirely on the server, bypassing Safari's client-side restrictions completely:
    1.  Created `actions.ts` with `exchangeToken()` server action that handles the token exchange server-to-server.
    2.  Updated `page.tsx` to call the server action instead of making a client-side fetch request.
    3.  Changed cookie `sameSite` from `"none"` to `"lax"` for better compatibility with same-site navigation.
- **Files:** 
    - `frontend/app/auth/callback/actions.ts` (new)
    - `frontend/app/auth/callback/page.tsx`
    - `frontend/next.config.ts` (updated rewrites to use fallback pattern)
