import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ContractDocumentJobsData } from "./ContractDocumentJobsPopover";
import { ContractDocumentJobsList, type ContractDocumentJobsListProps } from "./ContractDocumentJobsList";

const jobs: ContractDocumentJobsData = {
  active: [
    { jobId: "a", jobType: "create_document", clientName: "고객 A", status: "queued", documentKind: "service_contract", displayOperation: "generate" },
    { jobId: "b", jobType: "finalize_document", clientName: "고객 B", status: "processing", documentKind: "service_contract", displayOperation: "review" },
  ], requiresAttention: [
    { jobId: "c", jobType: "create_document", clientName: "고객 C", status: "failed", documentKind: "service_contract", displayOperation: "generate" },
    { jobId: "d", jobType: "create_document", clientName: "고객 D", status: "requires_attention", documentKind: "service_record", displayOperation: "generate" },
  ], recent: [
    { jobId: "e", jobType: "finalize_document", clientName: "고객 E", status: "completed", documentKind: "service_contract", displayOperation: "review" },
    { jobId: "f", jobType: "create_document", clientName: "고객 F", status: "completed", documentKind: "service_record", displayOperation: "generate" },
  ],
};
const props: ContractDocumentJobsListProps = { jobs, isLoading: false, collapsed: { processing: false, attention: false, recent: false }, onToggle: jest.fn(), onSelect: jest.fn(), "data-component": "desktop_contracts_document-jobs-modal_list" };
beforeEach(() => jest.clearAllMocks());

test("renders independent names/operations/statuses and selects all six native cards with their actual button", () => {
  const { container } = render(<ContractDocumentJobsList {...props} />);
  for (const title of ["처리중", "확인 필요", "최근 처리"]) {
    const toggle = screen.getByRole("button", { name: `${title} 2건` });
    expect(toggle).toBeInTheDocument();
    expect(toggle.querySelector('[data-component$="_toggle_title"]')?.textContent?.trim()).toBe(title);
    expect(toggle.querySelector('[data-slot="contract-document-jobs-count"]')?.textContent?.trim()).toBe("2건");
  }
  const expected = [["a", "고객 A", "서비스 계약서 생성", "대기"], ["b", "고객 B", "서비스 계약서 검토", "처리중"], ["c", "고객 C", "서비스 계약서 생성", "처리 실패"], ["d", "고객 D", "제공기록지 생성", "처리 실패"], ["e", "고객 E", "서비스 계약서 검토", "완료"], ["f", "고객 F", "제공기록지 생성", "완료"]];
  for (const [id, name, operation, status] of expected) {
    const card = screen.getByRole("button", { name: `${name} · ${operation} · ${status} 상세 보기` });
    expect(card).toHaveAttribute("role", "button"); expect(card).not.toHaveAttribute("aria-controls");
    expect(card.closest('[data-source-component="AnimatedSlotList"]')).not.toBeNull();
    expect(card.querySelector('[data-component$="_title"]')).toHaveTextContent(new RegExp(`^${name}$`));
    expect(card.querySelector('[data-component$="_subtitle"]')).toHaveTextContent(new RegExp(`^${operation}$`));
    expect(card.querySelector('[data-component$="_status"] [data-source-component="StatusBadge"]')).toHaveTextContent(status);
    fireEvent.click(card.querySelector('[data-component$="_title"]')!); expect(props.onSelect).toHaveBeenLastCalledWith(id, card);
  }
  expect(props.onSelect).toHaveBeenCalledTimes(6); expect(screen.queryByRole("link")).not.toBeInTheDocument();
  expect(container.textContent).not.toMatch(/읽기 전용|자동 최종화|최근 완료/);
  expect(container.querySelector('[data-slot*="meta"]')).toBeNull();
  expect(container.firstElementChild).toHaveAttribute("data-source-component", "ContractDocumentJobsList");
  for (const node of container.querySelectorAll<HTMLElement>("[data-component]")) {
    const owner = node.parentElement?.closest("[data-component]");
    if (owner) expect(node.dataset.component?.startsWith(`${owner.getAttribute("data-component")}_`)).toBe(true);
    for (const cls of node.classList) if (cls.startsWith("contract-document-jobs-")) expect(node).toHaveAttribute("data-slot", cls);
  }
});

test("collapse is controlled, immediately inert and linked to stable unique body IDs", () => {
  const { rerender } = render(<ContractDocumentJobsList {...props} />);
  const toggle = screen.getByRole("button", { name: "처리중 2건" });
  const id = toggle.getAttribute("aria-controls")!;
  expect(document.getElementById(id)).toHaveAttribute("aria-labelledby", toggle.id);
  fireEvent.click(toggle); expect(props.onToggle).toHaveBeenCalledWith("processing"); expect(toggle).toHaveAttribute("aria-expanded", "true");
  rerender(<ContractDocumentJobsList {...props} collapsed={{ ...props.collapsed, processing: true }} />);
  expect(toggle).toHaveAttribute("aria-expanded", "false"); expect(toggle).toHaveAttribute("aria-controls", id);
  expect(document.getElementById(id)).toHaveAttribute("inert"); expect(document.getElementById(id)).toHaveAttribute("data-expanded", "false");
  expect(screen.queryByRole("button", { name: "고객 A · 서비스 계약서 생성 · 대기 상세 보기" })).not.toBeInTheDocument();
  render(<ContractDocumentJobsList {...props} data-component="desktop_contracts_document-jobs-modal_other-list" />);
  const controls = screen.getAllByRole("button").map((button) => button.getAttribute("aria-controls")).filter(Boolean);
  expect(new Set(controls).size).toBe(6); for (const bodyId of controls) expect(document.getElementById(bodyId!)).toBeInTheDocument();
});

