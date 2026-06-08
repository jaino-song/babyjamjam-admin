"use client";

import React from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  UserCheck,
  UserKey,
  Globe,
  FileText,
  FolderOpen,
  Settings,
  LucideIcon,
  Calculator,
  Headset,
  MessageCircle,
  BarChart3,
} from "lucide-react";
import { useInitialUser } from "@/providers/UserProvider";
import { isLayoutExcluded } from "@/lib/constants/v3-layout";
import { KakaoTalkIcon } from "@/components/icons/KakaoTalkIcon";
import { useLocale } from "@/providers/LocaleProvider";
import { t } from "@/lib/i18n/translations";
import { ROLES } from "@/lib/constants/roles";
import { SidebarNotifications } from "@/components/app/v3/SidebarNotifications";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useConsultationInquiries } from "@/hooks/useConsultationInquiries";

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon | React.ElementType;
  badge?: string;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const BASE_NAV_SECTIONS: NavSection[] = [
  {
    title: "메인",
    items: [
      { label: "대시보드", href: "/dashboard", icon: LayoutDashboard },
      // { label: "서비스 일정", href: "/schedule", icon: Calendar },
    ],
  },
  {
    title: "지점 관리",
    items: [
      { label: "상담", href: "/consultations", icon: Headset },
      { label: "고객", href: "/clients", icon: Users },
      { label: "직원", href: "/employees", icon: UserCheck },
      // { label: "통계", href: "/analytics", icon: BarChart3 },
    ],
  },
  {
    title: "서비스 관리",
    items: [
      { label: "메시지", href: "/messages", icon: MessageCircle },
      { label: "가격표", href: "/prices", icon: Calculator },
      { label: "알림톡", href: "/alimtalk", icon: KakaoTalkIcon },
    ],
  },
  {
    title: "문서 관리",
    items: [
      { label: "전자문서", href: "/contracts", icon: FileText },
      { label: "파일 저장소", href: "/files", icon: FolderOpen },
    ],
  },
  {
    title: "시스템 관리",
    items: [
      { label: "통계", href: "/stats", icon: BarChart3 },
      { label: "설정", href: "/settings", icon: Settings },
    ],
  },
];

