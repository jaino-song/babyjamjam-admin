"use client";
import { getUserErrorMessage } from "@babyjamjam/shared";


import { type CSSProperties, useCallback, useMemo, useState } from "react";
import { ArrowLeft, FileText, Loader2, Plus, Trash2 } from "lucide-react";
import {
  useDeleteMessageTemplate,
  useMessageTemplates,
} from "@/features/message-templates/hooks/use-message-templates";
import {
  useMessageTemplate,
  useUpdateMessageTemplate,
} from "@/hooks/use-message-templates";
import { TwoButtonModal } from "@/components/app/ui/TwoButtonModal";
import {
  AnimatedSlotList,
  AnimatedSlotListItemContent,
  DetailEmptyState,
  DetailPanel,
  HeaderActionButton,
  ListEmptyState,
  ListPanel,
  SplitLayout,
} from "@/components/app/v3";
import {
  FormField,
  FormHelperText,
  FormTextInput,
} from "@/components/app/ui/form-section";
import { SECTION_NAV_RAIL_WIDTH_PX } from "@/components/app/v3/SectionNav";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { formatDateForDisplay } from "@/lib/date/format-date-for-display";

interface TemplateListItem {
  id: string;
  label: string;
  subtitle?: string;
  icon: typeof FileText;
}

const formatDate = (dateString: string): string => {
  return formatDateForDisplay(dateString);
};

const TEMPLATE_NAME_ERROR = "템플릿 이름은 공백 이외의 문자를 포함해야 합니다.";
const TEMPLATE_CONTENT_ERROR = "템플릿 내용은 공백 이외의 문자를 포함해야 합니다.";

interface TemplateFieldErrors {
  name?: string;
  content?: string;
}

function TemplateEditorLoadingSkeleton({ name }: { name: string }) {
  return (
    <div data-component={name} className="flex flex-col gap-6">
      <div data-component={`${name}-name`} className="space-y-2">
        <Skeleton className="h-3 w-28 bg-v3-dim-white" />
        <Skeleton className="h-11 w-full rounded-[14px] bg-v3-dim-white" />
      </div>
      <div data-component={`${name}-content`} className="space-y-2">
        <Skeleton className="h-3 w-24 bg-v3-dim-white" />
        <Skeleton className="h-48 w-full rounded-[14px] bg-v3-dim-white" />
      </div>
      <div data-component={`${name}-action`} className="flex justify-end">
        <Skeleton className="h-10 w-20 rounded-[12px] bg-v3-dim-white" />
      </div>
    </div>
  );
}

