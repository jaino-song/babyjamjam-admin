# API & State Management Guide

## 기술 스택

| 라이브러리 | 용도 |
|-----------|------|
| Axios | HTTP 클라이언트 |
| TanStack Query | 서버 상태 관리 |
| Zustand | 클라이언트 상태 관리 |
| Zod | 스키마 검증 |

## Axios Instance 설정

```typescript
// core/api/axios.ts
import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig } from 'axios';

interface ApiError {
  code: string;
  message: string;
  status: number;
  traceId?: string;
}

export const apiClient: AxiosInstance = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
});

// Request Interceptor
apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  // Request ID 추가
  config.headers['X-Request-ID'] = crypto.randomUUID();
  
  // Mobile: Bearer Token 추가
  if (typeof window !== 'undefined') {
    const token = useAuthStore.getState().accessToken;
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  
  return config;
});

// Response Interceptor
apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    // 401: Token Refresh
    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true;
      
      try {
        const newToken = await refreshAccessToken();
        if (newToken && originalRequest.headers) {
          originalRequest.headers.Authorization = `Bearer ${newToken}`;
          return apiClient(originalRequest);
        }
      } catch {
        useAuthStore.getState().logout();
        window.location.href = '/login';
      }
    }

    // Error 가공
    const apiError: ApiError = {
      code: error.response?.data?.error?.code || 'UNKNOWN_ERROR',
      message: error.response?.data?.error?.message || error.message,
      status: error.response?.status || 500,
      traceId: error.response?.data?.error?.traceId,
    };

    return Promise.reject(apiError);
  }
);

async function refreshAccessToken(): Promise<string | null> {
  try {
    const response = await axios.post(
      `${process.env.NEXT_PUBLIC_API_URL}/auth/refresh`,
      {},
      { withCredentials: true }
    );
    const { accessToken } = response.data;
    useAuthStore.getState().setAccessToken(accessToken);
    return accessToken;
  } catch {
    return null;
  }
}
```

## API Service Layer

```typescript
// core/api/services/auth.api.ts
import apiClient from '../axios';
import type { LoginInput, RegisterInput, AuthResponse, User } from '@repo/types';

export const authApi = {
  login: async (data: LoginInput): Promise<AuthResponse> => {
    const response = await apiClient.post('/auth/login', data);
    return response.data;
  },

  register: async (data: RegisterInput): Promise<AuthResponse> => {
    const response = await apiClient.post('/auth/register', data);
    return response.data;
  },

  logout: async (): Promise<void> => {
    await apiClient.post('/auth/logout');
  },

  getMe: async (): Promise<User> => {
    const response = await apiClient.get('/auth/me');
    return response.data;
  },

  exchangeCode: async (code: string, platform: 'web' | 'mobile'): Promise<AuthResponse> => {
    const endpoint = platform === 'mobile' ? '/auth/token/mobile' : '/auth/token';
    const response = await apiClient.post(endpoint, { code, platform });
    return response.data;
  },
};

// core/api/services/user.api.ts
import apiClient from '../axios';
import type { User, UpdateUserInput, PaginatedResponse } from '@repo/types';

export const userApi = {
  getById: async (id: string): Promise<User> => {
    const response = await apiClient.get(`/users/${id}`);
    return response.data;
  },

  update: async (id: string, data: UpdateUserInput): Promise<User> => {
    const response = await apiClient.patch(`/users/${id}`, data);
    return response.data;
  },

  list: async (params?: { page?: number; limit?: number }): Promise<PaginatedResponse<User>> => {
    const response = await apiClient.get('/users', { params });
    return response.data;
  },
};
```

## API Index

```typescript
// core/api/index.ts
export { default as apiClient } from './axios';
export { authApi } from './services/auth.api';
export { userApi } from './services/user.api';

export const api = {
  auth: authApi,
  user: userApi,
};
```

## Zustand Stores

### Auth Store

```typescript
// core/stores/auth.store.ts
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import type { User } from '@repo/types';

interface AuthState {
  user: User | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  
  setUser: (user: User | null) => void;
  setAccessToken: (token: string | null) => void;
  login: (user: User, accessToken?: string) => void;
  logout: () => void;
  setLoading: (loading: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    immer((set) => ({
      user: null,
      accessToken: null,
      isAuthenticated: false,
      isLoading: true,

      setUser: (user) => set((state) => {
        state.user = user;
        state.isAuthenticated = !!user;
      }),

      setAccessToken: (token) => set((state) => {
        state.accessToken = token;
      }),

      login: (user, accessToken) => set((state) => {
        state.user = user;
        state.accessToken = accessToken || null;
        state.isAuthenticated = true;
        state.isLoading = false;
      }),

      logout: () => set((state) => {
        state.user = null;
        state.accessToken = null;
        state.isAuthenticated = false;
      }),

      setLoading: (loading) => set((state) => {
        state.isLoading = loading;
      }),
    })),
    {
      name: 'auth-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);
```

### UI Store

