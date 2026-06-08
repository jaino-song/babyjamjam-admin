"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BellRing,
  CalendarClock,
  CalendarRange,
  CheckCircle2,
  Plus,
  Save,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import {
  SplitLayout,
  ListPanel,
  DetailPanel,
  DetailSkeleton,
  AnimatedSlotList,
  HeaderActionButton,
  ListEmptyState,
} from "@/components/app/v3";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { settingsApi, type AlimtalkProvider } from "@/services/api";
import { useToast } from "@/hooks/use-toast";
import {
  useAlimtalkTriggerRules,
  useAlimtalkTriggerTemplates,
  useCreateAlimtalkTriggerRule,
  useUpdateAlimtalkTriggerRule,
  useDeleteAlimtalkTriggerRule,
} from "@/features/alimtalk-triggers/hooks/use-alimtalk-triggers";
import type {
  AlimtalkTriggerRule,
  CreateAlimtalkTriggerRuleDto,
  TriggerEventType,
  TriggerOffsetType,
  TriggerRecipientType,
  TriggerTemplateCatalogItem,
  TriggerTemplateKey,
} from "@/features/alimtalk-triggers/types";

type RuleSelection = string | "new" | null;
type RuleStatusFilter = "active" | "inactive";

type RuleFormState = CreateAlimtalkTriggerRuleDto;

type RuleListItem = {
  id: string;
  title: string;
  subtitle: string;
  active: boolean;
  icon: typeof BellRing;
};

const INPUT_CLASS =
  "mt-1.5 w-full rounded-[14px] border border-v3-border bg-white px-3.5 py-2.5 text-[0.8rem] text-v3-dark placeholder:text-v3-text-muted/60 focus:outline-none focus:ring-2 focus:ring-v3-primary/25 focus:border-v3-primary transition-colors";

const EVENT_OPTIONS: Array<{ value: TriggerEventType; label: string; icon: typeof BellRing }> = [
  { value: "CLIENT_CREATED", label: "고객 등록", icon: UserPlus },
  { value: "SERVICE_START", label: "서비스 시작", icon: CalendarClock },
  { value: "SERVICE_END", label: "서비스 종료", icon: CalendarRange },
  { value: "EMPLOYEE_ASSIGNED", label: "직원 배정", icon: Users },
];

const OFFSET_OPTIONS: Record<TriggerEventType, Array<{ value: TriggerOffsetType; label: string }>> = {
  CLIENT_CREATED: [
    { value: "IMMEDIATE", label: "즉시 발송" },
    { value: "AFTER_DAYS", label: "등록 후 N일" },
  ],
  SERVICE_START: [
    { value: "SAME_DAY", label: "시작 당일" },
    { value: "BEFORE_DAYS", label: "시작 N일 전" },
    { value: "AFTER_DAYS", label: "시작 N일 후" },
  ],
  SERVICE_END: [
    { value: "SAME_DAY", label: "종료 당일" },
    { value: "BEFORE_DAYS", label: "종료 N일 전" },
    { value: "AFTER_DAYS", label: "종료 N일 후" },
  ],
  EMPLOYEE_ASSIGNED: [{ value: "IMMEDIATE", label: "즉시 발송" }],
};

const RECIPIENT_OPTIONS: Record<TriggerEventType, Array<{ value: TriggerRecipientType; label: string }>> = {
  CLIENT_CREATED: [{ value: "CLIENT", label: "고객" }],
  SERVICE_START: [{ value: "CLIENT", label: "고객" }],
  SERVICE_END: [{ value: "CLIENT", label: "고객" }],
  EMPLOYEE_ASSIGNED: [
    { value: "PRIMARY_EMPLOYEE", label: "주 담당 직원" },
    { value: "SECONDARY_EMPLOYEE", label: "보조 직원" },
  ],
};

const DEFAULT_FORM_STATE: RuleFormState = {
  name: "",
  isActive: true,
  eventType: "CLIENT_CREATED",
  offsetType: "IMMEDIATE",
  offsetDays: 0,
  recipientType: "CLIENT",
  templateKey: "CLIENT_WELCOME",
};

const RULE_STATUS_TABS = [
  { label: "활성화", value: "active" },
  { label: "비활성화", value: "inactive" },
] as const;

const TRIGGER_RULE_APPROVAL_MESSAGE =
  "메시지 발송 승인 후에 설정 가능합니다. 설정에서 메시지 발송 기능을 신청해 주세요.";

