"use client";

/* eslint-disable react-hooks/set-state-in-effect -- selection follows the async server catalog */

import { useEffect, useMemo, useState } from "react";
import { FileText } from "lucide-react";

import {
  AnimatedSlotList,
  AnimatedSlotListItemContent,
  DetailEmptyState,
  DetailPanel,
  ListEmptyState,
  ListPanel,
  SplitLayout,
} from "@/components/app/v3";
import { MessagePhonePreview } from "@/components/app/messages/MessagePhonePreview";
import { SystemTemplateEditor } from "@/components/app/ui/SystemTemplateEditor";
import { VersionHistory } from "@/features/system-templates/components/VersionHistory";
import {
  useSystemTemplate,
  useSystemTemplates,
} from "@/features/system-templates/hooks";
import type { SystemTemplate } from "@/features/system-templates/types";
import type { ServerSystemTemplate } from "@/features/system-templates/catalog";
import { Skeleton } from "@/components/ui/skeleton";

export interface SystemTemplatesManagerProps {
  dataComponent: string;
  initialTemplateKey?: string | null;
}

function normalizeTemplates(data: SystemTemplate[] | undefined): ServerSystemTemplate[] {
  return Array.isArray(data) ? (data as ServerSystemTemplate[]) : [];
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
  const [previewOverride, setPreviewOverride] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

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
    setPreviewOverride(null);
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
  const previewMessage = previewOverride ?? detail?.content ?? "";
  const component = (suffix: string) => `${dataComponent}_${suffix}`;

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
          subtitle="문구를 수정하지 않은 지점에 반영되는 기본 메시지를 관리합니다"
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
              loadingCount={5}
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
                    subtitle={item.description || item.templateKey}
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
            trailing={
              detail ? (
                <VersionHistory templateKey={detail.templateKey} />
              ) : undefined
            }
          >
            {detailQuery.isError && !detail ? (
              <DetailEmptyState message="선택한 템플릿 정보를 불러오지 못했습니다." />
            ) : detail ? (
              <div data-component={component("detail-content")} className="grid min-h-0 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
                <SystemTemplateEditor
                  key={`global:${detail.templateKey}`}
                  template={detail as SystemTemplate}
                  scope="global"
                  dataComponent={component("detail-content_editor")}
                  onPendingChange={setIsSaving}
                  onPreviewMessageChange={setPreviewOverride}
                />
                <MessagePhonePreview
                  dataComponentPrefix={component("preview")}
                  panelDataComponent={component("preview-panel")}
                  content={previewMessage}
                  templateName={detail.name || detail.templateKey}
                  className="h-[520px]"
                />
              </div>
            ) : (
              <DetailEmptyState message="선택한 템플릿 정보를 불러오지 못했습니다." />
            )}
          </DetailPanel>
        )}
      </SplitLayout>
    </section>
  );
}
