import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ContractDocumentJob } from "./ContractDocumentJobsPopover";
import { ContractDocumentJobsModal } from "./ContractDocumentJobsModal";
import { DocumentJobProgressSummary, documentJobProgressPercent } from "./DocumentJobProgressSummary";

const JOB: ContractDocumentJob = { jobId: "progress-job", jobType: "create_document", status: "processing", clientName: "예시 고객", documentKind: "service_contract", displayOperation: "generate", documentId: "doc /1" };
const BASE = "desktop_contracts_jobs-modal_detail_progress";
const cases = [
  ["queued", "queued", "service_contract", "처리 대기", 0, "작업이 시작되기를 기다리고 있습니다."],
  ["processing", "dispatch_authorized", "service_contract", "전송 준비 중", undefined, "문서 처리 준비 상태를 확인하고 있습니다."],
  ["processing", "future_step", "service_contract", "현재 상태 확인 중", undefined, "확인된 진행 정보가 없어 현재 상태를 확인하고 있습니다."],
  ["processing", "2/4", "service_contract", "현재 상태 확인 중", undefined, "확인된 진행 정보가 없어 현재 상태를 확인하고 있습니다."],
  ["processing", "sent", "service_contract", "현재 상태 확인 중", undefined, "확인된 진행 정보가 없어 현재 상태를 확인하고 있습니다."],
  ["reconciling", "sent", "service_contract", "현재 상태 확인 중", undefined, "처리 결과를 확인하고 있습니다."],
  ["completed", "sent", "service_contract", "작업 완료", 100, "작업 처리가 종료되었습니다."],
  ["completed", "manual_resolved", "service_contract", "직접 처리됨", 100, "담당자가 직접 처리한 것으로 기록된 작업입니다."],
  ["processing", "sent", "service_record", "현재 상태 확인 중", undefined, "확인된 진행 정보가 없어 현재 상태를 확인하고 있습니다."],
  ["queued", "queued", "service_record", "현재 상태 확인 중", undefined, "확인된 진행 정보가 없어 현재 상태를 확인하고 있습니다."],
  ["processing", "dispatch_authorized", "service_record", "현재 상태 확인 중", undefined, "확인된 진행 정보가 없어 현재 상태를 확인하고 있습니다."],
  ["completed", "sent", "service_record", "작업 완료", 100, "작업 처리가 종료되었습니다."],
  ["processing", "manual_in_progress", "service_contract", "수동 처리 중", undefined, "수동 처리 작업이 진행 중입니다. 담당자의 처리 결과를 기다려 주세요."],
  ["failed", "manual_in_progress:42:private-expiry", "service_contract", "수동 처리 중", undefined, "수동 처리 작업이 진행 중입니다. 담당자의 처리 결과를 기다려 주세요."],
  ["completed", "manual_in_progress:42:private-expiry", "service_contract", "수동 처리 중", undefined, "수동 처리 작업이 진행 중입니다. 담당자의 처리 결과를 기다려 주세요."],
  ["queued", "dispatch_authorized", "service_contract", "처리 대기", 0, "작업이 시작되기를 기다리고 있습니다."],
  ["failed", "failed", "service_contract", "처리 실패", undefined, "아래 작업 정보를 확인해 주세요."],
  ["requires_attention", null, "service_contract", "처리 실패", undefined, "아래 작업 정보를 확인해 주세요."],
  ["queued", "queued", "unknown", "현재 상태 확인 중", undefined, "확인된 진행 정보가 없어 현재 상태를 확인하고 있습니다."],
  ["queued", "queued", undefined, "현재 상태 확인 중", undefined, "확인된 진행 정보가 없어 현재 상태를 확인하고 있습니다."],
  ["completed", "manual_resolved:42", "service_contract", "작업 완료", 100, "작업 처리가 종료되었습니다."],
  ["processing", "manual_in_progress_extra", "service_contract", "현재 상태 확인 중", undefined, "확인된 진행 정보가 없어 현재 상태를 확인하고 있습니다."],
  ["future_status", "dispatch_authorized", "service_contract", "현재 상태 확인 중", undefined, "확인된 진행 정보가 없어 현재 상태를 확인하고 있습니다."],
  ["completed", "manual_in_progress", "service_contract", "수동 처리 중", undefined, "수동 처리 작업이 진행 중입니다. 담당자의 처리 결과를 기다려 주세요."],
  ["failed", "manual_in_progress", "service_contract", "수동 처리 중", undefined, "수동 처리 작업이 진행 중입니다. 담당자의 처리 결과를 기다려 주세요."],
  ["processing", "manual_resolved", "service_contract", "현재 상태 확인 중", undefined, "확인된 진행 정보가 없어 현재 상태를 확인하고 있습니다."],
  ["failed", "manual_resolved", "service_contract", "처리 실패", undefined, "아래 작업 정보를 확인해 주세요."],
] as const;

