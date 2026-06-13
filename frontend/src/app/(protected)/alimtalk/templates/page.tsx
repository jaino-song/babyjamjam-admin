"use client";

import { useCallback, useMemo, useState } from "react";
import { SplitLayout, ListPanel, DetailPanel, AnimatedSlotList, ListEmptyState, useSplitLayoutSelection } from "@/components/app/v3";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  MessageCircle,
  CalendarCheck,
  Briefcase,
  Clock,
  CreditCard,
  Heart,
  FileText,
  Send,
} from "lucide-react";

type AlimtalkTemplateType =
  | "greeting"
  | "reservation"
  | "service-info"
  | "reminder"
  | "payment"
  | "thanks";

type TemplateGroup = "builtin" | "user";

interface TemplateListItem {
  id: string;
  label: string;
  description: string;
  icon: typeof MessageCircle;
  group: TemplateGroup;
}

const BUILTIN_TEMPLATES: TemplateListItem[] = [
  { id: "builtin:greeting", label: "인사 알림톡", description: "첫 방문 고객 환영 메시지", icon: MessageCircle, group: "builtin" },
  { id: "builtin:reservation", label: "예약 확인", description: "서비스 예약 확인 알림", icon: CalendarCheck, group: "builtin" },
  { id: "builtin:service-info", label: "서비스 안내", description: "서비스 일정 및 내용 안내", icon: Briefcase, group: "builtin" },
  { id: "builtin:reminder", label: "일정 리마인더", description: "방문 일정 사전 알림", icon: Clock, group: "builtin" },
  { id: "builtin:payment", label: "결제 안내", description: "요금 및 결제 관련 안내", icon: CreditCard, group: "builtin" },
  { id: "builtin:thanks", label: "감사 알림톡", description: "서비스 종료 감사 메시지", icon: Heart, group: "builtin" },
];

const TEMPLATE_DETAILS: Record<AlimtalkTemplateType, { title: string; content: string; variables: string[] }> = {
  greeting: {
    title: "인사 알림톡",
    content: "#{고객명}님, 안녕하세요!\n아가잼잼에 오신 것을 환영합니다.\n\n담당 관리사 #{담당자명}입니다.\n궁금하신 점이 있으시면 언제든 연락 주세요.\n\n감사합니다.",
    variables: ["고객명", "담당자명"],
  },
  reservation: {
    title: "예약 확인",
    content: "#{고객명}님, 예약이 확인되었습니다.\n\n■ 서비스 일정\n- 날짜: #{예약일자}\n- 시간: #{예약시간}\n- 담당: #{담당자명}\n\n변경이 필요하시면 미리 연락 부탁드립니다.",
    variables: ["고객명", "예약일자", "예약시간", "담당자명"],
  },
  "service-info": {
    title: "서비스 안내",
    content: "#{고객명}님, 서비스 안내드립니다.\n\n■ 이용 정보\n- 서비스: #{서비스명}\n- 기간: #{시작일} ~ #{종료일}\n- 이용 횟수: #{이용횟수}회\n\n자세한 내용은 앱에서 확인하실 수 있습니다.",
    variables: ["고객명", "서비스명", "시작일", "종료일", "이용횟수"],
  },
  reminder: {
    title: "일정 리마인더",
    content: "#{고객명}님, 내일 방문 일정을 알려드립니다.\n\n■ 방문 일정\n- 날짜: #{방문일자}\n- 시간: #{방문시간}\n- 담당: #{담당자명}\n\n일정 변경이 필요하시면 연락 주세요.",
    variables: ["고객명", "방문일자", "방문시간", "담당자명"],
  },
  payment: {
    title: "결제 안내",
    content: "#{고객명}님, 결제 안내드립니다.\n\n■ 결제 정보\n- 서비스: #{서비스명}\n- 금액: #{결제금액}원\n- 바우처 지원금: #{지원금}원\n- 본인부담금: #{본인부담금}원\n\n감사합니다.",
    variables: ["고객명", "서비스명", "결제금액", "지원금", "본인부담금"],
  },
  thanks: {
    title: "감사 알림톡",
    content: "#{고객명}님, 그동안 아가잼잼을 이용해 주셔서 감사합니다.\n\n#{서비스기간} 동안 함께해 주셔서 감사드리며,\n앞으로도 좋은 서비스로 찾아뵙겠습니다.\n\n감사합니다.",
    variables: ["고객명", "서비스기간"],
  },
};

