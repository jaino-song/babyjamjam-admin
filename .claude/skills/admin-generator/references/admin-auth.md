# Admin Auth

> RBAC (Role-Based Access Control) 어드민 권한 관리 가이드

---

## 📋 목차

1. [역할 정의](#역할-정의)
2. [권한 체계](#권한-체계)
3. [서버 사이드 권한 검증](#서버-사이드-권한-검증)
4. [클라이언트 권한 가드](#클라이언트-권한-가드)
5. [미들웨어 보호](#미들웨어-보호)
6. [API 권한 검증](#api-권한-검증)
7. [민감정보 보호](#민감정보-보호)

---

## 역할 정의

### 기본 역할 타입

```ts
// features/admin/types/auth.types.ts
export const ROLES = {
  ADMIN: 'ADMIN',
  MANAGER: 'MANAGER',
  VIEWER: 'VIEWER',
  USER: 'USER',
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export interface Permission {
  resource: string;
  actions: ('create' | 'read' | 'update' | 'delete')[];
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  permissions?: Permission[];
}
```

### 역할별 권한 매핑

```ts
// features/admin/config/permissions.ts
import type { Role, Permission } from '../types/auth.types';

type PermissionMatrix = Record<Role, Permission[]>;

export const PERMISSION_MATRIX: PermissionMatrix = {
  ADMIN: [
    { resource: '*', actions: ['create', 'read', 'update', 'delete'] },
  ],
  MANAGER: [
    { resource: 'users', actions: ['read', 'update'] },
    { resource: 'products', actions: ['create', 'read', 'update', 'delete'] },
    { resource: 'orders', actions: ['read', 'update'] },
    { resource: 'analytics', actions: ['read'] },
  ],
  VIEWER: [
    { resource: 'users', actions: ['read'] },
    { resource: 'products', actions: ['read'] },
    { resource: 'orders', actions: ['read'] },
    { resource: 'analytics', actions: ['read'] },
  ],
  USER: [],
};

export function hasPermission(
  role: Role,
  resource: string,
  action: 'create' | 'read' | 'update' | 'delete'
): boolean {
  const permissions = PERMISSION_MATRIX[role];
  
  return permissions.some((p) => {
    const resourceMatch = p.resource === '*' || p.resource === resource;
    const actionMatch = p.actions.includes(action);
    return resourceMatch && actionMatch;
  });
}

export function canAccessAdmin(role: Role): boolean {
  return ['ADMIN', 'MANAGER', 'VIEWER'].includes(role);
}
```

---

## 권한 체계

### 계층적 역할 구조

```
ADMIN
  ├── 모든 리소스 CRUD
  ├── 역할 관리
  ├── 시스템 설정
  └── 감사 로그 접근
  
MANAGER
  ├── 대부분 리소스 CRUD
  ├── 자신이 생성한 콘텐츠 관리
  └── 분석 데이터 열람
  
VIEWER
  ├── 읽기 전용 접근
  └── 대시보드 열람

USER (일반 사용자)
  └── 어드민 접근 불가
```

### 리소스별 권한 정의

```ts
// features/admin/config/resources.ts
export const RESOURCES = {
  USERS: {
    name: 'users',
    displayName: '사용자 관리',
    permissions: {
      list: ['ADMIN', 'MANAGER', 'VIEWER'],
      view: ['ADMIN', 'MANAGER', 'VIEWER'],
      create: ['ADMIN'],
      update: ['ADMIN', 'MANAGER'],
      delete: ['ADMIN'],
    },
  },
  PRODUCTS: {
    name: 'products',
    displayName: '상품 관리',
    permissions: {
      list: ['ADMIN', 'MANAGER', 'VIEWER'],
      view: ['ADMIN', 'MANAGER', 'VIEWER'],
      create: ['ADMIN', 'MANAGER'],
      update: ['ADMIN', 'MANAGER'],
      delete: ['ADMIN', 'MANAGER'],
    },
  },
  ORDERS: {
    name: 'orders',
    displayName: '주문 관리',
    permissions: {
      list: ['ADMIN', 'MANAGER', 'VIEWER'],
      view: ['ADMIN', 'MANAGER', 'VIEWER'],
      update: ['ADMIN', 'MANAGER'],
      refund: ['ADMIN'],
    },
  },
  SETTINGS: {
    name: 'settings',
    displayName: '시스템 설정',
    permissions: {
      view: ['ADMIN'],
      update: ['ADMIN'],
    },
  },
} as const;
```

---

## 서버 사이드 권한 검증

### 세션 기반 검증

```ts
// lib/auth.ts
import { cookies } from 'next/headers';
import { jwtVerify } from 'jose';
import type { User, Role } from '@/features/admin/types/auth.types';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET);

export async function getServerSession(): Promise<{ user: User } | null> {
  const cookieStore = cookies();
  const token = cookieStore.get('auth-token')?.value;

  if (!token) {
    return null;
  }

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return {
      user: {
        id: payload.sub as string,
        email: payload.email as string,
        name: payload.name as string,
        role: payload.role as Role,
      },
    };
  } catch {
    return null;
  }
}

export async function requireAuth() {
  const session = await getServerSession();
  
  if (!session) {
    throw new Error('Unauthorized');
  }
  
  return session;
}

export async function requireRole(allowedRoles: Role[]) {
  const session = await requireAuth();
  
  if (!allowedRoles.includes(session.user.role)) {
    throw new Error('Forbidden');
  }
  
  return session;
}
```

### 레이아웃에서 권한 검증

```tsx
// app/(admin)/layout.tsx
import { redirect } from 'next/navigation';
import { getServerSession } from '@/lib/auth';
import { canAccessAdmin } from '@/features/admin/config/permissions';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession();

  if (!session) {
    redirect('/login?callbackUrl=/admin');
  }

  if (!canAccessAdmin(session.user.role)) {
    redirect('/unauthorized');
  }

  return (
    <AdminLayoutClient user={session.user}>
      {children}
    </AdminLayoutClient>
  );
}
```

### 페이지별 권한 검증

```tsx
// app/(admin)/settings/page.tsx
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth';
import { SettingsForm } from '@/features/admin/components/settings/SettingsForm';

export default async function SettingsPage() {
  try {
    const session = await requireRole(['ADMIN']);
    
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">시스템 설정</h1>
        <SettingsForm />
      </div>
    );
  } catch {
    redirect('/admin?error=forbidden');
  }
}
```

---

## 클라이언트 권한 가드

### RoleGuard 컴포넌트

```tsx
// features/admin/components/auth/RoleGuard.tsx
'use client';

import { useAuth } from '@/features/admin/hooks/useAuth';
import type { Role } from '@/features/admin/types/auth.types';

interface RoleGuardProps {
  allowedRoles: Role[];
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export function RoleGuard({
  allowedRoles,
  children,
  fallback = null,
}: RoleGuardProps) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return null; // 또는 스켈레톤
  }

  if (!user || !allowedRoles.includes(user.role)) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}
```

### PermissionGuard 컴포넌트

```tsx
// features/admin/components/auth/PermissionGuard.tsx
'use client';

import { useAuth } from '@/features/admin/hooks/useAuth';
import { hasPermission } from '@/features/admin/config/permissions';

interface PermissionGuardProps {
  resource: string;
  action: 'create' | 'read' | 'update' | 'delete';
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export function PermissionGuard({
  resource,
  action,
  children,
  fallback = null,
}: PermissionGuardProps) {
  const { user } = useAuth();

  if (!user || !hasPermission(user.role, resource, action)) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}
```

### 사용 예시

```tsx
// features/admin/components/users/UserActions.tsx
'use client';

import { RoleGuard } from '../auth/RoleGuard';
import { PermissionGuard } from '../auth/PermissionGuard';
import { Button } from '@/components/ui/button';
import { Plus, Trash2 } from 'lucide-react';

export function UserActions() {
  return (
    <div className="flex gap-2">
      {/* 특정 역할만 보이는 버튼 */}
      <RoleGuard allowedRoles={['ADMIN']}>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          새 사용자
        </Button>
      </RoleGuard>

      {/* 권한 기반 버튼 */}
      <PermissionGuard resource="users" action="delete">
        <Button variant="destructive">
          <Trash2 className="h-4 w-4 mr-2" />
          선택 삭제
        </Button>
      </PermissionGuard>
    </div>
  );
}
```

---

## 미들웨어 보호

### Next.js 미들웨어

```ts
// middleware.ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET);

const protectedPaths = ['/admin', '/users', '/products', '/orders', '/settings'];
const adminOnlyPaths = ['/settings', '/users/roles'];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 어드민 경로가 아니면 통과
  const isProtectedPath = protectedPaths.some(
    (path) => pathname.startsWith(path) || pathname === path
  );

  if (!isProtectedPath) {
    return NextResponse.next();
  }

  // 토큰 확인
  const token = request.cookies.get('auth-token')?.value;

  if (!token) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(loginUrl);
  }

  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    const role = payload.role as string;

    // 어드민 접근 권한 확인
    if (!['ADMIN', 'MANAGER', 'VIEWER'].includes(role)) {
      return NextResponse.redirect(new URL('/unauthorized', request.url));
    }

    // 어드민 전용 경로 확인
    const isAdminOnlyPath = adminOnlyPaths.some((path) =>
      pathname.startsWith(path)
    );

    if (isAdminOnlyPath && role !== 'ADMIN') {
      return NextResponse.redirect(new URL('/admin?error=forbidden', request.url));
    }

    return NextResponse.next();
  } catch {
    // 토큰 검증 실패
    const response = NextResponse.redirect(new URL('/login', request.url));
    response.cookies.delete('auth-token');
    return response;
  }
}

export const config = {
  matcher: [
    '/admin/:path*',
    '/users/:path*',
    '/products/:path*',
    '/orders/:path*',
    '/settings/:path*',
  ],
};
```

---

## API 권한 검증

### API Route 보호

```ts
// app/api/admin/users/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(request: NextRequest) {
  try {
    const session = await requireRole(['ADMIN', 'MANAGER', 'VIEWER']);

    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        createdAt: true,
        // 민감 정보 제외
      },
    });

    return NextResponse.json({ users });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'Unauthorized') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      if (error.message === 'Forbidden') {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    // 생성은 ADMIN만 가능
    const session = await requireRole(['ADMIN']);

    const body = await request.json();
    // 유효성 검증 및 생성 로직

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    // 에러 처리
  }
}
```

### API 권한 유틸리티

```ts
// lib/api-auth.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession, requireRole } from './auth';
import type { Role } from '@/features/admin/types/auth.types';

type Handler = (
  request: NextRequest,
  context: { params: Record<string, string> }
) => Promise<NextResponse>;

export function withAuth(handler: Handler): Handler {
  return async (request, context) => {
    try {
      await getServerSession();
      return handler(request, context);
    } catch {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  };
}

export function withRoles(roles: Role[], handler: Handler): Handler {
  return async (request, context) => {
    try {
      await requireRole(roles);
      return handler(request, context);
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === 'Forbidden') {
          return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
      }
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  };
}

// 사용 예시
export const GET = withRoles(['ADMIN', 'MANAGER'], async (request) => {
  // 핸들러 로직
  return NextResponse.json({ data: [] });
});
```

---

## 민감정보 보호

### 데이터 마스킹 유틸리티

```ts
// lib/utils/masking.ts
export function maskEmail(email: string): string {
  if (!email) return '';
  
  const [local, domain] = email.split('@');
  if (!domain) return email;
  
  const visibleChars = Math.min(2, local.length);
  const maskedLocal = local.slice(0, visibleChars) + '***';
  
  return `${maskedLocal}@${domain}`;
}

export function maskPhone(phone: string): string {
  if (!phone) return '';
  
  // 숫자만 추출
  const digits = phone.replace(/\D/g, '');
  
  if (digits.length < 7) return phone;
  
  // 010-****-1234 형식
  const start = digits.slice(0, 3);
  const end = digits.slice(-4);
  
  return `${start}-****-${end}`;
}

export function maskCardNumber(cardNumber: string): string {
  if (!cardNumber) return '';
  
  const digits = cardNumber.replace(/\D/g, '');
  
  if (digits.length < 12) return '****-****-****-****';
  
  return `****-****-****-${digits.slice(-4)}`;
}

export function maskName(name: string): string {
  if (!name || name.length < 2) return name;
  
  if (name.length === 2) {
    return name[0] + '*';
  }
  
  const firstChar = name[0];
  const lastChar = name[name.length - 1];
  const middleMask = '*'.repeat(name.length - 2);
  
  return `${firstChar}${middleMask}${lastChar}`;
}
```

### 역할별 데이터 변환

```ts
// features/admin/utils/transform.ts
import type { User, Role } from '../types/auth.types';
import { maskEmail, maskPhone, maskName } from '@/lib/utils/masking';

interface TransformOptions {
  viewerRole: Role;
  includeSensitive?: boolean;
}

export function transformUserForRole(
  user: User,
  options: TransformOptions
): Partial<User> {
  const { viewerRole, includeSensitive = false } = options;

  // ADMIN은 모든 정보 조회 가능
  if (viewerRole === 'ADMIN') {
    return user;
  }

  // MANAGER는 일부 마스킹
  if (viewerRole === 'MANAGER') {
    return {
      ...user,
      email: includeSensitive ? user.email : maskEmail(user.email),
      phone: user.phone ? maskPhone(user.phone) : undefined,
    };
  }

  // VIEWER는 최소 정보만
  return {
    id: user.id,
    name: maskName(user.name),
    email: maskEmail(user.email),
    role: user.role,
    status: user.status,
  };
}
```

### 감사 로그

```ts
// lib/audit.ts
import { prisma } from './prisma';

interface AuditLogEntry {
  userId: string;
  action: string;
  resource: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

export async function createAuditLog(entry: AuditLogEntry) {
  try {
    await prisma.auditLog.create({
      data: {
        ...entry,
        timestamp: new Date(),
      },
    });
  } catch (error) {
    console.error('Failed to create audit log:', error);
    // 감사 로그 실패는 메인 작업을 중단하지 않음
  }
}

// 사용 예시
export async function deleteUser(userId: string, adminUser: User) {
  await prisma.user.delete({ where: { id: userId } });

  await createAuditLog({
    userId: adminUser.id,
    action: 'DELETE',
    resource: 'users',
    resourceId: userId,
    details: { deletedBy: adminUser.email },
  });
}
```

### 세션 관리

```ts
// features/admin/hooks/useAuth.ts
'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '../types/auth.types';

interface AuthState {
  user: User | null;
  isLoading: boolean;
  setUser: (user: User | null) => void;
  logout: () => Promise<void>;
}

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isLoading: true,
      setUser: (user) => set({ user, isLoading: false }),
      logout: async () => {
        try {
          await fetch('/api/auth/logout', { method: 'POST' });
        } finally {
          set({ user: null });
          window.location.href = '/login';
        }
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({ user: state.user }),
    }
  )
);
```

---

## 보안 체크리스트

### 필수 확인 사항

- [ ] 서버 사이드에서 모든 권한 검증
- [ ] 클라이언트 가드는 UX용, 실제 보안은 서버에서
- [ ] 민감 데이터 마스킹 적용
- [ ] 감사 로그 기록
- [ ] 세션 타임아웃 설정
- [ ] HTTPS 강제
- [ ] CSRF 토큰 적용
- [ ] Rate Limiting 적용

### 금지 사항

- ❌ 클라이언트에서만 권한 검증
- ❌ 민감 정보 평문 노출
- ❌ 권한 없는 API 엔드포인트
- ❌ 감사 로그 없이 중요 작업 수행

---

*Admin Auth v1.0.0 | 2025-01-03*
