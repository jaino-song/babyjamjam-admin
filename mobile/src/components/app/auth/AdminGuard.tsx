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
  const { data: user, isLoading } = useGetAuthUser();
  const pathname = usePathname();
  
  if (isLoading) {
    return <div data-component="mobile_auth_admin-guard" className="flex items-center justify-center min-h-screen">Loading...</div>;
  }
  
  const isAdmin = user?.role === 'admin' || user?.role === 'owner';
  const isFeedbackRoute = pathname === '/admin'
    || pathname === '/admin/feedback'
    || pathname?.startsWith('/admin/feedback/');
  
  if (!user || (isFeedbackRoute ? !canManageBranch(user) : !isAdmin)) {
    return fallback ?? <AccessDenied />;
  }
  
  return <>{children}</>;
}