export default function AlimtalkTemplatesPage() {
  const [activeGroup, setActiveGroup] = useState<TemplateGroup>("builtin");
  const [mobilePanel, setMobilePanel] = useState(0);

  const userTemplateItems = useMemo<TemplateListItem[]>(() => [], []);
  const isLoadingUserTemplates = false;

  const listTabs = useMemo(
    () => [
      { value: "builtin", label: "기본 템플릿" },
      {
        value: "user",
        label: userTemplateItems.length > 0 ? `사용자 템플릿 (${userTemplateItems.length})` : "사용자 템플릿",
      },
    ],
    [userTemplateItems.length]
  );

  const visibleItems = activeGroup === "builtin" ? BUILTIN_TEMPLATES : userTemplateItems;
  const visibleItemIds = useMemo(() => visibleItems.map((item) => item.id), [visibleItems]);
  const {
    selectedId: selectedValue,
    setSelectedId: setSelectedValue,
    setSplitLayoutMode,
  } = useSplitLayoutSelection(visibleItemIds);
  const isListLoading = activeGroup === "user" && isLoadingUserTemplates;

  const handleGroupChange = useCallback(
    (value: string) => {
      if (value !== "builtin" && value !== "user") return;

      const nextGroup = value as TemplateGroup;
      setActiveGroup(nextGroup);

      setSelectedValue((previous) => {
        if (nextGroup === "builtin") {
          if (previous?.startsWith("builtin:")) return previous;
          return null;
        }

        if (previous?.startsWith("user:")) return previous;
        return null;
      });
    },
    [setSelectedValue]
  );

  const handleTemplateSelect = useCallback((id: string) => {
    setSelectedValue(id);
    setActiveGroup(id.startsWith("user:") ? "user" : "builtin");
    setMobilePanel(1);
  }, [setSelectedValue]);

  const isBuiltin = selectedValue?.startsWith("builtin:") ?? false;
  const builtinType = isBuiltin && selectedValue ? (selectedValue.replace("builtin:", "") as AlimtalkTemplateType) : null;
  const templateDetail = builtinType ? TEMPLATE_DETAILS[builtinType] : null;

  return (
    <section data-component="alimtalk-templates">
      <SplitLayout
        columns={3}
        activePanel={mobilePanel}
        hasSelection={!!selectedValue}
        onBack={() => setMobilePanel(0)}
        onModeChange={setSplitLayoutMode}
      >
        <ListPanel
          title="알림톡 템플릿"
          tabs={listTabs}
          activeTab={activeGroup}
          onTabChange={handleGroupChange}
        >
          <div data-component="alimtalk-templates-list-content" className="space-y-2 pb-2">
            {!isListLoading && visibleItems.length === 0 ? (
              <ListEmptyState
                name="alimtalk-templates-list-empty"
                message="등록된 사용자 템플릿이 없습니다."
              />
            ) : (
              <AnimatedSlotList<TemplateListItem>
                items={visibleItems}
                isLoading={isListLoading}
                loadingCount={6}
                className="space-y-2"
                slotClassName={({ item, isLoading }) =>
                  cn(
                    "flex items-center gap-3 p-3 rounded-[16px] border-2 text-left transition-all duration-200",
                    !isLoading && item?.id === selectedValue
                      ? "bg-v3-primary-light border-v3-primary"
                      : "bg-white border-transparent",
                    !isLoading && "cursor-pointer hover:bg-v3-primary-light/50 hover:border-v3-primary/30"
                  )
                }
                onSlotClick={(item) => handleTemplateSelect(item.id)}
                render={({ item, isLoading: isSlotLoading }) => {
                  if (isSlotLoading) {
                    return (
                      <>
                        <div data-component="alimtalk-templates-list-skeleton-icon" className="w-9 h-9 rounded-[12px] bg-v3-dim-white flex items-center justify-center shrink-0">
                          <Skeleton className="w-4 h-4 rounded-md bg-white/70" />
                        </div>
                        <div data-component="alimtalk-templates-list-skeleton-text" className="flex-1 min-w-0 space-y-1.5">
                          <Skeleton className="h-4 w-32 bg-v3-dim-white" />
                          <Skeleton className="h-3 w-24 bg-v3-dim-white" />
                        </div>
                      </>
                    );
                  }

                  if (!item) return null;
                  const Icon = item.icon;

                  return (
                    <>
                      <div data-component="alimtalk-templates-list-item-icon" className="w-9 h-9 rounded-[12px] bg-v3-dim-white text-v3-text-muted flex items-center justify-center shrink-0">
                        <Icon className="w-4 h-4" />
                      </div>
                      <div data-component="alimtalk-templates-list-item-text" className="flex-1 min-w-0">
                        <span className="text-[0.8rem] font-semibold text-v3-dark truncate block">{item.label}</span>
                        <span className="text-[0.7rem] text-v3-text-muted truncate block">{item.description}</span>
                      </div>
                    </>
                  );
                }}
              />
            )}
          </div>
        </ListPanel>

        <DetailPanel>
          {!selectedValue && (
            <div data-component="alimtalk-templates-detail-select-empty" className="rounded-[16px] border border-dashed border-v3-border p-8 text-center text-sm text-v3-text-muted">
              왼쪽 목록에서 템플릿을 선택해 주세요.
            </div>
          )}

          {templateDetail && (
            <div data-component="alimtalk-templates-detail-content" className="space-y-6">
              <div data-component="alimtalk-templates-detail-header" className="flex items-center justify-between">
                <div data-component="alimtalk-templates-detail-title-group">
                  <h2 className="text-[1rem] font-bold text-v3-dark">{templateDetail.title}</h2>
                  <p className="text-[0.75rem] text-v3-text-muted mt-0.5">카카오 알림톡 템플릿</p>
                </div>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-v3-primary text-white text-[0.8rem] font-semibold hover:bg-v3-primary/90 transition-colors shadow-sm"
                >
                  <Send className="w-3.5 h-3.5" />
                  발송하기
                </button>
              </div>

              <div data-component="alimtalk-templates-detail-variables" className="rounded-[16px] border border-v3-border bg-v3-dim-white/30 p-4">
                <h3 className="text-[0.8rem] font-semibold text-v3-dark mb-3">변수</h3>
                <div data-component="alimtalk-templates-detail-variable-list" className="flex flex-wrap gap-2">
                  {templateDetail.variables.map((variable) => (
                    <span
                      key={variable}
                      className="inline-flex items-center px-3 py-1.5 rounded-lg bg-white border border-v3-border text-[0.75rem] font-medium text-v3-text-muted"
                    >
                      <FileText className="w-3 h-3 mr-1.5 text-v3-primary" />
                      {"#{"}
                      {variable}
                      {"}"}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {!templateDetail && selectedValue && (
            <div data-component="alimtalk-templates-detail-empty" className="rounded-[16px] border border-dashed border-v3-border p-8 text-center text-sm text-v3-text-muted">
              선택한 템플릿 정보를 불러오지 못했습니다.
            </div>
          )}
        </DetailPanel>

        <div data-component="alimtalk-templates-preview" className="bg-white rounded-[28px] shadow-v3 flex flex-col overflow-hidden h-full min-h-0 p-6">
          <h3 className="text-[0.85rem] font-bold text-v3-dark mb-4">알림톡 미리보기</h3>

          {templateDetail ? (
            <div data-component="alimtalk-templates-preview-content" className="flex-1 flex items-start justify-center overflow-y-auto">
              <div data-component="alimtalk-templates-preview-phone" className="w-full max-w-[320px]">
                <div data-component="alimtalk-templates-preview-shell" className="rounded-[20px] bg-[#FAE100] p-3">
                  <div data-component="alimtalk-templates-preview-card" className="rounded-[16px] bg-white p-4 shadow-sm">
                    <div data-component="alimtalk-templates-preview-header" className="flex items-center gap-2 mb-3 pb-2.5 border-b border-v3-border/50">
                      <div data-component="alimtalk-templates-preview-avatar" className="w-8 h-8 rounded-full bg-[#FAE100] flex items-center justify-center">
                        <MessageCircle className="w-4 h-4 text-[#3C1E1E]" />
                      </div>
                      <span className="text-[0.8rem] font-bold text-gray-900">아가잼잼</span>
                    </div>
                    <pre className="text-[0.78rem] text-gray-700 leading-relaxed whitespace-pre-wrap font-sans">
                      {templateDetail.content}
                    </pre>
                  </div>
                </div>

                <div data-component="alimtalk-templates-preview-caption" className="mt-3 px-1">
                  <p className="text-[0.7rem] text-v3-text-muted text-center">
                    실제 발송 시 변수가 고객 정보로 대체됩니다.
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div data-component="alimtalk-templates-preview-empty" className="flex-1 flex items-center justify-center">
              <div data-component="alimtalk-templates-preview-empty-content" className="text-center text-v3-text-muted">
                <MessageCircle className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-[0.8rem]">템플릿을 선택하면 미리보기가 표시됩니다.</p>
              </div>
            </div>
          )}
        </div>
      </SplitLayout>
    </section>
  );
}
