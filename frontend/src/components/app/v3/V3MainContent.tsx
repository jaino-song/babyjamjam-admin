"use client";

import { usePathname } from "next/navigation";
import { isLayoutExcluded } from "@/lib/constants/v3-layout";
import { cn } from "@/lib/utils";
import { FloatingQuickActions } from "./FloatingQuickActions";

export function V3MainContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const excluded = isLayoutExcluded(pathname);
  const isSelectBranchPage = pathname === "/select-branch";
  const shouldLockMainScroll = pathname === "/prices";
  const shouldRenderQuickActions = !excluded && !isSelectBranchPage;

  return (
    <main
      data-component="main-content"
      data-mode="desktop"
      className={cn(
        "h-screen overflow-x-hidden bg-v3-dim-white",
        shouldLockMainScroll ? "overflow-hidden" : "overflow-y-auto",
        "p-4 pb-24 md:pt-8 md:pb-4",
        shouldRenderQuickActions && "md:flex md:flex-row md:items-stretch md:gap-4",
        excluded ? "pt-4 md:px-8" : "pt-20 md:pl-[calc(min(20vw,240px)+16px)] md:pr-4",
        isSelectBranchPage && "overflow-hidden p-0 md:p-0",
      )}
    >
      {shouldRenderQuickActions ? (
        <>
          <div data-component="main-content-body" className="min-w-0 h-full flex-1">
            {children}
          </div>
          <FloatingQuickActions />
        </>
      ) : (
        children
      )}
    </main>
  );
}
