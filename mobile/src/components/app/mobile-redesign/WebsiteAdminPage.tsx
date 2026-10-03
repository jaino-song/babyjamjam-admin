"use client";

import { Flag, Link2, Palette, Save } from "lucide-react";
import { useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";

import { SlidingCard } from "@/components/app/mobile-redesign/sliding-card";
import {
  SettingsListCard,
  SettingsListItem,
  SettingsListRowsSkeleton,
} from "@/components/app/mobile-redesign/settings/SettingsListCard";
import { PolicyInfoRows } from "@/components/app/mobile-redesign/settings/PolicyInfoRows";
import { StatusPill } from "@/components/app/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { getRibbonConfig, updateRibbonConfig, type RibbonConfig } from "@/lib/api/website-admin";
import { useToast } from "@/hooks/use-toast";

import "@/components/app/mobile-redesign/redesign.css";

const PAGE_BASE = "mobile_website-admin_page";
const SLIDING_BASE = `${PAGE_BASE}_screen_content_sliding-card`;
const LIST_BASE = `${SLIDING_BASE}_stage_list-pane_website-admin-list`;
const DETAIL_BASE = `${SLIDING_BASE}_stage_detail-pane_body_ribbon`;
const RIBBON_ID = "ribbon";

export const DEFAULT_RIBBON_CONFIG: RibbonConfig = {
  enabled: false,
  message: "",
  backgroundColor: "#004AAD",
  textColor: "#FFFFFF",
  linkText: "",
  linkHref: "",
  linkColor: "#FFB27B",
};

function DetailContent({ children, trailing }: { children: ReactNode; trailing?: ReactNode }): ReactElement {
  return (
    <div data-component={DETAIL_BASE} data-source-component="DetailContent" className="flex flex-col gap-[calc(18px*var(--glint-ui-scale,1))]">
      <section data-component={`${DETAIL_BASE}_hero`} className="flex items-center gap-[calc(12px*var(--glint-ui-scale,1))]">
        <span data-component={`${DETAIL_BASE}_hero_icon`} className="flex h-[calc(46px*var(--glint-ui-scale,1))] w-[calc(46px*var(--glint-ui-scale,1))] shrink-0 items-center justify-center rounded-[calc(14px*var(--glint-ui-scale,1))] bg-v3-primary-light text-v3-primary" aria-hidden="true">
          <Flag className="h-[calc(20px*var(--glint-ui-scale,1))] w-[calc(20px*var(--glint-ui-scale,1))]" strokeWidth={2.25} />
        </span>
        <span data-component={`${DETAIL_BASE}_hero_copy`} className="flex min-w-0 flex-1 flex-col gap-[calc(4px*var(--glint-ui-scale,1))]">
          <span className="flex items-center justify-between gap-[calc(8px*var(--glint-ui-scale,1))]">
            <h2 data-component={`${DETAIL_BASE}_hero_copy_title`} className="text-[calc(0.94rem*var(--glint-ui-scale,1))] font-bold leading-[calc(1.25rem*var(--glint-ui-scale,1))] text-v3-dark">리본 배너</h2>
            {trailing ? <span data-component={`${DETAIL_BASE}_hero_trailing`} className="shrink-0">{trailing}</span> : null}
          </span>
          <p data-component={`${DETAIL_BASE}_hero_copy_description`} className="text-[calc(0.7rem*var(--glint-ui-scale,1))] leading-[calc(1.05rem*var(--glint-ui-scale,1))] text-v3-text-muted">홈페이지 상단에 표시되는 알림 리본을 관리합니다.</p>
        </span>
      </section>
      {children}
    </div>
  );
}

function ColorField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}): ReactElement {
  return (
    <div data-component={`${DETAIL_BASE}_${id}`} className="flex min-w-0 flex-1 flex-col gap-1.5">
      <Label htmlFor={`${id}-text`} className="text-[calc(0.68rem*var(--glint-ui-scale,1))] font-semibold text-v3-text-muted">{label}</Label>
      <div className="flex min-w-0 items-center gap-2">
        <Input id={`${id}-color`} type="color" value={value} onChange={(event) => onChange(event.target.value)} aria-label={`${label} 선택`} data-component={`${DETAIL_BASE}_${id}_picker`} className="h-11 w-11 shrink-0 cursor-pointer rounded-[12px] border-[1.5px] border-input bg-white p-1" />
        <Input id={`${id}-text`} variant="v3" value={value} onChange={(event) => onChange(event.target.value)} aria-label={`${label} 코드`} data-component={`${DETAIL_BASE}_${id}_input`} className="min-w-0 px-2.5 font-mono text-[0.75rem]" />
      </div>
    </div>
  );
}

