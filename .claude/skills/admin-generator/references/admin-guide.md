# Admin Guide

> Next.js + shadcn/ui 어드민 대시보드 구현 가이드

---

## 📋 목차

1. [프로젝트 구조](#프로젝트-구조)
2. [라우팅 설정](#라우팅-설정)
3. [레이아웃 구성](#레이아웃-구성)
4. [네비게이션](#네비게이션)
5. [페이지 패턴](#페이지-패턴)
6. [상태 관리](#상태-관리)
7. [에러 처리](#에러-처리)

---

## 프로젝트 구조

### 권장 디렉토리 구조

```
apps/web/src/
├── app/
│   ├── (public)/                 # 공개 페이지
│   │   ├── page.tsx              # 랜딩
│   │   └── login/page.tsx        # 로그인
│   └── (admin)/                  # 어드민 route group
│       ├── layout.tsx            # 어드민 레이아웃
│       ├── loading.tsx           # 로딩 UI
│       ├── error.tsx             # 에러 UI
│       ├── admin/
│       │   └── page.tsx          # 대시보드
│       ├── users/
│       │   ├── page.tsx          # 목록
│       │   ├── new/page.tsx      # 생성
│       │   └── [id]/
│       │       ├── page.tsx      # 상세
│       │       └── edit/page.tsx # 수정
│       ├── products/
│       ├── orders/
│       └── settings/
│           ├── page.tsx          # 일반 설정
│           └── profile/page.tsx  # 프로필 설정
├── features/
│   └── admin/
│       ├── components/           # 어드민 전용 컴포넌트
│       │   ├── layout/
│       │   │   ├── AdminHeader.tsx
│       │   │   ├── AdminSidebar.tsx
│       │   │   └── AdminBreadcrumb.tsx
│       │   ├── data-display/
│       │   │   ├── DataTable.tsx
│       │   │   ├── StatCard.tsx
│       │   │   └── Chart.tsx
│       │   └── forms/
│       │       ├── UserForm.tsx
│       │       └── ProductForm.tsx
│       ├── hooks/
│       │   ├── useAdminAuth.ts
│       │   ├── useDataTable.ts
│       │   └── useBreadcrumb.ts
│       ├── api/
│       │   ├── users.ts
│       │   ├── products.ts
│       │   └── analytics.ts
│       └── types/
│           └── admin.types.ts
├── components/
│   └── ui/                       # shadcn/ui 컴포넌트
└── lib/
    ├── utils.ts
    └── validations/
        └── admin.schema.ts
```

---

## 라우팅 설정

### Route Groups 사용

```tsx
// app/(admin)/layout.tsx
import { redirect } from 'next/navigation';
import { getServerSession } from '@/lib/auth';
import { AdminSidebar } from '@/features/admin/components/layout/AdminSidebar';
import { AdminHeader } from '@/features/admin/components/layout/AdminHeader';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getServerSession();
  
  if (!session) {
    redirect('/login');
  }
  
  if (!['ADMIN', 'MANAGER'].includes(session.user.role)) {
    redirect('/unauthorized');
  }
  
  return (
    <div className="flex min-h-screen">
      <AdminSidebar user={session.user} />
      <div className="flex-1 flex flex-col">
        <AdminHeader user={session.user} />
        <main className="flex-1 p-6 bg-muted/40">
          {children}
        </main>
      </div>
    </div>
  );
}
```

### 동적 라우트

```tsx
// app/(admin)/users/[id]/page.tsx
import { notFound } from 'next/navigation';
import { getUserById } from '@/features/admin/api/users';
import { UserDetail } from '@/features/admin/components/UserDetail';

interface PageProps {
  params: { id: string };
}

export default async function UserDetailPage({ params }: PageProps) {
  const user = await getUserById(params.id);
  
  if (!user) {
    notFound();
  }
  
  return <UserDetail user={user} />;
}

export async function generateMetadata({ params }: PageProps) {
  const user = await getUserById(params.id);
  return {
    title: user ? `${user.name} - 사용자 관리` : '사용자 관리',
  };
}
```

---

## 레이아웃 구성

### 반응형 레이아웃

```tsx
// features/admin/components/layout/AdminSidebar.tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import {
  LayoutDashboard,
  Users,
  Package,
  ShoppingCart,
  Settings,
  Menu,
  ChevronLeft,
} from 'lucide-react';

const navItems = [
  { href: '/admin', label: '대시보드', icon: LayoutDashboard },
  { href: '/users', label: '사용자 관리', icon: Users },
  { href: '/products', label: '상품 관리', icon: Package },
  { href: '/orders', label: '주문 관리', icon: ShoppingCart },
  { href: '/settings', label: '설정', icon: Settings },
];

interface AdminSidebarProps {
  user: { name: string; role: string };
}

export function AdminSidebar({ user }: AdminSidebarProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  const NavContent = () => (
    <nav className="space-y-1 p-4">
      {navItems.map((item) => {
        const isActive = pathname === item.href || 
          (item.href !== '/admin' && pathname.startsWith(item.href));
        
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
              isActive
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            <item.icon className="h-5 w-5" />
            {!collapsed && <span>{item.label}</span>}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <aside
        className={cn(
          'hidden md:flex flex-col border-r bg-card transition-all duration-300',
          collapsed ? 'w-16' : 'w-64'
        )}
      >
        <div className="flex items-center justify-between h-16 px-4 border-b">
          {!collapsed && (
            <span className="font-semibold text-lg">Admin</span>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setCollapsed(!collapsed)}
          >
            <ChevronLeft className={cn(
              'h-4 w-4 transition-transform',
              collapsed && 'rotate-180'
            )} />
          </Button>
        </div>
        <NavContent />
        {!collapsed && (
          <div className="mt-auto p-4 border-t">
            <div className="text-sm">
              <p className="font-medium">{user.name}</p>
              <p className="text-muted-foreground text-xs">{user.role}</p>
            </div>
          </div>
        )}
      </aside>

      {/* Mobile Sidebar */}
      <Sheet>
        <SheetTrigger asChild className="md:hidden">
          <Button variant="ghost" size="icon" className="fixed top-4 left-4 z-40">
            <Menu className="h-5 w-5" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-64 p-0">
          <div className="flex items-center h-16 px-4 border-b">
            <span className="font-semibold text-lg">Admin</span>
          </div>
          <NavContent />
        </SheetContent>
      </Sheet>
    </>
  );
}
```

### 헤더 컴포넌트

```tsx
// features/admin/components/layout/AdminHeader.tsx
'use client';

import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Moon, Sun, Bell, LogOut, User } from 'lucide-react';
import { AdminBreadcrumb } from './AdminBreadcrumb';

interface AdminHeaderProps {
  user: { name: string; email: string; image?: string };
}

export function AdminHeader({ user }: AdminHeaderProps) {
  const { setTheme, theme } = useTheme();

  return (
    <header className="h-16 border-b bg-card px-6 flex items-center justify-between">
      <AdminBreadcrumb />
      
      <div className="flex items-center gap-2">
        {/* 알림 */}
        <Button variant="ghost" size="icon">
          <Bell className="h-5 w-5" />
        </Button>
        
        {/* 테마 토글 */}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        >
          <Sun className="h-5 w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-5 w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
        </Button>
        
        {/* 사용자 메뉴 */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="relative h-8 w-8 rounded-full">
              <Avatar className="h-8 w-8">
                <AvatarImage src={user.image} alt={user.name} />
                <AvatarFallback>{user.name.slice(0, 2)}</AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-56" align="end">
            <div className="flex items-center justify-start gap-2 p-2">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium">{user.name}</p>
                <p className="text-xs text-muted-foreground">{user.email}</p>
              </div>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem>
              <User className="mr-2 h-4 w-4" />
              프로필 설정
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive">
              <LogOut className="mr-2 h-4 w-4" />
              로그아웃
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
```

### 브레드크럼

```tsx
// features/admin/components/layout/AdminBreadcrumb.tsx
'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { ChevronRight, Home } from 'lucide-react';

const pathNameMap: Record<string, string> = {
  admin: '대시보드',
  users: '사용자 관리',
  products: '상품 관리',
  orders: '주문 관리',
  settings: '설정',
  new: '새로 만들기',
  edit: '수정',
};

export function AdminBreadcrumb() {
  const pathname = usePathname();
  const segments = pathname.split('/').filter(Boolean);

  return (
    <nav className="flex items-center space-x-1 text-sm text-muted-foreground">
      <Link
        href="/admin"
        className="flex items-center hover:text-foreground transition-colors"
      >
        <Home className="h-4 w-4" />
      </Link>
      
      {segments.map((segment, index) => {
        const href = '/' + segments.slice(0, index + 1).join('/');
        const isLast = index === segments.length - 1;
        const label = pathNameMap[segment] || segment;

        return (
          <div key={segment} className="flex items-center">
            <ChevronRight className="h-4 w-4 mx-1" />
            {isLast ? (
              <span className="font-medium text-foreground">{label}</span>
            ) : (
              <Link
                href={href}
                className="hover:text-foreground transition-colors"
              >
                {label}
              </Link>
            )}
          </div>
        );
      })}
    </nav>
  );
}
```

---

## 네비게이션

### 권한 기반 네비게이션

```tsx
// features/admin/config/navigation.ts
import { LucideIcon, LayoutDashboard, Users, Package, ShoppingCart, Settings, BarChart3 } from 'lucide-react';

export type Role = 'ADMIN' | 'MANAGER' | 'VIEWER';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  roles: Role[];
  children?: Omit<NavItem, 'children'>[];
}

export const navigationConfig: NavItem[] = [
  {
    href: '/admin',
    label: '대시보드',
    icon: LayoutDashboard,
    roles: ['ADMIN', 'MANAGER', 'VIEWER'],
  },
  {
    href: '/users',
    label: '사용자 관리',
    icon: Users,
    roles: ['ADMIN', 'MANAGER'],
    children: [
      { href: '/users', label: '사용자 목록', icon: Users, roles: ['ADMIN', 'MANAGER'] },
      { href: '/users/roles', label: '역할 관리', icon: Users, roles: ['ADMIN'] },
    ],
  },
  {
    href: '/products',
    label: '상품 관리',
    icon: Package,
    roles: ['ADMIN', 'MANAGER'],
  },
  {
    href: '/orders',
    label: '주문 관리',
    icon: ShoppingCart,
    roles: ['ADMIN', 'MANAGER', 'VIEWER'],
  },
  {
    href: '/analytics',
    label: '분석',
    icon: BarChart3,
    roles: ['ADMIN'],
  },
  {
    href: '/settings',
    label: '설정',
    icon: Settings,
    roles: ['ADMIN'],
  },
];

export function getNavigationForRole(role: Role): NavItem[] {
  return navigationConfig
    .filter((item) => item.roles.includes(role))
    .map((item) => ({
      ...item,
      children: item.children?.filter((child) => child.roles.includes(role)),
    }));
}
```

---

## 페이지 패턴

### 목록 페이지

```tsx
// app/(admin)/users/page.tsx
import { Suspense } from 'react';
import { getUsers } from '@/features/admin/api/users';
import { UsersTable } from '@/features/admin/components/users/UsersTable';
import { UsersTableSkeleton } from '@/features/admin/components/users/UsersTableSkeleton';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import Link from 'next/link';

interface PageProps {
  searchParams: {
    page?: string;
    search?: string;
    role?: string;
  };
}

export default async function UsersPage({ searchParams }: PageProps) {
  const page = Number(searchParams.page) || 1;
  const { users, total, totalPages } = await getUsers({
    page,
    search: searchParams.search,
    role: searchParams.role,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">사용자 관리</h1>
          <p className="text-muted-foreground">
            총 {total}명의 사용자
          </p>
        </div>
        <Button asChild>
          <Link href="/users/new">
            <Plus className="h-4 w-4 mr-2" />
            새 사용자
          </Link>
        </Button>
      </div>

      <Suspense fallback={<UsersTableSkeleton />}>
        <UsersTable
          users={users}
          currentPage={page}
          totalPages={totalPages}
        />
      </Suspense>
    </div>
  );
}
```

### 생성/수정 페이지

```tsx
// app/(admin)/users/new/page.tsx
import { UserForm } from '@/features/admin/components/users/UserForm';

export default function NewUserPage() {
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">새 사용자 생성</h1>
        <p className="text-muted-foreground">
          새로운 사용자 계정을 생성합니다.
        </p>
      </div>

      <UserForm mode="create" />
    </div>
  );
}
```

---

## 상태 관리

### Zustand Store

```ts
// features/admin/stores/adminStore.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AdminState {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  
  // 필터 상태
  filters: Record<string, unknown>;
  setFilter: (key: string, value: unknown) => void;
  clearFilters: () => void;
}

export const useAdminStore = create<AdminState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      toggleSidebar: () =>
        set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      
      filters: {},
      setFilter: (key, value) =>
        set((state) => ({
          filters: { ...state.filters, [key]: value },
        })),
      clearFilters: () => set({ filters: {} }),
    }),
    {
      name: 'admin-storage',
      partialize: (state) => ({ sidebarCollapsed: state.sidebarCollapsed }),
    }
  )
);
```

### React Query 사용

```ts
// features/admin/hooks/useUsers.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getUsers, createUser, updateUser, deleteUser } from '../api/users';
import type { User, CreateUserDto, UpdateUserDto } from '../types/admin.types';

export function useUsers(params?: { page?: number; search?: string }) {
  return useQuery({
    queryKey: ['users', params],
    queryFn: () => getUsers(params),
  });
}

export function useUser(id: string) {
  return useQuery({
    queryKey: ['users', id],
    queryFn: () => getUserById(id),
    enabled: !!id,
  });
}

export function useCreateUser() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (data: CreateUserDto) => createUser(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });
}

export function useUpdateUser() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateUserDto }) =>
      updateUser(id, data),
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['users', id] });
    },
  });
}

export function useDeleteUser() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: (id: string) => deleteUser(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });
}
```

---

## 에러 처리

### 에러 바운더리

```tsx
// app/(admin)/error.tsx
'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle } from 'lucide-react';

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function AdminError({ error, reset }: ErrorProps) {
  useEffect(() => {
    // 에러 로깅 서비스에 전송
    console.error('Admin error:', error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
      <AlertTriangle className="h-12 w-12 text-destructive" />
      <div className="text-center">
        <h2 className="text-xl font-semibold">문제가 발생했습니다</h2>
        <p className="text-muted-foreground mt-1">
          잠시 후 다시 시도해 주세요.
        </p>
      </div>
      <Button onClick={reset}>다시 시도</Button>
    </div>
  );
}
```

### Not Found 페이지

```tsx
// app/(admin)/not-found.tsx
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { FileQuestion } from 'lucide-react';

export default function AdminNotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
      <FileQuestion className="h-12 w-12 text-muted-foreground" />
      <div className="text-center">
        <h2 className="text-xl font-semibold">페이지를 찾을 수 없습니다</h2>
        <p className="text-muted-foreground mt-1">
          요청하신 페이지가 존재하지 않습니다.
        </p>
      </div>
      <Button asChild>
        <Link href="/admin">대시보드로 돌아가기</Link>
      </Button>
    </div>
  );
}
```

### 로딩 상태

```tsx
// app/(admin)/loading.tsx
import { Skeleton } from '@/components/ui/skeleton';

export default function AdminLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-32" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
      </div>
      <Skeleton className="h-96" />
    </div>
  );
}
```

---

## 보안 베스트 프랙티스

### 1. 서버 사이드 권한 검증

```tsx
// 항상 서버에서 권한 검증
export async function GET(request: Request) {
  const session = await getServerSession();
  
  if (!session || session.user.role !== 'ADMIN') {
    return new Response('Unauthorized', { status: 401 });
  }
  
  // 처리 로직
}
```

### 2. 민감 데이터 마스킹

```ts
// lib/utils/masking.ts
export function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  const maskedLocal = local.slice(0, 2) + '***';
  return `${maskedLocal}@${domain}`;
}

export function maskPhone(phone: string): string {
  return phone.replace(/(\d{3})(\d{4})(\d{4})/, '$1-****-$3');
}
```

### 3. 감사 로그

```ts
// lib/audit.ts
export async function logAdminAction(action: {
  userId: string;
  action: string;
  resource: string;
  resourceId?: string;
  details?: Record<string, unknown>;
}) {
  await prisma.auditLog.create({
    data: {
      ...action,
      timestamp: new Date(),
    },
  });
}
```

---

*Admin Guide v1.0.0 | 2025-01-03*