```typescript
// core/stores/ui.store.ts
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
}

interface UIState {
  // Sidebar
  sidebarOpen: boolean;
  toggleSidebar: () => void;

  // Modal
  activeModal: string | null;
  modalData: Record<string, unknown>;
  openModal: (id: string, data?: Record<string, unknown>) => void;
  closeModal: () => void;

  // Toast
  toasts: Toast[];
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;

  // Loading
  globalLoading: boolean;
  setGlobalLoading: (loading: boolean) => void;
}

export const useUIStore = create<UIState>()(
  immer((set) => ({
    sidebarOpen: true,
    toggleSidebar: () => set((state) => { state.sidebarOpen = !state.sidebarOpen; }),

    activeModal: null,
    modalData: {},
    openModal: (id, data = {}) => set((state) => {
      state.activeModal = id;
      state.modalData = data;
    }),
    closeModal: () => set((state) => {
      state.activeModal = null;
      state.modalData = {};
    }),

    toasts: [],
    addToast: (toast) => set((state) => {
      state.toasts.push({ ...toast, id: crypto.randomUUID() });
    }),
    removeToast: (id) => set((state) => {
      state.toasts = state.toasts.filter((t) => t.id !== id);
    }),

    globalLoading: false,
    setGlobalLoading: (loading) => set((state) => { state.globalLoading = loading; }),
  }))
);

// Selector hooks
export const useSidebar = () => useUIStore((s) => ({ isOpen: s.sidebarOpen, toggle: s.toggleSidebar }));
export const useToasts = () => useUIStore((s) => s.toasts);
```

## TanStack Query Hooks

### Query Keys

```typescript
// features/auth/hooks/queryKeys.ts
export const authKeys = {
  all: ['auth'] as const,
  me: () => [...authKeys.all, 'me'] as const,
};

export const userKeys = {
  all: ['users'] as const,
  lists: () => [...userKeys.all, 'list'] as const,
  list: (params: object) => [...userKeys.lists(), params] as const,
  details: () => [...userKeys.all, 'detail'] as const,
  detail: (id: string) => [...userKeys.details(), id] as const,
};
```

### Auth Hooks

```typescript
// features/auth/hooks/useAuth.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { authApi } from '@/core/api';
import { useAuthStore } from '@/core/stores/auth.store';
import { useUIStore } from '@/core/stores/ui.store';
import { authKeys } from './queryKeys';
import type { LoginInput } from '@repo/types';

export function useCurrentUser() {
  const { setUser, setLoading } = useAuthStore();

  return useQuery({
    queryKey: authKeys.me(),
    queryFn: authApi.getMe,
    retry: false,
    staleTime: 5 * 60 * 1000,
    onSuccess: (user) => {
      setUser(user);
      setLoading(false);
    },
    onError: () => {
      setUser(null);
      setLoading(false);
    },
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { login } = useAuthStore();
  const { addToast } = useUIStore();

  return useMutation({
    mutationFn: (data: LoginInput) => authApi.login(data),
    onSuccess: (response) => {
      login(response.user, response.accessToken);
      queryClient.invalidateQueries({ queryKey: authKeys.all });
      addToast({ type: 'success', title: '로그인 성공' });
      router.push('/dashboard');
    },
    onError: (error: any) => {
      addToast({ type: 'error', title: '로그인 실패', message: error.message });
    },
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const { logout } = useAuthStore();

  return useMutation({
    mutationFn: authApi.logout,
    onSuccess: () => {
      logout();
      queryClient.clear();
      router.push('/login');
    },
  });
}
```

### Generic CRUD Hooks

```typescript
// shared/hooks/useCrud.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

interface CrudApi<T, CreateInput, UpdateInput> {
  getAll: (params?: any) => Promise<T[]>;
  getById: (id: string) => Promise<T>;
  create: (data: CreateInput) => Promise<T>;
  update: (id: string, data: UpdateInput) => Promise<T>;
  delete: (id: string) => Promise<void>;
}

export function useCrudHooks<T, CreateInput, UpdateInput>(
  key: string,
  api: CrudApi<T, CreateInput, UpdateInput>
) {
  const queryClient = useQueryClient();

  const useList = (params?: any) => useQuery({
    queryKey: [key, 'list', params],
    queryFn: () => api.getAll(params),
  });

  const useDetail = (id: string) => useQuery({
    queryKey: [key, 'detail', id],
    queryFn: () => api.getById(id),
    enabled: !!id,
  });

  const useCreate = () => useMutation({
    mutationFn: api.create,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [key] }),
  });

  const useUpdate = () => useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateInput }) => api.update(id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [key] }),
  });

  const useDelete = () => useMutation({
    mutationFn: api.delete,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [key] }),
  });

  return { useList, useDetail, useCreate, useUpdate, useDelete };
}
```

## 상태 관리 원칙

### Server State vs Client State

```typescript
// Server State: TanStack Query
// - API 데이터
// - 캐싱, 동기화, 재검증 필요

const { data: user } = useQuery({
  queryKey: ['user', userId],
  queryFn: () => api.users.getById(userId),
});

// Client State: Zustand
// - UI 상태 (모달, 사이드바)
// - 세션 임시 데이터

const { sidebarOpen, toggleSidebar } = useSidebar();
```

### Form State: React Hook Form + Zod

```typescript
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema, type LoginInput } from '@repo/validators';

function LoginForm() {
  const { mutate: login, isPending } = useLogin();
  
  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = (data: LoginInput) => login(data);

  return (
    <form onSubmit={form.handleSubmit(onSubmit)}>
      <InputField
        label="이메일"
        error={form.formState.errors.email?.message}
        {...form.register('email')}
      />
      <InputField
        label="비밀번호"
        type="password"
        error={form.formState.errors.password?.message}
        {...form.register('password')}
      />
      <Button type="submit" loading={isPending}>로그인</Button>
    </form>
  );
}
```

### URL State (선택)

```typescript
// nuqs 또는 URLSearchParams 사용
import { useQueryState, parseAsInteger } from 'nuqs';

function UserList() {
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1));
  const [search, setSearch] = useQueryState('search');
  
  const { data } = useQuery({
    queryKey: ['users', { page, search }],
    queryFn: () => api.users.list({ page, search }),
  });
}
```
