# Frontend Architecture Improvement Plan

> Created: 2026-01-04
> Status: Planning
> Priority: High

---

## Executive Summary

프론트엔드 아키텍처 분석 결과를 바탕으로 4단계 개선 계획을 수립합니다.
현재 구조는 기능적으로는 동작하지만, **Frontend Generator 표준 구조**와 비교하여
확장성과 유지보수성 측면에서 개선이 필요합니다.

| Phase | 이름 | 예상 작업량 | 우선순위 |
|-------|------|------------|----------|
| 1 | 디렉토리 구조 재구성 (Foundation) | 높음 | 🔴 Critical |
| 2 | Feature Module 마이그레이션 | 높음 | 🔴 Critical |
| 3 | Shared Components 시스템 구축 | 중간 | 🟡 High |
| 4 | 코드 품질 및 테스트 강화 | 낮음 | 🟢 Medium |

---

## Current vs Expected Structure

### 현재 구조 문제점

```
frontend/
├── app/                          # ❌ Routes + Components + Hooks + Lib 혼재
│   ├── (components)/             # ❌ Components가 app 내부에 위치
│   │   ├── clients/
│   │   ├── dashboard/
│   │   ├── messages/
│   │   └── ...
│   ├── hooks/                    # ❌ Flat 구조, Feature별 분리 안됨
│   ├── lib/                      # ❌ App 내부에 유틸리티
│   ├── store/                    # ❌ 단일 파일, Feature별 분리 안됨
│   ├── api/                      # ✅ API Routes (유지)
│   └── {routes}/page.tsx         # ✅ Routes (유지)
```

### 목표 구조 (Feature-Sliced Design)

```
frontend/
├── src/
│   ├── app/                      # Routes ONLY
│   │   ├── (auth)/               # 인증 필요 없는 페이지
│   │   │   ├── login/page.tsx
│   │   │   └── layout.tsx
│   │   ├── (main)/               # 인증 필요 페이지
│   │   │   ├── dashboard/page.tsx
│   │   │   ├── clients/page.tsx
│   │   │   ├── employees/page.tsx
│   │   │   ├── messages/
│   │   │   │   ├── greeting/page.tsx
│   │   │   │   └── ...
│   │   │   ├── settings/page.tsx
│   │   │   └── layout.tsx
│   │   ├── api/                  # API Routes (유지)
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── features/                 # Feature Modules
│   │   ├── auth/
│   │   │   ├── api/
│   │   │   ├── components/
│   │   │   ├── hooks/
│   │   │   ├── stores/
│   │   │   └── types/
│   │   ├── clients/
│   │   ├── employees/
│   │   ├── messages/
│   │   ├── dashboard/
│   │   └── settings/
│   ├── shared/                   # Shared Components & Utilities
│   │   ├── components/
│   │   │   ├── ui/               # MUI Wrapper Components
│   │   │   ├── common/           # Reusable Components
│   │   │   └── layouts/          # Layout Components
│   │   ├── hooks/                # Shared Hooks
│   │   └── utils/                # Utility Functions
│   └── core/                     # Core Infrastructure
│       ├── api/
│       │   └── client.ts         # Axios Instance
│       ├── providers/
│       │   ├── QueryProvider.tsx
│       │   ├── ThemeProvider.tsx
│       │   └── UserProvider.tsx
│       └── config/
│           └── constants.ts
├── public/
├── tests/
└── next.config.ts
```

---

## Phase 1: 디렉토리 구조 재구성 (Foundation)

### 목표
- `src/` 디렉토리 도입으로 소스 코드 분리
- Next.js App Router `app/` 디렉토리를 Routes 전용으로 정리
- 기본 디렉토리 구조 생성

### 1.1 src 디렉토리 생성 및 기본 구조 설정

**작업 순서**:

#### Step 1.1.1: 디렉토리 생성

```bash
# 기본 구조 생성
mkdir -p frontend/src/{app,features,shared,core}
mkdir -p frontend/src/shared/{components,hooks,utils}
mkdir -p frontend/src/shared/components/{ui,common,layouts}
mkdir -p frontend/src/core/{api,providers,config}
```

