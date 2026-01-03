# Next.js Implementation Guide v1.0

Next.js App Router 기반 프론트엔드 구현 가이드입니다.

---

## 1. 프로젝트 구조

```
apps/web/
├── src/
│   ├── app/                      # App Router (Pages & Layouts)
│   │   ├── (auth)/              # Auth 페이지 그룹
│   │   │   ├── login/
│   │   │   │   └── page.tsx
│   │   │   ├── register/
│   │   │   │   └── page.tsx
│   │   │   └── layout.tsx       # Auth 레이아웃
│   │   ├── (main)/              # 메인 페이지 그룹
│   │   │   ├── dashboard/
│   │   │   │   └── page.tsx
│   │   │   ├── profile/
│   │   │   │   └── page.tsx
│   │   │   └── layout.tsx       # 메인 레이아웃 (with Header/Sidebar)
│   │   ├── api/                 # API Proxy Routes
│   │   │   ├── auth/
│   │   │   │   └── [...path]/
│   │   │   │       └── route.ts
│   │   │   └── [...path]/
│   │   │       └── route.ts
│   │   ├── layout.tsx           # Root Layout
│   │   ├── page.tsx             # Home Page
│   │   ├── loading.tsx          # Global Loading
│   │   ├── error.tsx            # Global Error
│   │   └── not-found.tsx        # 404 Page
│   ├── components/              # 컴포넌트
│   │   ├── ui/                  # 공통 UI 컴포넌트
│   │   ├── layout/              # 레이아웃 컴포넌트
│   │   ├── features/            # 기능별 컴포넌트
│   │   └── providers/           # Context Providers
│   ├── hooks/                   # Custom Hooks
│   ├── lib/                     # 유틸리티
│   │   ├── api/                 # API 클라이언트
│   │   ├── auth/                # 인증 유틸
│   │   └── utils/               # 헬퍼 함수
│   ├── stores/                  # Zustand 스토어
│   ├── types/                   # TypeScript 타입
│   └── styles/                  # 글로벌 스타일
├── public/                      # 정적 파일
├── tailwind.config.ts
├── next.config.ts
├── tsconfig.json
└── package.json
```

---

## 2. 라우팅 패턴

### 2.1 Route Groups

페이지를 논리적으로 그룹화하되 URL에 영향 없음:

```typescript
// app/(auth)/layout.tsx - 인증 페이지용 레이아웃
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md">
        {children}
      </div>
    </div>
  );
}

// app/(main)/layout.tsx - 메인 페이지용 레이아웃
export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <Header />
      <main className="container mx-auto py-8">
        {children}
      </main>
      <Footer />
    </div>
  );
}
```

### 2.2 Dynamic Routes

```typescript
// app/products/[id]/page.tsx
interface Props {
  params: Promise<{ id: string }>;
}

export default async function ProductPage({ params }: Props) {
  const { id } = await params;
  const product = await getProduct(id);
  
  return <ProductDetail product={product} />;
}

// Catch-all: app/docs/[...slug]/page.tsx
interface Props {
  params: Promise<{ slug: string[] }>;
}

export default async function DocsPage({ params }: Props) {
  const { slug } = await params;
  // slug: ['guide', 'getting-started'] → /docs/guide/getting-started
  
  return <Documentation slug={slug} />;
}
```

### 2.3 Parallel Routes

동시에 여러 슬롯 렌더링:

```typescript
// app/dashboard/layout.tsx
export default function DashboardLayout({
  children,
  analytics,
  team,
}: {
  children: React.ReactNode;
  analytics: React.ReactNode;
  team: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-3 gap-4">
      <div className="col-span-2">{children}</div>
      <div className="space-y-4">
        {analytics}
        {team}
      </div>
    </div>
  );
}

// app/dashboard/@analytics/page.tsx
// app/dashboard/@team/page.tsx
```

### 2.4 Intercepting Routes

모달 패턴:

```
app/
├── @modal/
│   └── (.)photo/[id]/
│       └── page.tsx          # 모달로 표시
├── photo/[id]/
│   └── page.tsx              # 전체 페이지로 표시
└── page.tsx
```

```typescript
// app/@modal/(.)photo/[id]/page.tsx
export default function PhotoModal({ params }: Props) {
  return (
    <Modal>
      <PhotoDetail id={params.id} />
    </Modal>
  );
}
```

---

## 3. 렌더링 전략

### 3.1 Server Components (기본)

```typescript
// app/products/page.tsx (기본 = 서버 컴포넌트)
import { prisma } from '@/lib/prisma';

export default async function ProductsPage() {
  // 서버에서 직접 데이터 페칭
  const products = await prisma.product.findMany({
    take: 20,
    orderBy: { createdAt: 'desc' },
  });

  return (
    <div className="grid grid-cols-3 gap-4">
      {products.map((product) => (
        <ProductCard key={product.id} product={product} />
      ))}
    </div>
  );
}
```

