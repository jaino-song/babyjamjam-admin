"use client";

import { usePathname, useRouter } from "next/navigation";
import { Settings as SettingsIcon, DollarSign, Cog } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface SettingsLayoutProps {
  children: React.ReactNode;
}

const settingsTabs = [
  {
    value: "voucher-price",
    label: "바우처 요금표",
    icon: DollarSign,
    href: "/settings/voucher-price",
  },
  {
    value: "general",
    label: "일반 설정",
    icon: Cog,
    href: "/settings/general",
  },
] as const;

export default function SettingsLayout({ children }: SettingsLayoutProps) {
  const pathname = usePathname();
  const router = useRouter();

  // 현재 활성 탭 결정
  const getCurrentTab = () => {
    if (pathname?.includes("/voucher-price")) return "voucher-price";
    if (pathname?.includes("/general")) return "general";
    return "voucher-price"; // 기본값
  };

  const handleTabChange = (value: string) => {
    const tab = settingsTabs.find((t) => t.value === value);
    if (tab) {
      router.push(tab.href);
    }
  };

  return (
    <div className="container max-w-5xl py-6 px-4 sm:px-6">
      {/* 페이지 헤더 */}
      <div className="mb-6 flex items-center gap-3 opacity-0 animate-fade-in">
        <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-primary/10">
          <SettingsIcon size={24} className="text-primary" />
        </div>
        <h1 className="text-2xl font-bold text-foreground">설정</h1>
      </div>

      {/* shadcn/ui Tabs */}
      <Tabs value={getCurrentTab()} onValueChange={handleTabChange} className="w-full opacity-0 animate-fade-in" style={{ animationDelay: "100ms" }}>
        <TabsList className="grid w-full grid-cols-2 lg:w-[400px] mb-6">
          {settingsTabs.map((tab, index) => {
            const Icon = tab.icon;
            return (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="flex items-center gap-2 opacity-0 animate-fade-in"
                style={{ animationDelay: `${150 + index * 50}ms` }}
              >
                <Icon size={16} />
                {tab.label}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>

      {/* 탭 컨텐츠 (자식 라우트) */}
      <div className="opacity-0 animate-fade-in" style={{ animationDelay: "200ms" }}>
        {children}
      </div>
    </div>
  );
}
