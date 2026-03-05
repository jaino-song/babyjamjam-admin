"use client";

import { usePathname } from "next/navigation";
import { isLayoutExcluded } from "@/lib/constants/v3-layout";
import { cn } from "@/lib/utils";

export function V3MainContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const excluded = isLayoutExcluded(pathname);

  return (
    <main
      data-component="main-content"
      className={cn(
        "h-screen overflow-auto bg-v3-dim-white",
        "p-4 md:p-8 md:pr-24",
        "pb-24 md:pb-8",
        excluded ? "pt-4 md:pt-8" : "pt-20 md:pt-8 md:ml-[280px]",
        "[&>*]:h-full"
      )}
    >
      {children}
    </main>
  );
}
