# API & State Management Guide v1.0

TanStack Query + Zustand 기반 데이터 페칭 및 상태관리 가이드입니다.

---

## 1. API 클라이언트

### 1.1 Axios 클라이언트 설정

```typescript
// lib/api/client.ts
import axios, { AxiosError, AxiosRequestConfig, AxiosResponse } from 'axios';

// API 클라이언트 생성
export const apiClient = axios.create({
  baseURL: '/api', // Next.js API Proxy 사용
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request Interceptor
apiClient.interceptors.request.use(
  (config) => {
    // 토큰 자동 첨부 (서버에서 처리하므로 클라이언트에서는 불필요할 수 있음)
    return config;
  },
  (error) => Promise.reject(error)
);

// Response Interceptor
apiClient.interceptors.response.use(
  (response: AxiosResponse) => response.data,
  async (error: AxiosError<ApiError>) => {
    const originalRequest = error.config as AxiosRequestConfig & {
      _retry?: boolean;
    };

    // 401 에러 시 토큰 갱신 시도
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;

      try {
        await apiClient.post('/auth/refresh');
        return apiClient(originalRequest);
      } catch {
        // 갱신 실패 시 로그인 페이지로 이동
        window.location.href = '/login';
      }
    }

    return Promise.reject(error);
  }
);

// 타입 정의
interface ApiError {
  message: string;
  code?: string;
  details?: Record<string, string[]>;
}

// API 응답 타입
export interface ApiResponse<T> {
  data: T;
  message?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}
```

### 1.2 API Proxy Routes

**⚠️ 중요**: 클라이언트에서 직접 백엔드 API를 호출하지 않습니다.

```typescript
// app/api/[...path]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const BACKEND_URL = process.env.BACKEND_URL!;

async function handler(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const pathname = path.join('/');
  const cookieStore = await cookies();

  // 쿠키에서 토큰 추출
  const accessToken = cookieStore.get('accessToken')?.value;

  // 백엔드로 프록시
  const response = await fetch(`${BACKEND_URL}/api/${pathname}`, {
    method: request.method,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken && { Authorization: `Bearer ${accessToken}` }),
    },
    body: request.method !== 'GET' ? await request.text() : undefined,
  });

  const data = await response.json();

  // 토큰 갱신 시 쿠키 업데이트
  if (data.accessToken) {
    const res = NextResponse.json(data);
    res.cookies.set('accessToken', data.accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 15, // 15분
    });
    return res;
  }

  return NextResponse.json(data, { status: response.status });
}

export { handler as GET, handler as POST, handler as PUT, handler as DELETE };
```

### 1.3 인증 API Routes

```typescript
// app/api/auth/login/route.ts
import { NextRequest, NextResponse } from 'next/server';

const BACKEND_URL = process.env.BACKEND_URL!;

export async function POST(request: NextRequest) {
  const body = await request.json();

  const response = await fetch(`${BACKEND_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const data = await response.json();

  if (!response.ok) {
    return NextResponse.json(data, { status: response.status });
  }

  // 토큰을 HttpOnly 쿠키로 설정
  const res = NextResponse.json({ user: data.user });

  res.cookies.set('accessToken', data.accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 15, // 15분
  });

  res.cookies.set('refreshToken', data.refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7, // 7일
  });

  return res;
}
```

---

## 2. TanStack Query

### 2.1 Query Provider 설정

```typescript
// components/providers/QueryProvider.tsx
'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { useState } from 'react';

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 1000 * 60, // 1분
            gcTime: 1000 * 60 * 5, // 5분
            refetchOnWindowFocus: false,
            retry: (failureCount, error) => {
              // 4xx 에러는 재시도하지 않음
              if ((error as any)?.response?.status >= 400 &&
                  (error as any)?.response?.status < 500) {
                return false;
              }
              return failureCount < 3;
            },
          },
          mutations: {
            retry: false,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {process.env.NODE_ENV === 'development' && (
        <ReactQueryDevtools initialIsOpen={false} />
      )}
    </QueryClientProvider>
  );
}
```

### 2.2 Query Keys 관리

```typescript
// lib/api/queryKeys.ts
export const queryKeys = {
  // Users
  users: {
    all: ['users'] as const,
    lists: () => [...queryKeys.users.all, 'list'] as const,
    list: (filters: Record<string, unknown>) =>
      [...queryKeys.users.lists(), filters] as const,
    details: () => [...queryKeys.users.all, 'detail'] as const,
    detail: (id: string) => [...queryKeys.users.details(), id] as const,
  },

  // Products
  products: {
    all: ['products'] as const,
    lists: () => [...queryKeys.products.all, 'list'] as const,
    list: (filters: { category?: string; search?: string }) =>
      [...queryKeys.products.lists(), filters] as const,
    details: () => [...queryKeys.products.all, 'detail'] as const,
    detail: (id: string) => [...queryKeys.products.details(), id] as const,
  },

  // Orders
  orders: {
    all: ['orders'] as const,
    lists: () => [...queryKeys.orders.all, 'list'] as const,
    list: (userId?: string) => [...queryKeys.orders.lists(), { userId }] as const,
    detail: (id: string) => [...queryKeys.orders.all, 'detail', id] as const,
  },
} as const;
```

### 2.3 useQuery 사용

```typescript
// hooks/useProducts.ts
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/queryKeys';
import type { Product, PaginatedResponse } from '@/types';

