# Admin Dashboard

> 어드민 대시보드 페이지 구현 가이드

---

## 📋 목차

1. [대시보드 구조](#대시보드-구조)
2. [통계 카드](#통계-카드)
3. [차트 컴포넌트](#차트-컴포넌트)
4. [최근 활동](#최근-활동)
5. [데이터 페칭](#데이터-페칭)
6. [실시간 업데이트](#실시간-업데이트)
7. [반응형 레이아웃](#반응형-레이아웃)

---

## 대시보드 구조

### 기본 레이아웃

```tsx
// app/(admin)/admin/page.tsx
import { Suspense } from 'react';
import { StatsCards } from '@/features/admin/components/dashboard/StatsCards';
import { OverviewChart } from '@/features/admin/components/dashboard/OverviewChart';
import { RecentActivity } from '@/features/admin/components/dashboard/RecentActivity';
import { TopProducts } from '@/features/admin/components/dashboard/TopProducts';
import { DashboardSkeleton } from '@/features/admin/components/dashboard/DashboardSkeleton';

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div>
        <h1 className="text-2xl font-bold">대시보드</h1>
        <p className="text-muted-foreground">
          서비스 현황을 한눈에 확인하세요.
        </p>
      </div>

      {/* 통계 카드 */}
      <Suspense fallback={<StatsCardsSkeleton />}>
        <StatsCards />
      </Suspense>

      {/* 차트 섹션 */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-7">
        <Suspense fallback={<ChartSkeleton className="lg:col-span-4" />}>
          <OverviewChart className="lg:col-span-4" />
        </Suspense>
        <Suspense fallback={<ChartSkeleton className="lg:col-span-3" />}>
          <TopProducts className="lg:col-span-3" />
        </Suspense>
      </div>

      {/* 최근 활동 */}
      <Suspense fallback={<ActivitySkeleton />}>
        <RecentActivity />
      </Suspense>
    </div>
  );
}
```

### 스켈레톤 컴포넌트

```tsx
// features/admin/components/dashboard/DashboardSkeleton.tsx
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader } from '@/components/ui/card';

export function StatsCardsSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <Card key={i}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-4" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-8 w-32 mb-2" />
            <Skeleton className="h-3 w-20" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function ChartSkeleton({ className }: { className?: string }) {
  return (
    <Card className={className}>
      <CardHeader>
        <Skeleton className="h-5 w-32" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-[350px] w-full" />
      </CardContent>
    </Card>
  );
}

export function ActivitySkeleton() {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-24" />
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton className="h-10 w-10 rounded-full" />
              <div className="space-y-2 flex-1">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-32" />
              </div>
              <Skeleton className="h-4 w-16" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
```

---

## 통계 카드

### 서버 컴포넌트 통계

```tsx
// features/admin/components/dashboard/StatsCards.tsx
import { getDashboardStats } from '@/features/admin/api/dashboard';
import { StatCard } from '../data-display/StatCard';
import { Users, DollarSign, ShoppingCart, TrendingUp } from 'lucide-react';

export async function StatsCards() {
  const stats = await getDashboardStats();

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      <StatCard
        title="총 매출"
        value={`₩${stats.totalRevenue.toLocaleString()}`}
        description="지난달 대비"
        icon={DollarSign}
        trend={{
          value: stats.revenueTrend,
          isPositive: stats.revenueTrend > 0,
        }}
      />
      <StatCard
        title="신규 사용자"
        value={`+${stats.newUsers.toLocaleString()}`}
        description="이번 주"
        icon={Users}
        trend={{
          value: stats.userTrend,
          isPositive: stats.userTrend > 0,
        }}
      />
      <StatCard
        title="총 주문"
        value={stats.totalOrders.toLocaleString()}
        description="이번 달"
        icon={ShoppingCart}
        trend={{
          value: stats.orderTrend,
          isPositive: stats.orderTrend > 0,
        }}
      />
      <StatCard
        title="전환율"
        value={`${stats.conversionRate}%`}
        description="평균 대비"
        icon={TrendingUp}
        trend={{
          value: stats.conversionTrend,
          isPositive: stats.conversionTrend > 0,
        }}
      />
    </div>
  );
}
```

### API 함수

```ts
// features/admin/api/dashboard.ts
import { api } from '@/lib/api';

export interface DashboardStats {
  totalRevenue: number;
  revenueTrend: number;
  newUsers: number;
  userTrend: number;
  totalOrders: number;
  orderTrend: number;
  conversionRate: number;
  conversionTrend: number;
}

export interface ChartData {
  name: string;
  value: number;
}

export interface RecentActivityItem {
  id: string;
  type: 'order' | 'user' | 'product';
  title: string;
  description: string;
  timestamp: string;
  user?: {
    name: string;
    image?: string;
  };
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const response = await api.get('/admin/dashboard/stats');
  return response.data;
}

export async function getRevenueChart(): Promise<ChartData[]> {
  const response = await api.get('/admin/dashboard/revenue-chart');
  return response.data;
}

export async function getTopProducts(): Promise<ChartData[]> {
  const response = await api.get('/admin/dashboard/top-products');
  return response.data;
}

export async function getRecentActivity(): Promise<RecentActivityItem[]> {
  const response = await api.get('/admin/dashboard/recent-activity');
  return response.data;
}
```

---

## 차트 컴포넌트

### 매출 차트

```tsx
// features/admin/components/dashboard/OverviewChart.tsx
import { getRevenueChart } from '@/features/admin/api/dashboard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RevenueChart } from './charts/RevenueChart';

interface OverviewChartProps {
  className?: string;
}

export async function OverviewChart({ className }: OverviewChartProps) {
  const data = await getRevenueChart();

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>월별 매출 추이</CardTitle>
      </CardHeader>
      <CardContent>
        <RevenueChart data={data} />
      </CardContent>
    </Card>
  );
}
```

### 클라이언트 차트 렌더러

```tsx
// features/admin/components/dashboard/charts/RevenueChart.tsx
'use client';

import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts';
import { useTheme } from 'next-themes';

interface RevenueChartProps {
  data: { name: string; value: number }[];
}

export function RevenueChart({ data }: RevenueChartProps) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <ResponsiveContainer width="100%" height={350}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="5%"
              stopColor="hsl(var(--primary))"
              stopOpacity={0.3}
            />
            <stop
              offset="95%"
              stopColor="hsl(var(--primary))"
              stopOpacity={0}
            />
          </linearGradient>
        </defs>
        <CartesianGrid
          strokeDasharray="3 3"
          stroke={isDark ? '#333' : '#eee'}
          vertical={false}
        />
        <XAxis
          dataKey="name"
          stroke={isDark ? '#888' : '#666'}
          fontSize={12}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          stroke={isDark ? '#888' : '#666'}
          fontSize={12}
          tickLine={false}
          axisLine={false}
          tickFormatter={(value) => `₩${(value / 1000000).toFixed(0)}M`}
        />
        <Tooltip
          content={({ active, payload, label }) => {
            if (active && payload && payload.length) {
              return (
                <div className="rounded-lg border bg-background p-2 shadow-sm">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex flex-col">
                      <span className="text-[0.70rem] uppercase text-muted-foreground">
                        {label}
                      </span>
                      <span className="font-bold text-muted-foreground">
                        ₩{payload[0].value?.toLocaleString()}
                      </span>
                    </div>
                  </div>
                </div>
              );
            }
            return null;
          }}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke="hsl(var(--primary))"
          strokeWidth={2}
          fillOpacity={1}
          fill="url(#colorRevenue)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
```

### 인기 상품 차트

```tsx
// features/admin/components/dashboard/TopProducts.tsx
import { getTopProducts } from '@/features/admin/api/dashboard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ProductBarChart } from './charts/ProductBarChart';

interface TopProductsProps {
  className?: string;
}

export async function TopProducts({ className }: TopProductsProps) {
  const data = await getTopProducts();

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>인기 상품 TOP 5</CardTitle>
      </CardHeader>
      <CardContent>
        <ProductBarChart data={data} />
      </CardContent>
    </Card>
  );
}
```

```tsx
// features/admin/components/dashboard/charts/ProductBarChart.tsx
'use client';

import {
  Bar,
  BarChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Tooltip,
} from 'recharts';

interface ProductBarChartProps {
  data: { name: string; value: number }[];
}

export function ProductBarChart({ data }: ProductBarChartProps) {
  return (
    <ResponsiveContainer width="100%" height={350}>
      <BarChart data={data} layout="vertical">
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="name"
          width={120}
          fontSize={12}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          formatter={(value: number) => [`${value}개`, '판매량']}
          cursor={{ fill: 'hsl(var(--muted))' }}
        />
        <Bar
          dataKey="value"
          fill="hsl(var(--primary))"
          radius={[0, 4, 4, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
```

---

## 최근 활동

### 활동 피드

```tsx
// features/admin/components/dashboard/RecentActivity.tsx
import { getRecentActivity } from '@/features/admin/api/dashboard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { formatDistanceToNow } from 'date-fns';
import { ko } from 'date-fns/locale';
import { ShoppingCart, UserPlus, Package } from 'lucide-react';

const activityIcons = {
  order: ShoppingCart,
  user: UserPlus,
  product: Package,
};

const activityColors = {
  order: 'bg-blue-500',
  user: 'bg-green-500',
  product: 'bg-purple-500',
};

export async function RecentActivity() {
  const activities = await getRecentActivity();

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>최근 활동</CardTitle>
        <Badge variant="secondary">{activities.length}건</Badge>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {activities.map((activity) => {
            const Icon = activityIcons[activity.type];
            const colorClass = activityColors[activity.type];

            return (
              <div key={activity.id} className="flex items-start gap-4">
                <div
                  className={`p-2 rounded-full ${colorClass} text-white flex-shrink-0`}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{activity.title}</p>
                  <p className="text-sm text-muted-foreground truncate">
                    {activity.description}
                  </p>
                </div>
                {activity.user && (
                  <Avatar className="h-8 w-8 flex-shrink-0">
                    <AvatarImage src={activity.user.image} />
                    <AvatarFallback>
                      {activity.user.name.slice(0, 2)}
                    </AvatarFallback>
                  </Avatar>
                )}
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {formatDistanceToNow(new Date(activity.timestamp), {
                    addSuffix: true,
                    locale: ko,
                  })}
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
```

---

## 데이터 페칭

### React Query 훅

```ts
// features/admin/hooks/useDashboard.ts
'use client';

import { useQuery } from '@tanstack/react-query';
import {
  getDashboardStats,
  getRevenueChart,
  getTopProducts,
  getRecentActivity,
} from '../api/dashboard';

export function useDashboardStats() {
  return useQuery({
    queryKey: ['dashboard', 'stats'],
    queryFn: getDashboardStats,
    staleTime: 1000 * 60 * 5, // 5분
    refetchInterval: 1000 * 60 * 5, // 5분마다 자동 갱신
  });
}

export function useRevenueChart() {
  return useQuery({
    queryKey: ['dashboard', 'revenue-chart'],
    queryFn: getRevenueChart,
    staleTime: 1000 * 60 * 30, // 30분
  });
}

export function useTopProducts() {
  return useQuery({
    queryKey: ['dashboard', 'top-products'],
    queryFn: getTopProducts,
    staleTime: 1000 * 60 * 30,
  });
}

export function useRecentActivity() {
  return useQuery({
    queryKey: ['dashboard', 'recent-activity'],
    queryFn: getRecentActivity,
    staleTime: 1000 * 60, // 1분
    refetchInterval: 1000 * 60, // 1분마다 자동 갱신
  });
}
```

### 클라이언트 대시보드 (대안)

```tsx
// features/admin/components/dashboard/ClientDashboard.tsx
'use client';

import { useDashboardStats, useRecentActivity } from '../hooks/useDashboard';
import { StatCard } from '../data-display/StatCard';
import { StatsCardsSkeleton } from './DashboardSkeleton';

export function ClientStatsCards() {
  const { data: stats, isLoading, error } = useDashboardStats();

  if (isLoading) return <StatsCardsSkeleton />;
  if (error) return <div>통계를 불러오는데 실패했습니다.</div>;
  if (!stats) return null;

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {/* StatCard 렌더링 */}
    </div>
  );
}
```

---

## 실시간 업데이트

### WebSocket 연동

```ts
// features/admin/hooks/useRealtimeStats.ts
'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { DashboardStats } from '../api/dashboard';

export function useRealtimeStats() {
  const queryClient = useQueryClient();
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const ws = new WebSocket(process.env.NEXT_PUBLIC_WS_URL!);

    ws.onopen = () => {
      setIsConnected(true);
      ws.send(JSON.stringify({ type: 'subscribe', channel: 'dashboard' }));
    };

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);

      if (message.type === 'stats_update') {
        queryClient.setQueryData<DashboardStats>(
          ['dashboard', 'stats'],
          (old) => ({
            ...old,
            ...message.data,
          })
        );
      }

      if (message.type === 'new_activity') {
        queryClient.invalidateQueries({
          queryKey: ['dashboard', 'recent-activity'],
        });
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
    };

    return () => {
      ws.close();
    };
  }, [queryClient]);

  return { isConnected };
}
```

### 연결 상태 표시

```tsx
// features/admin/components/dashboard/ConnectionStatus.tsx
'use client';

import { useRealtimeStats } from '../hooks/useRealtimeStats';
import { Badge } from '@/components/ui/badge';

export function ConnectionStatus() {
  const { isConnected } = useRealtimeStats();

  return (
    <Badge variant={isConnected ? 'default' : 'secondary'}>
      {isConnected ? '🟢 실시간' : '🔴 오프라인'}
    </Badge>
  );
}
```

---

## 반응형 레이아웃

### 그리드 시스템

```tsx
// 반응형 대시보드 레이아웃
<div className="space-y-6">
  {/* 통계 카드: 모바일 2열, 태블릿 2열, 데스크톱 4열 */}
  <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
    {/* 카드들 */}
  </div>

  {/* 차트 섹션: 모바일 1열, 데스크톱 7:3 비율 */}
  <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-7">
    <Card className="md:col-span-2 lg:col-span-4">
      {/* 매출 차트 */}
    </Card>
    <Card className="md:col-span-2 lg:col-span-3">
      {/* 인기 상품 */}
    </Card>
  </div>

  {/* 하단 섹션: 모바일 1열, 데스크톱 2열 */}
  <div className="grid gap-6 md:grid-cols-2">
    <Card>
      {/* 최근 활동 */}
    </Card>
    <Card>
      {/* 추가 위젯 */}
    </Card>
  </div>
</div>
```

### 모바일 최적화

```tsx
// features/admin/components/dashboard/MobileStats.tsx
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface MobileStatsProps {
  children: React.ReactNode;
}

export function MobileStats({ children }: MobileStatsProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="md:hidden">
      <Button
        variant="ghost"
        className="w-full justify-between"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        통계 {isExpanded ? '접기' : '펼치기'}
        {isExpanded ? (
          <ChevronUp className="h-4 w-4" />
        ) : (
          <ChevronDown className="h-4 w-4" />
        )}
      </Button>
      {isExpanded && <div className="mt-4">{children}</div>}
    </div>
  );
}
```

---

## 위젯 예시

### 알림 위젯

```tsx
// features/admin/components/dashboard/NotificationWidget.tsx
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Bell, AlertTriangle, Info } from 'lucide-react';

interface Notification {
  id: string;
  type: 'info' | 'warning' | 'error';
  title: string;
  message: string;
  createdAt: string;
}

interface NotificationWidgetProps {
  notifications: Notification[];
}

const icons = {
  info: Info,
  warning: AlertTriangle,
  error: AlertTriangle,
};

const colors = {
  info: 'text-blue-500',
  warning: 'text-yellow-500',
  error: 'text-red-500',
};

export function NotificationWidget({ notifications }: NotificationWidgetProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Bell className="h-5 w-5" />
          알림
        </CardTitle>
        {notifications.length > 0 && (
          <Badge>{notifications.length}</Badge>
        )}
      </CardHeader>
      <CardContent>
        {notifications.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            새로운 알림이 없습니다.
          </p>
        ) : (
          <div className="space-y-3">
            {notifications.map((notification) => {
              const Icon = icons[notification.type];
              return (
                <div
                  key={notification.id}
                  className="flex items-start gap-3 p-2 rounded-lg hover:bg-muted"
                >
                  <Icon className={`h-5 w-5 ${colors[notification.type]}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{notification.title}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {notification.message}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

---

*Admin Dashboard v1.0.0 | 2025-01-03*