function stopClick(event: React.SyntheticEvent): void {
  event.stopPropagation();
}

export function WebsiteAdminPage(): ReactElement {
  const router = useRouter();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const didPushDetailRef = useRef(false);
  const selectedId = params.get("item");
  const ribbonQuery = useQuery({ queryKey: ["settings", "ribbon-config"], queryFn: getRibbonConfig });
  const [draft, setDraft] = useState<Partial<RibbonConfig>>({});
  const baseConfig = ribbonQuery.data ?? DEFAULT_RIBBON_CONFIG;
  const form = useMemo(() => ({ ...baseConfig, ...draft }), [baseConfig, draft]);
  const isDirty = Object.keys(draft).length > 0;
  const updateField = <K extends keyof RibbonConfig>(key: K, value: RibbonConfig[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const saveMutation = useMutation({
    mutationFn: updateRibbonConfig,
    onSuccess: (data) => {
      queryClient.setQueryData(["settings", "ribbon-config"], data);
      setDraft({});
      toast({ variant: "success", description: "리본 배너 설정을 저장했어요" });
    },
    onError: () => toast({ variant: "destructive", description: "리본 배너 설정을 저장하지 못했어요" }),
  });
  const openDetail = () => {
    router.push("/website-admin?item=ribbon", { scroll: false });
    didPushDetailRef.current = true;
  };
  const closeDetail = () => {
    if (didPushDetailRef.current) router.back();
    else router.replace("/website-admin", { scroll: false });
  };
  const toggleFromList = (enabled: boolean) => {
    if (!ribbonQuery.data || saveMutation.isPending) return;
    saveMutation.mutate({ ...ribbonQuery.data, enabled });
  };
  const detail = selectedId === RIBBON_ID ? (
    <DetailContent trailing={<Switch id="website-ribbon-enabled" aria-label="리본 배너 활성화" checked={form.enabled} onCheckedChange={(value) => updateField("enabled", value)} className="[--v3-ui-scale:var(--glint-ui-scale,1)]" />}>
      <Separator />
      <label data-component={`${DETAIL_BASE}_message_field`} className="flex flex-col gap-1.5"><Label htmlFor="website-ribbon-message" className="text-[calc(0.7rem*var(--glint-ui-scale,1))] font-semibold text-v3-text-muted">메시지</Label><Input id="website-ribbon-message" variant="v3" value={form.message} onChange={(event) => updateField("message", event.target.value)} placeholder="리본에 표시할 메시지를 입력하세요" data-component={`${DETAIL_BASE}_message_input`} /></label>
      <div data-component={`${DETAIL_BASE}_colors`} className="flex flex-col gap-3"><div className="flex items-center gap-2 text-[calc(0.68rem*var(--glint-ui-scale,1))] font-semibold text-v3-text-muted"><Palette className="h-4 w-4" />색상</div><div className="flex gap-2"><ColorField id="background-color" label="배경" value={form.backgroundColor} onChange={(value) => updateField("backgroundColor", value)} /><ColorField id="text-color" label="텍스트" value={form.textColor} onChange={(value) => updateField("textColor", value)} /></div><ColorField id="link-color" label="링크" value={form.linkColor} onChange={(value) => updateField("linkColor", value)} /></div>
      <div data-component={`${DETAIL_BASE}_link`} className="flex flex-col gap-3"><div className="flex items-center gap-2 text-[calc(0.68rem*var(--glint-ui-scale,1))] font-semibold text-v3-text-muted"><Link2 className="h-4 w-4" />링크 (선택)</div><label className="flex flex-col gap-1.5"><Label htmlFor="website-ribbon-link-text" className="text-[calc(0.68rem*var(--glint-ui-scale,1))] font-semibold text-v3-text-muted">링크 문구</Label><Input id="website-ribbon-link-text" variant="v3" value={form.linkText} onChange={(event) => updateField("linkText", event.target.value)} placeholder="자세히 보기" data-component={`${DETAIL_BASE}_link_text`} /></label><label className="flex flex-col gap-1.5"><Label htmlFor="website-ribbon-link-href" className="text-[calc(0.68rem*var(--glint-ui-scale,1))] font-semibold text-v3-text-muted">링크 주소</Label><Input id="website-ribbon-link-href" variant="v3" value={form.linkHref} onChange={(event) => updateField("linkHref", event.target.value)} placeholder="https://..." data-component={`${DETAIL_BASE}_link_href`} /></label></div>
      <section data-component={`${DETAIL_BASE}_preview`} className="overflow-hidden rounded-[calc(12px*var(--glint-ui-scale,1))] border border-v3-border"><div className="px-3 py-2 text-[calc(0.62rem*var(--glint-ui-scale,1))] font-semibold text-v3-text-muted">미리보기</div><div className="flex min-h-[42px] items-center justify-center gap-2 px-3 py-2 text-center text-[calc(0.72rem*var(--glint-ui-scale,1))] font-semibold" style={{ backgroundColor: form.backgroundColor, color: form.textColor }}>{form.message || "리본 배너 메시지"}{form.linkText ? <span style={{ color: form.linkColor }} className="underline">{form.linkText}</span> : null}</div></section>
      <PolicyInfoRows data-component={`${DETAIL_BASE}_info`} title="안내" rows={[{ id: "enabled", label: "현재 상태", value: form.enabled ? "활성" : "비활성" }, { id: "message", label: "메시지", value: form.message || "미입력" }, { id: "link", label: "링크", value: form.linkHref || "없음" }]} />
      <Button type="button" variant="v3" size="lg" width="lg" disabled={!isDirty || saveMutation.isPending} onClick={() => saveMutation.mutate(form)} data-component={`${DETAIL_BASE}_save`}><Save className="h-4 w-4" />{saveMutation.isPending ? "저장 중…" : "설정 저장"}</Button>
    </DetailContent>
  ) : null;

  const list = <SettingsListCard data-component={LIST_BASE} title="홈페이지 관리" count={1} subtitle="홈페이지에 노출되는 콘텐츠와 설정을 관리합니다.">
    {ribbonQuery.isLoading ? <SettingsListRowsSkeleton data-component={`${LIST_BASE}_loading`} rowCount={1} /> : <SettingsListItem data-component={`${LIST_BASE}_item-ribbon`} icon={Flag} title="리본 배너" subtitle="홈페이지 상단 알림 리본 설정" isSelected={selectedId === RIBBON_ID} onSelect={openDetail} control={<span onClick={stopClick} onPointerDown={stopClick}><Switch data-component={`${LIST_BASE}_item-ribbon_switch`} thumbDataComponent={`${LIST_BASE}_item-ribbon_switch_thumb`} aria-label="리본 배너 활성화" checked={form.enabled} disabled={!ribbonQuery.data || saveMutation.isPending} onCheckedChange={toggleFromList} className="[--v3-ui-scale:var(--glint-ui-scale,1)]" /></span>} />}
    {ribbonQuery.isError ? <div className="flex flex-col gap-2 rounded-[calc(14px*var(--glint-ui-scale,1))] bg-v3-dim-white p-3 text-[calc(0.7rem*var(--glint-ui-scale,1))] text-v3-text-muted"><span>리본 배너 설정을 불러오지 못했습니다.</span><Button type="button" variant="outline" size="sm" onClick={() => void ribbonQuery.refetch()} data-component={`${LIST_BASE}_retry`}>다시 시도</Button></div> : null}
  </SettingsListCard>;

  return <section data-component={PAGE_BASE} data-slot="messages-page" data-page="website-admin" className="messages-page flex min-h-0 w-full flex-1"><div data-component={`${PAGE_BASE}_screen`} className="relative flex min-h-0 w-full flex-1 overflow-hidden"><div data-component={`${PAGE_BASE}_screen_content`} data-slot="messages-content" className="shell-content relative min-h-0 flex-1 flex-col gap-[calc(8px*var(--glint-ui-scale,1))] !overflow-hidden"><SlidingCard data-component={SLIDING_BASE} open={selectedId === RIBBON_ID} onBack={closeDetail} backLabel="홈페이지 관리" detailKey={selectedId} list={list} detail={detail} detailHeaderTrailing={selectedId === RIBBON_ID ? <StatusPill data-component={`${SLIDING_BASE}_stage_detail-pane_header_status`} variant={form.enabled ? "success" : "neutral"} className="!rounded-[calc(999px*var(--glint-ui-scale,1))] !px-[calc(8px*var(--glint-ui-scale,1))] !py-[calc(4px*var(--glint-ui-scale,1))] !text-[calc(0.62rem*var(--glint-ui-scale,1))]">{form.enabled ? "활성" : "비활성"}</StatusPill> : null} /></div></div></section>;
}
