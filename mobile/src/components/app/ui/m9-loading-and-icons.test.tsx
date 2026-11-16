import { fireEvent, render, screen } from "@testing-library/react";

import { ServiceWorkerUpdateOverlay } from "../ServiceWorkerUpdateOverlay";
import { AdminGuard } from "../auth/AdminGuard";
import { ToolIndicator } from "../chat/tool-indicator";
import { ContractPdfViewerPlaceholder } from "../contracts/contract-pdf-viewer-placeholder";
import { MessageSenderApprovalSettings } from "../messages/MessageSenderApprovalSettings";
import { MessagingFeatureGate } from "../messages/MessagingFeatureGate";
import { DetailPanel } from "../v3/DetailPanel";
import { ExpandableSearch } from "../v3/ExpandableSearch";
import { AnimatedSlotList } from "../v3/AnimatedSlotList";
import { Autocomplete } from "./Autocomplete";
import { DataTableToolbar } from "./datatable/DataTableToolbar";

const mockGoToList = jest.fn();
let mockUpdating = true;

jest.mock("@/hooks/useGetAuthUser", () => ({ useGetAuthUser: () => ({ isLoading: true }) }));
jest.mock("@/hooks/useServiceWorkerUpdate", () => ({ useServiceWorkerUpdate: () => ({ isUpdating: mockUpdating }) }));
jest.mock("next/navigation", () => ({ usePathname: () => "/admin/system" }));
jest.mock("../v3/SplitLayoutContext", () => ({ useSplitLayoutNavOptional: () => ({ isMobile: true, goToList: mockGoToList }) }));

function expectSpinnerStatus(name: string): HTMLElement {
  const status = screen.getByRole("status", { name });
  expect(status.querySelector('[data-slot="spinner"]')).toHaveAttribute("aria-hidden", "true");
  expect(status.querySelector(".sr-only")).toHaveTextContent(name);
  return status;
}

function expectIconTarget(button: HTMLElement): void {
  expect(button).toHaveClass("relative", "h-8", "w-8", "after:absolute", "after:-inset-1.5", "after:content-['']");
}

