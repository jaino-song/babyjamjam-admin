"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, Mail, MessageSquare, Send, type LucideIcon } from "lucide-react";

import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Toaster } from "@/components/ui/toaster";
import { useGetAuthUser } from "@/hooks/useGetAuthUser";
import { usePushNotification } from "@/hooks/usePushNotification";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api/client";
import { safeStorageGetItem, safeStorageSetItem } from "@/lib/safe-storage";
import { useInitialUser } from "@/providers/UserProvider";
import { type AlimtalkProvider, type AlimtalkProviderResponse, settingsApi } from "@/services/api";
import "@/components/app/mobile-redesign/redesign.css";

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

const EMAIL_NOTIFICATION_STORAGE_PREFIX = "settings:email-notifications";
const NOTIFICATION_ROUTE_BODY_CLASS = "mobile-all-route";
const ALIMTALK_PROVIDER_QUERY_KEY = ["settings", "alimtalk-provider"] as const;
const KOREA_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

interface BroadcastResult {
  sent: number;
  failed: number;
}

interface NotificationSettingsRowProps {
  label: string;
  icon: LucideIcon;
  tone: "primary" | "orange" | "green" | "purple" | "muted" | "burgundy";
  description: ReactNode;
  rightContent?: ReactNode;
  className?: string;
}

function emailNotificationStorageKey(userId: string) {
  return `${EMAIL_NOTIFICATION_STORAGE_PREFIX}:${userId}`;
}

function formatKoreaDateTime(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return KOREA_DATE_TIME_FORMATTER.format(date);
}

function providerTone(value: AlimtalkProvider): "primary" | "orange" | "muted" {
  if (value === "aligo") return "primary";
  if (value === "channeltalk") return "orange";
  return "muted";
}

function NotificationSettingsRow({
  label,
  icon: Icon,
  tone,
  description,
  rightContent,
  className,
}: NotificationSettingsRowProps) {
  return (
    <div
      className={`list-item notification-settings-row ${className ?? ""}`}
      data-component="notification-settings-row"
    >
      <div
        className={`trigger-icon trigger-icon-${tone}`}
        data-component="notification-settings-row-icon"
      >
        <Icon size={18} strokeWidth={2.5} />
      </div>

      <div className="trigger-info" data-component="notification-settings-row-info">
        <div className="trigger-title" data-component="notification-settings-row-title">
          {label}
        </div>
        <div className="trigger-meta" data-component="notification-settings-row-meta">
          {description}
        </div>
      </div>

      {rightContent ? (
        <div className="notification-row-control" data-component="notification-settings-row-control">
          {rightContent}
        </div>
      ) : null}
    </div>
  );
}

interface ProviderSettingsRowProps {
  option: (typeof PROVIDER_OPTIONS)[number];
  isSelected: boolean;
  isDisabled: boolean;
  onSelect: (value: AlimtalkProvider) => void;
}

function ProviderSettingsRow({
  option,
  isSelected,
  isDisabled,
  onSelect,
}: ProviderSettingsRowProps) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={isSelected}
      aria-label={`${option.label} 선택`}
      disabled={isDisabled}
      className={`list-item notification-settings-row notification-settings-row-button ${
        isSelected ? "notification-settings-row-selected" : ""
      }`}
      data-component="notification-settings-row"
      onClick={() => onSelect(option.value)}
    >
      <div
        className={`trigger-icon trigger-icon-${providerTone(option.value)}`}
        data-component="notification-settings-row-icon"
      >
        <MessageSquare size={18} strokeWidth={2.5} />
      </div>

      <div className="trigger-info" data-component="notification-settings-row-info">
        <div className="trigger-title" data-component="notification-settings-row-title">
          {option.label}
        </div>
        <div className="trigger-meta" data-component="notification-settings-row-meta">
          {option.description}
        </div>
      </div>

      <div className="notification-row-control" data-component="notification-settings-row-control">
        <span
          className="notification-radio-indicator"
          data-state={isSelected ? "checked" : "unchecked"}
          aria-hidden="true"
        >
          {isSelected ? <span className="notification-radio-dot" /> : null}
        </span>
      </div>
    </button>
  );
}

