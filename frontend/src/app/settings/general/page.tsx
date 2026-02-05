"use client";

import { useState } from "react";
import { ContentPaper } from "@/app/(components)/root/content-paper";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { settingsApi, AlimtalkProvider } from "@/services/api";
import { MessageSquare } from "lucide-react";
import { useGetAuthUser } from "@/app/hooks/useGetAuthUser";
import { NotificationTestSection } from "@/app/(components)/settings/NotificationTestSection";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { useToast } from "@/app/hooks/use-toast";
import { Toaster } from "@/components/ui/toaster";

const PROVIDER_OPTIONS: { value: AlimtalkProvider; label: string; description: string }[] = [
  {
    value: "aligo",
    label: "알리고 (Aligo)",
    description: "알리고 알림톡 API를 통해 카카오 알림톡을 발송합니다.",
  },
  {
    value: "channeltalk",
    label: "채널톡 (Channel Talk)",
    description: "채널톡 마케팅 자동화를 통해 알림톡을 발송합니다.",
  },
  {
    value: "none",
    label: "사용 안함",
    description: "알림톡 발송을 비활성화합니다.",
  },
];

export default function GeneralSettingsPage() {
  const [notifications, setNotifications] = useState(true);
  const [darkMode, setDarkMode] = useState(false);
  const { toast } = useToast();

  const queryClient = useQueryClient();
  const { data: user } = useGetAuthUser();
  const isOwner = user?.role === 'owner';

  const { data: alimtalkSettings, isLoading: isLoadingAlimtalk, error: alimtalkError } = useQuery({
    queryKey: ["settings", "alimtalk-provider"],
    queryFn: settingsApi.getAlimtalkProvider,
  });

  const updateAlimtalkMutation = useMutation({
    mutationFn: settingsApi.updateAlimtalkProvider,
    onSuccess: (data) => {
      queryClient.setQueryData(["settings", "alimtalk-provider"], data);
      toast({
        title: "설정 저장됨",
        description: "알림톡 설정이 저장되었습니다.",
      });
    },
    onError: () => {
      toast({
        title: "오류",
        description: "설정 저장에 실패했습니다. 다시 시도해주세요.",
        variant: "destructive",
      });
    },
  });

  const handleProviderChange = (value: string) => {
    const newProvider = value as AlimtalkProvider;
    updateAlimtalkMutation.mutate(newProvider);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* 알림톡 설정 카드 */}
      <ContentPaper className="opacity-0 animate-fade-in" style={{ animationDelay: "100ms" }}>
        <div className="mb-4 flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-warning/10">
            <MessageSquare size={20} className="text-warning" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">알림톡 설정</h2>
            <p className="text-sm text-muted-foreground">
              카카오 알림톡 발송 서비스를 선택합니다.
            </p>
          </div>
        </div>

        <Separator className="mb-4" />

        {isLoadingAlimtalk ? (
          <div className="flex justify-center py-6">
            <Spinner className="h-6 w-6" />
          </div>
        ) : alimtalkError ? (
          <Alert variant="destructive">
            <AlertDescription>설정을 불러오는데 실패했습니다.</AlertDescription>
          </Alert>
        ) : (
          <RadioGroup
            value={alimtalkSettings?.provider || "aligo"}
            onValueChange={handleProviderChange}
            className="space-y-3"
          >
            {PROVIDER_OPTIONS.map((option, index) => (
              <div
                key={option.value}
                className="flex items-start space-x-3 opacity-0 animate-fade-in"
                style={{ animationDelay: `${200 + index * 50}ms` }}
              >
                <RadioGroupItem
                  value={option.value}
                  id={option.value}
                  disabled={updateAlimtalkMutation.isPending}
                  className="mt-1"
                />
                <div className="grid gap-1">
                  <Label
                    htmlFor={option.value}
                    className="font-medium cursor-pointer"
                  >
                    {option.label}
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    {option.description}
                  </p>
                </div>
              </div>
            ))}
          </RadioGroup>
        )}

        {alimtalkSettings?.updatedAt && (
          <p className="text-xs text-muted-foreground mt-4">
            마지막 수정: {new Date(alimtalkSettings.updatedAt).toLocaleString("ko-KR")}
          </p>
        )}
      </ContentPaper>

      {/* 기타 설정 카드 */}
      <ContentPaper className="opacity-0 animate-fade-in" style={{ animationDelay: "200ms" }}>
        <div className="mb-4">
          <h2 className="text-lg font-semibold">기타 설정</h2>
          <p className="text-sm text-muted-foreground">
            시스템 환경 설정을 관리합니다.
          </p>
        </div>

        <Separator className="mb-4" />

        <div className="space-y-4">
          {/* 알림 수신 */}
          <div className="flex items-center justify-between opacity-0 animate-fade-in" style={{ animationDelay: "250ms" }}>
            <div className="space-y-0.5">
              <Label htmlFor="notifications" className="text-sm font-medium">
                알림 수신
              </Label>
              <p className="text-sm text-muted-foreground">
                시스템 알림 및 중요 업데이트를 이메일로 수신합니다.
              </p>
            </div>
            <Switch
              id="notifications"
              checked={notifications}
              onCheckedChange={setNotifications}
            />
          </div>

          {/* 다크 모드 */}
          <div className="flex items-center justify-between opacity-0 animate-fade-in" style={{ animationDelay: "300ms" }}>
            <div className="space-y-0.5">
              <Label htmlFor="dark-mode" className="text-sm font-medium text-muted-foreground">
                다크 모드 (준비 중)
              </Label>
              <p className="text-sm text-muted-foreground">
                어두운 테마로 전환합니다. (추후 지원 예정)
              </p>
            </div>
            <Switch
              id="dark-mode"
              checked={darkMode}
              onCheckedChange={setDarkMode}
              disabled
            />
          </div>
        </div>
      </ContentPaper>

      {/* 알림 테스트 (Owner만 표시) */}
      {isOwner && (
        <ContentPaper className="opacity-0 animate-fade-in" style={{ animationDelay: "300ms" }}>
          <NotificationTestSection />
        </ContentPaper>
      )}

      <Toaster />
    </div>
  );
}
