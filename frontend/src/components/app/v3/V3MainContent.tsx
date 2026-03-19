"use client";

import { usePathname } from "next/navigation";
import { isLayoutExcluded } from "@/lib/constants/v3-layout";
import { cn } from "@/lib/utils";

export function V3MainContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const excluded = isLayoutExcluded(pathname);
  const isSelectOrganizationPage = pathname === "/select-organization";

  return (
    <main
      data-component="main-content"
      className={cn(
        "h-screen overflow-y-auto overflow-x-hidden bg-v3-dim-white",
        "p-4 pb-24 md:pt-8 md:pb-8",
        excluded ? "pt-4 md:px-8" : "pt-20 md:pl-[312px] md:pr-24",
        isSelectOrganizationPage && "overflow-hidden p-0 md:p-0",
        "[&>*]:h-full"
      )}
    >
      {children}
    </main>
  );
}