### 3.2 Client Components

인터랙션이 필요한 경우:

```typescript
// components/features/product/AddToCartButton.tsx
'use client';

import { useState } from 'react';
import { useCartStore } from '@/stores/cart';

interface Props {
  productId: string;
}

export function AddToCartButton({ productId }: Props) {
  const [loading, setLoading] = useState(false);
  const addItem = useCartStore((state) => state.addItem);

  const handleClick = async () => {
    setLoading(true);
    await addItem(productId);
    setLoading(false);
  };

  return (
    <button
      onClick={handleClick}
      disabled={loading}
      className="px-4 py-2 bg-blue-600 text-white rounded-lg disabled:opacity-50"
    >
      {loading ? '추가 중...' : '장바구니 담기'}
    </button>
  );
}
```

### 3.3 Streaming & Suspense

```typescript
// app/dashboard/page.tsx
import { Suspense } from 'react';
import { StatsSkeleton, ChartSkeleton } from '@/components/ui/Skeleton';

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      {/* 즉시 렌더링 */}
      <h1 className="text-2xl font-bold">대시보드</h1>
      
      {/* 스트리밍 */}
      <Suspense fallback={<StatsSkeleton />}>
        <DashboardStats />
      </Suspense>
      
      <Suspense fallback={<ChartSkeleton />}>
        <SalesChart />
      </Suspense>
    </div>
  );
}

// 각 컴포넌트는 독립적으로 데이터 페칭
async function DashboardStats() {
  const stats = await fetchStats();
  return <StatsGrid stats={stats} />;
}

async function SalesChart() {
  const data = await fetchSalesData();
  return <Chart data={data} />;
}
```

### 3.4 Static Generation (ISR)

```typescript
// app/blog/[slug]/page.tsx
export const revalidate = 3600; // 1시간마다 재검증

export async function generateStaticParams() {
  const posts = await getAllPosts();
  return posts.map((post) => ({
    slug: post.slug,
  }));
}

export default async function BlogPost({ params }: Props) {
  const { slug } = await params;
  const post = await getPost(slug);
  
  return <Article post={post} />;
}
```

---

## 4. 데이터 페칭

### 4.1 서버 컴포넌트에서 직접 페칭

```typescript
// lib/api/products.ts
export async function getProducts(options?: {
  category?: string;
  limit?: number;
}) {
  const response = await fetch(
    `${process.env.BACKEND_URL}/api/products?${new URLSearchParams({
      ...(options?.category && { category: options.category }),
      ...(options?.limit && { limit: String(options.limit) }),
    })}`,
    {
      next: { revalidate: 60 }, // 60초 캐시
    }
  );

  if (!response.ok) {
    throw new Error('Failed to fetch products');
  }

  return response.json();
}

// app/products/page.tsx
export default async function ProductsPage() {
  const products = await getProducts({ limit: 20 });
  return <ProductList products={products} />;
}
```

### 4.2 클라이언트에서 TanStack Query

```typescript
// hooks/useProducts.ts
'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';

export function useProducts(category?: string) {
  return useQuery({
    queryKey: ['products', { category }],
    queryFn: () => apiClient.get('/api/products', { params: { category } }),
  });
}

export function useCreateProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateProductDto) => 
      apiClient.post('/api/products', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });
}
```

---

## 5. Metadata

### 5.1 정적 메타데이터

```typescript
// app/layout.tsx
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: {
    default: 'My App',
    template: '%s | My App',
  },
  description: 'My awesome application',
  openGraph: {
    type: 'website',
    locale: 'ko_KR',
    siteName: 'My App',
  },
};
```

### 5.2 동적 메타데이터

```typescript
// app/products/[id]/page.tsx
import type { Metadata } from 'next';

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const product = await getProduct(id);

  return {
    title: product.name,
    description: product.description,
    openGraph: {
      images: [product.imageUrl],
    },
  };
}
```

---

## 6. Error Handling

### 6.1 Error Boundary

```typescript
// app/error.tsx
'use client';

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // 에러 로깅
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h2 className="text-2xl font-bold mb-4">문제가 발생했습니다</h2>
        <p className="text-gray-600 mb-4">{error.message}</p>
        <button
          onClick={reset}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg"
        >
          다시 시도
        </button>
      </div>
    </div>
  );
}
```

### 6.2 Not Found

```typescript
// app/not-found.tsx
import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-6xl font-bold text-gray-200">404</h1>
        <h2 className="text-2xl font-bold mb-4">페이지를 찾을 수 없습니다</h2>
        <Link
          href="/"
          className="text-blue-600 hover:underline"
        >
          홈으로 돌아가기
        </Link>
      </div>
    </div>
  );
}

// 동적으로 404 트리거
import { notFound } from 'next/navigation';

export default async function ProductPage({ params }: Props) {
  const product = await getProduct(params.id);
  
  if (!product) {
    notFound();
  }
  
  return <ProductDetail product={product} />;
}
```

