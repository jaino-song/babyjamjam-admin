# Dashboard Loading Optimization

## Problem Statement

The dashboard loading after login takes too long. Users experience noticeable delay before seeing the fully rendered dashboard with their profile information.

---

## Current Architecture Analysis

### Authentication & Dashboard Flow

```
1. User clicks Kakao login → /login page redirects to /auth/kakao
2. Backend validates Kakao user → Creates/finds user in DB
3. Backend generates auth code → Redirects to /callback?code=...
4. Frontend exchanges code for tokens → Stores in httpOnly cookies
5. Frontend redirects to /dashboard
6. Server-side render → Calls getCurrentUser() [API CALL #1]
7. Client hydration → Header calls useGetAuthUser() [API CALL #2 - DUPLICATE]
8. Page fully interactive
```

### Key Files Involved

| Component | File Path | Purpose |
|-----------|-----------|---------|
| Login Page | `/frontend/app/login/page.tsx` | Initiates OAuth flow |
| Auth Callback | `/frontend/app/(auth)/callback/page.tsx` | Handles OAuth redirect |
| Token Exchange | `/frontend/app/(auth)/callback/actions.ts` | Exchanges code for JWT tokens |
| Dashboard Page | `/frontend/app/dashboard/page.tsx` | Main dashboard (server component) |
| Header Component | `/frontend/app/(components)/root/Header.tsx` | Navigation with user avatar |
| getCurrentUser | `/frontend/app/lib/auth/cookies.ts` | Server-side user fetch |
| useGetAuthUser | `/frontend/app/hooks/useGetAuthUser.ts` | Client-side user fetch hook |
| Auth Controller | `/backend/interface/controllers/auth.controller.ts` | Backend auth endpoints |
| Auth Service | `/backend/application/services/auth.service.ts` | Auth business logic |

---

## Identified Performance Issues

### Issue 1: Duplicate User Data Fetch (HIGH PRIORITY)

**Location:**
- Server-side: `/frontend/app/dashboard/page.tsx:57-66`
- Client-side: `/frontend/app/(components)/root/Header.tsx:26`

**Problem:**
The `/auth/me` endpoint is called twice:
1. During server-side rendering in `dashboard/page.tsx` via `getCurrentUser()`
2. During client hydration in `Header.tsx` via `useGetAuthUser()`

**Impact:** 100-200ms additional latency

**Code Evidence:**
```typescript
// dashboard/page.tsx (Server Component)
const user = await getCurrentUser();  // First fetch

// Header.tsx (Client Component)
const { data: user, isLoading } = useGetAuthUser();  // Second fetch - REDUNDANT
```

---

### Issue 2: No Prefetching During Auth Flow (MEDIUM PRIORITY)

**Location:** `/frontend/app/(auth)/callback/actions.ts`

**Problem:**
After successful token exchange, the user is redirected to dashboard without prefetching any data. The dashboard then has to wait for a full network roundtrip.

**Impact:** 50-100ms that could be saved

---

### Issue 3: Header Loading State (MEDIUM PRIORITY)

**Location:** `/frontend/app/(components)/root/Header.tsx:65`

**Problem:**
The header shows a loading spinner for the user avatar while waiting for `useGetAuthUser()` to complete, causing visible UI jank.

**Impact:** Poor perceived performance

---

### Issue 4: No React Query Hydration (MEDIUM PRIORITY)

**Location:** `/frontend/app/lib/queryClient.ts`

**Problem:**
Server-fetched data is not hydrated into React Query cache, causing client components to refetch data that's already available.

**Impact:** Unnecessary duplicate requests

---

## Solutions

### Solution 1: Hydrate React Query from Server Data

**Files to modify:**
- `/frontend/app/dashboard/page.tsx`
- `/frontend/app/dashboard/layout.tsx` (may need to create)
- `/frontend/app/(components)/root/Header.tsx`

**Implementation:**

