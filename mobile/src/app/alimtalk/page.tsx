"use client";

import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  Battery,
  CheckCircle2,
  ChevronLeft,
  Clock,
  FileText,
  History,
  Info,
  MessageCircle,
  Monitor,
  Plus,
  Send,
  Settings,
  Signal,
  Wifi,
  Workflow,
  XCircle,
} from "lucide-react";
import { TriggerRulesManager } from "@/components/app/alimtalk/TriggerRulesManager";
import { api } from "@/lib/api/client";
import "@/components/app/mobile-redesign/redesign.css";

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

const STATUS_TONE: Record<AlimtalkLogRecord["status"], "green" | "orange" | "burgundy"> = {
  pending: "orange",
  sent: "green",
  failed: "burgundy",
};

const STATUS_AVATAR_BG: Record<AlimtalkLogRecord["status"], string> = {
  pending: "bg-v3-orange",
  sent: "bg-v3-green",
  failed: "bg-v3-burgundy",
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
  { id: "triggers", label: "트리거", icon: Workflow },
  { id: "settings", label: "설정", icon: Settings },
] as const;

type SectionId = (typeof NAV_SECTIONS)[number]["id"];

const STAT_DEFS = [
  { key: "total", label: "총 발송", icon: Send, bg: "bg-v3-primary-light", color: "text-v3-primary" },
  { key: "sent", label: "성공", icon: CheckCircle2, bg: "bg-v3-green-light", color: "text-v3-green" },
  { key: "failed", label: "실패", icon: XCircle, bg: "bg-v3-burgundy-light", color: "text-v3-burgundy" },
  { key: "pending", label: "대기", icon: Clock, bg: "bg-v3-orange-light", color: "text-v3-orange" },
] as const;

