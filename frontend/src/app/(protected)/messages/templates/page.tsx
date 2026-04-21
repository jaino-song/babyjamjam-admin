"use client";

import { useCallback, useMemo, useState } from "react";
import { ArrowLeft, FileText, Loader2, Plus, Users } from "lucide-react";
import { useMessageTemplates } from "@/features/message-templates/hooks/use-message-templates";
import { useMessageTemplate, useUpdateMessageTemplate } from "@/hooks/use-message-templates";
import {
  AnimatedSlotList,
  DetailPanel,
  HeaderActionButton,
  ListEmptyState,
  ListPanel,
  SplitLayout,
} from "@/components/app/v3";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

interface TemplateListItem {
  id: string;
  label: string;
  subtitle?: string;
  icon: typeof FileText;
}

const formatDate = (dateString: string): string => {
  return new Date(dateString).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
};

function BranchTemplateDetail({ templateId }: { templateId: string }) {
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
      <div data-component="messages-templates-user-loading" className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-v3-primary" />
      </div>
    );
  }

  if (!template) {
    return (
      <div
        data-component="messages-templates-user-error"
        className="rounded-[16px] border border-dashed border-v3-border p-8 text-center text-[0.8rem] text-v3-text-muted"
      >
        지점 템플릿을 불러올 수 없습니다.
      </div>
    );
  }

  const hasChanges = name !== template.name || content !== template.content;

  const handleSave = () => {
    updateMutation.mutate(
      { id: template.id, request: { name, content, variables: template.variables } },
      {
        onSuccess: () => toast({ description: "지점 템플릿이 저장되었습니다." }),
        onError: () => toast({ variant: "destructive", description: "저장 중 오류가 발생했습니다." }),
      },
    );
  };

  return (
    <div data-component="messages-templates-user-detail" className="flex flex-col gap-6">
      <div data-component="messages-templates-user-name-field">
        <p className="mb-2 text-[0.8rem] font-semibold text-v3-dark">
          지점 템플릿 이름 <span className="text-red-500">*</span>
        </p>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="지점 템플릿 이름을 입력하세요"
          className="w-full rounded-[14px] border border-v3-border bg-white px-4 py-3 text-[0.8rem] text-v3-dark placeholder:text-v3-text-muted/60 focus:border-v3-primary focus:outline-none focus:ring-2 focus:ring-v3-primary/30 transition-colors"
        />
      </div>

      <div data-component="messages-templates-user-content-field">
        <p className="mb-2 text-[0.8rem] font-semibold text-v3-dark">
          템플릿 내용 <span className="text-red-500">*</span>
        </p>
        <textarea
          rows={10}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="메시지 내용을 입력하세요. 변수는 {{변수명}} 형식으로 사용합니다."
          className="w-full resize-y rounded-[14px] border border-v3-border bg-white px-4 py-3 font-mono text-[0.8rem] text-v3-dark placeholder:text-v3-text-muted/60 focus:border-v3-primary focus:outline-none focus:ring-2 focus:ring-v3-primary/30 transition-colors"
        />
      </div>

      <div data-component="messages-templates-user-actions" className="flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={!name || !content || !hasChanges || updateMutation.isPending}
          className={cn(
            "flex items-center gap-2 rounded-[12px] px-5 py-2.5 text-[0.8rem] font-semibold transition-colors",
            hasChanges && name && content && !updateMutation.isPending
              ? "bg-v3-primary text-white hover:bg-v3-primary/90"
              : "cursor-not-allowed bg-v3-dim-white text-v3-text-muted",
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
  const [selectedValue, setSelectedValue] = useState<string | null>(null);

  const { data: branchTemplatesData, isLoading: isLoadingBranchTemplates } = useMessageTemplates(1, 100);
  const branchTemplates = useMemo(() => branchTemplatesData?.data ?? [], [branchTemplatesData]);

  const branchItems = useMemo<TemplateListItem[]>(
    () =>
      branchTemplates.map((template) => ({
        id: `user:${template.id}`,
        label: template.name,
        subtitle: formatDate(template.updatedAt),
        icon: FileText,
      })),
    [branchTemplates],
  );

  const activeTemplateId = useMemo(() => {
    if (!selectedValue) {
      return null;
    }

    return branchItems.find((item) => item.id === selectedValue)?.id ?? null;
  }, [branchItems, selectedValue]);

  const handleTemplateSelect = useCallback((id: string) => {
    setSelectedValue(id);
  }, []);

  const branchTemplateId =
    activeTemplateId?.startsWith("user:") ? activeTemplateId.replace("user:", "") : null;

  return (
    <section data-component="messages-templates">
      <SplitLayout hasSelection={!!activeTemplateId} onBack={() => setSelectedValue(null)}>
        <ListPanel
          title="지점 템플릿 수정"
          subtitle="새로 만든 템플릿은 모두 지점 템플릿으로 저장됩니다."
          headerActions={
            <div data-component="messages-templates-header-actions" className="flex items-center gap-1.5">
              <HeaderActionButton icon={Plus} label="새 템플릿" href="/messages/templates/new" />
              <HeaderActionButton icon={ArrowLeft} label="돌아가기" href="/messages" variant="muted" />
            </div>
          }
        >
          <div data-component="messages-templates-list" className="space-y-2 pb-2">
            {branchItems.length > 0 ? (
              <AnimatedSlotList<TemplateListItem>
                items={branchItems}
                isLoading={false}
                className="space-y-2"
                slotClassName={({ item }) =>
                  cn(
                    "flex items-center gap-3 rounded-[16px] border-2 p-3 text-left transition-all duration-200",
                    item?.id === activeTemplateId
                      ? "border-v3-primary bg-v3-primary-light"
                      : "border-transparent bg-white",
                    "cursor-pointer hover:border-v3-primary/30 hover:bg-v3-primary-light/50",
                  )
                }
                onSlotClick={(item) => handleTemplateSelect(item.id)}
                render={({ item, isLoading: isSlotLoading }) => {
                  if (isSlotLoading) {
                    return (
                      <>
                        <div
                          data-component="messages-templates-list-skeleton-icon"
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] bg-v3-dim-white"
                        >
                          <Skeleton className="h-4 w-4 rounded-md bg-white/70" />
                        </div>
                        <div
                          data-component="messages-templates-list-skeleton-text"
                          className="min-w-0 flex-1 space-y-1.5"
                        >
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
                      <div
                        data-component="messages-templates-list-item-icon"
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] bg-v3-dim-white text-v3-text-muted"
                      >
                        <Icon className="h-4 w-4" />
                      </div>
                      <div data-component="messages-templates-list-item-text" className="min-w-0 flex-1">
                        <span className="block truncate text-[0.8rem] font-semibold text-v3-dark">
                          {item.label}
                        </span>
                        {item.subtitle ? (
                          <span className="text-[0.7rem] text-v3-text-muted">{item.subtitle}</span>
                        ) : null}
                      </div>
                    </>
                  );
                }}
              />
            ) : null}
            {isLoadingBranchTemplates ? (
              <div
                data-component="messages-templates-list-loading"
                className="rounded-[16px] border border-dashed border-v3-border p-4 text-[0.76rem] text-v3-text-muted"
              >
                지점 템플릿을 불러오는 중입니다.
              </div>
            ) : null}
            {!isLoadingBranchTemplates && branchItems.length === 0 ? (
              <ListEmptyState name="messages-templates-list-empty" message="등록된 지점 템플릿이 없습니다." />
            ) : null}
          </div>
        </ListPanel>

        <DetailPanel>
          {!activeTemplateId ? (
            <div
              data-component="messages-templates-detail-empty"
              className="flex min-h-[320px] items-center justify-center"
            >
              <div
                data-component="messages-templates-detail-empty-copy"
                className="text-center text-v3-text-muted"
              >
                <Users
                  data-component="messages-templates-detail-empty-icon"
                  className="mx-auto mb-3 h-12 w-12 opacity-30"
                  aria-hidden="true"
                />
                <p className="text-[0.85rem]">지점 템플릿을 선택하면 상세 정보가 표시됩니다.</p>
              </div>
            </div>
          ) : null}

          {branchTemplateId ? <BranchTemplateDetail key={branchTemplateId} templateId={branchTemplateId} /> : null}
        </DetailPanel>
      </SplitLayout>
    </section>
  );
}
