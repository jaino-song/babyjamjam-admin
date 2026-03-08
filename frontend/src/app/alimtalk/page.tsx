"use client";

import { useState, useMemo, useCallback } from "react";
import {
  Send,
  FileText,
  History,
  Settings,
  MessageCircle,
  Users,
  CheckCircle2,
  XCircle,
  Clock,
  Plus,
  Trash2,
  ChevronLeft,
  Wifi,
  Battery,
  Signal,
} from "lucide-react";
import { ContentPaper } from "@/components/app/root/content-paper";
import { SectionNav } from "@/components/app/v3";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const NAV_SECTIONS = [
  { id: "overview", label: "발송 현황", icon: Send },
  { id: "history", label: "발송 내역", icon: History },
  { id: "templates", label: "템플릿", icon: FileText },
  { id: "settings", label: "설정", icon: Settings },
] as const;

type SectionId = (typeof NAV_SECTIONS)[number]["id"];

const STATS = [
  { label: "총 발송", value: "0건", icon: Send, color: "text-v3-primary", bg: "bg-v3-primary/10" },
  { label: "성공", value: "0건", icon: CheckCircle2, color: "text-emerald-500", bg: "bg-emerald-500/10" },
  { label: "실패", value: "0건", icon: XCircle, color: "text-red-500", bg: "bg-red-500/10" },
  { label: "대기", value: "0건", icon: Clock, color: "text-amber-500", bg: "bg-amber-500/10" },
];

type TplType = "BA" | "EX" | "AD" | "MI";
type TplEmType = "NONE" | "TEXT" | "IMAGE";
type ButtonLinkType = "WL" | "AL" | "BK" | "MD" | "DS" | "AC";