---

## 7. Middleware

```typescript
// middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const token = request.cookies.get('token')?.value;
  const { pathname } = request.nextUrl;

  // 인증 필요 경로
  const protectedPaths = ['/dashboard', '/profile', '/settings'];
  const isProtected = protectedPaths.some((path) => 
    pathname.startsWith(path)
  );

  // 인증되지 않은 상태로 보호된 경로 접근
  if (isProtected && !token) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // 이미 인증된 상태로 로그인 페이지 접근
  if (pathname === '/login' && token) {
    return NextResponse.redirect(new URL('/dashboard', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
};
```

---

## 8. Image Optimization

```typescript
import Image from 'next/image';

// 기본 사용
<Image
  src="/hero.png"
  alt="Hero image"
  width={1200}
  height={600}
  priority // LCP 이미지
/>

// 반응형
<Image
  src={product.imageUrl}
  alt={product.name}
  fill
  sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
  className="object-cover"
/>

// 외부 이미지
// next.config.ts
const config: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'cdn.example.com',
      },
    ],
  },
};
```

---

## 9. Fonts

```typescript
// app/layout.tsx
import { Inter, Noto_Sans_KR } from 'next/font/google';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const notoSansKr = Noto_Sans_KR({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-noto-sans-kr',
  display: 'swap',
});

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko" className={`${inter.variable} ${notoSansKr.variable}`}>
      <body>{children}</body>
    </html>
  );
}

// tailwind.config.ts
const config: Config = {
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-inter)', 'var(--font-noto-sans-kr)', 'sans-serif'],
      },
    },
  },
};
```

---

## 10. Environment Variables

```bash
# .env.local (클라이언트 + 서버)
NEXT_PUBLIC_APP_URL=http://localhost:3000

# .env.local (서버만)
BACKEND_URL=http://localhost:4000
DATABASE_URL=postgresql://...
JWT_SECRET=your-secret-key
```

```typescript
// lib/config.ts
export const config = {
  appUrl: process.env.NEXT_PUBLIC_APP_URL!,
  backendUrl: process.env.BACKEND_URL!,
  isProduction: process.env.NODE_ENV === 'production',
} as const;
```

---

## 11. 성능 최적화

### 11.1 Dynamic Imports

```typescript
import dynamic from 'next/dynamic';

// 클라이언트 사이드에서만 로드
const Chart = dynamic(() => import('@/components/Chart'), {
  ssr: false,
  loading: () => <ChartSkeleton />,
});

// 특정 조건에서만 로드
const AdminPanel = dynamic(() => import('@/components/AdminPanel'));

export default function Dashboard() {
  const { isAdmin } = useAuth();
  
  return (
    <div>
      <Chart />
      {isAdmin && <AdminPanel />}
    </div>
  );
}
```

### 11.2 Route Prefetching

```typescript
import Link from 'next/link';

// 기본: 뷰포트에 들어오면 prefetch
<Link href="/products">Products</Link>

// Prefetch 비활성화
<Link href="/products" prefetch={false}>Products</Link>

// 프로그래매틱 prefetch
import { useRouter } from 'next/navigation';

const router = useRouter();
router.prefetch('/products');
```

---

## 12. Testing

### 12.1 Component Testing

```typescript
// __tests__/ProductCard.test.tsx
import { render, screen } from '@testing-library/react';
import { ProductCard } from '@/components/features/product/ProductCard';

describe('ProductCard', () => {
  const mockProduct = {
    id: '1',
    name: 'Test Product',
    price: 10000,
    imageUrl: '/test.jpg',
  };

  it('renders product name', () => {
    render(<ProductCard product={mockProduct} />);
    expect(screen.getByText('Test Product')).toBeInTheDocument();
  });

  it('formats price correctly', () => {
    render(<ProductCard product={mockProduct} />);
    expect(screen.getByText('₩10,000')).toBeInTheDocument();
  });
});
```

### 12.2 E2E Testing (Playwright)

```typescript
// e2e/products.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Products Page', () => {
  test('should display products', async ({ page }) => {
    await page.goto('/products');
    
    await expect(page.getByRole('heading', { name: '상품 목록' }))
      .toBeVisible();
    
    const products = page.getByTestId('product-card');
    await expect(products).toHaveCount(20);
  });

  test('should filter by category', async ({ page }) => {
    await page.goto('/products');
    
    await page.getByRole('button', { name: '전자제품' }).click();
    
    await expect(page).toHaveURL('/products?category=electronics');
  });
});
```

---

*v1.0 | 2025-01-02 | Next.js 15 App Router*