#### Step 1.1.2: tsconfig.json 경로 별칭 업데이트

**파일**: `frontend/tsconfig.json`

**현재 상태**:
```json
{
  "compilerOptions": {
    "paths": {
      "@/*": ["./app/*"]
    }
  }
}
```

**목표 상태**:
```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"],
      "@/app/*": ["./src/app/*"],
      "@/features/*": ["./src/features/*"],
      "@/shared/*": ["./src/shared/*"],
      "@/core/*": ["./src/core/*"]
    }
  }
}
```

#### Step 1.1.3: next.config 업데이트 (필요시)

**파일**: `frontend/next.config.ts`

```typescript
/** @type {import('next').NextConfig} */
const nextConfig = {
  // src 디렉토리 사용 시 자동 감지됨
  // 추가 설정 필요 없음
};

export default nextConfig;
```

### 1.2 Core 인프라 이동

#### Step 1.2.1: API Client 이동

**현재**: `app/lib/axios/client.ts`
**목표**: `src/core/api/client.ts`

```typescript
// src/core/api/client.ts
import axios from 'axios';

export const apiClient = axios.create({
  baseURL: '/api',
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

// 401 인터셉터
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      // Token refresh or redirect to login
      window.location.href = '/login';
    }
    return Promise.reject(error);
  },
);

export { apiClient as api };
```

#### Step 1.2.2: Providers 이동

**현재 위치**:
- `app/query-provider.tsx`
- `app/(components)/mui-theme-provider.tsx`
- `app/(components)/providers/UserProvider.tsx`
- `app/(components)/LocaleProvider.tsx`
- `app/(components)/EmotionRegistry.tsx`

**목표 위치**: `src/core/providers/`

```
src/core/providers/
├── QueryProvider.tsx
├── ThemeProvider.tsx
├── UserProvider.tsx
├── LocaleProvider.tsx
├── EmotionRegistry.tsx
└── index.ts
```

**새 파일**: `src/core/providers/index.ts`
```typescript
export { QueryProvider } from './QueryProvider';
export { MuiThemeProvider as ThemeProvider } from './ThemeProvider';
export { UserProvider } from './UserProvider';
export { LocaleProvider } from './LocaleProvider';
export { default as EmotionRegistry } from './EmotionRegistry';
```

### 1.3 App 디렉토리 이동 및 정리

#### Step 1.3.1: Route 파일만 이동

**이동 대상** (app/ → src/app/):
- `layout.tsx`
- `page.tsx`
- `globals.css`
- `middleware.ts`
- `api/**/*` (전체 API Routes)
- `auth/**/*`
- `clients/**/*` (page.tsx, layout.tsx만)
- `dashboard/**/*`
- `employees/**/*`
- `messages/**/*`
- `settings/**/*`
- `contracts/**/*`
- `login/**/*`
- `fonts/`
- `actions/`

**제외 대상** (features/로 이동 예정):
- `(components)/**/*`
- `hooks/**/*`
- `lib/**/*`
- `store/**/*`

### 1.4 검증 체크리스트

- [ ] `pnpm build` 성공
- [ ] `pnpm dev` 정상 동작
- [ ] 모든 페이지 접근 가능
- [ ] API Routes 동작 확인
- [ ] Import 경로 오류 없음

---

## Phase 2: Feature Module 마이그레이션

### 목표
- 기능별로 관련 코드 그룹화
- API, Hooks, Components, Types를 Feature 단위로 co-location
- 재사용성과 유지보수성 향상

### 2.1 Feature Module 구조 정의

각 Feature는 다음 구조를 따름:

```
src/features/{feature}/
├── api/
│   └── {feature}.api.ts          # API 함수 정의
├── components/
│   ├── {FeatureComponent}.tsx
│   └── ...
├── hooks/
│   ├── use-{feature}.ts          # Query/Mutation Hooks
│   └── keys.ts                   # Query Key Factory
├── stores/
│   └── {feature}.store.ts        # Zustand Store (필요시)
├── types/
│   └── index.ts                  # Type 정의
└── index.ts                      # Public Exports
```

