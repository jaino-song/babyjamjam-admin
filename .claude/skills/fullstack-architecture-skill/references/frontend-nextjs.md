# Next.js Frontend Guide

## 디렉토리 구조

```
src/
├── app/                        # App Router
│   ├── (auth)/                 # 인증 불필요 라우트 그룹
│   │   ├── login/
│   │   │   └── page.tsx
│   │   └── register/
│   │       └── page.tsx
│   ├── (main)/                 # 인증 필요 라우트 그룹
│   │   ├── dashboard/
│   │   │   └── page.tsx
│   │   └── settings/
│   │       └── page.tsx
│   ├── api/                    # API Routes (BFF)
│   ├── layout.tsx
│   └── providers.tsx
├── features/                   # Feature 모듈
│   ├── auth/
│   │   ├── components/
│   │   ├── hooks/
│   │   ├── services/
│   │   └── types/
│   └── [feature]/
├── shared/                     # 공유 리소스
│   ├── components/
│   │   ├── atoms/
│   │   ├── molecules/
│   │   ├── organisms/
│   │   └── templates/
│   ├── hooks/
│   ├── lib/
│   ├── types/
│   └── constants/
└── core/                       # 핵심 설정
    ├── api/                    # Axios 설정
    ├── providers/              # Context Providers
    ├── stores/                 # Zustand Stores
    └── config/
```

## 컴포넌트 원칙

### Server Component가 기본

```typescript
// page.tsx - Server Component
export default async function DashboardPage() {
  const data = await fetchData(); // 서버에서 직접 fetch
  
  return (
    <div>
      <ServerRenderedContent data={data} />
      <ClientInteraction /> {/* Client Component만 'use client' */}
    </div>
  );
}
```

### Client Component는 최소화

```typescript
// ClientInteraction.tsx
'use client';

import { useState } from 'react';

export function ClientInteraction() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(c => c + 1)}>{count}</button>;
}
```

### Composition Pattern

```typescript
// 데이터 페칭 + 인터랙션 분리
<DataFetcher>           {/* Server: 데이터 */}
  <ClientWrapper>       {/* Client: 상태/이벤트 */}
    <PureUI />          {/* Pure: 렌더링만 */}
  </ClientWrapper>
</DataFetcher>
```

## Route Groups

```
app/
├── (auth)/                 # 인증 레이아웃
│   ├── layout.tsx          # AuthLayout
│   ├── login/
│   └── register/
├── (main)/                 # 메인 레이아웃
│   ├── layout.tsx          # MainLayout + AuthGuard
│   ├── dashboard/
│   └── settings/
└── (public)/               # 공개 페이지
    ├── layout.tsx
    └── about/
```

### Auth Guard Layout

```typescript
// (main)/layout.tsx
import { redirect } from 'next/navigation';
import { getServerSession } from '@/core/auth/session';

export default async function MainLayout({ children }) {
  const session = await getServerSession();
  
  if (!session) {
    redirect('/login');
  }
  
  return (
    <div className="flex">
      <Sidebar />
      <main className="flex-1">{children}</main>
    </div>
  );
}
```

## Feature 모듈 구조

```
features/
└── auth/
    ├── components/
    │   ├── LoginForm.tsx
    │   ├── RegisterForm.tsx
    │   └── OAuthButtons.tsx
    ├── hooks/
    │   ├── useLogin.ts
    │   ├── useRegister.ts
    │   └── useCurrentUser.ts
    ├── services/
    │   └── auth.api.ts
    └── types/
        └── auth.types.ts
```

## Providers 설정

```typescript
// app/providers.tsx
'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { useState } from 'react';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,        // 1분
            gcTime: 5 * 60 * 1000,       // 5분
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}

// app/layout.tsx
export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
```

## 에러 처리

### Error Boundary

```typescript
// app/(main)/error.tsx
'use client';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen">
      <h2 className="text-2xl font-bold">문제가 발생했습니다</h2>
      <p className="text-gray-600 mt-2">{error.message}</p>
      <button
        onClick={reset}
        className="mt-4 px-4 py-2 bg-primary-500 text-white rounded"
      >
        다시 시도
      </button>
    </div>
  );
}
```

### Not Found

```typescript
// app/(main)/not-found.tsx
export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen">
      <h2 className="text-2xl font-bold">페이지를 찾을 수 없습니다</h2>
      <Link href="/" className="mt-4 text-primary-500">
        홈으로 돌아가기
      </Link>
    </div>
  );
}
```

## Loading States

```typescript
// app/(main)/dashboard/loading.tsx
export default function DashboardLoading() {
  return (
    <div className="animate-pulse">
      <div className="h-8 bg-gray-200 rounded w-1/4 mb-4" />
      <div className="h-64 bg-gray-200 rounded" />
    </div>
  );
}
```

## Metadata

```typescript
// app/(main)/dashboard/page.tsx
import { Metadata } from 'next';

export const metadata: Metadata = {
  title: '대시보드 | MyApp',
  description: '사용자 대시보드',
};

export default function DashboardPage() {
  // ...
}

// 동적 메타데이터
export async function generateMetadata({ params }): Promise<Metadata> {
  const user = await getUser(params.id);
  return {
    title: `${user.name} | MyApp`,
  };
}
```