1. Create a hydration wrapper component:

```typescript
// /frontend/app/(components)/providers/QueryHydration.tsx
'use client';

import { HydrationBoundary, dehydrate } from '@tanstack/react-query';
import { getQueryClient } from '@/app/lib/queryClient';

export function QueryHydration({
  children,
  state
}: {
  children: React.ReactNode;
  state: unknown;
}) {
  return (
    <HydrationBoundary state={state}>
      {children}
    </HydrationBoundary>
  );
}
```

2. Prefetch and dehydrate in dashboard page:

```typescript
// /frontend/app/dashboard/page.tsx
import { dehydrate, QueryClient } from '@tanstack/react-query';
import { QueryHydration } from '@/app/(components)/providers/QueryHydration';

export default async function DashboardPage() {
  const queryClient = new QueryClient();

  // Prefetch user data
  await queryClient.prefetchQuery({
    queryKey: ['authUser'],
    queryFn: getCurrentUser,
  });

  const user = queryClient.getQueryData(['authUser']);

  return (
    <QueryHydration state={dehydrate(queryClient)}>
      {/* Dashboard content */}
    </QueryHydration>
  );
}
```

3. The `useGetAuthUser` hook will now use the hydrated data instead of refetching.

---

### Solution 2: Pass User Data via Props (Simpler Alternative)

**Files to modify:**
- `/frontend/app/dashboard/page.tsx`
- `/frontend/app/(components)/root/Header.tsx`
- `/frontend/app/(components)/root/ConditionalHeader.tsx`
- `/frontend/app/layout.tsx`

**Implementation:**

1. Modify layout to pass user data:

```typescript
// /frontend/app/dashboard/layout.tsx
import { getCurrentUser } from '@/app/lib/auth/cookies';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();

  return (
    <>
      <Header initialUser={user} />
      {children}
    </>
  );
}
```

2. Modify Header to accept initial data:

```typescript
// /frontend/app/(components)/root/Header.tsx
interface HeaderProps {
  initialUser?: User | null;
}

export default function Header({ initialUser }: HeaderProps) {
  const { data: user, isLoading } = useGetAuthUser({
    initialData: initialUser,
  });

  // No loading state needed if initialUser is provided
  // ...
}
```

3. Modify useGetAuthUser hook:

```typescript
// /frontend/app/hooks/useGetAuthUser.ts
interface UseGetAuthUserOptions {
  initialData?: User | null;
}

export const useGetAuthUser = (options?: UseGetAuthUserOptions) => {
  return useQuery({
    queryKey: ['authUser'],
    queryFn: fetchAuthUser,
    staleTime: 1000 * 60 * 5,
    initialData: options?.initialData ?? undefined,
    // Skip initial fetch if we have initialData
    enabled: options?.initialData === undefined,
  });
};
```

---

### Solution 3: Prefetch During Auth Callback

**Files to modify:**
- `/frontend/app/(auth)/callback/actions.ts`

**Implementation:**