interface TemplateButton {
  name: string;
  linkType: ButtonLinkType;
  linkM: string;
  linkP: string;
  linkI: string;
  linkA: string;
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

const BUTTON_LINK_TYPES: { value: ButtonLinkType; label: string }[] = [
  { value: "WL", label: "웹링크" },
  { value: "AL", label: "앱링크" },
  { value: "BK", label: "봇키워드" },
  { value: "MD", label: "메시지전달" },
  { value: "DS", label: "배송조회" },
  { value: "AC", label: "채널추가" },
];

const EMPTY_BUTTON: TemplateButton = { name: "", linkType: "WL", linkM: "", linkP: "", linkI: "", linkA: "" };

const INPUT_CLASS = "mt-1.5 w-full px-3.5 py-2.5 rounded-xl border border-[hsl(var(--v3-border))] bg-white text-[0.8rem] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--v3-primary))]/20 focus:border-[hsl(var(--v3-primary))] transition-all placeholder:text-v3-text-muted/50";
const SELECT_CLASS = "mt-1.5 w-full px-3.5 py-2.5 rounded-xl border border-[hsl(var(--v3-border))] bg-white text-[0.8rem] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--v3-primary))]/20 focus:border-[hsl(var(--v3-primary))] transition-all appearance-none cursor-pointer";

function TemplateCreator() {
  const [tplName, setTplName] = useState("");
  const [tplContent, setTplContent] = useState("");
  const [tplType, setTplType] = useState<TplType>("BA");
  const [tplEmType, setTplEmType] = useState<TplEmType>("NONE");
  const [tplTitle, setTplTitle] = useState("");
  const [tplSubtitle, setTplSubtitle] = useState("");
  const [tplExtra, setTplExtra] = useState("");
  const [tplAdvert, setTplAdvert] = useState("");
  const [buttons, setButtons] = useState<TemplateButton[]>([]);

  const addButton = useCallback(() => {
    if (buttons.length >= 5) return;
    setButtons((prev) => [...prev, { ...EMPTY_BUTTON }]);
  }, [buttons.length]);

  const removeButton = useCallback((idx: number) => {
    setButtons((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const updateButton = useCallback((idx: number, field: keyof TemplateButton, value: string) => {
    setButtons((prev) => prev.map((b, i) => (i === idx ? { ...b, [field]: value } : b)));
  }, []);

  const variables = useMemo(() => {
    const matches = tplContent.match(/#\{[^}]+\}/g);
    return matches ? [...new Set(matches)] : [];
  }, [tplContent]);

  const now = new Date();
  const timeStr = `${now.getHours()}:${String(now.getMinutes()).padStart(2, "0")}`;

  return (
    <section data-component="alimtalk-template-creator" className="flex flex-col lg:flex-row gap-8">
        <ContentPaper variant="v3" className="flex-1 min-w-0">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-violet-500/10">
              <FileText size={20} className="text-violet-500" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-foreground">새 템플릿 작성</h2>
              <p className="text-sm text-muted-foreground">알리고 API 기반 카카오 알림톡 템플릿</p>
            </div>
          </div>
          <Separator className="mb-6" />

          <div className="space-y-5">
            <div>
              <Label htmlFor="tpl-name" className="text-[0.8rem] font-semibold">템플릿 이름 *</Label>
              <input id="tpl-name" type="text" value={tplName} onChange={(e) => setTplName(e.target.value)} placeholder="예: 배송완료 안내" className={INPUT_CLASS} />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="tpl-type" className="text-[0.8rem] font-semibold">메시지 유형</Label>
                <select id="tpl-type" value={tplType} onChange={(e) => setTplType(e.target.value as TplType)} className={SELECT_CLASS}>
                  {TPL_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <Label htmlFor="tpl-emtype" className="text-[0.8rem] font-semibold">강조 유형</Label>
                <select id="tpl-emtype" value={tplEmType} onChange={(e) => setTplEmType(e.target.value as TplEmType)} className={SELECT_CLASS}>
                  {TPL_EMTYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </div>

            {tplEmType === "TEXT" && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="tpl-title" className="text-[0.8rem] font-semibold">강조 제목</Label>
                  <input id="tpl-title" type="text" value={tplTitle} onChange={(e) => setTplTitle(e.target.value)} placeholder="핵심 정보" className={INPUT_CLASS} />
                </div>
                <div>
                  <Label htmlFor="tpl-stitle" className="text-[0.8rem] font-semibold">강조 부제목</Label>
                  <input id="tpl-stitle" type="text" value={tplSubtitle} onChange={(e) => setTplSubtitle(e.target.value)} placeholder="보조 문구" className={INPUT_CLASS} />
                </div>
              </div>
            )}

            <div>
              <Label htmlFor="tpl-content" className="text-[0.8rem] font-semibold">템플릿 내용 *</Label>
              <textarea
                id="tpl-content"
                value={tplContent}
                onChange={(e) => setTplContent(e.target.value)}
                placeholder={"#{고객명}님, 안녕하세요.\n주문하신 상품이 발송되었습니다.\n\n■ 주문 정보\n- 상품: #{상품명}\n- 송장번호: #{송장번호}"}
                rows={8}
                className={cn(INPUT_CLASS, "resize-none")}
              />
              <p className="mt-1.5 text-[0.7rem] text-v3-text-muted">
                변수는 {"#{변수명}"} 형식으로 입력하세요. ({tplContent.length}/1,000자)
              </p>
            </div>

            {variables.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {variables.map((v) => (
                  <span key={v} className="inline-flex items-center px-2.5 py-1 rounded-lg bg-v3-primary/5 border border-v3-primary/20 text-[0.7rem] font-medium text-v3-primary">
                    {v}
                  </span>
                ))}
              </div>
            )}

            {(tplType === "EX" || tplType === "MI") && (
              <div>
                <Label htmlFor="tpl-extra" className="text-[0.8rem] font-semibold">부가 정보</Label>
                <textarea id="tpl-extra" value={tplExtra} onChange={(e) => setTplExtra(e.target.value)} placeholder="부가 정보를 입력하세요" rows={3} className={cn(INPUT_CLASS, "resize-none")} />
              </div>
            )}

            {(tplType === "AD" || tplType === "MI") && (
              <div>
                <Label htmlFor="tpl-advert" className="text-[0.8rem] font-semibold">광고 문구 *</Label>
                <input id="tpl-advert" type="text" value={tplAdvert} onChange={(e) => setTplAdvert(e.target.value)} placeholder="수신동의 또는 간단 광고 문구" className={INPUT_CLASS} />
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-3">
                <Label className="text-[0.8rem] font-semibold">버튼 (최대 5개)</Label>
                <button type="button" onClick={addButton} disabled={buttons.length >= 5} className="inline-flex items-center gap-1 text-[0.75rem] font-semibold text-v3-primary hover:text-v3-primary/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                  <Plus className="w-3.5 h-3.5" /> 버튼 추가
                </button>
              </div>

              {buttons.length === 0 && (
                <div className="rounded-xl border border-dashed border-v3-border p-4 text-center text-[0.75rem] text-v3-text-muted">
                  버튼이 없습니다. 위의 &quot;버튼 추가&quot;를 눌러 추가하세요.
                </div>
              )}

              <div className="space-y-3">
                {buttons.map((btn, idx) => (
                  <div key={`btn-${btn.linkType}-${idx}`} className="rounded-xl border border-v3-border p-4 space-y-3 bg-v3-dim-white/30">
                    <div className="flex items-center justify-between">
                      <span className="text-[0.75rem] font-semibold text-v3-dark">버튼 {idx + 1}</span>
                      <button type="button" onClick={() => removeButton(idx)} className="text-red-400 hover:text-red-500 transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-[0.7rem]">버튼명</Label>
                        <input type="text" value={btn.name} onChange={(e) => updateButton(idx, "name", e.target.value)} placeholder="바로가기" className={INPUT_CLASS} />
                      </div>
                      <div>
                        <Label className="text-[0.7rem]">링크 타입</Label>
                        <select value={btn.linkType} onChange={(e) => updateButton(idx, "linkType", e.target.value)} className={SELECT_CLASS}>
                          {BUTTON_LINK_TYPES.map((lt) => <option key={lt.value} value={lt.value}>{lt.label}</option>)}
                        </select>
                      </div>
                    </div>
                    {btn.linkType === "WL" && (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label className="text-[0.7rem]">모바일 링크</Label>
                          <input type="url" value={btn.linkM} onChange={(e) => updateButton(idx, "linkM", e.target.value)} placeholder="https://" className={INPUT_CLASS} />
                        </div>
                        <div>
                          <Label className="text-[0.7rem]">PC 링크</Label>
                          <input type="url" value={btn.linkP} onChange={(e) => updateButton(idx, "linkP", e.target.value)} placeholder="https://" className={INPUT_CLASS} />
                        </div>
                      </div>
                    )}
                    {btn.linkType === "AL" && (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label className="text-[0.7rem]">iOS 스킴</Label>
                          <input type="text" value={btn.linkI} onChange={(e) => updateButton(idx, "linkI", e.target.value)} placeholder="myapp://" className={INPUT_CLASS} />
                        </div>
                        <div>
                          <Label className="text-[0.7rem]">Android 스킴</Label>
                          <input type="text" value={btn.linkA} onChange={(e) => updateButton(idx, "linkA", e.target.value)} placeholder="myapp://" className={INPUT_CLASS} />
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <Separator />

            <button type="button" disabled={!tplName.trim() || !tplContent.trim()} className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-v3-primary text-white text-[0.85rem] font-semibold hover:bg-v3-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm">
              <Send className="w-4 h-4" />
              템플릿 등록 요청
            </button>
          </div>
        </ContentPaper>

        <div className="flex justify-center lg:sticky lg:top-24 self-start">
            <div className="w-[320px] shrink-0">
              <div className="rounded-[44px] border-[3px] border-gray-800 bg-gray-800 shadow-2xl overflow-hidden">
                <div className="bg-gray-800 px-6 pt-3 pb-2 flex items-center justify-between">
                  <span className="text-[0.65rem] text-gray-400 font-medium">{timeStr}</span>
                  <div className="flex items-center gap-1.5">
                    <Signal className="w-3 h-3 text-gray-400" />
                    <Wifi className="w-3 h-3 text-gray-400" />
                    <Battery className="w-3.5 h-3.5 text-gray-400" />
                  </div>
                </div>

                <div className="bg-[#B2C7D9] px-3 py-2 flex items-center gap-2">
                  <ChevronLeft className="w-5 h-5 text-gray-700" />
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <div className="w-8 h-8 rounded-full bg-[#FAE100] flex items-center justify-center shrink-0">
                      <MessageCircle className="w-4 h-4 text-[#3C1E1E]" />
                    </div>
                    <span className="text-[0.8rem] font-bold text-gray-900 truncate">
                      {tplName || "아가잼잼"}
                    </span>
                  </div>
                </div>

                <div className="bg-[#B2C7D9] min-h-[520px] max-h-[520px] overflow-y-auto px-3 py-4 custom-scrollbar">
                  {tplContent.trim() ? (
                    <div className="flex items-end gap-1.5">
                      <div className="w-9 h-9 rounded-full bg-[#FAE100] flex items-center justify-center shrink-0 self-start">
                        <MessageCircle className="w-4 h-4 text-[#3C1E1E]" />
                      </div>
                      <div className="flex flex-col gap-1 min-w-0 max-w-[85%]">
                        <span className="text-[0.7rem] font-semibold text-gray-800 pl-1">아가잼잼</span>
                        <div className="rounded-xl bg-white shadow-sm overflow-hidden">
                          {tplEmType === "TEXT" && tplTitle && (
                            <div className="px-3.5 pt-3 pb-1 border-b border-gray-100">
                              <p className="text-[0.85rem] font-extrabold text-gray-900 leading-tight">{tplTitle}</p>
                              {tplSubtitle && <p className="text-[0.65rem] text-gray-500 mt-0.5">{tplSubtitle}</p>}
                            </div>
                          )}

                          <div className="px-3.5 py-3">
                            <pre className="text-[0.72rem] text-gray-800 leading-relaxed whitespace-pre-wrap font-sans break-all">
                              {tplContent}
                            </pre>
                          </div>

                          {tplExtra && (tplType === "EX" || tplType === "MI") && (
                            <div className="px-3.5 py-2 border-t border-gray-100 bg-gray-50/80">
                              <pre className="text-[0.65rem] text-gray-500 whitespace-pre-wrap font-sans">{tplExtra}</pre>
                            </div>
                          )}

                          {tplAdvert && (tplType === "AD" || tplType === "MI") && (
                            <div className="px-3.5 py-2 border-t border-gray-100 bg-gray-50/80">
                              <p className="text-[0.6rem] text-gray-400">{tplAdvert}</p>
                            </div>
                          )}

                          {buttons.length > 0 && (
                            <div className="border-t border-gray-100">
                              {buttons.map((btn, idx) => (
                                <button
                                  type="button"
                                  key={`preview-btn-${btn.linkType}-${idx}`}
                                  className="w-full text-center py-2.5 text-[0.72rem] font-medium text-[#4A90D9] hover:bg-gray-50 transition-colors border-b border-gray-100 last:border-b-0"
                                >
                                  {btn.name || `버튼 ${idx + 1}`}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        <span className="text-[0.6rem] text-gray-600 pl-1">{timeStr}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-full min-h-[460px]">
                      <div className="text-center">
                        <MessageCircle className="w-8 h-8 mx-auto mb-2 text-gray-500/40" />
                        <p className="text-[0.72rem] text-gray-600/70">템플릿 내용을 입력하면<br />미리보기가 표시됩니다</p>
                      </div>
                    </div>
                  )}
                </div>

                <div className="bg-[#EFF2F6] px-3 py-2.5 flex items-center gap-2">
                  <div className="flex-1 rounded-full bg-white px-3.5 py-2 text-[0.7rem] text-gray-400">
                    메시지 입력
                  </div>
                  <div className="w-8 h-8 rounded-full bg-[#FAE100] flex items-center justify-center shrink-0">
                    <Send className="w-3.5 h-3.5 text-[#3C1E1E]" />
                  </div>
                </div>

                <div className="bg-gray-800 h-5 flex items-center justify-center">
                  <div className="w-28 h-1 rounded-full bg-gray-600" />
                </div>
              </div>
          </div>
        </div>
    </section>
  );
}

export default function AlimtalkPage() {
  const [activeSection, setActiveSection] = useState<SectionId>("overview");

  return (
    <section data-component="alimtalk" className="space-y-6">
      <div data-component="alimtalk-content" className="flex flex-col lg:flex-row gap-8">
        <SectionNav
          items={NAV_SECTIONS}
          activeId={activeSection}
          onSelect={(id) => setActiveSection(id as SectionId)}
        />

        <div data-component="alimtalk-sections" className="flex-1 min-w-0">
          {activeSection === "overview" && (
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

                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
                  {STATS.map((stat) => {
                    const Icon = stat.icon;
                    return (
                      <div
                        key={stat.label}
                        className="flex items-center gap-3 p-4 rounded-2xl border border-v3-border/50 bg-white"
                      >
                        <div className={`w-10 h-10 rounded-xl ${stat.bg} flex items-center justify-center shrink-0`}>
                          <Icon className={`w-5 h-5 ${stat.color}`} />
                        </div>
                        <div>
                          <p className="text-[0.75rem] text-v3-text-muted">{stat.label}</p>
                          <p className="text-lg font-bold text-v3-dark">{stat.value}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="rounded-2xl border border-dashed border-v3-border p-12 text-center">
                  <MessageCircle className="w-10 h-10 mx-auto mb-3 text-v3-text-muted opacity-30" />
                  <p className="text-[0.85rem] font-semibold text-v3-text-muted mb-1">발송 현황이 없습니다</p>
                  <p className="text-[0.75rem] text-v3-text-muted">알림톡을 발송하면 여기에 현황이 표시됩니다.</p>
                </div>
              </ContentPaper>
            </section>
          )}

          {activeSection === "history" && (
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

                <div className="rounded-2xl border border-dashed border-v3-border p-12 text-center">
                  <History className="w-10 h-10 mx-auto mb-3 text-v3-text-muted opacity-30" />
                  <p className="text-[0.85rem] font-semibold text-v3-text-muted mb-1">발송 내역이 없습니다</p>
                  <p className="text-[0.75rem] text-v3-text-muted">알림톡을 발송하면 여기에 내역이 표시됩니다.</p>
                </div>
              </ContentPaper>
            </section>
          )}

          {activeSection === "templates" && <TemplateCreator />}

          {activeSection === "settings" && (
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
                      설정으로 이동
                    </a>
                  </div>
                </div>
              </ContentPaper>
            </section>
          )}
        </div>
      </div>
    </section>
  );
}
