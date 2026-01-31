import { AdminGuard } from '@/app/(components)/auth/AdminGuard';
import { ReactNode } from 'react';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminGuard>{children}</AdminGuard>;
}
