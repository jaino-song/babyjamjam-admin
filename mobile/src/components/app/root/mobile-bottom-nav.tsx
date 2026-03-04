"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { Home, Users, FileText, Sparkles, Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { isLayoutExcluded } from "@/lib/constants/v3-layout";

export function MobileBottomNav() {
  const pathname = usePathname();

  if (!pathname) return null;

  if (isLayoutExcluded(pathname)) return null;

  if (pathname.startsWith("/clients/new")) return null;

  const navItems: Array<{
    href: string;
    label: string;
    icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
    kind?: "normal" | "chat";
  }> = [
      { href: "/dashboard", label: "홈", icon: Home, kind: "normal" },
      { href: "/clients", label: "고객", icon: Users, kind: "normal" },
      { href: "/chat", label: "어시스턴트", icon: Sparkles, kind: "chat" },
      { href: "/contracts", label: "계약", icon: FileText, kind: "normal" },
      { href: "/all", label: "전체", icon: Menu, kind: "normal" },
    ];

  const activeIndex = navItems.findIndex((item) => {
    if (item.href === "/dashboard") return pathname === "/dashboard";
    if (item.href === "/chat" || item.href === "/all")
      return pathname === item.href;
    return pathname.startsWith(item.href);
  });

  const activeItem = activeIndex >= 0 ? navItems[activeIndex] : null;

  return (
    <nav
      data-component="mobile-bottom-nav"
      className={cn(
        "fixed left-1/2 z-40 w-[calc(100%-2rem)] max-w-[398px] -translate-x-1/2",
        "grid grid-cols-5 items-end gap-1 p-2",
        "bg-white/80 backdrop-blur-xl rounded-2xl",
        "shadow-v3-hover",
      )}
      style={{
        bottom: "max(calc(1rem + env(safe-area-inset-bottom)), calc(100dvh - var(--mobile-shell-max-height, 932px) + 1rem))",
      }}
    >
      {activeIndex >= 0 && (
        <div
          aria-hidden="true"
          className={cn(
            "absolute top-2 bottom-2 rounded-2xl",
            "transition-[transform,background-color] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]",
            activeItem?.kind === "chat"
              ? "bg-v3-primary-light"
              : "bg-v3-primary"
          )}
          style={{
            width: "calc((100% - 2rem) / 5)",
            left: "0.5rem",
            transform: `translateX(calc(${activeIndex} * (100% + 0.25rem)))`,
          }}
        />
      )}

      {navItems.map((item) => {
        const isActive =
          item.href === "/dashboard"
            ? pathname === "/dashboard"
            : item.href === "/chat" || item.href === "/all"
              ? pathname === item.href
              : pathname.startsWith(item.href);
        const Icon = item.icon;

        return (
          <Link
            key={item.href}
            href={item.href}
            data-component={
              item.kind === "chat"
                ? "mobile-bottom-nav-chat"
                : `mobile-bottom-nav-${item.href.replace("/", "")}`
            }
            className={cn(
              "relative z-10 flex flex-col items-center gap-1 p-2 rounded-2xl transition-colors duration-300",
              item.kind === "chat"
                ? "text-v3-primary"
                : isActive
                  ? "text-white"
                  : "text-gray-500"
            )}
          >
            <Icon
              className={cn(
                item.kind === "chat"
                  ? "lucide lucide-sparkles h-5 w-5 text-navy shrink-0"
                  : "w-5 h-5"
              )}
              strokeWidth={item.kind === "chat" ? 2 : 2.5}
            />
            <span className="text-[10px] font-medium leading-none">
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
