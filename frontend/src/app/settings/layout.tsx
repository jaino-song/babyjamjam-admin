"use client";

import { usePathname, useRouter } from "next/navigation";
import { Box, Container, Typography } from "@mui/material";
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
    <Container maxWidth="lg" sx={{ py: 4 }}>
      {/* 페이지 헤더 */}
      <Box sx={{ mb: 4, display: "flex", alignItems: "center", gap: 2 }}>
        <SettingsIcon size={32} className="text-blue-600" />
        <Typography variant="h4" component="h1">
          설정
        </Typography>
      </Box>

      {/* shadcn/ui Tabs */}
      <Tabs value={getCurrentTab()} onValueChange={handleTabChange} className="w-full">
        <TabsList className="grid w-full grid-cols-2 lg:w-[400px] mb-6">
          {settingsTabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="flex items-center gap-2"
              >
                <Icon size={16} />
                {tab.label}
              </TabsTrigger>
            );
          })}
        </TabsList>
      </Tabs>

      {/* 탭 컨텐츠 (자식 라우트) */}
      <Box>{children}</Box>
    </Container>
  );
}