export default function NotificationPage() {
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [isAppNotificationUpdating, setIsAppNotificationUpdating] = useState(false);

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const initialUser = useInitialUser();
  const { data: user } = useGetAuthUser({ initialData: initialUser });
  const {
    isSupported: isAppNotificationSupported,
    isSubscribed: isAppNotificationEnabled,
    permission: appNotificationPermission,
    isLoading: isAppNotificationLoading,
    error: appNotificationError,
    subscribe: subscribeAppNotifications,
    unsubscribe: unsubscribeAppNotifications,
  } = usePushNotification();
  const isOwner = user?.role === "owner";
  const accountEmail = user?.email?.trim() ?? "";
  const emailNotificationStorageId = user?.id ?? "";
  const appNotificationDisabled =
    isAppNotificationLoading
    || isAppNotificationUpdating
    || !isAppNotificationSupported
    || appNotificationPermission === "denied";
  const appNotificationDescription = !isAppNotificationSupported
    ? "이 브라우저는 앱 알림을 지원하지 않습니다."
    : appNotificationPermission === "denied"
      ? "브라우저에서 알림 권한이 차단되어 있습니다."
      : isAppNotificationEnabled
        ? "앱에서 중요한 업무 알림을 받고 있습니다."
        : "앱에서 중요한 업무 알림을 받지 않습니다.";
  const emailNotificationDescription = accountEmail
    ? `${accountEmail}로 주요 알림을 받습니다.`
    : "현재 계정 이메일을 불러오는 중입니다.";

  const {
    data: alimtalkSettings,
    isLoading: isLoadingAlimtalk,
    error: alimtalkError,
  } = useQuery({
    queryKey: ALIMTALK_PROVIDER_QUERY_KEY,
    queryFn: settingsApi.getAlimtalkProvider,
  });
  const selectedAlimtalkProvider = alimtalkSettings?.provider || "aligo";
  const alimtalkUpdatedAtText = alimtalkSettings?.updatedAt
    ? formatKoreaDateTime(alimtalkSettings.updatedAt)
    : null;

  const updateAlimtalkMutation = useMutation({
    mutationFn: settingsApi.updateAlimtalkProvider,
    onMutate: async (provider) => {
      await queryClient.cancelQueries({ queryKey: ALIMTALK_PROVIDER_QUERY_KEY });
      const previous = queryClient.getQueryData<AlimtalkProviderResponse>(ALIMTALK_PROVIDER_QUERY_KEY);

      queryClient.setQueryData<AlimtalkProviderResponse>(
        ALIMTALK_PROVIDER_QUERY_KEY,
        (current) => ({
          ...(current ?? { updatedAt: undefined }),
          provider,
          enabled: provider !== "none",
        }),
      );

      return { previous };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(ALIMTALK_PROVIDER_QUERY_KEY, data);
      toast({
        title: "설정 저장됨",
        description: "알림톡 설정이 저장되었습니다.",
      });
    },
    onError: (_error, _provider, context) => {
      if (context?.previous) {
        queryClient.setQueryData(ALIMTALK_PROVIDER_QUERY_KEY, context.previous);
      }

      toast({
        title: "오류",
        description: "설정 저장에 실패했습니다. 다시 시도해주세요.",
        variant: "destructive",
      });
    },
  });

  const testNotificationMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<BroadcastResult>("/notifications/test-broadcast");
      return data;
    },
    onSuccess: (data) => {
      toast({
        title: "테스트 알림 전송 완료",
        description: `성공 ${data.sent}건 · 실패 ${data.failed}건`,
      });
    },
    onError: () => {
      toast({
        title: "테스트 알림 실패",
        description: "알림 전송에 실패했습니다.",
        variant: "destructive",
      });
    },
  });

  const handleProviderChange = (value: AlimtalkProvider) => {
    if (value === selectedAlimtalkProvider || updateAlimtalkMutation.isPending) return;
    updateAlimtalkMutation.mutate(value);
  };

  const handleAppNotificationChange = async (checked: boolean) => {
    setIsAppNotificationUpdating(true);
    const success = checked
      ? await subscribeAppNotifications()
      : await unsubscribeAppNotifications();
    setIsAppNotificationUpdating(false);

    if (!success) {
      toast({
        title: "앱 알림 설정 실패",
        description: checked
          ? "앱 알림을 켜지 못했습니다. 브라우저 알림 권한을 확인해주세요."
          : "앱 알림을 끄지 못했습니다. 잠시 후 다시 시도해주세요.",
        variant: "destructive",
      });
    }
  };

  const handleEmailNotificationChange = (checked: boolean) => {
    setEmailNotifications(checked);
    if (emailNotificationStorageId) {
      safeStorageSetItem(
        "local",
        emailNotificationStorageKey(emailNotificationStorageId),
        checked ? "true" : "false",
      );
    }
  };

  useEffect(() => {
    document.body.classList.add(NOTIFICATION_ROUTE_BODY_CLASS);

    return () => {
      document.body.classList.remove(NOTIFICATION_ROUTE_BODY_CLASS);
    };
  }, []);

  useEffect(() => {
    if (!emailNotificationStorageId) return;

    window.requestAnimationFrame(() => {
      const stored = safeStorageGetItem(
        "local",
        emailNotificationStorageKey(emailNotificationStorageId),
      );
      if (stored === null) return;
      setEmailNotifications(stored === "true");
    });
  }, [emailNotificationStorageId]);

  return (
    <section data-component="notification-settings" className="alimtalk-page notification-settings-page">
      <div className="shell-content" data-component="notification-settings-content">
        <div className="list-card pop-up notification-settings-card" data-component="notification-settings-card">
          <div className="list-title" data-component="notification-settings-card-title">
            <span className="list-title-text">알림 설정</span>
          </div>

          <div className="list-card-scroll" data-component="notification-settings-scroll">
            <div className="section-block" data-component="notification-settings-channel-section">
              <div className="section-header" data-component="notification-settings-section-header">
                수신 채널
              </div>

              <NotificationSettingsRow
                label="앱 알림"
                icon={BellRing}
                tone={isAppNotificationEnabled ? "primary" : "muted"}
                description={(
                  <>
                    {appNotificationDescription}
                    {appNotificationError ? (
                      <span className="notification-row-error">{appNotificationError}</span>
                    ) : null}
                  </>
                )}
                rightContent={(
                  <Switch
                    variant="v3"
                    id="notif-app"
                    checked={isAppNotificationEnabled}
                    onCheckedChange={handleAppNotificationChange}
                    disabled={appNotificationDisabled}
                    aria-label="앱 알림 설정"
                  />
                )}
              />

              <NotificationSettingsRow
                label="이메일 알림"
                icon={Mail}
                tone="orange"
                description={emailNotificationDescription}
                rightContent={(
                  <Switch
                    variant="v3"
                    id="notif-email"
                    checked={emailNotifications && Boolean(accountEmail)}
                    onCheckedChange={handleEmailNotificationChange}
                    disabled={!accountEmail}
                    aria-label="이메일 알림 설정"
                  />
                )}
              />
            </div>

            <div className="section-block" data-component="notification-settings-alimtalk-section">
              <div className="section-header" data-component="notification-settings-section-header">
                알림톡 서비스
              </div>

              {isLoadingAlimtalk ? (
                <NotificationSettingsRow
                  label="설정 불러오는 중"
                  icon={MessageSquare}
                  tone="muted"
                  description="알림톡 발송 서비스 설정을 확인하고 있습니다."
                  rightContent={<Spinner className="h-5 w-5" />}
                />
              ) : alimtalkError ? (
                <NotificationSettingsRow
                  label="설정을 불러오지 못했습니다"
                  icon={MessageSquare}
                  tone="burgundy"
                  description="잠시 후 다시 시도해주세요."
                />
              ) : (
                <div
                  role="radiogroup"
                  className="notification-provider-group"
                  data-component="settings-alimtalk-provider"
                >
                  {PROVIDER_OPTIONS.map((option) => {
                    return (
                      <ProviderSettingsRow
                        key={option.value}
                        option={option}
                        isSelected={selectedAlimtalkProvider === option.value}
                        isDisabled={updateAlimtalkMutation.isPending}
                        onSelect={handleProviderChange}
                      />
                    );
                  })}
                </div>
              )}

              {alimtalkUpdatedAtText ? (
                <div className="notification-updated-at" data-component="notification-alimtalk-updated-at">
                  마지막 수정: {alimtalkUpdatedAtText}
                </div>
              ) : null}
            </div>

            {isOwner ? (
              <div className="section-block" data-component="notification-settings-admin-section">
                <div className="section-header" data-component="notification-settings-section-header">
                  관리자
                </div>

                <NotificationSettingsRow
                  label="테스트 알림"
                  icon={Send}
                  tone="primary"
                  description="모든 구독된 디바이스에 테스트 알림을 전송합니다."
                  rightContent={(
                    <button
                      type="button"
                      data-component="notification-test-send-button"
                      className="notification-action-pill"
                      onClick={() => testNotificationMutation.mutate()}
                      disabled={testNotificationMutation.isPending}
                    >
                      {testNotificationMutation.isPending ? "전송 중" : "발송"}
                    </button>
                  )}
                />
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <Toaster />
    </section>
  );
}
