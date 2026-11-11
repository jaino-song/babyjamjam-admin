import { AlertTriangle, Check, Clock3 } from "lucide-react";
import type { ContractDocumentJob } from "./ContractDocumentJobsPopover";

interface DocumentJobProgressSummaryProps {
  job: ContractDocumentJob;
  "data-component"?: string;
}
type ProgressView = { title: string; notice: string; state: "waiting" | "unknown" | "done" | "error"; value?: 0 | 100 };

/** Geometry only: these synthetic counts never infer a document-job checkpoint. */
export function documentJobProgressPercent(done: number, total: number): number {
  if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.min(100, Math.max(0, done / total * 100));
}
function progressView(job: ContractDocumentJob): ProgressView {
  const step = job.progressStep;
  if (job.status === "completed" && step === "manual_resolved") return { state: "done", value: 100, title: "직접 처리됨", notice: "담당자가 직접 처리한 것으로 기록된 작업입니다." };
  if (step === "manual_in_progress" || step?.startsWith("manual_in_progress:")) return { state: "unknown", title: "수동 처리 중", notice: "수동 처리 작업이 진행 중입니다. 담당자의 처리 결과를 기다려 주세요." };
  if (job.status === "completed") return { state: "done", value: 100, title: "작업 완료", notice: "작업 처리가 종료되었습니다." };
  if (job.status === "reconciling") return { state: "unknown", title: "현재 상태 확인 중", notice: "처리 결과를 확인하고 있습니다." };
  if (job.status === "failed" || job.status === "requires_attention") return { state: "error", title: "처리 실패", notice: "아래 작업 정보를 확인해 주세요." };
  if (job.documentKind === "service_contract" && job.status === "queued") return { state: "waiting", value: 0, title: "처리 대기", notice: "작업이 시작되기를 기다리고 있습니다." };
  if (job.documentKind === "service_contract" && job.status === "processing" && step === "dispatch_authorized") return { state: "unknown", title: "전송 준비 중", notice: "문서 처리 준비 상태를 확인하고 있습니다." };
  return { state: "unknown", title: "현재 상태 확인 중", notice: "확인된 진행 정보가 없어 현재 상태를 확인하고 있습니다." };
}

export function DocumentJobProgressSummary({ job, "data-component": base }: DocumentJobProgressSummaryProps): React.ReactElement {
  const view = progressView(job);
  const sub = (suffix: string) => base ? `${base}_${suffix}` : undefined;
  const circumference = 2 * Math.PI * 40;
  const percent = view.value === undefined ? undefined : documentJobProgressPercent(view.value, 100);
  const Icon = view.state === "done" ? Check : view.state === "error" ? AlertTriangle : Clock3;
  const arcColor = view.state === "done" ? "text-status-success-fg" : view.state === "error" ? "text-status-danger-fg" : "text-v3-primary";
  const centerColor = view.state === "done" ? "bg-status-success-fg text-white" : view.state === "error" ? "bg-status-danger-fg text-white" : view.state === "waiting" ? "bg-white text-v3-primary" : "bg-white text-v3-text-muted";
  return <section data-component={base} data-slot="job-progress-section" data-source-component="DocumentJobProgressSummary" className="flex w-full flex-col items-center gap-5 py-2">
    <div data-component={sub("hero")} data-slot="progress-hero" className="flex flex-col items-center gap-2.5 text-center">
      <div data-component={sub("hero_ring")} data-slot="progress-ring" data-state={view.state} className="relative h-[84px] w-[84px] shrink-0"
        role={percent === undefined ? "status" : "progressbar"} aria-label={view.title}
        aria-valuenow={percent} aria-valuemin={percent === undefined ? undefined : 0} aria-valuemax={percent === undefined ? undefined : 100} aria-valuetext={percent === undefined ? undefined : view.title}>
        <svg data-component={sub("hero_ring_svg")} data-slot="progress-ring-svg" viewBox="0 0 84 84" width="84" height="84" aria-hidden="true" className="absolute inset-0 -rotate-90 overflow-visible fill-none">
          <circle data-component={sub("hero_ring_svg_track")} data-slot="progress-track" cx="42" cy="42" r="40" strokeWidth="5" className="stroke-current text-v3-border" />
          <circle data-component={sub("hero_ring_svg_arc")} data-slot="progress-arc" cx="42" cy="42" r="40" strokeWidth="5" strokeLinecap="round"
            strokeDasharray={circumference} strokeDashoffset={percent === undefined ? circumference : circumference * (1 - percent / 100)} strokeOpacity={percent === undefined ? 0 : 1} className={`stroke-current ${arcColor}`} />
        </svg>
        <div data-component={sub("hero_ring_center")} data-slot="progress-center" className={`absolute inset-[12px] grid place-items-center rounded-full shadow-v3 ${centerColor}`}>
          <Icon data-component={sub("hero_ring_center_icon")} aria-hidden="true" size={24} strokeWidth={view.state === "done" || view.state === "error" ? 3 : 2} />
        </div>
      </div>
      <h3 data-component={sub("hero_title")} data-slot="progress-title" aria-live="polite" className={`text-[17px] font-bold leading-[1.375] ${view.state === "error" ? "text-status-danger-fg" : "text-v3-dark"}`}>{view.title}</h3>
      <p data-component={sub("hero_notice")} data-slot="progress-notice" className="text-xs leading-5 text-v3-text-muted">{view.notice}</p>
    </div>
  </section>;
}