function toFormState(rule: AlimtalkTriggerRule | null): RuleFormState {
  if (!rule) return DEFAULT_FORM_STATE;
  return {
    name: rule.name,
    isActive: rule.isActive,
    eventType: rule.eventType,
    offsetType: rule.offsetType,
    offsetDays: rule.offsetDays,
    recipientType: rule.recipientType,
    templateKey: rule.templateKey,
  };
}

function normalizeDto(dto: RuleFormState): CreateAlimtalkTriggerRuleDto {
  return {
    ...dto,
    offsetDays:
      dto.offsetType === "BEFORE_DAYS" || dto.offsetType === "AFTER_DAYS"
        ? Number(dto.offsetDays || 0)
        : 0,
  };
}

function getRuleSummary(rule: RuleFormState) {
  const eventLabel = EVENT_OPTIONS.find((option) => option.value === rule.eventType)?.label ?? rule.eventType;
  const recipientLabel =
    RECIPIENT_OPTIONS[rule.eventType].find((option) => option.value === rule.recipientType)?.label ??
    rule.recipientType;

  let timingLabel = OFFSET_OPTIONS[rule.eventType].find((option) => option.value === rule.offsetType)?.label ?? rule.offsetType;
  if (rule.offsetType === "BEFORE_DAYS" || rule.offsetType === "AFTER_DAYS") {
    timingLabel = `${timingLabel.replace("N", String(rule.offsetDays || 0))}`;
  }

  return `${eventLabel} · ${timingLabel} · ${recipientLabel}`;
}

function getRuleIcon(eventType: TriggerEventType) {
  return EVENT_OPTIONS.find((option) => option.value === eventType)?.icon ?? BellRing;
}

function TriggerRulesDetailSkeleton({ dataComponentPrefix = "alimtalk" }: { dataComponentPrefix?: string }) {
  return (
    <DetailSkeleton
      name={`${dataComponentPrefix}-trigger-rules-detail-skeleton`}
      headerActions={1}
      headerBanner
      sections={[
        { titleWidth: "w-24", rows: ["w-2/3"] },
        { titleWidth: "w-20", rows: ["w-full", "w-full"] },
        { titleWidth: "w-20", rows: ["w-5/6", "w-2/3"] },
      ]}
    />
  );
}