test.each(cases)("maps %s/%s/%s to safe work-state %s", (status, progressStep, documentKind, title, value, notice) => {
  const { container } = render(<DocumentJobProgressSummary job={{ ...JOB, status, progressStep, documentKind }} data-component={BASE} />);
  expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
  const ring = screen.getByRole(value === undefined ? "status" : "progressbar", { name: title });
  if (value === undefined) {
    for (const attr of ["aria-valuenow", "aria-valuemin", "aria-valuemax"]) expect(ring).not.toHaveAttribute(attr);
    expect(container.querySelector('[data-slot="progress-arc"]')).toHaveAttribute("stroke-opacity", "0");
  } else {
    expect(ring).toHaveAttribute("aria-valuenow", String(value)); expect(ring).toHaveAttribute("aria-valuemin", "0"); expect(ring).toHaveAttribute("aria-valuemax", "100");
    expect(ring).toHaveAttribute("aria-valuetext", title);
  }
  const icon = container.querySelector('[data-slot="progress-center"] svg');
  expect(icon).toHaveAttribute("aria-hidden", "true");
  const center = container.querySelector('[data-slot="progress-center"]');
  expect(center).toHaveClass(value === 100 ? "bg-status-success-fg" : title === "처리 실패" ? "bg-status-danger-fg" : "bg-white");
  expect(center).toHaveClass(value === 100 || title === "처리 실패" ? "text-white" : value === 0 ? "text-v3-primary" : "text-v3-text-muted");
  expect(icon?.getAttribute("class")).toMatch(value === 100 ? /lucide-check/ : title === "처리 실패" ? /lucide-(triangle-alert|alert-triangle)/ : /lucide-clock/);
  expect(container.querySelector('[data-slot="progress-notice"]')?.textContent).toBe(notice);
  expect(container.textContent).not.toMatch(/전송 완료|자동|future_step|2\/4|manual_|private-expiry|42|%/);
  expect(container.querySelector('[data-slot*="timeline"]')).toBeNull();
});

test("distinguishes human-marked completion from ordinary work completion without delivery claims", () => {
  const { rerender } = render(<DocumentJobProgressSummary job={{ ...JOB, status: "completed", progressStep: "manual_resolved" }} />);
  expect(screen.getByText("담당자가 직접 처리한 것으로 기록된 작업입니다.")).toBeInTheDocument();
  rerender(<DocumentJobProgressSummary job={{ ...JOB, status: "completed", progressStep: "sent" }} />);
  expect(screen.getByText("작업 처리가 종료되었습니다.")).toBeInTheDocument();
});