### 2.2 Clients Feature 마이그레이션 (예시)

#### Step 2.2.1: 디렉토리 생성

```bash
mkdir -p frontend/src/features/clients/{api,components,hooks,types}
```

#### Step 2.2.2: Types 정의

**새 파일**: `src/features/clients/types/index.ts`

```typescript
// 기존 app/lib/client/types.ts에서 이동
export interface Client {
  id: number;
  name: string;
  address?: string | null;
  phone?: string | null;
  careCenter: boolean;
  voucherClient: boolean;
  type?: string | null;
  duration?: number | null;
  fullPrice?: string | null;
  grant?: string | null;
  actualPrice?: string | null;
  paymentDate?: string | null;
  contractStartDate?: string | null;
  contractEndDate?: string | null;
  area?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateClientDto {
  name: string;
  address?: string;
  phone?: string;
  careCenter: boolean;
  voucherClient: boolean;
  type?: string;
  duration?: number;
  primaryEmployeeId?: number;
  secondaryEmployeeId?: number;
}

export interface UpdateClientDto extends Partial<CreateClientDto> {}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
```

#### Step 2.2.3: API 함수 분리

**새 파일**: `src/features/clients/api/clients.api.ts`

```typescript
import { api } from '@/core/api/client';
import type {
  Client,
  CreateClientDto,
  UpdateClientDto,
  PaginatedResponse
} from '../types';

export const clientsApi = {
  // 목록 조회 (페이지네이션)
  list: (params?: { page?: number; limit?: number; search?: string }) =>
    api.get<PaginatedResponse<Client>>('/clients', { params }),

  // 전체 목록 (드롭다운용)
  listAll: () =>
    api.get<Client[]>('/clients'),

  // 단건 조회
  getById: (id: number) =>
    api.get<Client>(`/clients/${id}`),

  // 생성
  create: (data: CreateClientDto) =>
    api.post<Client>('/clients', data),

  // 수정
  update: (id: number, data: UpdateClientDto) =>
    api.patch<Client>(`/clients/${id}`, data),

  // 삭제
  delete: (id: number) =>
    api.delete(`/clients/${id}`),
};
```

#### Step 2.2.4: Query Keys Factory

**새 파일**: `src/features/clients/hooks/keys.ts`

```typescript
export const clientKeys = {
  all: ['clients'] as const,
  lists: () => [...clientKeys.all, 'list'] as const,
  list: (filters: { page?: number; limit?: number; search?: string }) =>
    [...clientKeys.lists(), filters] as const,
  details: () => [...clientKeys.all, 'detail'] as const,
  detail: (id: number) => [...clientKeys.details(), id] as const,
};
```

#### Step 2.2.5: Query/Mutation Hooks

**새 파일**: `src/features/clients/hooks/use-clients.ts`

```typescript
'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { clientsApi } from '../api/clients.api';
import { clientKeys } from './keys';
import type { CreateClientDto, UpdateClientDto } from '../types';

// 목록 조회 (페이지네이션)
export function useClients(
  page: number = 1,
  limit: number = 10,
  search?: string
) {
  return useQuery({
    queryKey: clientKeys.list({ page, limit, search }),
    queryFn: () => clientsApi.list({ page, limit, search }).then(r => r.data),
    staleTime: 1000 * 60 * 5, // 5분
  });
}

// 전체 목록 (드롭다운용)
export function useAllClients() {
  return useQuery({
    queryKey: clientKeys.all,
    queryFn: () => clientsApi.listAll().then(r => r.data),
    staleTime: 1000 * 60 * 5,
  });
}

// 단건 조회
export function useClient(id: number) {
  return useQuery({
    queryKey: clientKeys.detail(id),
    queryFn: () => clientsApi.getById(id).then(r => r.data),
    enabled: !!id,
  });
}

// 생성
export function useCreateClient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (dto: CreateClientDto) =>
      clientsApi.create(dto).then(r => r.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: clientKeys.all });
    },
  });
}

// 수정
export function useUpdateClient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, dto }: { id: number; dto: UpdateClientDto }) =>
      clientsApi.update(id, dto).then(r => r.data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: clientKeys.all });
      queryClient.invalidateQueries({ queryKey: clientKeys.detail(id) });
    },
  });
}

// 삭제
export function useDeleteClient() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => clientsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: clientKeys.all });
    },
  });
}
```