export function TriggerRulesManager({ dataComponentPrefix = "alimtalk" }: { dataComponentPrefix?: string } = {}) {
  const { toast } = useToast();
  const [selectedRuleId, setSelectedRuleId] = useState<RuleSelection>(null);
  const [statusFilter, setStatusFilter] = useState<RuleStatusFilter>("active");
  const [formState, setFormState] = useState<RuleFormState>(DEFAULT_FORM_STATE);
  const component = (suffix: string) => `${dataComponentPrefix}-${suffix}`;

  const { data: rulesData = [], isLoading } = useAlimtalkTriggerRules();
  const createMutation = useCreateAlimtalkTriggerRule();
  const updateMutation = useUpdateAlimtalkTriggerRule();
  const deleteMutation = useDeleteAlimtalkTriggerRule();

  const rules = useMemo(() => (Array.isArray(rulesData) ? rulesData : []), [rulesData]);

  const { data: providerSettings } = useQuery({
    queryKey: ["settings", "alimtalk-provider"],
    queryFn: settingsApi.getAlimtalkProvider,
  });
  const { data: senderApproval, isLoading: isSenderApprovalLoading } = useQuery({
    queryKey: ["settings", "message-sender-approval"],
    queryFn: settingsApi.getMessageSenderApproval,
  });
  const isTriggerRulesLocked = !isSenderApprovalLoading && senderApproval?.isApproved === false;
  const effectiveSelectedRuleId = isTriggerRulesLocked ? null : selectedRuleId;

  const resolvedProvider: Exclude<AlimtalkProvider, "none"> =
    providerSettings?.provider === "channeltalk" ? "channeltalk" : "aligo";

  const selectedRule =
    effectiveSelectedRuleId && effectiveSelectedRuleId !== "new"
      ? rules.find((rule) => rule.id === effectiveSelectedRuleId) ?? null
      : null;

  const templateQuery = useAlimtalkTriggerTemplates({
    provider: resolvedProvider,
    eventType: formState.eventType,
    recipientType: formState.recipientType,
  });

  const availableTemplates = useMemo(() => templateQuery.data ?? [], [templateQuery.data]);
  const filteredRules = useMemo(() => {
    return rules.filter((rule) => rule.isActive === (statusFilter === "active"));
  }, [rules, statusFilter]);

  useEffect(() => {
    if (isTriggerRulesLocked) return;

    if (selectedRuleId === "new") return;
    if (selectedRuleId === null && filteredRules.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedRuleId(filteredRules[0].id);
      return;
    }
    if (!selectedRuleId) return;

    const existsInRules = rules.some((rule) => rule.id === selectedRuleId);
    if (!existsInRules) {
      setSelectedRuleId(filteredRules[0]?.id ?? null);
      return;
    }

    const existsInFilteredRules = filteredRules.some((rule) => rule.id === selectedRuleId);
    if (!existsInFilteredRules) {
      setSelectedRuleId(filteredRules[0]?.id ?? null);
    }
  }, [filteredRules, isTriggerRulesLocked, rules, selectedRuleId]);

  useEffect(() => {
    if (effectiveSelectedRuleId === "new") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFormState(DEFAULT_FORM_STATE);
      return;
    }
    setFormState(toFormState(selectedRule));
  }, [effectiveSelectedRuleId, selectedRule]);

  useEffect(() => {
    const allowedRecipients = RECIPIENT_OPTIONS[formState.eventType];
    if (!allowedRecipients.some((option) => option.value === formState.recipientType)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFormState((current) => ({
        ...current,
        recipientType: allowedRecipients[0].value,
      }));
    }

    const allowedOffsets = OFFSET_OPTIONS[formState.eventType];
    if (!allowedOffsets.some((option) => option.value === formState.offsetType)) {
      setFormState((current) => ({
        ...current,
        offsetType: allowedOffsets[0].value,
        offsetDays: 0,
      }));
    }
  }, [formState.eventType, formState.recipientType, formState.offsetType]);

  useEffect(() => {
    if (availableTemplates.length === 0) return;
    if (!availableTemplates.some((template) => template.key === formState.templateKey)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFormState((current) => ({
        ...current,
        templateKey: availableTemplates[0].key,
      }));
    }
  }, [availableTemplates, formState.templateKey]);

  const listItems = useMemo<RuleListItem[]>(() => {
    return filteredRules.map((rule) => ({
      id: rule.id,
      title: rule.name,
      subtitle: getRuleSummary(toFormState(rule)),
      active: rule.isActive,
      icon: getRuleIcon(rule.eventType),
    }));
  }, [filteredRules]);

  const currentTemplate = useMemo<TriggerTemplateCatalogItem | null>(() => {
    return availableTemplates.find((template) => template.key === formState.templateKey) ?? null;
  }, [availableTemplates, formState.templateKey]);

  const hasChanges = useMemo(() => {
    if (effectiveSelectedRuleId === "new") {
      return !!formState.name.trim();
    }
    if (!selectedRule) return false;
    return JSON.stringify(normalizeDto(formState)) !== JSON.stringify(normalizeDto(toFormState(selectedRule)));
  }, [effectiveSelectedRuleId, formState, selectedRule]);

  const isSaving = createMutation.isPending || updateMutation.isPending;

  const handleCreateNew = () => {
    if (isTriggerRulesLocked) return;
    setStatusFilter("active");
    setSelectedRuleId("new");
    setFormState(DEFAULT_FORM_STATE);
  };

  const handleSave = async () => {
    if (isTriggerRulesLocked) return;
    const dto = normalizeDto(formState);

    if (!dto.name.trim()) {
      toast({ variant: "destructive", description: "규칙 이름을 입력해 주세요." });
      return;
    }

    if ((dto.offsetType === "BEFORE_DAYS" || dto.offsetType === "AFTER_DAYS") && (!dto.offsetDays || dto.offsetDays < 1)) {
      toast({ variant: "destructive", description: "일수는 1 이상이어야 합니다." });
      return;
    }

    try {
      if (selectedRuleId === "new" || !selectedRule) {
        const created = await createMutation.mutateAsync(dto);
        setSelectedRuleId(created.id);
        toast({ description: "발송 규칙이 생성되었습니다." });
      } else {
        await updateMutation.mutateAsync({ id: selectedRule.id, dto });
        toast({ description: "발송 규칙이 저장되었습니다." });
      }
    } catch {
      toast({ variant: "destructive", description: "규칙 저장 중 오류가 발생했습니다." });
    }
  };

  const handleDelete = async () => {
    if (isTriggerRulesLocked) return;
    if (!selectedRule) return;
    try {
      await deleteMutation.mutateAsync(selectedRule.id);
      setSelectedRuleId(null);
      toast({ description: "발송 규칙이 삭제되었습니다." });
    } catch {
      toast({ variant: "destructive", description: "규칙 삭제 중 오류가 발생했습니다." });
    }
  };
  return (
    <section
      data-component={component("trigger-rules")}
      className="flex h-full min-h-0 flex-col"
    >
      <div data-component={component("trigger-rules-layout")} className="flex-1 min-h-0">
        <SplitLayout hasSelection={effectiveSelectedRuleId !== null} onBack={() => setSelectedRuleId(null)}>
          <ListPanel
            title={isLoading ? "" : "발송 규칙"}
            subtitle={isLoading ? undefined : "메시지 자동 발송 규칙을 설정할 수 있어요"}
            overlay={
              !isTriggerRulesLocked && !isLoading && listItems.length === 0 ? (
                <ListEmptyState
                  name={component("trigger-rules-empty")}
                  message={statusFilter === "active" ? "활성화된 발송 규칙이 없습니다." : "비활성화된 발송 규칙이 없습니다."}
                  className="flex-none min-h-0"
                />
              ) : null
            }
            tabs={RULE_STATUS_TABS.map((tab) => ({ ...tab }))}
            activeTab={statusFilter}
            onTabChange={isTriggerRulesLocked ? undefined : (value) => setStatusFilter(value as RuleStatusFilter)}
            disabled={isTriggerRulesLocked}
            disabledOverlay={isTriggerRulesLocked ? (
              <div
                data-component={component("trigger-rules-disabled-copy")}
                className="max-w-[240px] rounded-[18px] border border-v3-burgundy/15 bg-white/90 px-4 py-3 text-center text-[0.78rem] font-semibold leading-5 text-v3-burgundy shadow-sm"
              >
                {TRIGGER_RULE_APPROVAL_MESSAGE}
              </div>
            ) : undefined}
            headerActions={isLoading || isTriggerRulesLocked ? undefined : (
              <HeaderActionButton
                icon={Plus}
                label="새 규칙"
                onClick={handleCreateNew}
                data-component={component("trigger-rules-new")}
              />
            )}
          >
            {(isLoading || listItems.length > 0) ? (
              <div data-component={component("trigger-rules-list")} className="space-y-2 pb-2">
                <AnimatedSlotList<RuleListItem>
                  items={listItems}
                  isLoading={isLoading}
                  loadingCount={5}
                  className="space-y-2"
                  slotClassName={({ item, isLoading: slotLoading }) =>
                    cn(
                      "flex items-center gap-3 rounded-[18px] border-2 p-3 text-left transition-all duration-200",
                      !slotLoading && item?.id === effectiveSelectedRuleId
                        ? "border-v3-primary bg-v3-primary-light"
                        : "border-transparent bg-white hover:border-v3-primary/30 hover:bg-v3-primary-light/50",
                    )
                  }
                  onSlotClick={(item) => setSelectedRuleId(item.id)}
                  render={({ item, isLoading: slotLoading }) => {
                    if (slotLoading) {
                      return (
                        <>
                          <div data-component={component("trigger-rule-skeleton-icon")} className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-v3-dim-white">
                            <Skeleton className="h-4 w-4 rounded-md bg-white/70" />
                          </div>
                          <div data-component={component("trigger-rule-skeleton-text")} className="min-w-0 flex-1">
                            <Skeleton className="h-4 w-32 bg-v3-dim-white" />
                            <Skeleton className="mt-2 h-3 w-44 bg-v3-dim-white" />
                          </div>
                        </>
                      );
                    }

                    if (!item) return null;
                    const Icon = item.icon;

                    return (
                      <>
                        <div data-component={component("trigger-rule-icon")} className="flex h-10 w-10 items-center justify-center rounded-[14px] bg-v3-dim-white text-v3-text-muted">
                          <Icon className="h-4 w-4" />
                        </div>
                        <div data-component={component("trigger-rule-copy")} className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-[0.82rem] font-semibold text-v3-dark">{item.title}</p>
                            {item.active ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[0.68rem] font-semibold text-emerald-600">
                                <CheckCircle2 className="h-3 w-3" />
                                활성
                              </span>
                            ) : (
                              <span className="rounded-full bg-v3-dim-white px-2 py-0.5 text-[0.68rem] font-semibold text-v3-text-muted">
                                비활성
                              </span>
                            )}
                          </div>
                          <p className="mt-1 truncate text-[0.72rem] text-v3-text-muted">{item.subtitle}</p>
                        </div>
                      </>
                    );
                  }}
                />
              </div>
            ) : null}
          </ListPanel>

          {isLoading ? (
            <TriggerRulesDetailSkeleton />
          ) : isTriggerRulesLocked ? (
            <DetailPanel
              overlay={(
                <ListEmptyState
                  name={component("trigger-rules-locked")}
                  icon={BellRing}
                  message={TRIGGER_RULE_APPROVAL_MESSAGE}
                  className="flex-none min-h-0"
                />
              )}
            >
              {null}
            </DetailPanel>
          ) : effectiveSelectedRuleId === null ? (
            <DetailPanel
              overlay={(
                <ListEmptyState
                  name={component("trigger-rules-detail-empty")}
                  icon={BellRing}
                  message="왼쪽 목록에서 규칙을 선택하거나 새 규칙을 만들어 주세요."
                  className="flex-none min-h-0"
                />
              )}
            >
              {null}
            </DetailPanel>
          ) : (
            <DetailPanel
              title={effectiveSelectedRuleId === "new" ? "새 발송 규칙" : selectedRule?.name ?? "발송 규칙"}
              subtitle="이벤트 시점, 수신자, 템플릿을 조합해 자동 발송 동작을 정의합니다."
              trailing={
                <div data-component={component("trigger-rules-actions")} className="flex items-center gap-2">
                  {selectedRule && (
                    <button
                      type="button"
                      onClick={handleDelete}
                      disabled={deleteMutation.isPending}
                      className="inline-flex items-center gap-1 rounded-[12px] px-3 py-2 text-[0.75rem] font-semibold text-red-500 transition-colors hover:bg-red-50 disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      삭제
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={!hasChanges || isSaving}
                    className={cn(
                      "inline-flex items-center gap-2 rounded-[12px] px-4 py-2 text-[0.78rem] font-semibold transition-colors",
                      hasChanges && !isSaving
                        ? "bg-v3-primary text-white hover:bg-v3-primary/90"
                        : "bg-v3-dim-white text-v3-text-muted cursor-not-allowed",
                    )}
                  >
                    <Save className="h-3.5 w-3.5" />
                    {isSaving ? "저장 중..." : "저장"}
                  </button>
                </div>
              }
            >
              <div data-component={component("trigger-rules-form")} className="space-y-6">
                  <div data-component={component("trigger-rules-switch")} className="flex items-center justify-between rounded-[18px] border border-v3-border bg-v3-dim-white/50 px-4 py-3">
                    <div>
                      <p className="text-[0.82rem] font-semibold text-v3-dark">규칙 활성화</p>
                      <p className="text-[0.72rem] text-v3-text-muted mt-1">비활성화하면 저장된 상태는 유지되고 자동 발송만 중단됩니다.</p>
                    </div>
                    <Switch
                      checked={formState.isActive}
                      onCheckedChange={(checked) => setFormState((current) => ({ ...current, isActive: checked }))}
                    />
                  </div>

                  <div data-component={component("trigger-rules-grid")} className="grid gap-4 md:grid-cols-2">
                    <div data-component={component("trigger-rules-name")}>
                      <Label htmlFor="trigger-rule-name" className="text-[0.78rem] font-semibold">규칙 이름</Label>
                      <input
                        id="trigger-rule-name"
                        value={formState.name}
                        onChange={(event) => setFormState((current) => ({ ...current, name: event.target.value }))}
                        placeholder="예: 서비스 시작 7일 전 고객 안내"
                        className={INPUT_CLASS}
                      />
                    </div>

                    <div data-component={component("trigger-rules-event")}>
                      <Label htmlFor="trigger-rule-event" className="text-[0.78rem] font-semibold">이벤트 기준</Label>
                      <select
                        id="trigger-rule-event"
                        value={formState.eventType}
                        onChange={(event) => {
                          const nextEventType = event.target.value as TriggerEventType;
                          const nextRecipient = RECIPIENT_OPTIONS[nextEventType][0].value;
                          const nextOffset = OFFSET_OPTIONS[nextEventType][0].value;
                          setFormState((current) => ({
                            ...current,
                            eventType: nextEventType,
                            recipientType: nextRecipient,
                            offsetType: nextOffset,
                            offsetDays: nextOffset === "BEFORE_DAYS" || nextOffset === "AFTER_DAYS" ? 1 : 0,
                          }));
                        }}
                        className={INPUT_CLASS}
                      >
                        {EVENT_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div data-component={component("trigger-rules-offset")}>
                      <Label htmlFor="trigger-rule-offset" className="text-[0.78rem] font-semibold">발송 시점</Label>
                      <select
                        id="trigger-rule-offset"
                        value={formState.offsetType}
                        onChange={(event) => {
                          const nextOffsetType = event.target.value as TriggerOffsetType;
                          setFormState((current) => ({
                            ...current,
                            offsetType: nextOffsetType,
                            offsetDays:
                              nextOffsetType === "BEFORE_DAYS" || nextOffsetType === "AFTER_DAYS"
                                ? Math.max(current.offsetDays || 1, 1)
                                : 0,
                          }));
                        }}
                        className={INPUT_CLASS}
                      >
                        {OFFSET_OPTIONS[formState.eventType].map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div data-component={component("trigger-rules-recipient")}>
                      <Label htmlFor="trigger-rule-recipient" className="text-[0.78rem] font-semibold">수신 대상</Label>
                      <select
                        id="trigger-rule-recipient"
                        value={formState.recipientType}
                        onChange={(event) =>
                          setFormState((current) => ({
                            ...current,
                            recipientType: event.target.value as TriggerRecipientType,
                          }))
                        }
                        className={INPUT_CLASS}
                      >
                        {RECIPIENT_OPTIONS[formState.eventType].map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {(formState.offsetType === "BEFORE_DAYS" || formState.offsetType === "AFTER_DAYS") && (
                    <div data-component={component("trigger-rules-offset-days")} className="max-w-[220px]">
                      <Label htmlFor="trigger-rule-offset-days" className="text-[0.78rem] font-semibold">기준 일수</Label>
                      <input
                        id="trigger-rule-offset-days"
                        type="number"
                        min={1}
                        value={formState.offsetDays || 1}
                        onChange={(event) =>
                          setFormState((current) => ({
                            ...current,
                            offsetDays: Math.max(Number(event.target.value || 1), 1),
                          }))
                        }
                        className={INPUT_CLASS}
                      />
                    </div>
                  )}

                  <div data-component={component("trigger-rules-template")}>
                    <Label htmlFor="trigger-rule-template" className="text-[0.78rem] font-semibold">발송 템플릿</Label>
                    <select
                      id="trigger-rule-template"
                      value={formState.templateKey}
                      onChange={(event) =>
                        setFormState((current) => ({
                          ...current,
                          templateKey: event.target.value as TriggerTemplateKey,
                        }))
                      }
                      className={INPUT_CLASS}
                    >
                      {availableTemplates.map((template) => (
                        <option key={template.key} value={template.key}>
                          {template.name}
                        </option>
                      ))}
                    </select>
                    {currentTemplate && (
                      <div data-component={component("trigger-rules-template-copy")} className="mt-3 rounded-[18px] border border-v3-border bg-v3-dim-white/40 p-4">
                        <p className="text-[0.8rem] font-semibold text-v3-dark">{currentTemplate.name}</p>
                        <p className="mt-1 text-[0.72rem] text-v3-text-muted">{currentTemplate.description}</p>
                        {currentTemplate.requiredVariables.length > 0 && (
                          <div data-component={component("trigger-rules-template-vars")} className="mt-3 flex flex-wrap gap-1.5">
                            {currentTemplate.requiredVariables.map((variable) => (
                              <span
                                key={variable.key}
                                className="rounded-full border border-v3-border bg-white px-2.5 py-1 text-[0.68rem] font-medium text-v3-text-muted"
                              >
                                {variable.label}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div data-component={component("trigger-rules-preview")} className="rounded-[20px] border border-v3-border bg-gradient-to-br from-v3-primary-light/70 to-white p-5">
                    <p className="text-[0.78rem] font-semibold text-v3-dark">규칙 미리보기</p>
                    <p className="mt-2 text-[0.82rem] leading-relaxed text-v3-text">
                      {formState.name.trim() || "이름 없는 규칙"}:
                      <span className="ml-1 text-v3-text-muted">{getRuleSummary(formState)}</span>
                    </p>
                    <p className="mt-2 text-[0.72rem] text-v3-text-muted">
                      선택한 템플릿은 현재 제공자 <span className="font-semibold text-v3-dark">{resolvedProvider}</span> 기준으로 필터링됩니다.
                    </p>
                  </div>
                </div>
            </DetailPanel>
          )}
        </SplitLayout>
      </div>
    </section>
  );
}