interface UseProductsOptions {
  category?: string;
  search?: string;
  enabled?: boolean;
}

export function useProducts(options: UseProductsOptions = {}) {
  const { category, search, enabled = true } = options;

  return useQuery({
    queryKey: queryKeys.products.list({ category, search }),
    queryFn: async (): Promise<PaginatedResponse<Product>> => {
      const params = new URLSearchParams();
      if (category) params.set('category', category);
      if (search) params.set('search', search);

      return apiClient.get(`/products?${params.toString()}`);
    },
    enabled,
    staleTime: 1000 * 60 * 5, // 5분
  });
}

export function useProduct(id: string) {
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: queryKeys.products.detail(id),
    queryFn: async (): Promise<Product> => {
      return apiClient.get(`/products/${id}`);
    },
    // 리스트에서 초기 데이터 가져오기
    initialData: () => {
      const lists = queryClient.getQueriesData<PaginatedResponse<Product>>({
        queryKey: queryKeys.products.lists(),
      });

      for (const [, data] of lists) {
        const product = data?.items.find((p) => p.id === id);
        if (product) return product;
      }

      return undefined;
    },
  });
}
```

### 2.4 useMutation 사용

```typescript
// hooks/useCreateProduct.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/queryKeys';
import type { CreateProductDto, Product } from '@/types';

export function useCreateProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateProductDto): Promise<Product> => {
      return apiClient.post('/products', data);
    },
    onSuccess: (newProduct) => {
      // 상품 목록 캐시 무효화
      queryClient.invalidateQueries({
        queryKey: queryKeys.products.lists(),
      });

      // 또는 직접 캐시 업데이트 (Optimistic Update)
      // queryClient.setQueryData(
      //   queryKeys.products.detail(newProduct.id),
      //   newProduct
      // );
    },
    onError: (error) => {
      console.error('Failed to create product:', error);
    },
  });
}

export function useUpdateProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: Partial<CreateProductDto>;
    }): Promise<Product> => {
      return apiClient.patch(`/products/${id}`, data);
    },
    onSuccess: (updatedProduct, { id }) => {
      // 상세 캐시 업데이트
      queryClient.setQueryData(
        queryKeys.products.detail(id),
        updatedProduct
      );

      // 목록 캐시 무효화
      queryClient.invalidateQueries({
        queryKey: queryKeys.products.lists(),
      });
    },
  });
}

