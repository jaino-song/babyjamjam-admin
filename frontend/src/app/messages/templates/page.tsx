"use client";

import { useMemo, useCallback, useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import {
  FileText,
  ArrowLeft,
  MessageCircle,
  Briefcase,
  CreditCard,
  Bell,
  Heart,
  ClipboardList,
  Info,
} from "lucide-react";
import { useMessageTemplates } from "@/features/message-templates/hooks/use-message-templates";
import { useMessageTemplate } from "@/hooks/use-message-templates";
import { useUpdateMessageTemplate } from "@/hooks/use-message-templates";
import { useSystemTemplate } from "@/features/system-templates/hooks/useSystemTemplate";
import { useUpdateSystemTemplate } from "@/features/system-templates/hooks/use-update-system-template";
import { VersionHistory } from "@/features/system-templates/components/VersionHistory";
import type { CustomVariable } from "@/features/system-templates/types";
import { SplitLayout, ListPanel, DetailPanel, AnimatedSlotList, HeaderActionButton } from "@/components/app/v3";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

interface TemplateListItem {
  id: string;
  label: string;
  subtitle?: string;
  icon: typeof FileText;
}

const BUILTIN_TEMPLATES: TemplateListItem[] = [
  { id: "builtin:greeting", label: "인사 메시지", icon: MessageCircle },
  { id: "builtin:service-info", label: "서비스 안내", icon: Briefcase },
  { id: "builtin:price-info", label: "요금 안내", icon: CreditCard },
  { id: "builtin:reminder", label: "리마인더", icon: Bell },
  { id: "builtin:thanks", label: "감사 메시지", icon: Heart },
  { id: "builtin:survey", label: "설문", icon: ClipboardList },
  { id: "builtin:info", label: "안내 메시지", icon: Info },
];

const formatDate = (dateString: string): string => {
  return new Date(dateString).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
};

function BuiltinTemplateDetail({ templateKey }: { templateKey: string }) {
  const { data: template, isLoading } = useSystemTemplate(templateKey);
  const updateMutation = useUpdateSystemTemplate();
  const { toast } = useToast();

  const [content, setContent] = useState("");
  const [customVariables, setCustomVariables] = useState<CustomVariable[]>([]);
  const [newVarKey, setNewVarKey] = useState("");
  const [newVarLabel, setNewVarLabel] = useState("");
  const [initialized, setInitialized] = useState<string | null>(null);

  if (template && initialized !== template.templateKey) {
    setContent(template.content);
    setCustomVariables(template.customVariables || []);
    setInitialized(template.templateKey);
  }

  if (isLoading) {
    return (
      <div data-component="messages-templates-builtin-loading" className="flex justify-center items-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-v3-primary" />
      </div>
    );
  }

  if (!template) {
    return (
      <div data-component="messages-templates-builtin-error" className="rounded-[16px] border border-dashed border-v3-border p-8 text-center text-[0.8rem] text-v3-text-muted">
        템플릿을 불러올 수 없습니다.
      </div>
    );
  }

  const hasChanges =
    content !== template.content ||
    JSON.stringify(customVariables) !== JSON.stringify(template.customVariables);

  const handleAddVariable = () => {
    if (!newVarKey.trim() || !newVarLabel.trim()) return;
    if (customVariables.some((v) => v.key === newVarKey)) {
      toast({ variant: "destructive", description: "이미 존재하는 변수 키입니다." });
      return;
    }
    setCustomVariables([...customVariables, { key: newVarKey, label: newVarLabel, required: true }]);
    setNewVarKey("");
    setNewVarLabel("");
  };

  const handleSave = async () => {
    try {
      await updateMutation.mutateAsync({ key: template.templateKey, content, customVariables });
      toast({ description: "템플릿이 저장되었습니다." });
    } catch {
      toast({ variant: "destructive", description: "저장 중 오류가 발생했습니다." });
    }
  };

  return (
    <div data-component="messages-templates-builtin-detail" className="flex flex-col gap-6">
      <div data-component="messages-templates-builtin-header" className="flex items-center justify-between">
        <div data-component="messages-templates-builtin-title-group">
          <h3 className="text-base font-bold text-v3-dark">{template.name}</h3>
          {template.description && (
            <p className="text-[0.75rem] text-v3-text-muted mt-0.5">{template.description}</p>
          )}
        </div>
        <VersionHistory templateKey={template.templateKey} />
      </div>

      {template.requiredVariables?.length > 0 && (
        <div data-component="messages-templates-builtin-required">
          <p className="text-[0.8rem] font-semibold text-v3-dark mb-2">필수 변수</p>
          <div data-component="messages-templates-builtin-required-list" className="flex flex-wrap gap-1.5">
            {template.requiredVariables.map((v) => (
              <span
                key={v.key}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-[10px] bg-v3-dim-white text-[0.75rem] font-medium text-v3-dark border border-v3-border"
              >
                <span className="text-red-500">*</span>
                {v.label} ({v.key})
              </span>
            ))}
          </div>
        </div>
      )}

      <div data-component="messages-templates-builtin-content">
        <p className="text-[0.8rem] font-semibold text-v3-dark mb-2">템플릿 내용</p>
        <textarea
          rows={10}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="템플릿 내용을 입력하세요. 변수는 {{변수명}} 형식으로 사용합니다."
          className="w-full rounded-[14px] border border-v3-border bg-white px-4 py-3 text-[0.8rem] text-v3-dark font-mono placeholder:text-v3-text-muted/60 focus:outline-none focus:ring-2 focus:ring-v3-primary/30 focus:border-v3-primary transition-colors resize-y"
        />
      </div>

      <div data-component="messages-templates-builtin-custom-variables">
        <p className="text-[0.8rem] font-semibold text-v3-dark mb-2">커스텀 변수</p>

        {customVariables.length > 0 && (
          <div data-component="messages-templates-builtin-custom-list" className="flex flex-wrap gap-1.5 mb-3">
            {customVariables.map((v) => (
              <span
                key={v.key}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[10px] bg-v3-primary-light text-[0.75rem] font-medium text-v3-primary"
              >
                {v.label} ({v.key})
                <button
                  type="button"
                  onClick={() => setCustomVariables(customVariables.filter((cv) => cv.key !== v.key))}
                  className="hover:text-red-500 transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        <div data-component="messages-templates-builtin-custom-editor" className="rounded-[14px] p-3">
          <div data-component="messages-templates-builtin-custom-fields" className="flex gap-2 mb-2">
            <input
              placeholder="변수 키"
              value={newVarKey}
              onChange={(e) => setNewVarKey(e.target.value)}
              className="flex-1 rounded-[10px] border border-v3-border bg-white px-3 py-2 text-[0.8rem] text-v3-dark placeholder:text-v3-text-muted/60 focus:outline-none focus:ring-2 focus:ring-v3-primary/30 focus:border-v3-primary transition-colors"
            />
            <input
              placeholder="변수 레이블"
              value={newVarLabel}
              onChange={(e) => setNewVarLabel(e.target.value)}
              className="flex-1 rounded-[10px] border border-v3-border bg-white px-3 py-2 text-[0.8rem] text-v3-dark placeholder:text-v3-text-muted/60 focus:outline-none focus:ring-2 focus:ring-v3-primary/30 focus:border-v3-primary transition-colors"
            />
            <button
              type="button"
              onClick={handleAddVariable}
              className="flex items-center gap-1 px-3 py-2 rounded-[10px] bg-v3-primary text-white text-[0.75rem] font-semibold hover:bg-v3-primary/90 transition-colors"
            >
              <Plus className="h-3.5 w-3.5" />
              추가
            </button>
          </div>
          <p className="text-[0.7rem] text-v3-text-muted">
            커스텀 변수를 추가하여 템플릿을 더 유연하게 만들 수 있습니다.
          </p>
        </div>
      </div>

      <div data-component="messages-templates-builtin-actions" className="flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={!hasChanges || updateMutation.isPending}
          className={cn(
            "flex items-center gap-2 px-5 py-2.5 rounded-[12px] text-[0.8rem] font-semibold transition-colors",
            hasChanges && !updateMutation.isPending
              ? "bg-v3-primary text-white hover:bg-v3-primary/90"
              : "bg-v3-dim-white text-v3-text-muted cursor-not-allowed",
          )}
        >
          {updateMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {updateMutation.isPending ? "저장 중..." : "저장"}
        </button>
      </div>
    </div>
  );
}

function UserTemplateDetail({ templateId }: { templateId: string }) {
  const { data: template, isLoading } = useMessageTemplate(templateId);
  const updateMutation = useUpdateMessageTemplate();
  const { toast } = useToast();

  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [initialized, setInitialized] = useState<string | null>(null);

  if (template && initialized !== template.id) {
    setName(template.name);
    setContent(template.content);
    setInitialized(template.id);
  }

  if (isLoading) {
    return (
      <div data-component="messages-templates-user-loading" className="flex justify-center items-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-v3-primary" />
      </div>
    );
  }

  if (!template) {
    return (
      <div data-component="messages-templates-user-error" className="rounded-[16px] border border-dashed border-v3-border p-8 text-center text-[0.8rem] text-v3-text-muted">
        템플릿을 불러올 수 없습니다.
      </div>
    );
  }

  const hasChanges = name !== template.name || content !== template.content;

  const handleSave = () => {
    updateMutation.mutate(
      { id: template.id, request: { name, content, variables: template.variables } },
      {
        onSuccess: () => toast({ description: "템플릿이 저장되었습니다." }),
        onError: () => toast({ variant: "destructive", description: "저장 중 오류가 발생했습니다." }),
      },
    );
  };

  return (
    <div data-component="messages-templates-user-detail" className="flex flex-col gap-6">
      <div data-component="messages-templates-user-name-field">
        <p className="text-[0.8rem] font-semibold text-v3-dark mb-2">
          템플릿 이름 <span className="text-red-500">*</span>
        </p>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="템플릿 이름을 입력하세요"
          className="w-full rounded-[14px] border border-v3-border bg-white px-4 py-3 text-[0.8rem] text-v3-dark placeholder:text-v3-text-muted/60 focus:outline-none focus:ring-2 focus:ring-v3-primary/30 focus:border-v3-primary transition-colors"
        />
      </div>

      <div data-component="messages-templates-user-content-field">
        <p className="text-[0.8rem] font-semibold text-v3-dark mb-2">
          템플릿 내용 <span className="text-red-500">*</span>
        </p>
        <textarea
          rows={10}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="템플릿 내용을 입력하세요. 변수는 {{변수명}} 형식으로 사용합니다."
          className="w-full rounded-[14px] border border-v3-border bg-white px-4 py-3 text-[0.8rem] text-v3-dark font-mono placeholder:text-v3-text-muted/60 focus:outline-none focus:ring-2 focus:ring-v3-primary/30 focus:border-v3-primary transition-colors resize-y"
        />
      </div>

      <div data-component="messages-templates-user-actions" className="flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={!name || !content || !hasChanges || updateMutation.isPending}
          className={cn(
            "flex items-center gap-2 px-5 py-2.5 rounded-[12px] text-[0.8rem] font-semibold transition-colors",
            hasChanges && name && content && !updateMutation.isPending
              ? "bg-v3-primary text-white hover:bg-v3-primary/90"
              : "bg-v3-dim-white text-v3-text-muted cursor-not-allowed",
          )}
        >
          {updateMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {updateMutation.isPending ? "저장 중..." : "저장"}
        </button>
      </div>
    </div>
  );
}

export default function TemplatesPage() {
  const [selectedValue, setSelectedValue] = useState<string | null>("builtin:greeting");

  const { data: userTemplatesData, isLoading: isLoadingUser } = useMessageTemplates(1, 100);
  const userList = useMemo(() => userTemplatesData?.data ?? [], [userTemplatesData]);

  const userItems = useMemo<TemplateListItem[]>(
    () =>
      userList.map((t) => ({
        id: `user:${t.id}`,
        label: t.name,
        subtitle: formatDate(t.updatedAt),
        icon: FileText,
      })),
    [userList],
  );

  const visibleItems = useMemo(
    () => [...BUILTIN_TEMPLATES, ...userItems],
    [userItems],
  );

  const handleTemplateSelect = useCallback((id: string) => {
    setSelectedValue(id);
  }, []);

  const isBuiltin = selectedValue?.startsWith("builtin:") ?? false;
  const builtinType = isBuiltin && selectedValue ? selectedValue.replace("builtin:", "") : null;
  const userTemplateId = !isBuiltin && selectedValue?.startsWith("user:") ? selectedValue.replace("user:", "") : null;

  return (
    <section data-component="messages-templates">
      <SplitLayout hasSelection={!!selectedValue} onBack={() => setSelectedValue(null)}>
        <ListPanel
          title="템플릿 수정"
          headerActions={
            <div data-component="messages-templates-header-actions" className="flex items-center gap-1.5">
              <HeaderActionButton
                icon={Plus}
                label="새 템플릿"
                href="/messages/templates/new"
              />
              <HeaderActionButton
                icon={ArrowLeft}
                label="돌아가기"
                href="/messages"
                variant="muted"
              />
            </div>
          }
        >
          <div data-component="messages-templates-list" className="space-y-2 pb-2">
            <AnimatedSlotList<TemplateListItem>
              items={visibleItems}
              isLoading={false}
              className="space-y-2"
              slotClassName={({ item }) =>
                cn(
                  "flex items-center gap-3 p-3 rounded-[16px] border-2 text-left transition-all duration-200",
                  item?.id === selectedValue
                    ? "bg-v3-primary-light border-v3-primary"
                    : "bg-white border-transparent",
                  "cursor-pointer hover:bg-v3-primary-light/50 hover:border-v3-primary/30",
                )
              }
              onSlotClick={(item) => handleTemplateSelect(item.id)}
              render={({ item, isLoading: isSlotLoading }) => {
                if (isSlotLoading) {
                  return (
                    <>
                      <div data-component="messages-templates-list-skeleton-icon" className="w-9 h-9 rounded-[12px] bg-v3-dim-white flex items-center justify-center shrink-0">
                        <Skeleton className="w-4 h-4 rounded-md bg-white/70" />
                      </div>
                      <div data-component="messages-templates-list-skeleton-text" className="flex-1 min-w-0 space-y-1.5">
                        <Skeleton className="h-4 w-32 bg-v3-dim-white" />
                        <Skeleton className="h-3 w-20 bg-v3-dim-white" />
                      </div>
                    </>
                  );
                }

                if (!item) return null;
                const Icon = item.icon;

                return (
                  <>
                    <div data-component="messages-templates-list-item-icon" className="w-9 h-9 rounded-[12px] bg-v3-dim-white text-v3-text-muted flex items-center justify-center shrink-0">
                      <Icon className="w-4 h-4" />
                    </div>
                    <div data-component="messages-templates-list-item-text" className="flex-1 min-w-0">
                      <span className="text-[0.8rem] font-semibold text-v3-dark truncate block">
                        {item.label}
                      </span>
                      {item.subtitle && (
                        <span className="text-[0.7rem] text-v3-text-muted">
                          {item.subtitle}
                        </span>
                      )}
                    </div>
                  </>
                );
              }}
            />
            {isLoadingUser ? (
              <div data-component="messages-templates-list-loading" className="rounded-[16px] border border-dashed border-v3-border p-4 text-[0.76rem] text-v3-text-muted">
                사용자 템플릿을 불러오는 중입니다.
              </div>
            ) : null}
          </div>
        </ListPanel>

        <DetailPanel>
          {!selectedValue && (
            <div data-component="messages-templates-detail-empty" className="rounded-[16px] border border-dashed border-v3-border p-8 text-center text-[0.8rem] text-v3-text-muted">
              왼쪽 목록에서 템플릿을 선택해 주세요.
            </div>
          )}

          {builtinType && <BuiltinTemplateDetail key={builtinType} templateKey={builtinType} />}

          {userTemplateId && <UserTemplateDetail key={userTemplateId} templateId={userTemplateId} />}
        </DetailPanel>
      </SplitLayout>
    </section>
  );
}