#### Step 2.2.6: Components 이동

**이동 대상**:
- `app/(components)/clients/ClientsTable.tsx` → `src/features/clients/components/ClientsTable.tsx`
- `app/(components)/clients/ClientFormDialog.tsx` → `src/features/clients/components/ClientFormDialog.tsx`
- `app/(components)/clients/ClientDetailModal.tsx` → `src/features/clients/components/ClientDetailModal.tsx`
- `app/(components)/clients/EmployeeAutocomplete.tsx` → `src/features/clients/components/EmployeeAutocomplete.tsx`

#### Step 2.2.7: Public Exports

**새 파일**: `src/features/clients/index.ts`

```typescript
// Components
export { ClientsTable } from './components/ClientsTable';
export { ClientFormDialog } from './components/ClientFormDialog';
export { ClientDetailModal } from './components/ClientDetailModal';
export { EmployeeAutocomplete } from './components/EmployeeAutocomplete';

// Hooks
export {
  useClients,
  useAllClients,
  useClient,
  useCreateClient,
  useUpdateClient,
  useDeleteClient
} from './hooks/use-clients';
export { clientKeys } from './hooks/keys';

// Types
export type {
  Client,
  CreateClientDto,
  UpdateClientDto,
  PaginatedResponse
} from './types';

// API (internal use only, but exported for testing)
export { clientsApi } from './api/clients.api';
```

### 2.3 전체 Feature 마이그레이션 목록

| Feature | Components | Hooks | Store | Priority |
|---------|------------|-------|-------|----------|
| **clients** | 4 | 6 | - | P0 |
| **employees** | 3 | 4 | - | P0 |
| **messages** | 12 (forms + templates) | 2 | 1 (formStore) | P0 |
| **dashboard** | 5 | 2 | - | P1 |
| **settings** | 4 | 2 | - | P1 |
| **auth** | 1 | 1 | - | P1 |
| **contracts** | 1 | 1 | - | P2 |

### 2.4 Messages Feature (특별 케이스)

Messages는 하위 구조가 복잡하므로 추가 정리 필요:

```
src/features/messages/
├── api/
│   └── messages.api.ts
├── components/
│   ├── forms/
│   │   ├── GreetingMessageForm.tsx
│   │   ├── ThanksMessageForm.tsx
│   │   ├── InfoMessageForm.tsx
│   │   ├── ReminderMessageForm.tsx
│   │   ├── PriceInfoMessageForm.tsx
│   │   ├── ServiceInfoMessageForm.tsx
│   │   ├── SurveyMessageForm.tsx
│   │   ├── ContractCreationForm.tsx
│   │   └── form-components/
│   │       ├── ContactInput.tsx
│   │       └── NameInput.tsx
│   ├── templates/
│   │   ├── GeneratedMsg.tsx
│   │   ├── MsgField.tsx
│   │   └── message-templates/
│   │       ├── greetingMsg.ts
│   │       ├── thanksMsg.ts
│   │       └── ...
│   └── MsgNav.tsx
├── hooks/
│   └── use-messages.ts
├── stores/
│   └── form.store.ts
├── types/
│   └── index.ts
└── index.ts
```

### 2.5 검증 체크리스트

각 Feature 마이그레이션 후:

- [ ] Import 경로 업데이트 완료
- [ ] 해당 Feature 페이지 정상 동작
- [ ] CRUD 기능 테스트
- [ ] TypeScript 오류 없음
- [ ] `pnpm build` 성공

---