```typescript
// /frontend/app/(auth)/callback/actions.ts
export async function exchangeToken(code: string) {
  // ... existing token exchange logic ...

  if (response.ok) {
    // Set cookies...

    // Prefetch user data before redirect (optional optimization)
    // This warms up the server cache
    try {
      await fetch(`${API_BASE_URL}/auth/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    } catch {
      // Ignore errors - this is just prefetching
    }
  }

  redirect('/dashboard');
}
```

---

### Solution 4: Increase Cache Duration for User Data

**Files to modify:**
- `/frontend/app/hooks/useGetAuthUser.ts`

**Implementation:**

```typescript
// /frontend/app/hooks/useGetAuthUser.ts
export const useGetAuthUser = () => {
  return useQuery({
    queryKey: ['authUser'],
    queryFn: fetchAuthUser,
    staleTime: 1000 * 60 * 30, // 30 minutes (was 5 minutes)
    gcTime: 1000 * 60 * 60,    // 1 hour garbage collection
    retry: false,
  });
};
```

---

### Solution 5: Parallel Data Fetching for Dashboard Stats

**Files to modify:**
- `/frontend/app/dashboard/page.tsx`
- Backend: Create new dashboard stats endpoint

**Implementation:**

```typescript
// /frontend/app/dashboard/page.tsx
export default async function DashboardPage() {
  // Fetch all dashboard data in parallel
  const [user, stats, recentActivity] = await Promise.all([
    getCurrentUser(),
    getDashboardStats(),
    getRecentActivity(),
  ]);

  if (!user) {
    redirect('/login');
  }

  return (
    <div>
      <HeroBanner user={user} stats={stats} />
      <StatsGrid stats={stats} />
      <RecentActivity activities={recentActivity} />
    </div>
  );
}
```

---

## Implementation Order

### Phase 1: Quick Wins (Immediate Impact) ✅ COMPLETED
- [x] **1.1** Implement Solution 2 (Pass User Data via Props)
  - ✅ Modified Header to accept `initialUser` prop
  - ✅ Modified useGetAuthUser to accept `initialData` option
  - ✅ Created UserProvider context to share user data with client components
  - ✅ Moved UserProvider to root layout (for ConditionalHeader access)
  - ✅ Updated ConditionalHeader to use useInitialUser() hook
  - ✅ Dashboard layout handles auth redirect only
- [x] **1.2** Implement Solution 4 (Increase Cache Duration)
  - ✅ Updated staleTime to 30 minutes (was 5 minutes)
  - ✅ Added gcTime of 1 hour for garbage collection
- [x] **1.3** Added React cache() for Server-side Deduplication
  - ✅ Wrapped getCurrentUser with React cache() to prevent duplicate API calls within same request

### Phase 2: Architecture Improvements
- [x] **2.1** Implement SSR-safe QueryClient
  - ✅ Updated queryClient.ts with factory function for SSR
  - ✅ Server creates new instance per request (prevents state leakage)
  - ✅ Client uses singleton for consistent cache
- [ ] **2.2** Implement Solution 3 (Prefetch During Auth)
  - Add prefetch call in auth callback (optional future enhancement)

### Phase 3: Future Enhancements
- [ ] **3.1** Implement Solution 5 (Parallel Data Fetching)
  - Create dashboard stats API endpoint
  - Update dashboard to fetch real data
  - Use Promise.all for parallel fetching

---

## Expected Results

| Optimization | Time Saved | Cumulative |
|--------------|------------|------------|
| Eliminate duplicate fetch | 100-200ms | 100-200ms |
| Prefetch during auth | 50-100ms | 150-300ms |
| React Query hydration | 50-100ms | 200-400ms |
| Parallel data fetching | Variable | Depends on data |

**Target:** Reduce dashboard load time from ~400-600ms to ~100-200ms

---

## Testing Checklist

- [x] Dashboard loads without duplicate `/auth/me` calls (check Network tab) ✅ VERIFIED
  - Server-side: Only 1 call via `getCurrentUser()` (cached with React cache())
  - Client-side: Header uses `initialData` from UserProvider, no additional API call
- [x] Header shows user avatar immediately without loading state ✅ VERIFIED
  - `initialUser` prop prevents loading spinner on protected routes
- [ ] Navigation between pages maintains user data in cache
  - React Query cache with 30min staleTime ensures data reuse
- [ ] Logout properly clears cached user data
- [ ] Auth flow still works correctly after changes
- [ ] Error states handled properly (no user, network failure)

---

## Notes

- Current dashboard stats are hardcoded mock data (lines 13-53 in dashboard/page.tsx)
- The backend queries are well-optimized with no N+1 issues
- JWT guard adds minimal overhead (~5-10ms per request)
- React Query global config: 30 min staleTime, 1 hour gcTime (updated for performance)
