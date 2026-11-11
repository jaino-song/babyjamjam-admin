import { fireEvent, render, screen, within } from "@testing-library/react";

import { ContractDocumentJobDetail } from "./ContractDocumentJobDetail";
import { ContractDocumentJobSummary } from "./ContractDocumentJobSummary";
import type { ContractDocumentJob } from "./ContractDocumentJobsPopover";

const JOB: ContractDocumentJob = {
  jobId: "detail-job", jobType: "create_document", status: "processing",
  clientName: "예시 고객", documentKind: "service_contract", displayOperation: "generate",
};
const BASE = "desktop_contracts_jobs-modal_detail";

function row(label: string) {
  return within(screen.getByText(label).closest('[data-slot="job-info-row"]') as HTMLElement);
}

describe("ContractDocumentJobSummary", () => {
  it.each([
    ["service_contract", "generate", "서비스 계약서 생성"],
    ["service_contract", "review", "서비스 계약서 검토"],
    ["service_record", "generate", "제공기록지 생성"],
  ] as const)("should display the projected %s/%s operation", (documentKind, displayOperation, label) => {
    const { container } = render(<ContractDocumentJobSummary job={{ ...JOB, documentKind, displayOperation }} data-component={BASE} />);
    expect(screen.getByRole("heading", { name: "예시 고객" })).toBeInTheDocument();
    expect(screen.getByText(label)).toBeInTheDocument();
    const root = container.querySelector('[data-slot="job-detail-summary"]');
    expect(root).toHaveAttribute("data-component", BASE);
    expect(root?.querySelector('[data-slot="job-detail-avatar"]')).toHaveAttribute("data-component", "desktop_contracts_jobs-modal_detail_avatar");
    expect(root?.querySelector('[data-slot="job-detail-heading"]')).toHaveAttribute("data-component", "desktop_contracts_jobs-modal_detail_heading");
    expect(screen.getByRole("heading", { name: "예시 고객" })).toHaveAttribute("data-component", "desktop_contracts_jobs-modal_detail_heading_customer");
    expect(screen.getByText(label)).toHaveAttribute("data-component", "desktop_contracts_jobs-modal_detail_heading_type");
    expect(screen.getByText("처리 중")).toHaveAttribute("data-component", "desktop_contracts_jobs-modal_detail_status");
    expect(root?.querySelector('[data-slot="job-detail-heading"]')?.parentElement).toBe(root);
    expect(root?.querySelector('[data-slot="status-badge"]')?.parentElement).toBe(root);
  });

  it.each([
    ["queued", "대기"], ["processing", "처리 중"], ["reconciling", "확인 중"],
    ["completed", "완료"], ["failed", "처리 실패"], ["requires_attention", "처리 실패"],
    ["new_status", "상태 확인 필요"],
  ])("should show safe status copy for %s", (status, label) => {
    render(<ContractDocumentJobSummary job={{ ...JOB, status }} />);
    expect(screen.getByText(label)).toHaveAttribute("data-source-component", "StatusBadge");
  });

  it.each([
    ["new_status", "상태 확인 필요", "bg-status-neutral border-status-neutral-line text-status-neutral-fg"],
    ["failed", "처리 실패", "bg-status-danger border-status-danger-line text-status-danger-fg"],
    ["requires_attention", "처리 실패", "bg-status-danger border-status-danger-line text-status-danger-fg"],
    ["completed", "완료", "bg-status-success border-status-success-line text-status-success-fg"],
  ])("should pass the fixed badge variant for %s", (status, label, expectedClasses) => {
    render(<ContractDocumentJobSummary job={{ ...JOB, status }} />);
    expect(screen.getByText(label)).toHaveClass(expectedClasses);
  });

  it.each([null, undefined, "  "])("should show a missing customer fallback for %s", (clientName) => {
    render(<ContractDocumentJobSummary job={{ ...JOB, clientName }} />);
    expect(screen.getByRole("heading", { name: "고객 정보 확인 필요" })).toBeInTheDocument();
  });

  it("should not infer a document type from jobType/source", () => {
    render(<ContractDocumentJobSummary job={{ ...JOB, documentKind: undefined, displayOperation: undefined, source: "auto_finalize" }} />);
    expect(screen.getByText("작업 유형 확인 필요")).toBeInTheDocument();
    expect(screen.queryByText("서비스 계약서 생성")).not.toBeInTheDocument();
  });
});