type StatKey = (typeof STAT_DEFS)[number]["key"];

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
    <div data-component="alimtalk-template-details" className="space-y-3">
      <div className="rounded-[16px] border border-v3-border bg-white p-4">
        <h3 className="text-[0.85rem] font-bold text-v3-dark mb-3">메시지 내용</h3>
        <pre className="whitespace-pre-wrap text-[0.78rem] leading-relaxed text-v3-text font-[Pretendard] bg-v3-dim-white rounded-[14px] p-3">
          {template.content}
        </pre>
      </div>

      <div className="rounded-[16px] border border-v3-border bg-white p-4">
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
        <div className="rounded-[16px] border border-v3-border bg-white p-4">
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
  const router = useRouter();
  const [customTemplates] = useState<TemplateRecord[]>(CUSTOM_TEMPLATES);
  const [activeGroup, setActiveGroup] = useState<TemplateGroup>("builtin");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(BUILTIN_TEMPLATES[0]?.id ?? "");
  const [activeDetailTab, setActiveDetailTab] = useState<TemplateDetailTab>("details");

  const handleSendWithTemplate = useCallback(
    (template: TemplateRecord) => {
      const params = new URLSearchParams({ body: template.content });
      router.push(`/messages/new?${params.toString()}`);
    },
    [router],
  );

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

  const handleSelectTemplate = useCallback((templateId: string) => {
    setSelectedTemplateId((previous) => (previous === templateId ? "" : templateId));
    setActiveDetailTab("details");
  }, []);

  const groupCounts = useMemo(() => ({
    builtin: BUILTIN_TEMPLATES.length,
    custom: customTemplates.length,
  }), [customTemplates]);

  return (
    <div className="list-card flex-1 min-h-0 flex flex-col" data-component="alimtalk-templates-card">
      <div className="list-title">
        <span className="list-title-text">
          알림톡 템플릿
          <span className="list-count">{visibleTemplates.length}건</span>
        </span>
      </div>

      <div className="filter-row" data-component="alimtalk-templates-group-row">
        {TEMPLATE_GROUP_TABS.map((tab) => {
          const isActive = tab.value === activeGroup;
          return (
            <button
              key={tab.value}
              type="button"
              className={`filter-pill ${isActive ? "active" : ""}`}
              aria-pressed={isActive}
              onClick={() => {
                setActiveGroup(tab.value);
                setActiveDetailTab("details");
              }}
              data-component="alimtalk-templates-group-pill"
            >
              {tab.label}
              <span className="count">{groupCounts[tab.value]}</span>
            </button>
          );
        })}
      </div>

      <div
        data-component="alimtalk-templates-desktop-notice"
        className="flex items-start gap-2 mx-3 mb-2 rounded-2xl border border-v3-border/60 bg-v3-dim-white px-3 py-2 text-[0.72rem] text-v3-text-muted"
      >
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-v3-primary" />
        <p>
          템플릿 생성·편집은 <span className="font-semibold text-v3-dark">데스크톱</span>에서, 모바일에서는 선택 후 발송할 수 있습니다.
        </p>
      </div>

      <div className="list-card-scroll">
        {visibleTemplates.length === 0 ? (
          <div className="flex flex-col items-center py-10 text-v3-text-muted">
            <FileText className="mb-3 h-9 w-9 opacity-30" />
            <p className="text-[0.85rem] font-semibold">등록된 템플릿이 없습니다</p>
          </div>
        ) : (
          visibleTemplates.map((template) => {
            const isSelected = template.id === selectedTemplateId;
            const tone = template.status === "승인완료" ? "green" : "orange";
            return (
              <div key={template.id} data-component="alimtalk-template-block">
                <button
                  type="button"
                  onClick={() => handleSelectTemplate(template.id)}
                  className="list-item w-full text-left"
                  aria-pressed={isSelected}
                  data-component="alimtalk-template-row"
                  data-selected={isSelected || undefined}
                  style={isSelected ? { background: "hsl(var(--v3-primary-light))" } : undefined}
                >
                  <div className="list-avatar bg-v3-purple">
                    <FileText size={16} strokeWidth={2.5} />
                  </div>
                  <div className="list-info">
                    <div className="list-name">{template.name}</div>
                    <div className="list-meta">
                      {template.description}
                      {` · ${getTplTypeLabel(template.tplType)}`}
                      {` · ${getTplEmTypeLabel(template.tplEmType)}`}
                    </div>
                  </div>
                  <div className="list-right">
                    <span className={`badge badge-${tone}`}>{template.status}</span>
                  </div>
                </button>

                {isSelected && selectedTemplate ? (
                  <div
                    className="mx-3 my-2 space-y-3"
                    data-component="alimtalk-template-detail-inline"
                  >
                    <div className="filter-row !px-0" data-component="alimtalk-template-detail-tabs">
                      {TEMPLATE_DETAIL_TABS.map((tab) => {
                        const isTabActive = tab.key === activeDetailTab;
                        return (
                          <button
                            key={tab.key}
                            type="button"
                            className={`filter-pill ${isTabActive ? "active" : ""}`}
                            aria-pressed={isTabActive}
                            onClick={() => setActiveDetailTab(tab.key)}
                            data-component="alimtalk-template-detail-pill"
                          >
                            {tab.label}
                          </button>
                        );
                      })}
                    </div>

                    {activeDetailTab === "details" ? (
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

                    <button
                      type="button"
                      data-component="alimtalk-template-send-cta"
                      onClick={() => handleSendWithTemplate(selectedTemplate)}
                      className="flex w-full items-center justify-center gap-2 rounded-2xl bg-v3-primary px-4 py-3 text-sm font-bold text-white shadow-v3-hover transition hover:bg-v3-primary/90"
                    >
                      <Send className="h-4 w-4" />이 템플릿으로 보내기
                    </button>

                    <div
                      data-component="alimtalk-template-edit-notice"
                      className="flex items-start gap-2 rounded-2xl border border-dashed border-v3-border bg-v3-dim-white px-3 py-2 text-[0.72rem] text-v3-text-muted"
                    >
                      <Monitor className="mt-0.5 h-4 w-4 shrink-0 text-v3-primary" />
                      <p>
                        내용·버튼·이미지 수정은 <span className="font-semibold text-v3-dark">데스크톱</span>에서 해 주세요.
                      </p>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </div>
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

  const statCounts = useMemo<Record<StatKey, number>>(() => {
    const counts: Record<StatKey, number> = { total: logs.length, sent: 0, failed: 0, pending: 0 };
    for (const log of logs) {
      if (log.status === "sent" || log.status === "failed" || log.status === "pending") {
        counts[log.status] += 1;
      }
    }
    return counts;
  }, [logs]);

  const successRate = logs.length > 0 ? Math.round((statCounts.sent / logs.length) * 100) : 0;

  return (
    <section data-component="alimtalk" className="flex h-full min-h-0 flex-col">
      <div className="filter-row pt-3" data-component="alimtalk-section-nav">
        {NAV_SECTIONS.map((section) => {
          const Icon = section.icon;
          const isActive = section.id === activeSection;
          return (
            <button
              key={section.id}
              type="button"
              className={`filter-pill ${isActive ? "active" : ""}`}
              aria-pressed={isActive}
              onClick={() => setActiveSection(section.id)}
              data-component="alimtalk-section-pill"
            >
              <Icon size={12} strokeWidth={2.5} />
              {section.label}
            </button>
          );
        })}
      </div>

      <div className="shell-content" data-component="alimtalk-content">
        {activeSection === "overview" ? (
          <div className="flex-1 min-h-0 flex flex-col gap-3" data-component="alimtalk-overview">
            <div className="stats-grid !pt-0">
              {STAT_DEFS.map((stat) => {
                const Icon = stat.icon;
                const value = isLogsLoading ? "—" : `${statCounts[stat.key]}`;
                return (
                  <div
                    key={stat.key}
                    className="mini-stat"
                    data-component={`alimtalk-stat-${stat.key}`}
                  >
                    <div className={`mini-stat-icon ${stat.bg} ${stat.color}`}>
                      <Icon size={16} strokeWidth={2.5} />
                    </div>
                    <div>
                      <div className="mini-stat-num">{value}</div>
                      <div className="mini-stat-label">{stat.label}</div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="list-card flex-1 min-h-0 flex flex-col">
              <div className="list-title">
                <span className="list-title-text">
                  발송 요약
                  <span className="list-count">
                    {isLogsLoading ? "불러오는 중" : `${logs.length}건 기준`}
                  </span>
                </span>
              </div>
              <div className="list-card-scroll">
                {isLogsLoading ? (
                  <div className="flex flex-col items-center py-10 text-v3-text-muted">
                    <MessageCircle className="mb-3 h-9 w-9 opacity-30 animate-pulse" />
                    <p className="text-[0.85rem] font-semibold">발송 현황 불러오는 중…</p>
                  </div>
                ) : isLogsError ? (
                  <div className="flex flex-col items-center py-10">
                    <XCircle className="mb-3 h-9 w-9 text-v3-burgundy opacity-50" />
                    <p className="text-[0.85rem] font-semibold text-v3-burgundy">발송 현황을 불러오지 못했습니다</p>
                    <p className="mt-1 text-[0.75rem] text-v3-text-muted">잠시 후 다시 시도해 주세요.</p>
                  </div>
                ) : logs.length === 0 ? (
                  <div className="flex flex-col items-center py-10 text-v3-text-muted">
                    <MessageCircle className="mb-3 h-9 w-9 opacity-30" />
                    <p className="text-[0.85rem] font-semibold">발송 현황이 없습니다</p>
                    <p className="mt-1 text-[0.75rem]">알림톡을 발송하면 현황이 표시됩니다.</p>
                  </div>
                ) : (
                  <div className="px-4 py-3 text-[0.78rem] text-v3-text-muted">
                    최근 발송 <span className="font-semibold text-v3-dark">{logs.length}건</span> 기준 ·{" "}
                    <span className="font-semibold text-v3-green">성공률 {successRate}%</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}

        {activeSection === "history" ? (
          <div className="list-card flex-1 min-h-0 flex flex-col" data-component="alimtalk-history">
            <div className="list-title">
              <span className="list-title-text">
                발송 내역
                <span className="list-count">{isLogsLoading ? "불러오는 중" : `${logs.length}건`}</span>
              </span>
            </div>
            <div className="list-card-scroll">
              {isLogsLoading ? (
                <div className="flex flex-col items-center py-10 text-v3-text-muted">
                  <History className="mb-3 h-9 w-9 opacity-30 animate-pulse" />
                  <p className="text-[0.85rem] font-semibold">발송 내역 불러오는 중…</p>
                </div>
              ) : isLogsError ? (
                <div className="flex flex-col items-center py-10">
                  <XCircle className="mb-3 h-9 w-9 text-v3-burgundy opacity-50" />
                  <p className="text-[0.85rem] font-semibold text-v3-burgundy">발송 내역을 불러오지 못했습니다</p>
                  <p className="mt-1 text-[0.75rem] text-v3-text-muted">잠시 후 다시 시도해 주세요.</p>
                </div>
              ) : logs.length === 0 ? (
                <div className="flex flex-col items-center py-10 text-v3-text-muted">
                  <History className="mb-3 h-9 w-9 opacity-30" />
                  <p className="text-[0.85rem] font-semibold">발송 내역이 없습니다</p>
                  <p className="mt-1 text-[0.75rem]">알림톡을 발송하면 내역이 표시됩니다.</p>
                </div>
              ) : (
                logs.map((log) => {
                  const recipient = log.recipientName ?? log.clientName ?? log.employeeName ?? log.receiver;
                  const initial = recipient.charAt(0) || "?";
                  const tone = STATUS_TONE[log.status];
                  return (
                    <div
                      key={log.id}
                      className="list-item"
                      data-component="alimtalk-history-row"
                    >
                      <div className={`list-avatar ${STATUS_AVATAR_BG[log.status]}`}>{initial}</div>
                      <div className="list-info">
                        <div className="list-name">
                          {recipient}
                          <span className={`badge badge-${tone}`}>{STATUS_LABEL[log.status]}</span>
                        </div>
                        <div className="list-meta">
                          {log.ruleName ?? log.templateKey}
                          {log.eventType ? ` · ${log.eventType}` : ""}
                          {` · ${formatLogTimestamp(log.createdAt)}`}
                        </div>
                        {log.errorMessage ? (
                          <div className="list-meta text-v3-burgundy mt-1">{log.errorMessage}</div>
                        ) : null}
                      </div>
                      <div className="list-right">
                        <span className="dday-sub">{log.receiver}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        ) : null}

        {activeSection === "templates" ? <TemplatesSection /> : null}

        {activeSection === "triggers" ? (
          <div className="flex-1 min-h-0 overflow-y-auto" data-component="alimtalk-triggers">
            <TriggerRulesManager />
          </div>
        ) : null}

        {activeSection === "settings" ? (
          <div className="list-card flex-1 min-h-0 flex flex-col" data-component="alimtalk-settings">
            <div className="list-title">
              <span className="list-title-text">알림톡 설정</span>
            </div>
            <div className="list-card-scroll">
              <a href="/settings" className="list-item" data-component="alimtalk-settings-provider">
                <div className="list-avatar bg-v3-primary">
                  <Settings size={16} strokeWidth={2.5} />
                </div>
                <div className="list-info">
                  <div className="list-name">발송 서비스 제공자</div>
                  <div className="list-meta">설정 &gt; 알림에서 변경할 수 있습니다.</div>
                </div>
                <div className="list-right">
                  <span className="dday-sub text-v3-primary font-bold">이동</span>
                </div>
              </a>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
