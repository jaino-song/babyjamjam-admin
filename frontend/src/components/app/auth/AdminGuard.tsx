'use client';

import { ReactNode } from 'react';
import { useGetAuthUser } from '@/hooks/useGetAuthUser';
import { canManageBranchFromAuthQuery } from '@/lib/auth/branch-role-policy';
import { AccessDenied } from './AccessDenied';
import { Skeleton } from '@/components/ui/skeleton';
import { usePathname } from 'next/navigation';

interface AdminGuardProps {
  children: ReactNode;
  fallback?: ReactNode;
}

export function AdminGuard({ children, fallback }: AdminGuardProps) {
  const authUserQuery = useGetAuthUser();
  const { data: user, isLoading, isFetching, isError } = authUserQuery;
  const pathname = usePathname();
  
  if (isLoading || isFetching) {
    return (
      <div data-component="desktop_shell_admin-guard_loading" className="min-h-screen bg-background p-6">
        <div className="mx-auto max-w-4xl space-y-6">
          <Skeleton className="h-8 w-40 bg-v3-dim-white" />
          <div className="rounded-[24px] border border-v3-border bg-white p-6 shadow-v3">
            <div className="space-y-4">
              <Skeleton className="h-6 w-48 bg-v3-dim-white" />
              <Skeleton className="h-4 w-full bg-v3-dim-white" />
              <Skeleton className="h-4 w-3/4 bg-v3-dim-white" />
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

  const canAccessAdminConsole = !isError && !isFetching && Boolean(user) && isAdmin;
  const canAccessFeedback = canManageBranchFromAuthQuery(authUserQuery);

  if (isError || (isFeedbackRoute ? !canAccessFeedback : !canAccessAdminConsole)) {
    return fallback ?? <AccessDenied />;
  }
  
  return <>{children}</>;
}
