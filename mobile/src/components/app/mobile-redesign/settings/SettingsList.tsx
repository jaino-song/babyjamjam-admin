"use client";

import type { ReactElement } from "react";

import {
  SettingsListCard,
  SettingsListItem as SharedSettingsListItem,
  SettingsListRowsSkeleton,
} from "@/components/app/mobile-redesign/settings/SettingsListCard";
import { StatusPill } from "@/components/app/ui/status-badge";
import { Switch } from "@/components/ui/switch";

import type { SettingsListItem } from "./settings-items";

export interface SettingsListProps {
  "data-component": string;
  items: SettingsListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  isLoading: boolean;
  policiesError?: boolean;
  onRetryPolicies?: () => void;
  approvalError?: boolean;
  onRetryApproval?: () => void;
  isApproved: boolean;
}

export function SettingsList({
  "data-component": dataComponent,
  items,
  selectedId,
  onSelect,
  isLoading,
  policiesError = false,
  onRetryPolicies,
  approvalError = false,
  onRetryApproval,
  isApproved,
}: SettingsListProps): ReactElement {
  const sub = (suffix: string) => `${dataComponent}_${suffix}`;

  return (
    <SettingsListCard
      data-component={dataComponent}
      title="설정"
      count={items.length}
      subtitle="메시지에 관련된 설정들을 정할 수 있어요"
    >
        {isLoading ? (
          <SettingsListRowsSkeleton data-component={sub("items_loading")} />
        ) : (
          <>
            {items.map((item) => {
              const itemBase = sub(`item-${item.id}`);
              const isTenantApplication = item.kind === "tenant-application";
              const isSwitchChecked = item.requiresApproval
                ? isApproved && item.active
                : item.active;

              return (
                <SharedSettingsListItem
                  key={item.id}
                  data-component={itemBase}
                  icon={item.icon}
                  title={item.title}
                  subtitle={item.subtitle}
                  isSelected={selectedId === item.id}
                  onSelect={() => onSelect(item.id)}
                  control={isTenantApplication ? (
                    <StatusPill
                      data-component={`${itemBase}_trailing_status`}
                      variant="primary"
                      className="pointer-events-none !rounded-[calc(999px*var(--glint-ui-scale,1))] !border-[calc(1px*var(--glint-ui-scale,1))] !border-v3-primary/15 !bg-v3-primary-light !px-[calc(8px*var(--glint-ui-scale,1))] !py-[calc(4px*var(--glint-ui-scale,1))] !text-[calc(0.62rem*var(--glint-ui-scale,1))] !text-v3-primary"
                    >
                      {item.statusLabel}
                    </StatusPill>
                  ) : (
                    <Switch
                      data-component={`${itemBase}_trailing_switch`}
                      thumbDataComponent={`${itemBase}_trailing_switch_thumb`}
                      aria-label={`${item.title} 활성화`}
                      checked={isSwitchChecked}
                      disabled
                      className="pointer-events-none [--v3-ui-scale:var(--glint-ui-scale,1)]"
                    />
                  )}
                />
              );
            })}

            {approvalError || policiesError ? (
              <div
                data-component={sub("items_query-error")}
                className="flex items-center justify-between gap-[calc(12px*var(--glint-ui-scale,1))] rounded-[calc(14px*var(--glint-ui-scale,1))] border-[calc(1px*var(--glint-ui-scale,1))] border-v3-border bg-v3-dim-white px-[calc(12px*var(--glint-ui-scale,1))] py-[calc(10px*var(--glint-ui-scale,1))]"
                role="alert"
              >
                <span
                  data-component={sub("items_query-error_message")}
                  className="min-w-0 text-[calc(0.68rem*var(--glint-ui-scale,1))] font-semibold leading-[calc(0.95rem*var(--glint-ui-scale,1))] text-v3-text-muted"
                >
                  {approvalError
                    ? "메시지 발송 신청 상태를 불러오지 못했습니다"
                    : "자동 전송 정책을 불러오지 못했습니다"}
                </span>
                <button
                  data-component={sub("items_query-error_retry")}
                  type="button"
                  aria-label={approvalError ? "신청 상태 재시도" : "재시도"}
                  className="min-h-[calc(36px*var(--glint-ui-scale,1))] shrink-0 cursor-pointer rounded-[calc(10px*var(--glint-ui-scale,1))] bg-v3-primary-light px-[calc(10px*var(--glint-ui-scale,1))] text-[calc(0.68rem*var(--glint-ui-scale,1))] font-bold text-v3-primary outline-none transition-colors active:bg-v3-primary/15 focus-visible:ring-[calc(3px*var(--glint-ui-scale,1))] focus-visible:ring-v3-primary/10"
                  onClick={approvalError ? onRetryApproval : onRetryPolicies}
                >
                  재시도
                </button>
              </div>
            ) : null}
          </>
        )}
    </SettingsListCard>
  );
}
