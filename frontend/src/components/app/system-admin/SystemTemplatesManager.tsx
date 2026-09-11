"use client";

/* eslint-disable react-hooks/set-state-in-effect -- selection follows the async server catalog */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileText } from "lucide-react";

import {
  AnimatedSlotList,
  AnimatedSlotListItemContent,
  DetailEmptyState,
  DetailPanel,
  DetailTabPanels,
  DetailTabs,
  ListEmptyState,
  ListPanel,
  SplitLayout,
} from "@/components/app/v3";
import { SystemTemplateEditor } from "@/components/app/ui/SystemTemplateEditor";
import type {
  SystemTemplateEditorDraft,
  SystemTemplateEditorHandle,
} from "@/components/app/ui/SystemTemplateEditor";
import { TemplatePreview } from "@/components/app/my-templates/template-preview";
import { VersionHistory } from "@/features/system-templates/components/VersionHistory";
import {
  useSystemTemplate,
  useSystemTemplates,
} from "@/features/system-templates/hooks";
import type {
  CustomVariable,
  SystemTemplate,
  TemplateVariable as RegistryTemplateVariable,
} from "@/features/system-templates/types";
import type { ServerSystemTemplate } from "@/features/system-templates/catalog";
import type { TemplateVariable } from "@/lib/template/types";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { DETAIL_PANEL_FOOTER_ACTIONS_CLASS_NAME } from "@/components/app/v3/DetailPanel";

export interface SystemTemplatesManagerProps {
  dataComponent: string;
  initialTemplateKey?: string | null;
}

type DetailTab = "edit" | "preview";

function normalizeTemplates(data: SystemTemplate[] | undefined): ServerSystemTemplate[] {
  return Array.isArray(data) ? (data as ServerSystemTemplate[]) : [];
}

function toEditorVariable(
  variable: RegistryTemplateVariable | CustomVariable,
): TemplateVariable {
  return {
    key: variable.key,
    label: variable.label,
    type: "text",
    required: Boolean(variable.required),
  };
}

function getPreviewVariables(template: ServerSystemTemplate, draft: SystemTemplateEditorDraft | null) {
  const customVariables = draft?.customVariables ?? template.customVariables ?? [];
  const seen = new Set<string>();
  return [...(template.requiredVariables ?? []), ...customVariables].flatMap((variable) => {
    if (!variable?.key || seen.has(variable.key)) return [];
    seen.add(variable.key);
    return [toEditorVariable(variable)];
  });
}

function formatUpdatedDate(value: string | undefined) {
  if (!value) return "최근 수정일 없음";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "최근 수정일 없음";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
  })
    .format(date)
    .replace(/\s/g, "")
    .replace(/\.$/, "");
}

