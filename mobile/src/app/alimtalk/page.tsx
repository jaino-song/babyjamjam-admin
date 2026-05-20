"use client";

import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Battery,
  CheckCircle2,
  ChevronLeft,
  Clock,
  FileText,
  History,
  MessageCircle,
  Plus,
  Send,
  Settings,
  Signal,
  Users,
  Wifi,
  Workflow,
  XCircle,
} from "lucide-react";
import { ContentPaper } from "@/components/app/root/content-paper";
import {
  DetailPanel,
  DetailTabs,
  ListPanel,
  SectionNav,
  SplitLayout,
} from "@/components/app/v3";
import { Separator } from "@/components/ui/separator";
import { TriggerRulesManager } from "@/components/app/alimtalk/TriggerRulesManager";
import { api } from "@/lib/api/client";
import { cn } from "@/lib/utils";

interface AlimtalkLogRecord {
  id: number;
  provider: string;
  templateKey: string;
  receiver: string;
  clientId: number | null;
  messageBody: string;
  status: "pending" | "sent" | "failed";
  errorMessage: string | null;
  attempts: number;
  createdAt: string;
  updatedAt: string;
  ruleName: string | null;
  eventType: string | null;
  recipientName: string | null;
  clientName: string | null;
  employeeName: string | null;
}

const STATUS_LABEL: Record<AlimtalkLogRecord["status"], string> = {
  pending: "대기",
  sent: "성공",
  failed: "실패",
};

const STATUS_STYLE: Record<AlimtalkLogRecord["status"], string> = {
  pending: "bg-amber-500/10 text-amber-600",
  sent: "bg-emerald-500/10 text-emerald-600",
  failed: "bg-red-500/10 text-red-600",
};