function BranchTemplateDetail({
  templateId,
  onDeleted,
}: {
  templateId: string;
  onDeleted: () => void;
}) {
  const { data: template, isLoading } = useMessageTemplate(templateId);
  const updateMutation = useUpdateMessageTemplate();
  const deleteMutation = useDeleteMessageTemplate();
  const { toast } = useToast();

  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [initialized, setInitialized] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<TemplateFieldErrors>({});
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  if (template && initialized !== template.id) {
    setName(template.name);
    setContent(template.content);
    setInitialized(template.id);
  }

  if (isLoading) {
    return <TemplateEditorLoadingSkeleton name="desktop_messages_sections_templates_user-loading" />;
  }

  if (!template) {
    return (
      <DetailEmptyState
        message="지점 템플릿을 불러올 수 없어요."
      />
    );
  }

  const hasChanges = name !== template.name || content !== template.content;
  const hasValidFields = name.trim().length > 0 && content.trim().length > 0;
  const hasValidationErrors = Boolean(fieldErrors.name || fieldErrors.content);
  const nameFieldId = `message-template-${template.id}-name`;
  const contentFieldId = `message-template-${template.id}-content`;
  const nameErrorId = `${nameFieldId}-error`;
  const contentErrorId = `${contentFieldId}-error`;
  const validationSummaryId = `message-template-${template.id}-validation-summary`;

  const handleSave = () => {
    const nextFieldErrors: TemplateFieldErrors = {
      name: name.trim().length > 0 ? undefined : TEMPLATE_NAME_ERROR,
      content: content.trim().length > 0 ? undefined : TEMPLATE_CONTENT_ERROR,
    };
    setFieldErrors(nextFieldErrors);

    if (!hasValidFields || !hasChanges || updateMutation.isPending) {
      return;
    }

    updateMutation.mutate(
      { id: template.id, request: { name, content, variables: template.variables } },
      {
        onSuccess: () => toast({ variant: "success", description: "지점 템플릿을 저장했어요" }),
        onError: () => toast({ variant: "destructive", description: getUserErrorMessage("지점 템플릿을 저장하지 못했어요") }),
      },
    );
  };

  // Awaited rather than using mutate's per-call callbacks: the optimistic removal
  // unmounts this detail panel, and TanStack drops those callbacks once the
  // observer is gone — the failure toast would never fire.
  const handleDelete = async () => {
    try {
      await deleteMutation.mutateAsync(template.id);
      setDeleteDialogOpen(false);
      onDeleted();
      toast({ variant: "success", description: "지점 템플릿을 삭제했어요" });
    } catch {
      toast({ variant: "destructive", description: getUserErrorMessage("지점 템플릿을 삭제하지 못했어요") });
    }
  };

  return (
    <div data-component="desktop_messages_sections_templates-user-detail" className="flex flex-col gap-6">
      <FormField
        data-component="desktop_messages_sections_templates-user-detail_templates-user-name-field"
        label="지점 템플릿 이름"
        htmlFor={nameFieldId}
        required
      >
        <FormTextInput
          data-component="desktop_messages_sections_templates-user-detail_templates-user-name-field_input"
          id={nameFieldId}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setFieldErrors((current) => ({ ...current, name: undefined }));
          }}
          placeholder="지점 템플릿 이름을 입력하세요"
          error={Boolean(fieldErrors.name)}
          aria-describedby={fieldErrors.name ? nameErrorId : undefined}
        />
        {fieldErrors.name ? (
          <FormHelperText
            id={nameErrorId}
            role="alert"
            tone="error"
            data-component="desktop_messages_sections_templates-user-detail_templates-user-name-field_error"
          >
            {fieldErrors.name}
          </FormHelperText>
        ) : null}
      </FormField>

      <FormField
        data-component="desktop_messages_sections_templates-user-detail_templates-user-content-field"
        label="템플릿 내용"
        htmlFor={contentFieldId}
        required
      >
        <Textarea
          data-component="desktop_messages_sections_templates-user-detail_templates-user-content-field_input"
          id={contentFieldId}
          rows={10}
          value={content}
          onChange={(event) => {
            setContent(event.target.value);
            setFieldErrors((current) => ({ ...current, content: undefined }));
          }}
          placeholder="메시지 내용을 입력하세요. 변수는 {{변수명}} 형식으로 사용합니다."
          aria-invalid={Boolean(fieldErrors.content) || undefined}
          aria-describedby={fieldErrors.content ? contentErrorId : undefined}
        />
        {fieldErrors.content ? (
          <FormHelperText
            id={contentErrorId}
            role="alert"
            tone="error"
            data-component="desktop_messages_sections_templates-user-detail_templates-user-content-field_error"
          >
            {fieldErrors.content}
          </FormHelperText>
        ) : null}
      </FormField>

      {hasValidationErrors ? (
        <FormHelperText
          id={validationSummaryId}
          role="alert"
          aria-live="polite"
          data-component="desktop_messages_sections_templates-user-detail_validation-summary"
        >
          입력한 템플릿 이름과 내용을 확인해 주세요.
        </FormHelperText>
      ) : null}

      <div data-component="desktop_messages_sections_templates-user-detail_templates-user-actions" className="flex justify-between gap-3">
        <Button
          type="button"
          variant="destructive"
          onClick={() => setDeleteDialogOpen(true)}
          disabled={deleteMutation.isPending}
          data-component="desktop_messages_sections_templates-user-detail_templates-user-actions_delete"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" />
          삭제
        </Button>
        <Button
          type="button"
          variant="positive"
          onClick={handleSave}
          disabled={!hasChanges || updateMutation.isPending}
          aria-describedby={hasValidationErrors ? validationSummaryId : undefined}
          data-component="desktop_messages_sections_templates-user-detail_templates-user-actions_save"
        >
          {updateMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {updateMutation.isPending ? "저장 중..." : "저장"}
        </Button>
      </div>

      <TwoButtonModal
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        title="지점 템플릿을 삭제하시겠습니까?"
        description="삭제한 지점 템플릿은 복구할 수 없어요."
        cancelLabel="취소"
        approvalLabel="삭제"
        pendingLabel="삭제 중..."
        approvalVariant="destructive"
        isPending={deleteMutation.isPending}
        isDescriptionVisuallyHidden={false}
        onApprove={() => void handleDelete()}
        data-component="desktop_messages_sections_templates_delete-confirmation"
      />
    </div>
  );
}