## Phase 3: Shared Components 시스템 구축

### 목표
- 재사용 가능한 공통 컴포넌트 분리
- MUI 컴포넌트 래퍼 생성
- 일관된 UI 패턴 확립

### 3.1 Shared Components 구조

```
src/shared/
├── components/
│   ├── ui/                       # MUI Wrappers (필요시)
│   │   ├── Button.tsx
│   │   └── Input.tsx
│   ├── common/                   # Reusable Components
│   │   ├── DataTable.tsx         # 범용 테이블
│   │   ├── FormDialog.tsx        # 범용 폼 다이얼로그
│   │   ├── DetailModal.tsx       # 범용 상세 모달
│   │   ├── ConfirmDialog.tsx     # 확인 다이얼로그
│   │   ├── Spinner.tsx           # 로딩 스피너
│   │   └── EmptyState.tsx        # 빈 상태 컴포넌트
│   └── layouts/                  # Layout Components
│       ├── Header.tsx
│       ├── NavBar.tsx
│       ├── NavButton.tsx
│       ├── AnimatedContainer.tsx
│       └── MainLayout.tsx
├── hooks/
│   ├── useDebounce.ts
│   ├── useLocalStorage.ts
│   └── useMediaQuery.ts
└── utils/
    ├── cn.ts                     # className 유틸리티
    ├── formatters.ts             # 날짜, 숫자 포맷터
    └── validators.ts             # 공통 유효성 검사
```

### 3.2 Layout Components 이동

**현재**: `app/(components)/root/`, `app/(components)/nav-bar/`
**목표**: `src/shared/components/layouts/`

**이동 대상**:
- `Header.tsx`
- `NavBar.tsx`
- `NavButton.tsx`
- `LanguageSwitcher.tsx`
- `AnimatedContainer.tsx`
- `ComponentContainer.tsx`
- `ConditionalHeader.tsx`

### 3.3 공통 유틸리티 분리

**새 파일**: `src/shared/utils/cn.ts`

```typescript
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

**새 파일**: `src/shared/utils/formatters.ts`

```typescript
import { format, parseISO } from 'date-fns';
import { ko } from 'date-fns/locale';

export function formatDate(date: string | Date, pattern = 'yyyy-MM-dd'): string {
  const d = typeof date === 'string' ? parseISO(date) : date;
  return format(d, pattern, { locale: ko });
}

export function formatDateTime(date: string | Date): string {
  return formatDate(date, 'yyyy-MM-dd HH:mm');
}

export function formatCurrency(amount: number | string): string {
  const num = typeof amount === 'string' ? parseInt(amount, 10) : amount;
  return new Intl.NumberFormat('ko-KR', {
    style: 'currency',
    currency: 'KRW',
  }).format(num);
}

export function formatPhone(phone: string): string {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 11) {
    return cleaned.replace(/(\d{3})(\d{4})(\d{4})/, '$1-$2-$3');
  }
  if (cleaned.length === 10) {
    return cleaned.replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3');
  }
  return phone;
}
```

### 3.4 Shared Hooks 분리

**새 파일**: `src/shared/hooks/useDebounce.ts`

```typescript
import { useState, useEffect } from 'react';

export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}
```

### 3.5 검증 체크리스트

- [ ] Layout components 정상 동작
- [ ] 유틸리티 함수 테스트
- [ ] Import 경로 정리
- [ ] TypeScript 오류 없음

---

## Phase 4: 코드 품질 및 테스트 강화

### 목표
- ESLint 규칙 강화
- Playwright E2E 테스트 확장
- 코드 품질 메트릭 개선

### 4.1 ESLint 규칙 업데이트

**파일**: `frontend/eslint.config.mjs`

추가 권장 규칙:
```javascript
{
  rules: {
    // Import 순서 강제
    'import/order': ['error', {
      groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
      pathGroups: [
        { pattern: '@/core/**', group: 'internal', position: 'before' },
        { pattern: '@/features/**', group: 'internal' },
        { pattern: '@/shared/**', group: 'internal', position: 'after' },
      ],
      'newlines-between': 'always',
    }],

    // 미사용 import 금지
    'no-unused-vars': 'off',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],

    // 'use client' 필요 시 경고
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',
  }
}
```

### 4.2 테스트 구조 설계

```
frontend/tests/
├── e2e/
│   ├── auth.spec.ts              # 로그인/로그아웃 테스트
│   ├── clients.spec.ts           # 고객 CRUD 테스트
│   ├── employees.spec.ts         # 직원 CRUD 테스트
│   └── messages.spec.ts          # 메시지 생성 테스트
├── integration/
│   └── api/                      # API Route 테스트
└── unit/
    ├── hooks/                    # Custom Hooks 테스트
    └── utils/                    # Utility 함수 테스트
