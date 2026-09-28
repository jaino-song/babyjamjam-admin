'use client';

import { ReactNode } from 'react';
import { useGetAuthUser } from '@/hooks/useGetAuthUser';
import { canManageBranchFromAuthQuery } from '@/lib/auth/branch-role-policy';
import { AccessDenied } from './AccessDenied';
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
    return <div data-component="mobile_auth_admin-guard" className="flex items-center justify-center min-h-screen">Loading...</div>;
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