describe("M9 loading presentation", () => {
  it("announces the permission check without rendering guarded content", () => {
    render(<AdminGuard>private content</AdminGuard>);
    expectSpinnerStatus("권한 확인 중");
    expect(screen.queryByText("private content")).not.toBeInTheDocument();
    expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
  });

  it("keeps the update overlay while showing only a labelled Spinner", () => {
    mockUpdating = true;
    const { rerender } = render(<ServiceWorkerUpdateOverlay />);
    expectSpinnerStatus("앱 업데이트 중");
    expect(screen.queryByText("잠시만 기다려 주세요")).not.toBeInTheDocument();
    mockUpdating = false;
    rerender(<ServiceWorkerUpdateOverlay />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("keeps specific tool information but hides generic processing copy", () => {
    const { rerender } = render(<ToolIndicator data-component="mobile_chat_assistant_tool-indicator" isExecuting toolName={null} />);
    expectSpinnerStatus("처리 중");
    rerender(<ToolIndicator data-component="mobile_chat_assistant_tool-indicator" isExecuting toolName="searchClients" />);
    expect(screen.getByText("산모 검색 중...")).toBeInTheDocument();
    rerender(<ToolIndicator data-component="mobile_chat_assistant_tool-indicator" isExecuting={false} toolName={null} />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("labels PDF viewer preparation inside the existing viewer shell", () => {
    render(<ContractPdfViewerPlaceholder data-component="mobile_contracts_detail_pdf" aria-label="계약서 PDF" />);
    expectSpinnerStatus("PDF 뷰어를 준비하는 중");
    expect(screen.getByRole("region", { name: "계약서 PDF" })).toHaveAttribute("data-slot", "contract-pdf-viewer");
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("keeps approval copy after the initial loading status completes", () => {
    const { rerender } = render(<MessagingFeatureGate isEnabled={false} title="승인 필요" description="조직 승인이 필요합니다" isLoading>content</MessagingFeatureGate>);
    expectSpinnerStatus("승인 상태를 확인하는 중");
    rerender(<MessagingFeatureGate isEnabled={false} title="승인 필요" description="조직 승인이 필요합니다">content</MessagingFeatureGate>);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getAllByText("승인 필요")).toHaveLength(2);
  });

  it("blocks sender approval and restores its idle label after submission", () => {
    const onSubmit = jest.fn();
    const approval = { approvalStatus: "not_requested" as const, canRequest: true, isApproved: false, requestedAt: null, approvedAt: null };
    const { rerender } = render(<MessageSenderApprovalSettings approval={approval} isLoading={false} isSubmitting onSubmit={onSubmit} />);
    const busy = screen.getByRole("button", { name: "신청 중" });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute("aria-busy", "true");
    expect(busy.querySelector('[data-slot="button-idle"]')).toHaveAttribute("aria-hidden", "true");
    expect(busy.querySelector('[data-slot="button-idle"]')).toHaveClass("contents", "invisible");
    expect(busy.querySelector('[data-slot="button-idle"]')).toHaveTextContent("승인 신청");
    fireEvent.click(busy);
    expect(onSubmit).not.toHaveBeenCalled();
    rerender(<MessageSenderApprovalSettings approval={approval} isLoading={false} isSubmitting={false} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: "승인 신청" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("labels approval data loading separately from submission", () => {
    render(<MessageSenderApprovalSettings isLoading isSubmitting={false} onSubmit={jest.fn()} />);
    expectSpinnerStatus("승인 상태를 확인하는 중");
  });

  it("labels pagination even without an optional caller component base", () => {
    render(<AnimatedSlotList items={[]} isLoading={false} isFetchingMore render={() => null} />);
    expectSpinnerStatus("목록을 더 불러오는 중");
    expect(screen.getByRole("status")).not.toHaveAttribute("data-component");
  });

  it("labels autocomplete loading in both the input and open dropdown", () => {
    render(<Autocomplete data-component="mobile_clients_form_customer" name="customer" label="산모" value={null} items={[]} onChange={jest.fn()} getItemKey={(item: string) => item} getItemLabel={(item: string) => item} isLoading />);
    expectSpinnerStatus("산모 목록을 불러오는 중");
    fireEvent.focus(screen.getByLabelText("산모"));
    const statuses = screen.getAllByRole("status", { name: "산모 목록을 불러오는 중" });
    expect(statuses).toHaveLength(2);
    for (const status of statuses) expect(status.querySelector(".sr-only")).toHaveTextContent("산모 목록을 불러오는 중");
  });
});

describe("M9 icon target contract", () => {
  it("sizes the search toggle and preserves its interaction", () => {
    render(<ExpandableSearch value="" onChange={jest.fn()} />);
    expectIconTarget(screen.getByRole("button", { name: "검색 열기" }));
    fireEvent.click(screen.getByRole("button", { name: "검색 열기" }));
    expectIconTarget(screen.getByRole("button", { name: "검색 닫기" }));
  });

  it("sizes and names the mobile detail back control", () => {
    render(<DetailPanel data-component="mobile_clients_detail-panel">detail</DetailPanel>);
    const back = screen.getByRole("button", { name: "목록으로 돌아가기" });
    expectIconTarget(back);
    fireEvent.click(back);
    expect(mockGoToList).toHaveBeenCalledTimes(1);
  });

  it("sizes icon-only table search without changing the expanded input width", () => {
    render(<DataTableToolbar data-component="mobile_clients_table_toolbar" searchQuery="" filterValue={null} onSearchChange={jest.fn()} />);
    const search = screen.getByRole("button", { name: "search" });
    expectIconTarget(search);
    expect(search).not.toHaveClass("w-[100px]", "h-10");
    fireEvent.click(search);
    expect(screen.getByRole("textbox")).toHaveClass("w-[100px]");
  });

  it("sizes autocomplete clear and toggle controls and preserves clearing", () => {
    const onChange = jest.fn();
    const { rerender } = render(<Autocomplete data-component="mobile_clients_form_customer" name="customer" label="산모" value="QA-산모" items={["QA-산모"]} onChange={onChange} getItemKey={(item: string) => item} getItemLabel={(item: string) => item} />);
    const clear = screen.getByRole("button", { name: "선택 해제" });
    expectIconTarget(clear);
    fireEvent.click(clear);
    expect(onChange).toHaveBeenCalledWith(null);
    rerender(<Autocomplete data-component="mobile_clients_form_customer" name="customer" label="산모" value={null} items={["QA-산모"]} onChange={onChange} getItemKey={(item: string) => item} getItemLabel={(item: string) => item} />);
    fireEvent.focus(screen.getByLabelText("산모"));
    expectIconTarget(screen.getByRole("button", { name: "목록 닫기" }));
  });
});