```

### 4.3 E2E 테스트 예시

**파일**: `frontend/tests/e2e/clients.spec.ts`

```typescript
import { test, expect } from '@playwright/test';

test.describe('Clients Page', () => {
  test.beforeEach(async ({ page }) => {
    // 로그인 처리
    await page.goto('/login');
    // ... login flow
    await page.goto('/clients');
  });

  test('should display clients list', async ({ page }) => {
    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.getByText('고객 목록')).toBeVisible();
  });

  test('should create new client', async ({ page }) => {
    await page.getByRole('button', { name: /추가/ }).click();
    await page.getByLabel('이름').fill('테스트 고객');
    await page.getByRole('button', { name: /저장/ }).click();

    await expect(page.getByText('테스트 고객')).toBeVisible();
  });

  test('should search clients', async ({ page }) => {
    await page.getByPlaceholder('검색').fill('홍길동');
    await page.waitForResponse(resp => resp.url().includes('/clients'));

    // Verify search results
    const rows = page.getByRole('row');
    await expect(rows).toHaveCount.greaterThan(0);
  });
});
```

### 4.4 검증 체크리스트

- [ ] ESLint 규칙 통과
- [ ] E2E 테스트 작성 (주요 플로우)
- [ ] 빌드 성공
- [ ] CI/CD 파이프라인 통과

---

## Implementation Checklist

### Phase 1: 디렉토리 구조 재구성
- [ ] src/ 디렉토리 생성
- [ ] tsconfig.json 경로 별칭 업데이트
- [ ] Core 인프라 이동 (api/client, providers)
- [ ] app/ 디렉토리 src/app/으로 이동 (routes만)
- [ ] 빌드 성공 확인
- [ ] 개발 서버 동작 확인

### Phase 2: Feature Module 마이그레이션
- [ ] clients feature 마이그레이션
- [ ] employees feature 마이그레이션
- [ ] messages feature 마이그레이션
- [ ] dashboard feature 마이그레이션
- [ ] settings feature 마이그레이션
- [ ] auth feature 마이그레이션
- [ ] contracts feature 마이그레이션
- [ ] 기존 hooks/lib/store 디렉토리 정리

### Phase 3: Shared Components 시스템
- [ ] Layout components 이동
- [ ] 공통 유틸리티 분리
- [ ] 공통 hooks 분리
- [ ] 컴포넌트 문서화

### Phase 4: 코드 품질 강화
- [ ] ESLint 규칙 업데이트
- [ ] E2E 테스트 작성
- [ ] 빌드/린트 CI 통합

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Import 경로 오류로 빌드 실패 | High | 단계별 마이그레이션, 각 단계 후 빌드 확인 |
| Feature 분리 시 순환 참조 | Medium | 의존성 방향 명확화, index.ts로 Public API 제한 |
| 기존 기능 regression | High | E2E 테스트 먼저 작성 후 마이그레이션 |

---

## Notes

- Phase 1은 모든 후속 Phase의 선행 조건
- Phase 2는 Feature 단위로 순차 진행 (가장 간단한 것부터)
- Phase 3, 4는 병렬 진행 가능
- 각 단계 완료 후 반드시 빌드 및 동작 테스트 필수

---

*Last Updated: 2026-01-04*
