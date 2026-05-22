"use client";

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  BarChart3,
  Bell,
  Calculator,
  Calendar,
  HelpCircle,
  Languages,
  Lock,
  MessageCircle,
  MessageSquareText,
  Send,
  ShieldCheck,
  UserCheck,
  Users,
} from "lucide-react";

import { useInitialUser } from "@/providers/UserProvider";
import { useAllClients } from "@/hooks/useClients";
import { useEmployees } from "@/hooks/useEmployees";
import { useUnreadCount, usePushNotification } from "@/hooks/usePushNotification";
import { AllSettingsRedesign } from "@/components/app/mobile-redesign/AllSettingsRedesign";
import type { MenuGroup } from "@/components/app/mobile-redesign/mockup-data";

export default function AllMenuPage() {
  const router = useRouter();
  const user = useInitialUser();
  const { data: clients = [] } = useAllClients();
  const { data: employees = [] } = useEmployees();
  const { isSubscribed } = usePushNotification();
  const { data: unreadNotifCount = 0 } = useUnreadCount(isSubscribed);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia("(min-width: 768px)").matches) {
      router.replace("/dashboard");
    }
  }, [router]);

  const isAdminOrOwner = user?.role === "admin" || user?.role === "owner";

  const menuGroups = useMemo<MenuGroup[]>(() => {
    const groups: MenuGroup[] = [
      {
        title: "지점 관리",
        rows: [
          {
            label: "상담",
            href: "/consultations",
            icon: MessageCircle,
            tone: "burgundy",
            ...(unreadNotifCount > 0 ? { badge: String(unreadNotifCount) } : {}),
          },
          {
            label: "고객",
            href: "/clients",
            icon: Users,
            tone: "primary",
            value: `${clients.length}명`,
          },
          {
            label: "제공인력",
            href: "/employees",
            icon: UserCheck,
            tone: "purple",
            value: `${employees.length}명`,
          },
          {
            label: "일정 캘린더",
            href: "/employees/schedule",
            icon: Calendar,
            tone: "orange",
          },
          {
            label: "통계 보고서",
            href: "/dashboard/analytics",
            icon: BarChart3,
            tone: "green",
          },
        ],
      },
      {
        title: "서비스 관리",
        rows: [
          { label: "가격표", href: "/settings", icon: Calculator, tone: "orange" },
          { label: "메시지", href: "/messages", icon: MessageSquareText, tone: "primary" },
          { label: "알림톡", href: "/alimtalk", icon: Send, tone: "gold" },
        ],
      },
      {
        title: "설정",
        rows: [
          {
            label: "알림 설정",
            href: "/settings",
            icon: Bell,
            tone: "muted",
            value: isSubscribed ? "활성" : "비활성",
          },
          { label: "보안", href: "/settings", icon: Lock, tone: "muted" },
          { label: "언어", href: "/settings", icon: Languages, tone: "muted", value: "한국어" },
        ],
      },
      {
        title: "지원",
        rows: [
          { label: "도움말", href: "/settings", icon: HelpCircle, tone: "muted" },
          { label: "문의하기", href: "/messages", icon: MessageCircle, tone: "muted" },
        ],
      },
    ];

    if (isAdminOrOwner) {
      groups.push({
        title: "관리자",
        rows: [
          { label: "피드백 관리", href: "/admin/feedback", icon: ShieldCheck, tone: "burgundy" },
        ],
      });
    }

    return groups;
  }, [isAdminOrOwner, clients.length, employees.length, unreadNotifCount, isSubscribed]);

  return (
    <div className="md:hidden">
      <AllSettingsRedesign menuGroups={menuGroups} />
    </div>
  );
}