export const V3Sidebar = () => {
  const pathname = usePathname();
  const user = useInitialUser();
  const locale = useLocale();
  const isOwner = user?.role === ROLES.owner;
  const isExcluded = isLayoutExcluded(pathname);
  const [isNavScrolling, setIsNavScrolling] = React.useState(false);
  const scrollResetTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const consultationUnreadParams = React.useMemo(
    () => ({ page: 1, limit: 1, readState: "unread" }),
    []
  );
  const { data: consultationUnreadData } = useConsultationInquiries(
    consultationUnreadParams,
    Boolean(user) && !isExcluded
  );
  const consultationUnreadCount = consultationUnreadData?.total ?? 0;
  const consultationUnreadBadge =
    consultationUnreadCount > 99 ? "99+" : consultationUnreadCount > 0 ? String(consultationUnreadCount) : null;

  const getNavItemName = (href: string) => {
    const segment = href.split("/").filter(Boolean).pop() || "";
    return segment.toLowerCase();
  };

  const isActive = (href: string) => {
    if (href === "/dashboard" && pathname === "/dashboard/analytics") return false;
    if (href === "/employees" && pathname === "/employees/schedule") return false;
    return pathname.startsWith(href);
  };

  const navSections = React.useMemo<NavSection[]>(
    () => BASE_NAV_SECTIONS.map((section) => {
      if (section.title !== "시스템 관리") {
        return section;
      }

      const [statsItem, ...rest] = section.items;
      return {
        ...section,
        items: isOwner
          ? [
              statsItem,
              { label: "관리자", href: "/system-admin", icon: UserKey },
              { label: "홈페이지 관리", href: "/website-admin", icon: Globe },
              ...rest,
            ]
          : [{ ...statsItem, href: "/stats/inquiries" }, ...rest],
      };
    }),
    [isOwner]
  );

  React.useEffect(() => {
    return () => {
      if (scrollResetTimeoutRef.current !== null) {
        clearTimeout(scrollResetTimeoutRef.current);
      }
    };
  }, []);

  const handleNavScroll = () => {
    setIsNavScrolling(true);

    if (scrollResetTimeoutRef.current !== null) {
      clearTimeout(scrollResetTimeoutRef.current);
    }

    scrollResetTimeoutRef.current = setTimeout(() => {
      setIsNavScrolling(false);
    }, 450);
  };

  if (isExcluded) {
    return null;
  }

  const initials = user?.name
    ? user.name.slice(0, 2).toUpperCase()
    : "USER";

  return (
    <aside
      className="hidden md:flex flex-col fixed left-0 top-0 h-full w-[20vw] max-w-[240px] bg-white z-40 rounded-tr-[32px] rounded-br-[32px] shadow-v3 animate-v3-slide-right overflow-hidden"
      aria-label="Sidebar Navigation"
      data-component="sidebar"
    >
      <div className="flex items-center justify-between gap-3 px-6 pt-8 pb-6" data-component="sidebar-brand">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex items-center justify-center w-12 h-12 rounded-xl shrink-0 shadow-sm overflow-hidden">
            <Image src="/assets/logo.svg" alt="아가잼잼 로고" width={48} height={48} className="w-full h-full object-cover" />
          </div>
          <div className="min-w-0">
            <span className="block truncate text-xl font-bold text-v3-primary tracking-tight">
              아가잼잼
            </span>
            {user?.branchName && (
              <span className="mt-0.5 block truncate text-[0.72rem] font-medium leading-none text-v3-text-muted">
                {user.branchName}
              </span>
            )}
          </div>
        </div>
        <SidebarNotifications />
      </div>

      <nav
        className="flex-1 overflow-y-auto px-4 py-2 space-y-6 custom-scrollbar scrollbar-on-scroll"
        data-component="sidebar-nav"
        data-scroll-active={isNavScrolling ? "true" : "false"}
        onScroll={handleNavScroll}
      >
        {navSections.map((section, idx) => (
          <div key={section.title + idx}>
            <h3 className="px-4 mb-2 text-[0.65rem] font-semibold text-v3-text-muted uppercase tracking-[0.15em]">
              {section.title}
            </h3>
            <ul className="space-y-1">
              {section.items.map((item) => {
                const active = isActive(item.href);
                const badge = item.href === "/consultations" ? consultationUnreadBadge : item.badge;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      prefetch={false}
                      data-component={`sidebar-nav-${getNavItemName(item.href)}`}
                      className={`
                        relative group flex items-center gap-3 px-4 py-2.5 rounded-2xl transition-all duration-200 overflow-hidden
                        ${active
                          ? "bg-v3-primary text-white shadow-md shadow-blue-500/20"
                          : "text-v3-text hover:bg-v3-primary-light hover:text-v3-primary"
                        }
                      `}
                    >
                      <item.icon
                        className={`w-5 h-5 shrink-0 transition-colors ${active ? "text-white" : "group-hover:text-v3-primary"}`}
                        strokeWidth={2}
                      />
                      <span className="text-[0.85rem] font-medium leading-none pt-0.5">
                        {item.label}
                      </span>

                      {badge && (
	                        <span
	                          data-component={`sidebar-nav-${getNavItemName(item.href)}-badge`}
	                          className={`
	                            ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full px-2 text-center text-[0.65rem] font-bold leading-none
	                            bg-v3-burgundy text-white
	                          `}
	                        >
                          {badge}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="p-4 mt-auto" data-component="sidebar-profile">
        <div className="flex items-center gap-3 p-3 rounded-2xl bg-v3-dim-white/50 border border-v3-border/50 hover:bg-white hover:shadow-v3-hover transition-all cursor-pointer group">
          <Avatar className="h-10 w-10 shrink-0 rounded-full shadow-inner">
            <AvatarImage src={user?.profileImage || ""} alt={user?.name || "사용자"} />
            <AvatarFallback className="bg-gradient-to-br from-v3-primary to-blue-600 text-white font-bold text-sm">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-col min-w-0">
            <span className="text-[0.85rem] font-semibold text-gray-900 truncate group-hover:text-v3-primary transition-colors">
              {user?.name || "GUEST"}
            </span>
            <span className="text-[0.7rem] text-v3-text-muted truncate">
              {user?.role ? t(locale, `roles.${user.role}`) || t(locale, "roles.unknown") : t(locale, "roles.unknown")}
            </span>
          </div>
        </div>
      </div>
    </aside>
  );
};