export function useDeleteProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      return apiClient.delete(`/products/${id}`);
    },
    onSuccess: (_, id) => {
      // 상세 캐시 제거
      queryClient.removeQueries({
        queryKey: queryKeys.products.detail(id),
      });

      // 목록 캐시 무효화
      queryClient.invalidateQueries({
        queryKey: queryKeys.products.lists(),
      });
    },
  });
}
```

### 2.5 Infinite Query (무한 스크롤)

```typescript
// hooks/useInfiniteProducts.ts
import { useInfiniteQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/queryKeys';
import type { Product, PaginatedResponse } from '@/types';

interface UseInfiniteProductsOptions {
  category?: string;
  limit?: number;
}

export function useInfiniteProducts(options: UseInfiniteProductsOptions = {}) {
  const { category, limit = 12 } = options;

  return useInfiniteQuery({
    queryKey: [...queryKeys.products.list({ category }), 'infinite'],
    queryFn: async ({
      pageParam = 1,
    }): Promise<PaginatedResponse<Product> & { nextPage: number | null }> => {
      const params = new URLSearchParams({
        page: String(pageParam),
        limit: String(limit),
      });
      if (category) params.set('category', category);

      const data = await apiClient.get(`/products?${params.toString()}`);

      return {
        ...data,
        nextPage: data.hasMore ? pageParam + 1 : null,
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextPage,
    initialPageParam: 1,
  });
}

// 사용 예시
function ProductList() {
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteProducts({ category: 'electronics' });

  const products = data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <div>
      {products.map((product) => (
        <ProductCard key={product.id} product={product} />
      ))}

      {hasNextPage && (
        <Button
          onClick={() => fetchNextPage()}
          loading={isFetchingNextPage}
        >
          더 보기
        </Button>
      )}
    </div>
  );
}
```

### 2.6 Optimistic Updates

```typescript
// hooks/useToggleFavorite.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { queryKeys } from '@/lib/api/queryKeys';
import type { Product } from '@/types';

export function useToggleFavorite() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (productId: string): Promise<void> => {
      return apiClient.post(`/products/${productId}/favorite`);
    },
    onMutate: async (productId) => {
      // 진행 중인 쿼리 취소
      await queryClient.cancelQueries({
        queryKey: queryKeys.products.detail(productId),
      });

      // 이전 값 저장
      const previousProduct = queryClient.getQueryData<Product>(
        queryKeys.products.detail(productId)
      );

      // 낙관적 업데이트
      if (previousProduct) {
        queryClient.setQueryData<Product>(
          queryKeys.products.detail(productId),
          {
            ...previousProduct,
            isFavorite: !previousProduct.isFavorite,
          }
        );
      }

      return { previousProduct };
    },
    onError: (err, productId, context) => {
      // 에러 시 롤백
      if (context?.previousProduct) {
        queryClient.setQueryData(
          queryKeys.products.detail(productId),
          context.previousProduct
        );
      }
    },
    onSettled: (_, __, productId) => {
      // 완료 후 재검증
      queryClient.invalidateQueries({
        queryKey: queryKeys.products.detail(productId),
      });
    },
  });
}
```

---

## 3. Zustand (클라이언트 상태)

### 3.1 Store 설정

```typescript
// stores/useAuthStore.ts
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface User {
  id: string;
  email: string;
  name: string;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  setUser: (user: User | null) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isAuthenticated: false,
      setUser: (user) =>
        set({
          user,
          isAuthenticated: !!user,
        }),
      logout: () =>
        set({
          user: null,
          isAuthenticated: false,
        }),
    }),
    {
      name: 'auth-storage',
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({ user: state.user }),
    }
  )
);
```

### 3.2 Cart Store

```typescript
// stores/useCartStore.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

interface CartItem {
  productId: string;
  name: string;
  price: number;
  quantity: number;
  imageUrl: string;
}

interface CartState {
  items: CartItem[];
  addItem: (item: Omit<CartItem, 'quantity'>) => void;
  removeItem: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  clearCart: () => void;
  getTotalPrice: () => number;
  getTotalCount: () => number;
}

export const useCartStore = create<CartState>()(
  persist(
    immer((set, get) => ({
      items: [],

      addItem: (item) =>
        set((state) => {
          const existingItem = state.items.find(
            (i) => i.productId === item.productId
          );

          if (existingItem) {
            existingItem.quantity += 1;
          } else {
            state.items.push({ ...item, quantity: 1 });
          }
        }),

      removeItem: (productId) =>
        set((state) => {
          state.items = state.items.filter((i) => i.productId !== productId);
        }),

      updateQuantity: (productId, quantity) =>
        set((state) => {
          const item = state.items.find((i) => i.productId === productId);
          if (item) {
            if (quantity <= 0) {
              state.items = state.items.filter((i) => i.productId !== productId);
            } else {
              item.quantity = quantity;
            }
          }
        }),

      clearCart: () =>
        set((state) => {
          state.items = [];
        }),

      getTotalPrice: () => {
        return get().items.reduce(
          (total, item) => total + item.price * item.quantity,
          0
        );
      },

      getTotalCount: () => {
        return get().items.reduce((total, item) => total + item.quantity, 0);
      },
    })),
    {
      name: 'cart-storage',
    }
  )
);
```

### 3.3 UI State Store

```typescript
// stores/useUIStore.ts
import { create } from 'zustand';

interface UIState {
  sidebarOpen: boolean;
  modalOpen: string | null; // 열린 모달 ID
  theme: 'light' | 'dark';
  toggleSidebar: () => void;
  openModal: (modalId: string) => void;
  closeModal: () => void;
  setTheme: (theme: 'light' | 'dark') => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  modalOpen: null,
  theme: 'light',

  toggleSidebar: () =>
    set((state) => ({ sidebarOpen: !state.sidebarOpen })),

  openModal: (modalId) =>
    set({ modalOpen: modalId }),

  closeModal: () =>
    set({ modalOpen: null }),

  setTheme: (theme) =>
    set({ theme }),
}));
```

### 3.4 Store with Selectors

```typescript
// stores/useFilterStore.ts
import { create } from 'zustand';