test("uses the independent 84/r40/5 SVG geometry, fixed inset, static presentation and full owner metadata", () => {
  const { container, rerender } = render(<DocumentJobProgressSummary job={{ ...JOB, status: "queued" }} data-component={BASE} />);
  const svg = container.querySelector('[data-slot="progress-ring-svg"]')!;
  expect(svg).toHaveAttribute("viewBox", "0 0 84 84"); expect(svg).toHaveAttribute("width", "84"); expect(svg).toHaveAttribute("height", "84");
  expect(svg).toHaveClass("-rotate-90", "overflow-visible");
  expect(container.querySelector('[data-slot="progress-ring"]')).toHaveClass("h-[84px]", "w-[84px]");
  expect(container.querySelector('[data-slot="progress-track"]')).toHaveClass("stroke-current", "text-v3-border");
  for (const circle of svg.querySelectorAll("circle")) { expect(circle).toHaveAttribute("cx", "42"); expect(circle).toHaveAttribute("cy", "42"); expect(circle).toHaveAttribute("r", "40"); expect(circle).toHaveAttribute("stroke-width", "5"); }
  const arc = container.querySelector('[data-slot="progress-arc"]')!;
  expect(Number(arc.getAttribute("stroke-dasharray"))).toBeCloseTo(251.32741228718345);
  expect(Number(arc.getAttribute("stroke-dashoffset"))).toBeCloseTo(251.32741228718345);
  expect(container.querySelector('[data-slot="progress-center"]')).toHaveClass("inset-[12px]");
  expect(container.querySelector('[data-slot="progress-center"] svg')).toHaveAttribute("width", "24");
  expect(container.firstElementChild).toHaveAttribute("data-source-component", "DocumentJobProgressSummary");
  expect(container.querySelector('[data-slot="progress-track"]')).toHaveAttribute("data-component", `${BASE}_hero_ring_svg_track`);
  const annotated = container.querySelectorAll<HTMLElement>("[data-component]"); expect(annotated.length).toBeGreaterThan(7);
  for (const node of annotated) { const owner = node.parentElement?.closest("[data-component]"); if (owner) expect(node.getAttribute("data-component")?.startsWith(`${owner.getAttribute("data-component")}_`)).toBe(true); }
  expect(container.innerHTML).not.toMatch(/animate-|transition|<animate/);
  rerender(<DocumentJobProgressSummary job={{ ...JOB, status: "completed" }} />);
  expect(Number(container.querySelector('[data-slot="progress-arc"]')?.getAttribute("stroke-dashoffset"))).toBe(0);
  expect(container.querySelector("[data-component]")).toBeNull();
});

test("does not expose raw errors, contact details, user IDs or arbitrary checkpoint text", () => {
  const job = { ...JOB, progressStep: "unknown-private-step", lastErrorCode: "raw-provider-error", payload: { secret: "raw-payload" }, phone: "010-0000-0000" };
  const { container } = render(<DocumentJobProgressSummary job={job} />);
  expect(container.textContent).not.toMatch(/raw-provider-error|raw-payload|010-0000-0000|unknown-private-step/);
});

function OwnerHarness() {
  const ref = React.useRef<HTMLButtonElement>(null);
  return <><button ref={ref}>작업 열기</button><ContractDocumentJobsModal open onClose={() => {}} anchorRef={ref} isLoading={false} jobs={{ active: [JOB], requiresAttention: [], recent: [] }} data-component="desktop_contracts_jobs-modal" /></>;
}
test("real owner keeps Summary in the sliding header and adds progress as Detail's first child before metadata", () => {
  const { container } = render(<OwnerHarness />);
  fireEvent.click(screen.getByRole("button", { name: "예시 고객 · 서비스 계약서 생성 · 처리 중 상세 보기" }));
  const detail = document.querySelector('[data-slot="job-detail-body"]')!;
  expect(detail.firstElementChild).toHaveAttribute("data-slot", "job-progress-section");
  expect(detail.firstElementChild).toHaveAttribute("data-component", "desktop_contracts_jobs-modal_slide_detail-pane_body_scroll_job_progress");
  expect(detail.children[1]).toHaveAttribute("data-slot", "job-info-card");
  expect(document.querySelector('[data-slot="sliding-detail-header"]')).toContainElement(document.querySelector('[data-slot="job-detail-summary"]') as HTMLElement);
  expect(detail.querySelector('[data-slot="job-detail-summary"]')).toBeNull();
  expect(screen.getByRole("link", { name: "문서 보기" })).toHaveAttribute("href", "/contracts?documentId=doc%20%2F1");
  expect(container.querySelector("iframe")).toBeNull();
});

test.each([[2, 4, 50], [0, 100, 0], [100, 100, 100], [8, 4, 100], [-1, 4, 0], [1, 0, 0], [NaN, 4, 0], [Infinity, 4, 0], [1, Infinity, 0], [1, -1, 0]])("geometry helper normalizes %s/%s to %s without implying real job counts", (done, total, expected) => {
  expect(documentJobProgressPercent(done, total)).toBe(expected);
});
// @ts-expect-error Callers cannot forge a job progress value.
void (<DocumentJobProgressSummary job={JOB} percent={50} />);
