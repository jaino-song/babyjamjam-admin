"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { Home, Users, FileText, FolderOpen, Settings } from "lucide-react";
import { cn } from "@/lib/utils";
import { isLayoutExcluded } from "@/app/lib/constants/v3-layout";

export function MobileBottomNav() {
  const pathname = usePathname();

  if (!pathname) return null;

  if (isLayoutExcluded(pathname)) return null;

  const navItems = [
    {
      href: "/dashboard",
      label: "홈",
      icon: Home,
    },
    {
      href: "/clients",
      label: "고객",
      icon: Users,
    },
    {
      href: "/contracts",
      label: "계약",
      icon: FileText,
    },
    {
      href: "/files",
      label: "파일",
      icon: FolderOpen,
    },
    {
      href: "/settings",
      label: "설정",
      icon: Settings,
    },
  ];

  return (
    <nav
      data-component="mobile-bottom-nav"
      className={cn(
        "fixed bottom-4 left-4 right-4 z-[1000]",
        "flex items-center justify-between p-2",
        "bg-white rounded-3xl",
        "shadow-v3-hover",
        "md:hidden"
      )}
    >
      {navItems.map((item) => {
        const isActive = pathname === item.href;
        const Icon = item.icon;

        return (
          <Link
            key={item.href}
            href={item.href}
            data-component={`mobile-bottom-nav-${item.href.replace("/", "")}`}
            className={cn(
              "flex flex-1 flex-col items-center gap-1 p-2 rounded-2xl transition-all duration-200",
              isActive
                ? "bg-v3-primary text-white"
                : "text-gray-500 hover:bg-v3-primary-light"
            )}
          >
            <Icon className="w-5 h-5" strokeWidth={2.5} />
            <span className="text-[10px] font-medium leading-none">
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