describe("ContractDocumentJobDetail document navigation", () => {
  it.each([false, true])("calls the optional callback once without preventing the existing link (meta=%s)", (metaKey) => {
    const onDocumentNavigate = jest.fn();
    render(<ContractDocumentJobDetail job={{ ...JOB, documentId: "문서 /1" }} onDocumentNavigate={onDocumentNavigate} />);
    const link = screen.getByRole("link", { name: "문서 보기" });
    expect(link).toHaveAttribute("href", "/contracts?documentId=%EB%AC%B8%EC%84%9C%20%2F1");
    const event = new MouseEvent("click", { bubbles: true, cancelable: true, metaKey });
    fireEvent(link, event);
    expect(onDocumentNavigate).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(false);
  });
  it("does not call navigation when no document exists", () => {
    const onDocumentNavigate = jest.fn();
    render(<ContractDocumentJobDetail job={JOB} onDocumentNavigate={onDocumentNavigate} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(onDocumentNavigate).not.toHaveBeenCalled();
  });
});

describe("ContractDocumentJobDetail", () => {
  it("should forward the caller's complete metadata path to the detail and info rows", () => {
    const { container } = render(<ContractDocumentJobDetail job={JOB} data-component={BASE} />);
    expect(container.querySelector('[data-slot="job-detail-body"]')).toHaveAttribute("data-component", BASE);
    expect(container.querySelector('[data-slot="job-info-card"]')).toHaveAttribute("data-component", "desktop_contracts_jobs-modal_detail_info");
    expect(screen.getByRole("heading", { name: "작업 정보" })).toHaveAttribute("data-component", "desktop_contracts_jobs-modal_detail_info_title");
    for (const [label, expectedPath] of [
      ["작업 유형", "desktop_contracts_jobs-modal_detail_info_operation"],
      ["상태", "desktop_contracts_jobs-modal_detail_info_status"],
      ["작업 요청", "desktop_contracts_jobs-modal_detail_info_created-at"],
      ["시작", "desktop_contracts_jobs-modal_detail_info_started-at"],
      ["완료", "desktop_contracts_jobs-modal_detail_info_completed-at"],
      ["최근 업데이트", "desktop_contracts_jobs-modal_detail_info_updated-at"],
      ["시도 횟수", "desktop_contracts_jobs-modal_detail_info_attempts"],
    ]) {
      expect(screen.getByText(label).closest('[data-slot="job-info-row"]')).toHaveAttribute("data-component", expectedPath);
      expect(screen.getByText(label).parentElement).toHaveAttribute("data-component", `${expectedPath}_content`);
    }
  });

  it("should show actual KST timestamps, zero attempts and the encoded document link", () => {
    render(<ContractDocumentJobDetail job={{ ...JOB, documentId: "문서 /?&=#%", attempts: 0,
      createdAt: "2026-11-03T18:15:00Z", startedAt: "2026-11-03T18:16:00Z",
      completedAt: "2026-11-03T18:17:00Z", updatedAt: "2026-11-03T18:18:00Z",
    }} data-component={BASE} />);
    expect(row("작업 유형").getByText("서비스 계약서 생성")).toBeInTheDocument();
    expect(row("상태").getByText("처리 중")).toBeInTheDocument();
    for (const [label, value] of [["작업 요청", "2026.11.04 03:15"], ["시작", "2026.11.04 03:16"],
      ["완료", "2026.11.04 03:17"], ["최근 업데이트", "2026.11.04 03:18"], ["시도 횟수", "0회"]]) {
      expect(row(label).getByText(value)).toBeInTheDocument();
    }
    expect(screen.getByRole("link", { name: "문서 보기" })).toHaveAttribute("href", "/contracts?documentId=%EB%AC%B8%EC%84%9C%20%2F%3F%26%3D%23%25");
    expect(screen.getByRole("link", { name: "문서 보기" })).toHaveAttribute("data-variant", "secondary");
    expect(screen.getByRole("link", { name: "문서 보기" })).toHaveAttribute("data-component", "desktop_contracts_jobs-modal_detail_document");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "예시 고객" })).not.toBeInTheDocument();
  });

  it.each([undefined, null, ""])("should omit the document link for %s", (documentId) => {
    render(<ContractDocumentJobDetail job={{ ...JOB, documentId }} data-component={BASE} />);
    expect(screen.getByText("연결된 문서가 없습니다")).toBeInTheDocument();
    expect(screen.getByText("연결된 문서가 없습니다")).toHaveAttribute("data-component", "desktop_contracts_jobs-modal_detail_no-document");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("should use placeholders for missing or invalid times and attempts", () => {
    render(<ContractDocumentJobDetail job={{ ...JOB, createdAt: "invalid", startedAt: "", completedAt: null }} />);
    for (const label of ["작업 요청", "시작", "완료", "최근 업데이트", "시도 횟수"]) {
      expect(row(label).getByText("-")).toBeInTheDocument();
    }
  });

  it.each([NaN, Infinity, -1])("should omit invalid attempt count %s", (attempts) => {
    render(<ContractDocumentJobDetail job={{ ...JOB, attempts }} />);
    expect(row("시도 횟수").getByText("-")).toBeInTheDocument();
  });

  it("should use neutral unknown copy and exclude raw provider/contact fields", () => {
    const job = { ...JOB, status: "unknown", documentKind: undefined, displayOperation: undefined,
      error: "raw-provider-error", payload: { secret: "raw-payload" }, phone: "010-0000-0000" };
    const { container } = render(<ContractDocumentJobDetail job={job} data-component={BASE} />);
    expect(row("작업 유형").getByText("작업 유형 확인 필요")).toBeInTheDocument();
    expect(row("상태").getByText("상태 확인 필요")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/raw-provider-error|raw-payload|010-0000-0000/);
    const annotatedElements = container.querySelectorAll("[data-component]");
    expect(annotatedElements.length).toBeGreaterThan(0);
    for (const element of annotatedElements) {
      expect(element.getAttribute("data-component")).toMatch(new RegExp(`^${BASE}(?:_|$)`));
    }
  });

  it("should not invent data-component names when the caller omits its base", () => {
    const { container } = render(<><ContractDocumentJobSummary job={JOB} /><ContractDocumentJobDetail job={JOB} /></>);
    expect(container.querySelector("[data-component]")).toBeNull();
  });
});