function formatLogTimestamp(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const NAV_SECTIONS = [
  { id: "overview", label: "발송 현황", icon: Send },
  { id: "history", label: "발송 내역", icon: History },
  { id: "templates", label: "템플릿", icon: FileText },
  { id: "triggers", label: "발송 트리거 설정", icon: Workflow },
  { id: "settings", label: "설정", icon: Settings },
] as const;

type SectionId = (typeof NAV_SECTIONS)[number]["id"];

const STATS = [
  { label: "총 발송", value: "0건", icon: Send, color: "text-v3-primary", bg: "bg-v3-primary/10" },
  { label: "성공", value: "0건", icon: CheckCircle2, color: "text-emerald-500", bg: "bg-emerald-500/10" },
  { label: "실패", value: "0건", icon: XCircle, color: "text-red-500", bg: "bg-red-500/10" },
  { label: "대기", value: "0건", icon: Clock, color: "text-amber-500", bg: "bg-amber-500/10" },
] as const;

type TplType = "BA" | "EX" | "AD" | "MI";
type TplEmType = "NONE" | "TEXT" | "IMAGE";
type ButtonLinkType = "WL" | "AL" | "BK" | "MD" | "DS" | "AC";
type TemplateGroup = "builtin" | "custom";
type TemplateDetailTab = "details" | "preview";
type TemplateStatus = "승인완료" | "심사중";

interface TemplateButton {
  name: string;
  linkType: ButtonLinkType;
  linkM: string;
  linkP: string;
  linkI: string;
  linkA: string;
}

interface TemplateRecord {
  id: string;
  name: string;
  description: string;
  group: TemplateGroup;
  tplType: TplType;
  tplEmType: TplEmType;
  title?: string;
  subtitle?: string;
  content: string;
  extra?: string;
  advert?: string;
  buttons: TemplateButton[];
  updatedAt: string;
  status: TemplateStatus;
  provider: string;
}

const TPL_TYPE_OPTIONS: { value: TplType; label: string }[] = [
  { value: "BA", label: "기본형" },
  { value: "EX", label: "부가 정보형" },
  { value: "AD", label: "광고 추가형" },
  { value: "MI", label: "복합형" },
];

const TPL_EMTYPE_OPTIONS: { value: TplEmType; label: string }[] = [
  { value: "NONE", label: "선택안함" },
  { value: "TEXT", label: "강조표기형" },
  { value: "IMAGE", label: "이미지형" },
];

const TEMPLATE_GROUP_TABS = [
  { value: "builtin", label: "승인 완료" },
  { value: "custom", label: "심사중/반려" },
] as const;

const TEMPLATE_DETAIL_TABS = [
  { key: "details", label: "상세정보" },
  { key: "preview", label: "미리보기" },
] as const;

const BUILTIN_TEMPLATES: TemplateRecord[] = [
  {
    id: "builtin-client-created",
    name: "고객 등록 안내",
    description: "고객 등록 직후 보내는 첫 안내 메시지",
    group: "builtin",
    tplType: "BA",
    tplEmType: "TEXT",
    title: "등록이 완료되었어요",
    subtitle: "첫 안내 메시지",
    content:
      "#{고객명}님, 안녕하세요.\n아가잼잼 서비스 등록이 완료되었습니다.\n\n담당 매니저가 배정되면 다시 안내드릴게요.\n문의사항은 언제든 편하게 연락 주세요.",
    buttons: [{ name: "서비스 안내", linkType: "WL", linkM: "https://agajamjam.kr", linkP: "https://agajamjam.kr", linkI: "", linkA: "" }],
    updatedAt: "2026.03.08",
    status: "승인완료",
    provider: "알리고 API",
  },
  {
    id: "builtin-service-reminder",
    name: "서비스 시작 리마인드",
    description: "서비스 시작 하루 전 고객 안내",
    group: "builtin",
    tplType: "EX",
    tplEmType: "NONE",
    content:
      "#{고객명}님, 내일부터 서비스가 시작됩니다.\n\n■ 서비스 일정\n- 시작일: #{시작일}\n- 담당자: #{담당자명}\n- 방문 시간: #{방문시간}\n\n필요한 준비사항은 앱에서 확인해 주세요.",
    extra: "방문 전날 오후 6시에 자동 발송",
    buttons: [{ name: "준비사항 보기", linkType: "WL", linkM: "https://agajamjam.kr/app", linkP: "https://agajamjam.kr/app", linkI: "", linkA: "" }],
    updatedAt: "2026.03.06",
    status: "승인완료",
    provider: "알리고 API",
  },
  {
    id: "builtin-service-end",
    name: "서비스 종료 안내",
    description: "서비스 종료 전 고객 재안내 메시지",
    group: "builtin",
    tplType: "AD",
    tplEmType: "NONE",
    content:
      "#{고객명}님, 서비스 종료 예정일이 하루 남았습니다.\n\n■ 종료 정보\n- 종료일: #{종료일}\n- 담당자: #{담당자명}\n\n연장이 필요하시면 관리자에게 문의해 주세요.",
    advert: "(광고) 서비스 연장 상담은 앱 또는 고객센터에서 가능합니다.",
    buttons: [],
    updatedAt: "2026.03.05",
    status: "승인완료",
    provider: "알리고 API",
  },
];

const CUSTOM_TEMPLATES: TemplateRecord[] = [
  {
    id: "custom-employee-assigned",
    name: "관리사 배정 완료",
    description: "관리사 배정 시 직원에게 발송되는 템플릿",
    group: "custom",
    tplType: "BA",
    tplEmType: "TEXT",
    title: "새 배정이 도착했어요",
    subtitle: "#{고객명} 고객",
    content:
      "#{직원명}님, 새로운 배정이 등록되었습니다.\n\n■ 배정 정보\n- 고객명: #{고객명}\n- 서비스 시작: #{시작일}\n- 주소: #{서비스주소}\n\n배정 내용을 확인해 주세요.",
    buttons: [{ name: "배정 상세 보기", linkType: "WL", linkM: "https://agajamjam.kr/staff", linkP: "https://agajamjam.kr/staff", linkI: "", linkA: "" }],
    updatedAt: "2026.03.07",
    status: "승인완료",
    provider: "알리고 API",
  },
  {
    id: "custom-7days-before-start",
    name: "서비스 7일 전 안내",
    description: "서비스 시작 7일 전 고객에게 보내는 커스텀 템플릿",
    group: "custom",
    tplType: "MI",
    tplEmType: "TEXT",
    title: "곧 서비스를 시작해요",
    subtitle: "7일 전 사전 안내",
    content:
      "#{고객명}님, 서비스 시작까지 7일 남았습니다.\n\n필요 서류와 준비사항을 미리 확인해 주세요.\n담당 매니저가 일정에 맞춰 다시 연락드릴 예정입니다.",
    extra: "필요 서류: 산모수첩, 신분증, 서비스 신청서",
    advert: "문의는 카카오 채널 또는 앱 1:1 문의로 남겨 주세요.",
    buttons: [{ name: "준비물 체크", linkType: "WL", linkM: "https://agajamjam.kr/checklist", linkP: "https://agajamjam.kr/checklist", linkI: "", linkA: "" }],
    updatedAt: "2026.03.08",
    status: "심사중",
    provider: "알리고 API",
  },
];

function extractVariables(content: string) {
  const matches = content.match(/#\{[^}]+\}/g);
  return matches ? [...new Set(matches)] : [];
}

function getTplTypeLabel(type: TplType) {
  return TPL_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? type;
}

function getTplEmTypeLabel(type: TplEmType) {
  return TPL_EMTYPE_OPTIONS.find((option) => option.value === type)?.label ?? type;
}

function TemplatePhonePreview({
  templateName,
  content,
  buttons,
}: {
  templateName: string;
  content: string;
  buttons: TemplateButton[];
}) {
  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const hasContent = content.trim().length > 0;

  return (
    <div data-component="alimtalk-template-phone-preview" className="w-full max-w-[300px] shrink-0">
      <div className="rounded-[36px] border-[3px] border-gray-800 bg-gray-800 shadow-2xl overflow-hidden">
        <div className="bg-gray-800 px-5 pt-2.5 pb-1.5 flex items-center justify-between">
          <span className="text-[0.6rem] text-gray-400 font-medium">{timeStr}</span>
          <div className="flex items-center gap-1.5">
            <Signal className="w-2.5 h-2.5 text-gray-400" />
            <Wifi className="w-2.5 h-2.5 text-gray-400" />
            <Battery className="w-3 h-3 text-gray-400" />
          </div>
        </div>

        <div className="bg-[#B2C7D9] px-3 py-2 flex items-center gap-2">
          <ChevronLeft className="w-4 h-4 text-gray-700" />
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="w-7 h-7 rounded-full bg-[#FAE100] flex items-center justify-center shrink-0">
              <MessageCircle className="w-3.5 h-3.5 text-[#3C1E1E]" />
            </div>
            <span className="text-[0.75rem] font-bold text-gray-900 truncate">아가잼잼</span>
          </div>
        </div>

        <div className="bg-[#B2C7D9] min-h-[400px] max-h-[400px] overflow-y-auto px-3 py-3 custom-scrollbar">
          {hasContent ? (
            <div className="flex items-end gap-1.5">
              <div className="w-7 h-7 rounded-full bg-[#FAE100] flex items-center justify-center shrink-0 self-start">
                <MessageCircle className="w-3.5 h-3.5 text-[#3C1E1E]" />
              </div>
              <div className="flex flex-col gap-1 min-w-0 max-w-[85%]">
                <span className="text-[0.65rem] font-semibold text-gray-800 pl-1 truncate">
                  {templateName || "알림톡 템플릿"}
                </span>
                <div className="rounded-[16px] bg-white shadow-sm overflow-hidden">
                  <div className="px-3 py-3">
                    <pre className="whitespace-pre-wrap text-[0.7rem] leading-relaxed text-gray-800 font-[Pretendard]">
                      {content}
                    </pre>
                  </div>
                  {buttons.length > 0 && (
                    <div className="border-t border-gray-100">
                      {buttons.map((button, index) => (
                        <button
                          key={`preview-btn-${index}`}
                          type="button"
                          className="w-full px-3 py-2 text-[0.7rem] text-center text-[#4A90D9] font-medium border-b border-gray-50 last:border-b-0"
                        >
                          {button.name || `버튼 ${index + 1}`}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full">
              <p className="text-[0.72rem] text-gray-500/70">미리보기 내용이 없습니다</p>
            </div>
          )}
        </div>

        <div className="bg-[#B2C7D9] px-3 py-2 border-t border-[#A0B5C7]">
          <div className="flex items-center gap-2 bg-white rounded-full px-3 py-1.5">
            <Plus className="w-4 h-4 text-gray-400" />
            <span className="text-[0.68rem] text-gray-400 flex-1">메시지 입력</span>
            <Send className="w-3.5 h-3.5 text-gray-300" />
          </div>
        </div>

        <div className="bg-gray-800 h-5 flex items-center justify-center">
          <div className="w-28 h-1 rounded-full bg-gray-600" />
        </div>
      </div>
    </div>
  );
}

function TemplateDetails({ template }: { template: TemplateRecord }) {
  const variables = extractVariables(template.content);

  return (
    <div data-component="alimtalk-template-details" className="space-y-4">
      <div className="rounded-[20px] border border-v3-border bg-white p-4">
        <h3 className="text-[0.85rem] font-bold text-v3-dark mb-3">메시지 내용</h3>
        <pre className="whitespace-pre-wrap text-[0.78rem] leading-relaxed text-v3-text font-[Pretendard] bg-v3-dim-white/50 rounded-[14px] p-3">
          {template.content}
        </pre>
      </div>

      <div className="rounded-[20px] border border-v3-border bg-white p-4">
        <h3 className="text-[0.85rem] font-bold text-v3-dark mb-3">템플릿 정보</h3>
        <div className="space-y-2.5">
          <div className="flex items-center justify-between gap-3 text-[0.78rem]">
            <span className="text-v3-text-muted">분류</span>
            <span className="font-semibold text-v3-dark">
              {template.group === "builtin" ? "기본 템플릿" : "등록 템플릿"}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3 text-[0.78rem]">
            <span className="text-v3-text-muted">메시지 유형</span>
            <span className="font-semibold text-v3-dark">{getTplTypeLabel(template.tplType)}</span>
          </div>
          <div className="flex items-center justify-between gap-3 text-[0.78rem]">
            <span className="text-v3-text-muted">강조 유형</span>
            <span className="font-semibold text-v3-dark">{getTplEmTypeLabel(template.tplEmType)}</span>
          </div>
          <div className="flex items-center justify-between gap-3 text-[0.78rem]">
            <span className="text-v3-text-muted">최근 수정</span>
            <span className="font-semibold text-v3-dark">{template.updatedAt}</span>
          </div>
          <div className="flex items-center justify-between gap-3 text-[0.78rem]">
            <span className="text-v3-text-muted">버튼 수</span>
            <span className="font-semibold text-v3-dark">{template.buttons.length}개</span>
          </div>
        </div>
      </div>

      {variables.length > 0 && (
        <div className="rounded-[20px] border border-v3-border bg-white p-4">
          <h3 className="text-[0.85rem] font-bold text-v3-dark mb-3">치환 변수</h3>
          <div className="flex flex-wrap gap-2">
            {variables.map((variable) => (
              <span
                key={variable}
                className="inline-flex items-center rounded-full bg-v3-primary-light px-3 py-1 text-[0.72rem] font-semibold text-v3-primary"
              >
                {variable}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TemplatesSection() {
  const [customTemplates] = useState<TemplateRecord[]>(CUSTOM_TEMPLATES);
  const [activeGroup, setActiveGroup] = useState<TemplateGroup>("builtin");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(BUILTIN_TEMPLATES[0]?.id ?? "");
  const [activeDetailTab, setActiveDetailTab] = useState<TemplateDetailTab>("details");

  const visibleTemplates = useMemo(
    () => (activeGroup === "builtin" ? BUILTIN_TEMPLATES : customTemplates),
    [activeGroup, customTemplates]
  );

  const templateLibrary = useMemo(
    () => [...BUILTIN_TEMPLATES, ...customTemplates],
    [customTemplates]
  );

  const selectedTemplate = useMemo(
    () => templateLibrary.find((template) => template.id === selectedTemplateId) ?? null,
    [selectedTemplateId, templateLibrary]
  );

  const handleGroupChange = useCallback((value: string) => {
    if (value !== "builtin" && value !== "custom") return;

    const nextGroup = value as TemplateGroup;
    const nextTemplates = nextGroup === "builtin" ? BUILTIN_TEMPLATES : customTemplates;

    setActiveGroup(nextGroup);
    setSelectedTemplateId((previous) => {
      const previousTemplate = templateLibrary.find((template) => template.id === previous);
      if (previousTemplate?.group === nextGroup) return previous;
      return nextTemplates[0]?.id ?? "";
    });
    setActiveDetailTab("details");
  }, [customTemplates, templateLibrary]);

  const handleSelectTemplate = useCallback((templateId: string) => {
    setSelectedTemplateId(templateId);
    setActiveDetailTab("details");
  }, []);

  return (
    <section data-component="alimtalk-templates-browser">
      <SplitLayout hasSelection={!!selectedTemplate} onBack={() => setSelectedTemplateId("")}>
        <ListPanel
          title="알림톡 템플릿"
          tabs={TEMPLATE_GROUP_TABS.map((tab) => ({ value: tab.value, label: tab.label }))}
          activeTab={activeGroup}
          onTabChange={handleGroupChange}
        >
          <div className="space-y-2 pb-2">
            {visibleTemplates.length === 0 ? (
              <div className="rounded-[16px] border border-dashed border-v3-border p-5 text-center text-[0.8rem] text-v3-text-muted">
                등록된 템플릿이 없습니다.
              </div>
            ) : (
              visibleTemplates.map((template) => {
                const isSelected = template.id === selectedTemplateId;

                return (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => handleSelectTemplate(template.id)}
                    className={cn(
                      "w-full rounded-[18px] border p-4 text-left transition-all duration-200",
                      isSelected
                        ? "border-v3-primary bg-[hsl(var(--v3-primary-light))] shadow-[0_12px_32px_hsla(214,50%,20%,0.08)]"
                        : "border-v3-border bg-white hover:border-v3-primary/30 hover:bg-v3-primary-light/40"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/10 shrink-0">
                        <FileText className="h-4 w-4 text-violet-500" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-3">
                          <p className="truncate text-[0.82rem] font-semibold text-v3-dark">{template.name}</p>
                          <span
                            className={cn(
                              "shrink-0 rounded-full px-2.5 py-1 text-[0.65rem] font-semibold",
                              template.status === "승인완료"
                                ? "bg-emerald-500/10 text-emerald-600"
                                : "bg-amber-500/10 text-amber-600"
                            )}
                          >
                            {template.status}
                          </span>
                        </div>
                        <p className="mt-1 text-[0.73rem] text-v3-text-muted">{template.description}</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <span className="rounded-full bg-v3-dim-white px-2.5 py-1 text-[0.68rem] font-medium text-v3-text-muted">
                            {getTplTypeLabel(template.tplType)}
                          </span>
                          <span className="rounded-full bg-v3-dim-white px-2.5 py-1 text-[0.68rem] font-medium text-v3-text-muted">
                            {getTplEmTypeLabel(template.tplEmType)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </ListPanel>

        <DetailPanel
          title={selectedTemplate?.name ?? "템플릿 상세"}
          subtitle={
            selectedTemplate
              ? `${selectedTemplate.group === "builtin" ? "기본 템플릿" : "등록 템플릿"} · ${selectedTemplate.provider}`
              : "목록에서 템플릿을 선택해 주세요."
          }
          badges={
            selectedTemplate ? (
              <span
                className={cn(
                  "rounded-full px-3 py-1 text-[0.7rem] font-semibold",
                  selectedTemplate.status === "승인완료"
                    ? "bg-emerald-500/10 text-emerald-600"
                    : "bg-amber-500/10 text-amber-600"
                )}
              >
                {selectedTemplate.status}
              </span>
            ) : null
          }
          tabs={
            selectedTemplate ? (
              <DetailTabs
                tabs={TEMPLATE_DETAIL_TABS.map((tab) => ({ key: tab.key, label: tab.label }))}
                activeTab={activeDetailTab}
                onTabChange={(key) => setActiveDetailTab(key as TemplateDetailTab)}
              />
            ) : null
          }
        >
          {!selectedTemplate ? (
            <div className="rounded-[16px] border border-dashed border-v3-border p-8 text-center text-sm text-v3-text-muted">
              목록에서 템플릿을 선택해 주세요.
            </div>
          ) : activeDetailTab === "details" ? (
            <TemplateDetails template={selectedTemplate} />
          ) : (
            <div className="flex justify-center py-2">
              <TemplatePhonePreview
                templateName={selectedTemplate.name}
                content={selectedTemplate.content}
                buttons={selectedTemplate.buttons}
              />
            </div>
          )}
        </DetailPanel>
      </SplitLayout>
    </section>
  );
}

export default function AlimtalkPage() {
  const [activeSection, setActiveSection] = useState<SectionId>("overview");

  const {
    data: logs = [],
    isLoading: isLogsLoading,
    isError: isLogsError,
  } = useQuery<AlimtalkLogRecord[]>({
    queryKey: ["alimtalk", "logs", 200],
    queryFn: async () => {
      const res = await api.get<AlimtalkLogRecord[]>("/alimtalk-logs", { params: { limit: 200 } });
      return res.data;
    },
  });

  return (
    <section data-component="alimtalk" className="space-y-6">
      <SectionNav
        items={NAV_SECTIONS}
        activeId={activeSection}
        onSelect={(id) => setActiveSection(id as SectionId)}
      />

      <div data-component="alimtalk-sections" className="min-w-0">
        {activeSection === "overview" ? (
          <section data-component="alimtalk-overview">
            <ContentPaper variant="v3">
              <div className="mb-4 flex items-center gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-v3-primary/10">
                  <Send size={20} className="text-v3-primary" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-foreground">발송 현황</h2>
                  <p className="text-sm text-muted-foreground">알림톡 발송 현황을 확인합니다.</p>
                </div>
              </div>
              <Separator className="mb-6" />

              <div className="grid grid-cols-2 gap-3 mb-8">
                {STATS.map((stat) => {
                  const Icon = stat.icon;
                  return (
                    <div
                      key={stat.label}
                      className="flex items-center gap-3 p-3 rounded-2xl border border-v3-border/50 bg-white"
                    >
                      <div className={`w-9 h-9 rounded-xl ${stat.bg} flex items-center justify-center shrink-0`}>
                        <Icon className={`w-4 h-4 ${stat.color}`} />
                      </div>
                      <div>
                        <p className="text-[0.7rem] text-v3-text-muted">{stat.label}</p>
                        <p className="text-base font-bold text-v3-dark">{stat.value}</p>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="rounded-2xl border border-dashed border-v3-border p-8 text-center">
                <MessageCircle className="w-10 h-10 mx-auto mb-3 text-v3-text-muted opacity-30" />
                <p className="text-[0.85rem] font-semibold text-v3-text-muted mb-1">발송 현황이 없습니다</p>
                <p className="text-[0.75rem] text-v3-text-muted">알림톡을 발송하면 여기에 현황이 표시됩니다.</p>
              </div>
            </ContentPaper>
          </section>
        ) : null}

        {activeSection === "history" ? (
          <section data-component="alimtalk-history">
            <ContentPaper variant="v3">
              <div className="mb-4 flex items-center gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-amber-500/10">
                  <History size={20} className="text-amber-500" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-foreground">발송 내역</h2>
                  <p className="text-sm text-muted-foreground">알림톡 발송 기록을 확인합니다.</p>
                </div>
              </div>
              <Separator className="mb-6" />

              {isLogsLoading ? (
                <div className="rounded-2xl border border-dashed border-v3-border p-8 text-center">
                  <History className="w-10 h-10 mx-auto mb-3 text-v3-text-muted opacity-30 animate-pulse" />
                  <p className="text-[0.85rem] font-semibold text-v3-text-muted mb-1">발송 내역 불러오는 중…</p>
                </div>
              ) : isLogsError ? (
                <div className="rounded-2xl border border-dashed border-red-300 p-8 text-center">
                  <XCircle className="w-10 h-10 mx-auto mb-3 text-red-500 opacity-50" />
                  <p className="text-[0.85rem] font-semibold text-red-600 mb-1">발송 내역을 불러오지 못했습니다</p>
                  <p className="text-[0.75rem] text-v3-text-muted">잠시 후 다시 시도해 주세요.</p>
                </div>
              ) : logs.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-v3-border p-8 text-center">
                  <History className="w-10 h-10 mx-auto mb-3 text-v3-text-muted opacity-30" />
                  <p className="text-[0.85rem] font-semibold text-v3-text-muted mb-1">발송 내역이 없습니다</p>
                  <p className="text-[0.75rem] text-v3-text-muted">알림톡을 발송하면 여기에 내역이 표시됩니다.</p>
                </div>
              ) : (
                <ul data-component="alimtalk-history-list" className="space-y-2">
                  {logs.map((log) => {
                    const recipientLabel = log.recipientName ?? log.clientName ?? log.employeeName ?? log.receiver;
                    return (
                      <li
                        key={log.id}
                        data-component="alimtalk-history-item"
                        className="rounded-2xl border border-v3-border/60 bg-white p-3"
                      >
                        <div className="flex items-start gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-[0.85rem] font-semibold text-v3-dark truncate">
                                {recipientLabel}
                              </span>
                              <span
                                className={cn(
                                  "shrink-0 px-2 py-0.5 rounded-full text-[0.65rem] font-bold",
                                  STATUS_STYLE[log.status],
                                )}
                              >
                                {STATUS_LABEL[log.status]}
                              </span>
                            </div>
                            <p className="text-[0.72rem] text-v3-text-muted truncate">
                              {log.ruleName ?? log.templateKey}
                              {log.eventType ? ` · ${log.eventType}` : ""}
                            </p>
                            <p className="text-[0.68rem] text-v3-text-muted mt-1">
                              {formatLogTimestamp(log.createdAt)} · {log.receiver}
                            </p>
                            {log.errorMessage ? (
                              <p className="text-[0.68rem] text-red-600 mt-1 break-words">{log.errorMessage}</p>
                            ) : null}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </ContentPaper>
          </section>
        ) : null}

        {activeSection === "templates" ? <TemplatesSection /> : null}

        {activeSection === "triggers" ? (
          <section data-component="alimtalk-triggers">
            <TriggerRulesManager />
          </section>
        ) : null}

        {activeSection === "settings" ? (
          <section data-component="alimtalk-settings">
            <ContentPaper variant="v3">
              <div className="mb-4 flex items-center gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gray-500/10">
                  <Settings size={20} className="text-gray-500" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-foreground">알림톡 설정</h2>
                  <p className="text-sm text-muted-foreground">알림톡 발송 서비스를 설정합니다.</p>
                </div>
              </div>
              <Separator className="mb-6" />

              <div className="space-y-4">
                <div className="flex items-center gap-3 p-4 rounded-2xl border border-v3-border bg-white">
                  <div className="w-10 h-10 rounded-xl bg-v3-primary/10 flex items-center justify-center shrink-0">
                    <Users className="w-5 h-5 text-v3-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[0.85rem] font-semibold text-v3-dark">발송 서비스 제공자</p>
                    <p className="text-[0.75rem] text-v3-text-muted">
                      현재 설정은 설정 &gt; 알림 메뉴에서 변경할 수 있습니다.
                    </p>
                  </div>
                  <a
                    href="/settings"
                    className="text-[0.8rem] font-semibold text-v3-primary hover:underline shrink-0"
                  >
                    이동
                  </a>
                </div>
              </div>
            </ContentPaper>
          </section>
        ) : null}
      </div>
    </section>
  );
}
