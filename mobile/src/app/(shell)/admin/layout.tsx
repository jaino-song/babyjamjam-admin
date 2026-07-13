import { Metadata } from 'next';
import { AdminGuard } from '@/components/app/auth/AdminGuard';
import { ReactNode } from 'react';

export const metadata: Metadata = {
  title: "어드민 - 아가잼잼 관리자",
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminGuard>{children}</AdminGuard>;
}