interface FilterState {
  category: string | null;
  priceRange: [number, number];
  sortBy: 'price' | 'newest' | 'popular';
  search: string;
  setCategory: (category: string | null) => void;
  setPriceRange: (range: [number, number]) => void;
  setSortBy: (sortBy: FilterState['sortBy']) => void;
  setSearch: (search: string) => void;
  reset: () => void;
}

const initialState = {
  category: null,
  priceRange: [0, 1000000] as [number, number],
  sortBy: 'newest' as const,
  search: '',
};

export const useFilterStore = create<FilterState>((set) => ({
  ...initialState,
  setCategory: (category) => set({ category }),
  setPriceRange: (priceRange) => set({ priceRange }),
  setSortBy: (sortBy) => set({ sortBy }),
  setSearch: (search) => set({ search }),
  reset: () => set(initialState),
}));

// Selector 사용 (불필요한 리렌더링 방지)
import { useShallow } from 'zustand/react/shallow';

function ProductFilters() {
  const { category, setCategory, sortBy, setSortBy } = useFilterStore(
    useShallow((state) => ({
      category: state.category,
      setCategory: state.setCategory,
      sortBy: state.sortBy,
      setSortBy: state.setSortBy,
    }))
  );

  // ...
}
```

---

## 4. 서버 상태 vs 클라이언트 상태

### 구분 기준

| 상태 유형 | 사용 도구 | 예시 |
|----------|----------|------|
| 서버 상태 | TanStack Query | 상품 목록, 사용자 정보, 주문 내역 |
| 클라이언트 상태 | Zustand | 장바구니, UI 상태, 필터, 폼 상태 |

### 예시: 장바구니 (하이브리드)

```typescript
// 장바구니: Zustand (로컬) + 서버 동기화
// stores/useCartStore.ts
export const useCartStore = create<CartState>()((set, get) => ({
  items: [],
  syncing: false,

  // 로컬 상태 업데이트
  addItem: (item) => {
    set((state) => ({
      items: [...state.items, { ...item, quantity: 1 }],
    }));

    // 서버 동기화
    get().syncWithServer();
  },

  // 서버와 동기화
  syncWithServer: async () => {
    set({ syncing: true });
    try {
      await apiClient.post('/cart/sync', { items: get().items });
    } catch (error) {
      console.error('Cart sync failed:', error);
    } finally {
      set({ syncing: false });
    }
  },

  // 서버에서 불러오기
  fetchFromServer: async () => {
    const cart = await apiClient.get('/cart');
    set({ items: cart.items });
  },
}));
```

---

## 5. Error Handling

### 5.1 전역 에러 처리

```typescript
// components/providers/QueryProvider.tsx
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      onError: (error) => {
        // 전역 에러 토스트
        toast.error(getErrorMessage(error));
      },
    },
    mutations: {
      onError: (error) => {
        toast.error(getErrorMessage(error));
      },
    },
  },
});

// lib/utils/error.ts
export function getErrorMessage(error: unknown): string {
  if (error instanceof AxiosError) {
    return error.response?.data?.message || '요청 처리 중 오류가 발생했습니다';
  }
  if (error instanceof Error) {
    return error.message;
  }
  return '알 수 없는 오류가 발생했습니다';
}
```

### 5.2 컴포넌트 레벨 에러 처리

```typescript
function ProductList() {
  const { data, error, isLoading, refetch } = useProducts();

  if (isLoading) {
    return <ProductListSkeleton />;
  }

  if (error) {
    return (
      <ErrorState
        message="상품을 불러오는데 실패했습니다"
        onRetry={refetch}
      />
    );
  }

  return (
    <div className="grid grid-cols-3 gap-4">
      {data?.items.map((product) => (
        <ProductCard key={product.id} product={product} />
      ))}
    </div>
  );
}
```

---

## 6. Loading States

### 6.1 Skeleton Components

```typescript
// components/ui/Skeleton/Skeleton.tsx
import { cn } from '@/lib/utils';

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {}

export function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-gray-200', className)}
      {...props}
    />
  );
}

// components/features/product/ProductCardSkeleton.tsx
export function ProductCardSkeleton() {
  return (
    <div className="rounded-xl border p-4">
      <Skeleton className="aspect-square w-full" />
      <Skeleton className="mt-4 h-4 w-3/4" />
      <Skeleton className="mt-2 h-6 w-1/2" />
    </div>
  );
}
```

### 6.2 Suspense 활용

```typescript
// app/products/page.tsx
import { Suspense } from 'react';
import { ProductList } from '@/components/features/product';
import { ProductListSkeleton } from '@/components/features/product';

export default function ProductsPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">상품 목록</h1>
      <Suspense fallback={<ProductListSkeleton />}>
        <ProductList />
      </Suspense>
    </div>
  );
}
```

---

*v1.0 | 2025-01-02 | TanStack Query + Zustand*