export function SystemTemplatesManager({
  dataComponent,
  initialTemplateKey,
}: SystemTemplatesManagerProps) {
  const templatesQuery = useSystemTemplates({ scope: "global" });
  const templates = useMemo(() => normalizeTemplates(templatesQuery.data), [templatesQuery.data]);
  const templateKeys = useMemo(
    () => templates.map((template) => template.templateKey),
    [templates],
  );
  const [selectedTemplateKey, setSelectedTemplateKey] = useState<string | null>(
    initialTemplateKey ?? null,
  );
  const [activeTab, setActiveTab] = useState<DetailTab>("edit");
  const [draft, setDraft] = useState<SystemTemplateEditorDraft | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const editorRef = useRef<SystemTemplateEditorHandle>(null);

  useEffect(() => {
    if (templatesQuery.isLoading || templatesQuery.isError) return;

    setSelectedTemplateKey((current) => {
      if (current && templateKeys.includes(current)) return current;
      if (initialTemplateKey && templateKeys.includes(initialTemplateKey)) {
        return initialTemplateKey;
      }
      return templateKeys[0] ?? null;
    });
  }, [initialTemplateKey, templateKeys, templatesQuery.isError, templatesQuery.isLoading]);

  useEffect(() => {
    setActiveTab("edit");
    setDraft(null);
    setIsSaving(false);
  }, [selectedTemplateKey]);

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.templateKey === selectedTemplateKey) ?? null,
    [selectedTemplateKey, templates],
  );
  // Wait for the catalog before issuing a deep-linked detail request. This
  // keeps an invalid or stale URL from racing the list selection effect.
  const detailKey = selectedTemplateKey && templateKeys.includes(selectedTemplateKey)
    ? selectedTemplateKey
    : "";
  const detailQuery = useSystemTemplate(detailKey, { scope: "global" });
  const detail = detailQuery.data ?? selectedTemplate;
  const component = (suffix: string) => `${dataComponent}_${suffix}`;
  const previewContent = draft?.content ?? detail?.content ?? "";
  const previewVariables = detail ? getPreviewVariables(detail, draft) : [];

  const handleDraftChange = useCallback((nextDraft: SystemTemplateEditorDraft) => {
    setDraft(nextDraft);
  }, []);

  const handleSave = useCallback(() => {
    void editorRef.current?.save();
  }, []);

  const handleReset = useCallback(() => {
    editorRef.current?.reset();
  }, []);

  const footer = detail ? (
    <>
      <VersionHistory
        templateKey={detail.templateKey}
        onRollback={(updatedTemplate) => {
          // Apply the mutation response immediately so a dirty editor cannot
          // survive the rollback while its detail query is being refetched.
          editorRef.current?.reset(updatedTemplate);
          setDraft(null);
          setActiveTab("edit");
        }}
      />
      <div className={DETAIL_PANEL_FOOTER_ACTIONS_CLASS_NAME}>
        <Button
          data-component={component("footer_reset-button")}
          variant="outline"
          disabled={!draft?.isDirty || isSaving}
          onClick={handleReset}
        >
          되돌리기
        </Button>
        <Button
          data-component={component("footer_save-button")}
          disabled={!draft?.isDirty || !draft.isValid || isSaving}
          onClick={handleSave}
        >
          {isSaving ? "저장 중..." : "저장"}
        </Button>
      </div>
    </>
  ) : undefined;

  return (
    <section data-component={dataComponent} className="flex h-full min-h-0 flex-1 flex-col">
      <SplitLayout
        data-component={component("split-layout")}
        hasSelection={Boolean(detailKey)}
        onBack={() => {
          if (!isSaving) setSelectedTemplateKey(null);
        }}
      >
        <ListPanel
          data-component={component("list-panel")}
          title="메시지 템플릿"
          subtitle="고객에게 보내는 기본 메시지의 문구와 변수를 관리합니다"
          disabled={isSaving}
          disabledOverlay={<span className="text-sm text-v3-text-muted">저장 중에는 템플릿을 전환할 수 없습니다.</span>}
          emptyState={
            templatesQuery.isError ? (
              <ListEmptyState message="시스템 템플릿을 불러오지 못했습니다." />
            ) : !templatesQuery.isLoading && templates.length === 0 ? (
              <ListEmptyState message="등록된 시스템 템플릿이 없습니다." />
            ) : undefined
          }
        >
          {templatesQuery.isLoading || templates.length > 0 ? (
            <AnimatedSlotList<ServerSystemTemplate>
              data-component={component("list")}
              items={templates}
              isLoading={templatesQuery.isLoading}
              loadingCount={9}
              className="space-y-2"
              getItemKey={(template) => template.templateKey}
              getSlotState={({ item, isLoading }) => ({
                isActive: !isLoading && item?.templateKey === selectedTemplateKey,
                isInteractive: !isLoading && Boolean(item) && !isSaving,
              })}
              onSlotClick={(template) => {
                if (!isSaving) setSelectedTemplateKey(template.templateKey);
              }}
              render={({ item, isLoading }) => {
                if (isLoading) return <Skeleton className="h-16 w-full rounded-[18px] bg-v3-dim-white" />;
                if (!item) return null;

                return (
                  <AnimatedSlotListItemContent
                    dataComponent={component("row")}
                    icon={FileText}
                    title={item.name || item.templateKey}
                    subtitle={`필수 변수 ${item.requiredVariables?.length ?? 0}개 · 최근 수정 ${formatUpdatedDate(item.updatedAt)}`}
                  />
                );
              }}
            />
          ) : null}
        </ListPanel>

        {!detailKey ? (
          <DetailPanel
            data-component={component("detail-panel-empty")}
            overlay={<DetailEmptyState icon={FileText} message="왼쪽 목록에서 템플릿을 선택하세요." />}
          >
            {null}
          </DetailPanel>
        ) : (
          <DetailPanel
            data-component={component("detail-panel")}
            isLoading={detailQuery.isLoading && !detail}
            title={detail?.name ?? selectedTemplate?.name ?? selectedTemplateKey}
            subtitle={detail?.description ?? "오너 기본 템플릿"}
            tabs={
              detail ? (
                <DetailTabs
                  tabs={[
                    { key: "edit", label: "템플릿 편집" },
                    { key: "preview", label: "미리보기" },
                  ]}
                  activeTab={activeTab}
                  onTabChange={(key) => setActiveTab(key as DetailTab)}
                  ariaLabel="템플릿 상세"
                />
              ) : undefined
            }
            footer={footer}
            footerClassName="max-md:pb-[96px]"
          >
            {detailQuery.isError && !detail ? (
              <DetailEmptyState message="선택한 템플릿 정보를 불러오지 못했습니다." />
            ) : detail ? (
              <DetailTabPanels
                dataComponent={component("detail-tabpanes")}
                panelDataComponent={component("detail-pane")}
                activeTab={activeTab}
                className="min-h-0 flex-1"
                trackClassName="min-h-0 flex-1"
                panelClassName="h-full min-h-0"
                panels={[
                  {
                    key: "edit",
                    children: (
                      <SystemTemplateEditor
                        ref={editorRef}
                        key={`global:${detail.templateKey}`}
                        template={detail as SystemTemplate}
                        scope="global"
                        dataComponent={component("detail-content_editor")}
                        showSaveButton={false}
                        onPendingChange={setIsSaving}
                        onDraftChange={handleDraftChange}
                      />
                    ),
                  },
                  {
                    key: "preview",
                    children: (
                      <div
                        data-component={component("detail-content_preview")}
                        className="min-h-0"
                      >
                        <TemplatePreview content={previewContent} variables={previewVariables} />
                      </div>
                    ),
                  },
                ]}
              />
            ) : (
              <DetailEmptyState message="선택한 템플릿 정보를 불러오지 못했습니다." />
            )}
          </DetailPanel>
        )}
      </SplitLayout>
    </section>
  );
}