test("renders loading, safe retryable errors, callback-free errors and per-section empty copy", () => {
  const { rerender } = render(<ContractDocumentJobsList {...props} isLoading />);
  expect(screen.getByRole("status", { name: "전자문서 작업 불러오는 중" })).toBeInTheDocument(); expect(props.onSelect).not.toHaveBeenCalled(); expect(screen.queryByRole("button")).not.toBeInTheDocument();
  const onRetry = jest.fn();
  rerender(<ContractDocumentJobsList {...props} error={new Error("RAW_PROVIDER_DETAIL")} onRetry={onRetry} />);
  expect(screen.getByRole("alert")).toHaveTextContent("전자문서 작업을 불러오지 못했습니다."); expect(screen.queryByText("RAW_PROVIDER_DETAIL")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "처리중 2건" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" })); expect(onRetry).toHaveBeenCalledTimes(1);
  rerender(<ContractDocumentJobsList {...props} error={new Error("private")} />); expect(screen.queryByRole("button", { name: "다시 시도" })).not.toBeInTheDocument();
  rerender(<ContractDocumentJobsList {...props} jobs={null} />);
  for (const title of ["처리중", "확인 필요", "최근 처리"]) {
    const toggle = screen.getByRole("button", { name: `${title} 0건` });
    expect(toggle).toBeInTheDocument();
    expect(toggle.querySelector('[data-component$="_toggle_title"]')?.textContent?.trim()).toBe(title);
    expect(toggle.querySelector('[data-slot="contract-document-jobs-count"]')?.textContent?.trim()).toBe("0건");
  }
  expect(screen.getByText("처리중인 전자문서가 없습니다.")).toBeInTheDocument();
  expect(screen.getByText("확인이 필요한 전자문서가 없습니다.")).toBeInTheDocument(); expect(screen.getByText("최근 처리한 전자문서가 없습니다.")).toBeInTheDocument();
});

test("uses safe fallback copy and never invents a namespace when its optional base is absent", () => {
  const { container } = render(<ContractDocumentJobsList {...props} data-component={undefined} jobs={{ active: [{ jobId: "u", jobType: "create_document", clientName: "  ", status: "future" }], requiresAttention: [], recent: [] }} />);
  expect(screen.getByRole("button", { name: "고객 정보 확인 필요 · 작업 유형 확인 필요 · 상태 확인 필요 상세 보기" })).toBeInTheDocument();
  expect(container.querySelector("[data-component]")).toBeNull();
});

// Read the shipped CSS; ordered full-rule inventory catches appended overrides too.
const css = readFileSync(resolve(__dirname, "../../../app/globals.css"), "utf8");
type Rule = [context: string, selector: string, declarations: string];
function inventory(source: string, context = ""): Rule[] {
  source = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: Rule[] = []; let start = 0, opening = 0, depth = 0, quote = "";
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quote) { if (char === "\\") i++; else if (char === quote) quote = ""; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === ";" && !depth) start = i + 1;
    if (char === "{") { if (!depth) opening = i; depth++; }
    if (char !== "}" || --depth !== 0) continue;
    const selector = source.slice(start, opening).trim().replace(/\s+/g, " ");
    const body = source.slice(opening + 1, i);
    if (selector.startsWith("@")) rules.push(...inventory(body, context ? `${context} > ${selector}` : selector));
    else {
      if (selector.includes("contract-document-jobs-")) rules.push([context, selector, body.replace(/\s+/g, "")]);
      if (body.includes("{")) rules.push(...inventory(body, context));
    }
    start = i + 1;
  }
  if (depth || quote) throw new Error("Unbalanced CSS");
  return rules;
}
const c = ".contract-document-jobs-";
const expectedRules: Rule[] = [
  ["", `${c}list`, "display:flex;flex-direction:column;gap:20px;"],
  ["", `${c}section`, "display:flex;flex-direction:column;gap:8px;"],
  ["", `${c}toggle`, "width:100%;height:auto;display:flex;align-items:center;justify-content:flex-start;gap:8px;padding:0;border:0;border-radius:0;background:transparent;color:hsl(21410%55%);font-size:11.2px;line-height:16.8px;font-weight:700;text-align:left;"],
  ["", `${c}toggle:hover`, "background:transparent;color:hsl(21410%55%);"],
  ["", `${c}count`, "margin-left:auto;font-size:10.4px;font-weight:500;"],
  ["", `${c}chevron`, "width:14px;height:14px;transform:rotate(0deg);transition:transform250msease;"],
  ["", `${c}toggle[aria-expanded="true"] ${c}chevron`, "transform:rotate(180deg);"],
  ["", `${c}content`, "display:grid;grid-template-rows:1fr;min-height:0;transition:grid-template-rows250msease;"],
  ["", `${c}content[data-expanded="false"]`, "grid-template-rows:0fr;"],
  ["", `${c}inner`, "min-height:0;overflow:hidden;"],
  ["", `${c}empty`, "margin:0;min-height:116px;display:grid;place-items:center;padding:16px8px20px;text-align:center;font-size:11.2px;color:hsl(21410%55%);"],
  ["", `${c}state`, "display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;padding:24px;text-align:center;"],
  ["@media (prefers-reduced-motion: reduce)", `${c}content, ${c}chevron`, "transition:none;"],
];
test("actual CSS preserves 250ms accordion/chevron, centered gray cards and reduced-motion none without later overrides", () => {
  expect(inventory(css)).toEqual(expectedRules);
});
