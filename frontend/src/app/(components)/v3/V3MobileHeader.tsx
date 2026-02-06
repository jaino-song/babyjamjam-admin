"use client";

import { usePathname } from "next/navigation";
import { LayoutDashboard } from "lucide-react";
import { isLayoutExcluded } from "@/app/lib/constants/v3-layout";
import { NotificationBell } from "@/app/(components)/notifications/NotificationBell";

export function V3MobileHeader() {
  const pathname = usePathname();
  if (!pathname || isLayoutExcluded(pathname)) return null;

  return (
    <header className="fixed top-0 left-0 right-0 z-[1000] flex md:hidden items-center justify-between px-4 py-3 bg-white shadow-v3" style={{ borderRadius: '0 0 24px 24px' }}>
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-xl bg-v3-primary flex items-center justify-center">
          <LayoutDashboard className="w-5 h-5 text-white" />
        </div>
        <span className="text-base font-bold text-v3-dark">케어허브</span>
      </div>

      <div>
        <NotificationBell />
      </div>
    </header>
  );
}
