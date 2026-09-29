'use client';

import { ReactNode } from 'react';
import { useGetAuthUser } from '@/hooks/useGetAuthUser';
import { canManageBranch } from '@/lib/auth/branch-role-policy';
import { AccessDenied } from './AccessDenied';
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
    return <div data-component="mobile_auth_admin-guard" className="flex items-center justify-center min-h-screen">Loading...</div>;
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