export default function TemplatesPage() {
  const [selectedValue, setSelectedValue] = useState<string | null>(null);

  const { data: branchTemplatesData, isLoading: isLoadingBranchTemplates } = useMessageTemplates(1, 100);
  const branchTemplates = useMemo(() => branchTemplatesData ?? [], [branchTemplatesData]);

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
    <section
      data-component="desktop_messages_sections_templates"
      className="flex h-full min-h-0 flex-1 flex-col lg:pl-[calc(var(--message-section-nav-content-offset)*var(--glint-ui-scale,1))]"
      style={{
        "--message-section-nav-content-offset": `${SECTION_NAV_RAIL_WIDTH_PX}px`,
      } as CSSProperties}
    >
      <SplitLayout data-component="desktop_messages_sections_templates_split-layout" hasSelection={!!activeTemplateId} onBack={() => setSelectedValue(null)}>
        <ListPanel data-component="desktop_messages_sections_templates_split-layout_list-panel"
          title="지점 템플릿 수정"
          subtitle="새로 만든 템플릿은 모두 지점 템플릿으로 저장됩니다."
          headerActions={
            <div data-component="desktop_messages_sections_templates_split-layout_list-panel_templates-header-actions" className="flex items-center gap-1.5">
              <HeaderActionButton icon={Plus} label="새 템플릿" href="/messages/templates/new" />
              <HeaderActionButton icon={ArrowLeft} label="돌아가기" href="/messages" variant="muted" />
            </div>
          }
          emptyState={!(isLoadingBranchTemplates || branchItems.length > 0) ? (
            <ListEmptyState message="등록된 지점 템플릿이 없습니다." />
          ) : undefined}
        >
          <div data-component="desktop_messages_sections_templates_split-layout_list-panel_templates-list" className="space-y-2 pb-2">
            <AnimatedSlotList<TemplateListItem>
                items={branchItems}
                isLoading={isLoadingBranchTemplates}
                className="space-y-2"
                getSlotState={({ item, isLoading }) => ({
                  isActive: !isLoading && item?.id === activeTemplateId,
                  isInteractive: !isLoading && Boolean(item),
                })}
                onSlotClick={(item) => handleTemplateSelect(item.id)}
                render={({ item, isLoading: isSlotLoading }) => {
                  if (isSlotLoading) {
                    return (
                      <>
                        <div
                          data-component="desktop_messages_sections_templates_split-layout_list-panel_templates-list_templates-list-skeleton-icon"
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] bg-v3-dim-white"
                        >
                          <Skeleton className="h-4 w-4 rounded-md bg-white/70" />
                        </div>
                        <div
                          data-component="desktop_messages_sections_templates_split-layout_list-panel_templates-list_templates-list-skeleton-text"
                          className="min-w-0 flex-1 space-y-1.5"
                        >
                          <Skeleton className="h-4 w-32 bg-v3-dim-white" />
                          <Skeleton className="h-3 w-20 bg-v3-dim-white" />
                        </div>
                      </>
                    );
                  }

                  if (!item) return null;

                  return (
                    <AnimatedSlotListItemContent
                      dataComponent="desktop_messages_sections_templates-list-item"
                      icon={item.icon}
                      title={item.label}
                      subtitle={item.subtitle}
                    />
                  );
                }}
              />
            </div>
        </ListPanel>

        <DetailPanel data-component="desktop_messages_sections_templates_split-layout_detail-panel">
          {!activeTemplateId ? (
            <DetailEmptyState
              message="지점 템플릿을 선택하면 상세 정보가 표시됩니다."
            />
          ) : null}

          {branchTemplateId ? (
            <BranchTemplateDetail
              key={branchTemplateId}
              templateId={branchTemplateId}
              onDeleted={() => setSelectedValue(null)}
            />
          ) : null}
        </DetailPanel>
      </SplitLayout>
    </section>
  );
}
