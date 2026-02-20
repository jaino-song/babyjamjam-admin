"use client";

import { usePathname } from "next/navigation";
import { isLayoutExcluded } from "@/lib/constants/v3-layout";
import { cn } from "@/lib/utils";

export function V3MainContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const excluded = isLayoutExcluded(pathname);
  const isClientsNewRoute = pathname.startsWith("/clients/new");

  return (
    <main
      data-component="main-content"
      className={cn(
        "bg-v3-dim-white",
        isClientsNewRoute
          ? "h-[100dvh] overflow-hidden p-4 pt-20 pb-4 md:min-h-screen md:h-auto md:p-8 md:pt-8 md:pb-8 md:ml-[280px]"
          : "min-h-screen p-4 md:p-8 pb-24 md:pb-8",
        !isClientsNewRoute && (excluded ? "pt-4 md:pt-8" : "pt-20 md:pt-8 md:ml-[280px]")
      )}
    >
      {children}
    </main>
  );
}
