'use client';

import { ReactNode } from 'react';
import { useGetAuthUser } from '@/hooks/useGetAuthUser';
import { canManageBranch } from '@/lib/auth/branch-role-policy';
import { AccessDenied } from './AccessDenied';
import { Skeleton } from '@/components/ui/skeleton';
import { usePathname } from 'next/navigation';

interface AdminGuardProps {
  children: ReactNode;
  fallback?: ReactNode;
}

export function AdminGuard({ children, fallback }: AdminGuardProps) {
  const { data: user, isLoading, isFetching, isError } = useGetAuthUser();
  const pathname = usePathname();
  
  // Skeleton only until the first answer: a background refetch (e.g. on window
  // focus) keeps the last decision so the guarded page keeps its state.
  if (isLoading || (isFetching && !user)) {
    return (
      <div data-component="desktop_shell_admin-guard_loading" className="min-h-screen bg-background p-6">
        <div className="mx-auto max-w-4xl space-y-6">
          <Skeleton className="h-8 w-40 bg-surface" />
          <div className="rounded-[24px] border border-border bg-white p-6 shadow-v3">
            <div className="space-y-4">
              <Skeleton className="h-6 w-48 bg-surface" />
              <Skeleton className="h-4 w-full bg-surface" />
              <Skeleton className="h-4 w-3/4 bg-surface" />
            </div>
          </div>
        </div>
      </div>
    );
  }
  
  const isAdmin = user?.role === 'admin' || user?.role === 'owner';
  const isFeedbackRoute = pathname === '/admin'
    || pathname === '/admin/feedback'
    || pathname?.startsWith('/admin/feedback/');

  const canAccessAdminConsole = !isError && Boolean(user) && isAdmin;
  const canAccessFeedback = !isError && canManageBranch(user);

  if (isError || (isFeedbackRoute ? !canAccessFeedback : !canAccessAdminConsole)) {
    return fallback ?? <AccessDenied />;
  }
  
  return <>{children}</>;
}
