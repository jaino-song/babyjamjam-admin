"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import { isLayoutExcluded } from "@/lib/constants/v3-layout";
import { NotificationBell } from "@/components/app/notifications/NotificationBell";

export function V3MobileHeader() {
  const pathname = usePathname();
  if (!pathname || isLayoutExcluded(pathname)) return null;

  return (
    <header data-component="mobile-header" className="fixed top-0 left-1/2 z-40 flex w-full max-w-[430px] -translate-x-1/2 items-center justify-between px-4 py-3 bg-white shadow-v3" style={{ borderRadius: '0 0 24px 24px' }}>
      <div data-component="mobile-header-logo" className="flex items-center gap-2.5">
        <Image src="/assets/logo.svg" alt="아가잼잼" width={40} height={40} className="w-10 h-10 rounded-2xl" />
        <span className="text-xl font-bold text-v3-primary">아가잼잼</span>
      </div>

      <div data-component="mobile-header-notifications">
        <NotificationBell />
      </div>
    </header>
  );
}
