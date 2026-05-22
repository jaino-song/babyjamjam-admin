"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Bell,
  Palette,
  Shield,
  Sun,
  Moon,
  Monitor,
  MessageSquare,
} from "lucide-react";
import { ContentPaper } from "@/components/app/root/content-paper";
import { NotificationTestSection } from "@/components/app/settings/NotificationTestSection";
import { useGetAuthUser } from "@/hooks/useGetAuthUser";
import { useLocale } from "@/providers/LocaleProvider";
import { t } from "@/lib/i18n/translations";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { settingsApi, AlimtalkProvider } from "@/services/api";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Toaster } from "@/components/ui/toaster";

function UserKeyIcon({
  size = 20,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="m16 11 2 2 4-4" />
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
    </svg>
  );
}

const NAV_SECTIONS = [
  { id: "profile", label: "프로필", icon: UserKeyIcon },
  { id: "notifications", label: "알림", icon: Bell },
  { id: "theme", label: "테마", icon: Palette },
  { id: "security", label: "보안", icon: Shield },
] as const;

type SectionId = (typeof NAV_SECTIONS)[number]["id"];

const PROVIDER_OPTIONS: {
  value: AlimtalkProvider;
  label: string;
  description: string;
}[] = [
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

const THEME_OPTIONS = [
  { id: "light", label: "라이트", icon: Sun, description: "밝은 테마" },
  { id: "dark", label: "다크", icon: Moon, description: "어두운 테마" },
  { id: "system", label: "시스템", icon: Monitor, description: "시스템 설정" },
] as const;

export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState<SectionId>("profile");
  const [notifications, setNotifications] = useState(true);
  const [selectedTheme, setSelectedTheme] = useState<string>("light");
  const sectionRefs = useRef<Record<SectionId, HTMLElement | null>>({
    profile: null,
    notifications: null,
    theme: null,
    security: null,
  });

  const { toast } = useToast();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const { data: user } = useGetAuthUser();
  const isOwner = user?.role === "owner";

  const {
    data: alimtalkSettings,
    isLoading: isLoadingAlimtalk,
    error: alimtalkError,
  } = useQuery({
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
    updateAlimtalkMutation.mutate(value as AlimtalkProvider);
  };

  const scrollToSection = useCallback((sectionId: SectionId) => {
    setActiveSection(sectionId);
    const el = sectionRefs.current[sectionId];
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  useEffect(() => {
    const observers: IntersectionObserver[] = [];
    const entries = Object.entries(sectionRefs.current) as [SectionId, HTMLElement | null][];

    for (const [id, el] of entries) {
      if (!el) continue;
      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            setActiveSection(id);
          }
        },
        { rootMargin: "-20% 0px -60% 0px", threshold: 0 }
      );
      observer.observe(el);
      observers.push(observer);
    }

    return () => observers.forEach((o) => o.disconnect());
  }, []);

  return (
    <section data-component="settings" className="space-y-6">
      <div data-component="settings-content" className="flex flex-col lg:flex-row gap-8">
        <nav data-component="settings-nav" className="lg:w-[220px] shrink-0">
          <div className="hidden lg:block sticky top-24">
            <div className="flex flex-col gap-1">
              {NAV_SECTIONS.map((section) => {
                const Icon = section.icon;
                const isActive = activeSection === section.id;
                return (
                  <button
                    key={section.id}
                    onClick={() => scrollToSection(section.id)}
                    className={`flex items-center gap-3 px-4 py-2.5 rounded-2xl text-sm font-medium transition-all duration-200 text-left ${
                      isActive
                        ? "bg-[hsl(var(--v3-primary-light))] text-[hsl(var(--v3-primary))]"
                        : "text-[hsl(var(--v3-text-muted))] hover:bg-[hsl(var(--v3-bg))]"
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {section.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="lg:hidden overflow-x-auto scrollbar-hide -mx-4 px-4">
            <div className="flex gap-2 pb-2">
              {NAV_SECTIONS.map((section) => {
                const Icon = section.icon;
                const isActive = activeSection === section.id;
                return (
                  <button
                    key={section.id}
                    onClick={() => scrollToSection(section.id)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all duration-200 ${
                      isActive
                        ? "bg-[hsl(var(--v3-primary-light))] text-[hsl(var(--v3-primary))]"
                        : "text-[hsl(var(--v3-text-muted))] bg-[hsl(var(--v3-bg))]"
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {section.label}
                  </button>
                );
              })}
            </div>
          </div>
        </nav>

        <div data-component="settings-sections" className="flex-1 flex flex-col gap-8 min-w-0">
          <section
            data-component="settings-profile"
            ref={(el) => { sectionRefs.current.profile = el; }}
            id="section-profile"
          >
            <ContentPaper variant="v3">
              <div className="mb-4 flex items-center gap-3">
              <div className="flex items-center justify-center w-10 h-10 rounded-2xl bg-[hsl(var(--v3-primary))]/10">
                  <UserKeyIcon size={20} className="text-[hsl(var(--v3-primary))]" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-foreground">프로필</h2>
                  <p className="text-sm text-muted-foreground">개인 정보를 관리합니다.</p>
                </div>
              </div>
              <Separator className="mb-6" />

              <div className="flex items-center gap-4 mb-6">
                <div className="w-16 h-16 rounded-full bg-[hsl(var(--v3-primary))]/10 flex items-center justify-center">
                  <UserKeyIcon size={28} className="text-[hsl(var(--v3-primary))]" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {user?.name || "사용자"}
                  </p>
                  <p className="text-xs text-muted-foreground">{user?.role ? t(locale, `roles.${user.role}`) || t(locale, "roles.unknown") : t(locale, "roles.unknown")}</p>
                </div>
              </div>

              <div className="space-y-4">
                <div>
                  <Label htmlFor="profile-name" className="text-sm font-medium">
                    이름
                  </Label>
                  <Input
                    id="profile-name"
                    type="text"
                    defaultValue={user?.name || ""}
                    placeholder="이름을 입력하세요"
                    className="mt-1.5 w-full px-4 py-2.5 rounded-2xl border border-[hsl(var(--v3-border))] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--v3-primary))]/20 focus:border-[hsl(var(--v3-primary))] transition-all"
                  />
                </div>
                <div>
                  <Label htmlFor="profile-email" className="text-sm font-medium">
                    이메일
                  </Label>
                  <Input
                    id="profile-email"
                    type="email"
                    defaultValue={user?.email || ""}
                    placeholder="이메일을 입력하세요"
                    className="mt-1.5 w-full px-4 py-2.5 rounded-2xl border border-[hsl(var(--v3-border))] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--v3-primary))]/20 focus:border-[hsl(var(--v3-primary))] transition-all"
                  />
                </div>
                <div>
                  <Label htmlFor="profile-phone" className="text-sm font-medium">
                    전화번호
                  </Label>
                  <Input
                    id="profile-phone"
                    type="tel"
                    placeholder="전화번호를 입력하세요"
                    className="mt-1.5 w-full px-4 py-2.5 rounded-2xl border border-[hsl(var(--v3-border))] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--v3-primary))]/20 focus:border-[hsl(var(--v3-primary))] transition-all"
                  />
                </div>
              </div>
            </ContentPaper>
          </section>

          <section
            data-component="settings-notifications"
            ref={(el) => { sectionRefs.current.notifications = el; }}
            id="section-notifications"
          >
            <ContentPaper variant="v3">
              <div className="mb-4 flex items-center gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-2xl bg-amber-500/10">
                  <Bell size={20} className="text-amber-500" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-foreground">알림</h2>
                  <p className="text-sm text-muted-foreground">알림 수신 설정을 관리합니다.</p>
                </div>
              </div>
              <Separator className="mb-4" />

              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 rounded-2xl hover:bg-muted/50 transition-colors">
                  <div className="space-y-0.5">
                    <Label htmlFor="notif-email" className="text-sm font-medium">
                      이메일 알림
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      시스템 알림 및 중요 업데이트를 이메일로 수신합니다.
                    </p>
                  </div>
                  <Switch
                    variant="v3"
                    id="notif-email"
                    checked={notifications}
                    onCheckedChange={setNotifications}
                  />
                </div>

                <div className="p-3 rounded-2xl">
                  <div className="flex items-center gap-2 mb-3">
                    <MessageSquare size={16} className="text-amber-500" />
                    <Label className="text-sm font-medium">알림톡 서비스</Label>
                  </div>
                  <p className="text-sm text-muted-foreground mb-3">
                    카카오 알림톡 발송 서비스를 선택합니다.
                  </p>

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
                      {PROVIDER_OPTIONS.map((option) => (
                        <div
                          key={option.value}
                          className="flex items-start space-x-3 p-3 rounded-2xl transition-all hover:bg-muted/50"
                        >
                          <RadioGroupItem
                            value={option.value}
                            id={`alimtalk-${option.value}`}
                            disabled={updateAlimtalkMutation.isPending}
                            className="mt-1"
                          />
                          <div className="grid gap-1">
                            <Label
                              htmlFor={`alimtalk-${option.value}`}
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
                      마지막 수정:{" "}
                      {new Date(alimtalkSettings.updatedAt).toLocaleString("ko-KR")}
                    </p>
                  )}
                </div>
              </div>

              {isOwner && (
                <>
                  <Separator className="my-4" />
                  <NotificationTestSection />
                </>
              )}
            </ContentPaper>
          </section>

          <section
            data-component="settings-theme"
            ref={(el) => { sectionRefs.current.theme = el; }}
            id="section-theme"
          >
            <ContentPaper variant="v3">
              <div className="mb-4 flex items-center gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-2xl bg-violet-500/10">
                  <Palette size={20} className="text-violet-500" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-foreground">테마</h2>
                  <p className="text-sm text-muted-foreground">화면 테마를 선택합니다.</p>
                </div>
              </div>
              <Separator className="mb-6" />

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {THEME_OPTIONS.map((theme) => {
                  const Icon = theme.icon;
                  const isSelected = selectedTheme === theme.id;
                  return (
                    <button
                      key={theme.id}
                      onClick={() => setSelectedTheme(theme.id)}
                      disabled={theme.id === "dark"}
                      className={`relative flex flex-col items-center gap-3 p-6 rounded-2xl border-2 transition-all duration-200 ${
                        isSelected
                          ? "border-[hsl(var(--v3-primary))] bg-[hsl(var(--v3-primary))]/5"
                          : "border-[hsl(var(--v3-border))] hover:border-[hsl(var(--v3-primary))]/30"
                      } ${theme.id === "dark" ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                    >
                      <div
                        className={`w-12 h-12 rounded-full flex items-center justify-center ${
                          isSelected
                            ? "bg-[hsl(var(--v3-primary))]/10"
                            : "bg-muted/50"
                        }`}
                      >
                        <Icon
                          size={24}
                          className={
                            isSelected
                              ? "text-[hsl(var(--v3-primary))]"
                              : "text-muted-foreground"
                          }
                        />
                      </div>
                      <div className="text-center">
                        <p className="text-sm font-medium">{theme.label}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {theme.description}
                        </p>
                      </div>
                      {theme.id === "dark" && (
                        <span className="absolute top-2 right-2 text-[10px] bg-muted px-2 py-0.5 rounded-full text-muted-foreground">
                          준비 중
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </ContentPaper>
          </section>

          <section
            data-component="settings-security"
            ref={(el) => { sectionRefs.current.security = el; }}
            id="section-security"
          >
            <ContentPaper variant="v3">
              <div className="mb-4 flex items-center gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-2xl bg-red-500/10">
                  <Shield size={20} className="text-red-500" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-foreground">보안</h2>
                  <p className="text-sm text-muted-foreground">계정 보안 설정을 관리합니다.</p>
                </div>
              </div>
              <Separator className="mb-6" />

              <div className="space-y-4">
                <div>
                  <Label htmlFor="current-password" className="text-sm font-medium">
                    현재 비밀번호
                  </Label>
                  <Input
                    id="current-password"
                    type="password"
                    placeholder="현재 비밀번호를 입력하세요"
                    className="mt-1.5 w-full px-4 py-2.5 rounded-2xl border border-[hsl(var(--v3-border))] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--v3-primary))]/20 focus:border-[hsl(var(--v3-primary))] transition-all"
                  />
                </div>
                <div>
                  <Label htmlFor="new-password" className="text-sm font-medium">
                    새 비밀번호
                  </Label>
                  <Input
                    id="new-password"
                    type="password"
                    placeholder="새 비밀번호를 입력하세요"
                    className="mt-1.5 w-full px-4 py-2.5 rounded-2xl border border-[hsl(var(--v3-border))] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--v3-primary))]/20 focus:border-[hsl(var(--v3-primary))] transition-all"
                  />
                </div>
                <div>
                  <Label htmlFor="confirm-password" className="text-sm font-medium">
                    비밀번호 확인
                  </Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    placeholder="새 비밀번호를 다시 입력하세요"
                    className="mt-1.5 w-full px-4 py-2.5 rounded-2xl border border-[hsl(var(--v3-border))] bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--v3-primary))]/20 focus:border-[hsl(var(--v3-primary))] transition-all"
                  />
                </div>

                <Separator className="my-2" />

                <div className="flex items-center justify-between p-3 rounded-2xl hover:bg-muted/50 transition-colors">
                  <div className="space-y-0.5">
                    <Label htmlFor="two-factor" className="text-sm font-medium text-muted-foreground">
                      2단계 인증 (준비 중)
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      로그인 시 추가 인증을 요구합니다. (추후 지원 예정)
                    </p>
                  </div>
                  <Switch variant="v3" id="two-factor" checked={false} disabled />
                </div>
              </div>
            </ContentPaper>
          </section>

        </div>
      </div>

      <Toaster />
    </section>
  );
}
