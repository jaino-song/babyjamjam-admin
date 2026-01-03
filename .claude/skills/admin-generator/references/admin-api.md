# Admin API

> 어드민 API 연동 가이드

---

## 📋 목차

1. [API 클라이언트 설정](#api-클라이언트-설정)
2. [API Route 프록시](#api-route-프록시)
3. [CRUD 작업](#crud-작업)
4. [TanStack Query 통합](#tanstack-query-통합)
5. [에러 처리](#에러-처리)
6. [파일 업로드](#파일-업로드)
7. [Optimistic Updates](#optimistic-updates)
8. [캐싱 전략](#캐싱-전략)

---

## API 클라이언트 설정

### Axios 인스턴스

```ts
// lib/api.ts
import axios, { AxiosError, AxiosInstance, InternalAxiosRequestConfig } from 'axios';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || '/api';

export const api: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 10000,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,
});

// Request Interceptor
api.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    // 토큰이 필요한 경우 추가
    const token = typeof window !== 'undefined' 
      ? localStorage.getItem('token') 
      : null;
    
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    
    return config;
  },
  (error) => Promise.reject(error)
);

// Response Interceptor
api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config;

    // 401 에러 처리 (토큰 만료)
    if (error.response?.status === 401 && originalRequest) {
      try {
        // 토큰 갱신 시도
        const { data } = await axios.post('/api/auth/refresh');
        localStorage.setItem('token', data.accessToken);
        
        // 원래 요청 재시도
        originalRequest.headers.Authorization = `Bearer ${data.accessToken}`;
        return api(originalRequest);
      } catch (refreshError) {
        // 갱신 실패 시 로그아웃
        localStorage.removeItem('token');
        window.location.href = '/login';
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);
```

### 서버 사이드 API 클라이언트

```ts
// lib/api-server.ts
import axios from 'axios';
import { cookies } from 'next/headers';

const BACKEND_URL = process.env.BACKEND_URL!;

export async function serverApi() {
  const cookieStore = cookies();
  const token = cookieStore.get('auth-token')?.value;

  return axios.create({
    baseURL: BACKEND_URL,
    headers: {
      'Content-Type': 'application/json',
      ...(token && { Authorization: `Bearer ${token}` }),
    },
  });
}

// 사용 예시
export async function getUsers() {
  const client = await serverApi();
  const response = await client.get('/admin/users');
  return response.data;
}
```

---

## API Route 프록시

### 기본 프록시 패턴

```ts
// app/api/admin/users/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const BACKEND_URL = process.env.BACKEND_URL!;

export async function GET(request: NextRequest) {
  const cookieStore = cookies();
  const token = cookieStore.get('auth-token')?.value;

  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const queryString = searchParams.toString();
    const url = `${BACKEND_URL}/admin/users${queryString ? `?${queryString}` : ''}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const cookieStore = cookies();
  const token = cookieStore.get('auth-token')?.value;

  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();

    const response = await fetch(`${BACKEND_URL}/admin/users`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }

    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
```

### 동적 라우트 프록시

```ts
// app/api/admin/users/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';

const BACKEND_URL = process.env.BACKEND_URL!;

interface RouteParams {
  params: { id: string };
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const cookieStore = cookies();
  const token = cookieStore.get('auth-token')?.value;

  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const response = await fetch(`${BACKEND_URL}/admin/users/${params.id}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const cookieStore = cookies();
  const token = cookieStore.get('auth-token')?.value;

  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();

    const response = await fetch(`${BACKEND_URL}/admin/users/${params.id}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      return NextResponse.json(data, { status: response.status });
    }

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const cookieStore = cookies();
  const token = cookieStore.get('auth-token')?.value;

  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const response = await fetch(`${BACKEND_URL}/admin/users/${params.id}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const data = await response.json();
      return NextResponse.json(data, { status: response.status });
    }

    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}
```

---

## CRUD 작업

### API 함수 정의

```ts
// features/admin/api/users.ts
import { api } from '@/lib/api';
import type { User, CreateUserDto, UpdateUserDto } from '../types/admin.types';

export interface UsersResponse {
  users: User[];
  total: number;
  page: number;
  totalPages: number;
}

export interface UsersParams {
  page?: number;
  limit?: number;
  search?: string;
  role?: string;
  status?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

// 목록 조회
export async function getUsers(params?: UsersParams): Promise<UsersResponse> {
  const response = await api.get('/admin/users', { params });
  return response.data;
}

// 단일 조회
export async function getUserById(id: string): Promise<User> {
  const response = await api.get(`/admin/users/${id}`);
  return response.data;
}

// 생성
export async function createUser(data: CreateUserDto): Promise<User> {
  const response = await api.post('/admin/users', data);
  return response.data;
}

// 수정
export async function updateUser(id: string, data: UpdateUserDto): Promise<User> {
  const response = await api.patch(`/admin/users/${id}`, data);
  return response.data;
}

// 삭제
export async function deleteUser(id: string): Promise<void> {
  await api.delete(`/admin/users/${id}`);
}

// 일괄 삭제
export async function deleteUsers(ids: string[]): Promise<void> {
  await api.post('/admin/users/bulk-delete', { ids });
}

// 상태 변경
export async function updateUserStatus(
  id: string,
  status: 'active' | 'inactive'
): Promise<User> {
  const response = await api.patch(`/admin/users/${id}/status`, { status });
  return response.data;
}
```

---

## TanStack Query 통합

### Query Hooks

```ts
// features/admin/hooks/useUsers.ts
import { useQuery, useMutation, useQueryClient, UseQueryOptions } from '@tanstack/react-query';
import {
  getUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  deleteUsers,
  updateUserStatus,
  type UsersParams,
  type UsersResponse,
} from '../api/users';
import type { User, CreateUserDto, UpdateUserDto } from '../types/admin.types';
import { toast } from 'sonner';

// Query Keys
export const userKeys = {
  all: ['users'] as const,
  lists: () => [...userKeys.all, 'list'] as const,
  list: (params?: UsersParams) => [...userKeys.lists(), params] as const,
  details: () => [...userKeys.all, 'detail'] as const,
  detail: (id: string) => [...userKeys.details(), id] as const,
};

// 목록 조회
export function useUsers(
  params?: UsersParams,
  options?: Omit<UseQueryOptions<UsersResponse>, 'queryKey' | 'queryFn'>
) {
  return useQuery({
    queryKey: userKeys.list(params),
    queryFn: () => getUsers(params),
    ...options,
  });
}

// 단일 조회
export function useUser(
  id: string,
  options?: Omit<UseQueryOptions<User>, 'queryKey' | 'queryFn'>
) {
  return useQuery({
    queryKey: userKeys.detail(id),
    queryFn: () => getUserById(id),
    enabled: !!id,
    ...options,
  });
}

// 생성
export function useCreateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateUserDto) => createUser(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: userKeys.lists() });
      toast.success('사용자가 생성되었습니다.');
    },
    onError: (error: Error) => {
      toast.error(`생성 실패: ${error.message}`);
    },
  });
}

// 수정
export function useUpdateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateUserDto }) =>
      updateUser(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: userKeys.lists() });
      queryClient.invalidateQueries({ queryKey: userKeys.detail(id) });
      toast.success('사용자가 수정되었습니다.');
    },
    onError: (error: Error) => {
      toast.error(`수정 실패: ${error.message}`);
    },
  });
}

// 삭제
export function useDeleteUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deleteUser(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: userKeys.lists() });
      toast.success('사용자가 삭제되었습니다.');
    },
    onError: (error: Error) => {
      toast.error(`삭제 실패: ${error.message}`);
    },
  });
}

// 일괄 삭제
export function useDeleteUsers() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (ids: string[]) => deleteUsers(ids),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: userKeys.lists() });
      toast.success('선택한 사용자가 삭제되었습니다.');
    },
    onError: (error: Error) => {
      toast.error(`삭제 실패: ${error.message}`);
    },
  });
}

// 상태 변경
export function useUpdateUserStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'active' | 'inactive' }) =>
      updateUserStatus(id, status),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: userKeys.lists() });
      queryClient.invalidateQueries({ queryKey: userKeys.detail(id) });
      toast.success('상태가 변경되었습니다.');
    },
    onError: (error: Error) => {
      toast.error(`상태 변경 실패: ${error.message}`);
    },
  });
}
```

---

## 에러 처리

### 에러 타입 정의

```ts
// lib/errors.ts
export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public code?: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static fromResponse(response: {
    status: number;
    data: { message?: string; code?: string; details?: Record<string, unknown> };
  }) {
    return new ApiError(
      response.data.message || 'Unknown error',
      response.status,
      response.data.code,
      response.data.details
    );
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}
```

### 에러 핸들링 유틸리티

```ts
// lib/api-error-handler.ts
import axios, { AxiosError } from 'axios';
import { toast } from 'sonner';

interface ApiErrorResponse {
  message: string;
  code?: string;
  errors?: Record<string, string[]>;
}

export function handleApiError(error: unknown) {
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError<ApiErrorResponse>;
    const data = axiosError.response?.data;
    const status = axiosError.response?.status;

    switch (status) {
      case 400:
        if (data?.errors) {
          // 유효성 검사 에러
          const firstError = Object.values(data.errors)[0]?.[0];
          toast.error(firstError || '입력값을 확인해주세요.');
        } else {
          toast.error(data?.message || '잘못된 요청입니다.');
        }
        break;
      case 401:
        toast.error('로그인이 필요합니다.');
        // 로그인 페이지로 리다이렉트
        window.location.href = '/login';
        break;
      case 403:
        toast.error('권한이 없습니다.');
        break;
      case 404:
        toast.error('요청한 리소스를 찾을 수 없습니다.');
        break;
      case 409:
        toast.error(data?.message || '이미 존재하는 데이터입니다.');
        break;
      case 422:
        toast.error(data?.message || '처리할 수 없는 요청입니다.');
        break;
      case 429:
        toast.error('너무 많은 요청입니다. 잠시 후 다시 시도해주세요.');
        break;
      case 500:
      default:
        toast.error('서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
        break;
    }

    return {
      status,
      message: data?.message,
      code: data?.code,
      errors: data?.errors,
    };
  }

  // 네트워크 에러
  if (error instanceof Error) {
    if (error.message === 'Network Error') {
      toast.error('네트워크 연결을 확인해주세요.');
    } else {
      toast.error(error.message);
    }
  }

  return null;
}
```

---

## 파일 업로드

### 파일 업로드 API

```ts
// features/admin/api/files.ts
import { api } from '@/lib/api';

export interface UploadResponse {
  url: string;
  key: string;
  filename: string;
  size: number;
  mimeType: string;
}

export async function uploadFile(
  file: File,
  folder: string = 'uploads'
): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('folder', folder);

  const response = await api.post('/admin/files/upload', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });

  return response.data;
}

export async function uploadMultipleFiles(
  files: File[],
  folder: string = 'uploads'
): Promise<UploadResponse[]> {
  const formData = new FormData();
  files.forEach((file) => formData.append('files', file));
  formData.append('folder', folder);

  const response = await api.post('/admin/files/upload-multiple', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });

  return response.data;
}

export async function deleteFile(key: string): Promise<void> {
  await api.delete(`/admin/files/${encodeURIComponent(key)}`);
}
```

### 파일 업로드 컴포넌트

```tsx
// features/admin/components/forms/FileUpload.tsx
'use client';

import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { useMutation } from '@tanstack/react-query';
import { uploadFile } from '../api/files';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Upload, X, File } from 'lucide-react';
import { toast } from 'sonner';

interface FileUploadProps {
  onUpload: (url: string) => void;
  accept?: Record<string, string[]>;
  maxSize?: number;
}

export function FileUpload({
  onUpload,
  accept = { 'image/*': ['.png', '.jpg', '.jpeg', '.webp'] },
  maxSize = 5 * 1024 * 1024, // 5MB
}: FileUploadProps) {
  const [uploadProgress, setUploadProgress] = useState(0);

  const mutation = useMutation({
    mutationFn: uploadFile,
    onSuccess: (data) => {
      onUpload(data.url);
      toast.success('파일이 업로드되었습니다.');
      setUploadProgress(0);
    },
    onError: () => {
      toast.error('파일 업로드에 실패했습니다.');
      setUploadProgress(0);
    },
  });

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      const file = acceptedFiles[0];
      if (file) {
        mutation.mutate(file);
      }
    },
    [mutation]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept,
    maxSize,
    multiple: false,
  });

  return (
    <div
      {...getRootProps()}
      className={`
        border-2 border-dashed rounded-lg p-6 text-center cursor-pointer
        transition-colors
        ${isDragActive ? 'border-primary bg-primary/5' : 'border-muted-foreground/25'}
        ${mutation.isPending ? 'pointer-events-none opacity-50' : ''}
      `}
    >
      <input {...getInputProps()} />
      
      {mutation.isPending ? (
        <div className="space-y-2">
          <File className="h-10 w-10 mx-auto text-muted-foreground" />
          <Progress value={uploadProgress} className="w-full" />
          <p className="text-sm text-muted-foreground">업로드 중...</p>
        </div>
      ) : (
        <>
          <Upload className="h-10 w-10 mx-auto text-muted-foreground" />
          <p className="mt-2 text-sm">
            {isDragActive
              ? '파일을 놓으세요'
              : '클릭하거나 파일을 드래그하세요'}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            최대 {maxSize / 1024 / 1024}MB
          </p>
        </>
      )}
    </div>
  );
}
```

---

## Optimistic Updates

### Optimistic 삭제

```ts
// features/admin/hooks/useUsers.ts (확장)
export function useDeleteUserOptimistic() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deleteUser(id),
    
    // 낙관적 업데이트
    onMutate: async (id) => {
      // 진행 중인 쿼리 취소
      await queryClient.cancelQueries({ queryKey: userKeys.lists() });

      // 이전 데이터 스냅샷
      const previousData = queryClient.getQueryData<UsersResponse>(
        userKeys.list({})
      );

      // 낙관적으로 캐시 업데이트
      queryClient.setQueryData<UsersResponse>(userKeys.list({}), (old) => {
        if (!old) return old;
        return {
          ...old,
          users: old.users.filter((user) => user.id !== id),
          total: old.total - 1,
        };
      });

      return { previousData };
    },
    
    // 에러 시 롤백
    onError: (err, id, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(userKeys.list({}), context.previousData);
      }
      toast.error('삭제에 실패했습니다.');
    },
    
    // 성공/에러 후 항상 새로고침
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: userKeys.lists() });
    },
  });
}
```

### Optimistic 상태 변경

```ts
export function useUpdateUserStatusOptimistic() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'active' | 'inactive' }) =>
      updateUserStatus(id, status),

    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: userKeys.lists() });
      await queryClient.cancelQueries({ queryKey: userKeys.detail(id) });

      const previousList = queryClient.getQueryData<UsersResponse>(
        userKeys.list({})
      );
      const previousDetail = queryClient.getQueryData<User>(
        userKeys.detail(id)
      );

      // 목록 캐시 업데이트
      queryClient.setQueryData<UsersResponse>(userKeys.list({}), (old) => {
        if (!old) return old;
        return {
          ...old,
          users: old.users.map((user) =>
            user.id === id ? { ...user, status } : user
          ),
        };
      });

      // 상세 캐시 업데이트
      queryClient.setQueryData<User>(userKeys.detail(id), (old) => {
        if (!old) return old;
        return { ...old, status };
      });

      return { previousList, previousDetail };
    },

    onError: (err, { id }, context) => {
      if (context?.previousList) {
        queryClient.setQueryData(userKeys.list({}), context.previousList);
      }
      if (context?.previousDetail) {
        queryClient.setQueryData(userKeys.detail(id), context.previousDetail);
      }
      toast.error('상태 변경에 실패했습니다.');
    },

    onSettled: (_, __, { id }) => {
      queryClient.invalidateQueries({ queryKey: userKeys.lists() });
      queryClient.invalidateQueries({ queryKey: userKeys.detail(id) });
    },
  });
}
```

---

## 캐싱 전략

### Query Client 설정

```tsx
// app/providers.tsx
'use client';

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 1000 * 60 * 5, // 5분
            gcTime: 1000 * 60 * 30, // 30분 (이전 cacheTime)
            retry: 1,
            refetchOnWindowFocus: false,
          },
          mutations: {
            retry: 0,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {process.env.NODE_ENV === 'development' && <ReactQueryDevtools />}
    </QueryClientProvider>
  );
}
```

### 데이터 프리페칭

```tsx
// app/(admin)/users/page.tsx
import { HydrationBoundary, dehydrate } from '@tanstack/react-query';
import { getQueryClient } from '@/lib/get-query-client';
import { getUsers } from '@/features/admin/api/users';
import { userKeys } from '@/features/admin/hooks/useUsers';
import { UsersClient } from './users-client';

interface PageProps {
  searchParams: { page?: string; search?: string };
}

export default async function UsersPage({ searchParams }: PageProps) {
  const queryClient = getQueryClient();
  const params = {
    page: Number(searchParams.page) || 1,
    search: searchParams.search,
  };

  await queryClient.prefetchQuery({
    queryKey: userKeys.list(params),
    queryFn: () => getUsers(params),
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <UsersClient initialParams={params} />
    </HydrationBoundary>
  );
}
```

### 무한 스크롤

```ts
// features/admin/hooks/useInfiniteUsers.ts
import { useInfiniteQuery } from '@tanstack/react-query';
import { getUsers, type UsersParams } from '../api/users';

export function useInfiniteUsers(params?: Omit<UsersParams, 'page'>) {
  return useInfiniteQuery({
    queryKey: ['users', 'infinite', params],
    queryFn: ({ pageParam = 1 }) => getUsers({ ...params, page: pageParam }),
    getNextPageParam: (lastPage) => {
      if (lastPage.page < lastPage.totalPages) {
        return lastPage.page + 1;
      }
      return undefined;
    },
    initialPageParam: 1,
  });
}
```

---

*Admin API v1.0.0 | 2025-01-03*
