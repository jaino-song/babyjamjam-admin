import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";

import { eformsignApi, type EformsignLinkConfirmation } from "@/services/api";
import { ContractLinkConfirmationsNotice } from "../contract-link-confirmations-notice";

const mockSheet = jest.fn();
jest.mock("../../clients/contract-link-confirm-sheet", () => ({
  ContractLinkConfirmSheet: (props: { entry: EformsignLinkConfirmation; "data-component": string; onClose: () => void; refetchConfirmations: unknown }) => {
    mockSheet(props);
    return <div data-testid="sheet" data-component={props["data-component"]}>{props.entry.documentId}</div>;
  },
}));
jest.mock("@/services/api", () => ({ eformsignApi: { getLinkConfirmations: jest.fn() } }));

const mockGet = jest.mocked(eformsignApi.getLinkConfirmations);
const DC = "mobile_contracts_detail-sheet_stack_list-page_content_link-confirmations";
const KEY = ["eformsign-docs", "link-confirmations", "all", "branch-1"];

function makeEntry(index: number, overrides: Partial<EformsignLinkConfirmation> = {}): EformsignLinkConfirmation {
  return {
    documentId: `doc-${index}`,
    documentName: `계약서 ${index}`,
    statusType: "020",
    statusDetail: "",
    createdDate: "2026-10-13T00:00:00Z",
    document: { name: "계약 이름", phone: "01012345678", birthday: "1990-01-01" },
    client: { id: index, name: `고객 ${index}`, phone: "01012345678", birthday: "1991-02-02" },
    differences: ["name", "birthday"],
    canConfirm: true,
    ...overrides,
  };
}

let queryClient: QueryClient;
function mount(branchId: string | null = "branch-1") {
  return render(
    <QueryClientProvider client={queryClient}>
      <ContractLinkConfirmationsNotice data-component={DC} branchId={branchId} />
    </QueryClientProvider>,
  );
}
async function flush() {
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}
// Waits until no query is mid-flight (paused and pending-forever queries are not "fetching" / are flushed by hand).
async function settle() {
  await flush();
  await waitFor(() => expect(queryClient.isFetching()).toBe(0));
}
const root = () => document.querySelector(`[data-component="${DC}"]`);
const rows = () => Array.from(document.querySelectorAll('[data-slot="doc-row"]'));

beforeEach(() => {
  jest.clearAllMocks();
  onlineManager.setOnline(true);
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
});
afterEach(() => onlineManager.setOnline(true));

describe("ContractLinkConfirmationsNotice", () => {
  it("renders nothing while loading", async () => {
    mockGet.mockReturnValue(new Promise(() => undefined));
    const { container } = mount();
    await flush();
    expect(queryClient.getQueryState(KEY)).toMatchObject({ status: "pending", fetchStatus: "fetching" });
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing while paused with no data", async () => {
    onlineManager.setOnline(false);
    mockGet.mockResolvedValue([makeEntry(1)]);
    const { container } = mount();
    await settle();
    expect(queryClient.getQueryState(KEY)).toMatchObject({ status: "pending", fetchStatus: "paused" });
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when loaded and empty", async () => {
    mockGet.mockResolvedValue([]);
    const { container } = mount();
    await settle();
    expect(queryClient.getQueryState(KEY)).toMatchObject({ status: "success" });
    expect(container.innerHTML).toBe("");
  });

  it("does not query until the branch is known", async () => {
    const { container } = mount(null);
    await settle();
    expect(mockGet).not.toHaveBeenCalled();
    expect(container.innerHTML).toBe("");
  });

  it("queries the branch-wide list (no clientId) under a branch-scoped key", async () => {
    mockGet.mockResolvedValue([makeEntry(1)]);
    mount();
    await settle();
    expect(mockGet).toHaveBeenCalledWith();
    expect(queryClient.getQueryData(KEY)).toEqual([makeEntry(1)]);
  });

  it("failed with no data: alert whose retry refetches, and never the empty look", async () => {
    mockGet.mockRejectedValue(new Error("boom"));
    mount();
    await settle();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("연결 확인이 필요한 계약서를 불러오지 못했습니다");
    expect(document.querySelectorAll('[data-slot="doc-row"]')).toHaveLength(0);
    mockGet.mockClear();
    mockGet.mockResolvedValue([makeEntry(1)]);
    fireEvent.click(within(alert).getByRole("button", { name: "다시 시도" }));
    await settle();
    await waitFor(() => expect(mockGet).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("연결 확인이 필요한 계약서 1건")).toBeInTheDocument();
  });

  it("cached entries + failed refetch: entries stay and a stale notice with retry sits beside them", async () => {
    queryClient.setQueryData(KEY, [makeEntry(1)]);
    mockGet.mockRejectedValue(new Error("boom"));
    mount();
    await settle();
    await act(async () => { await queryClient.refetchQueries({ queryKey: KEY }).catch(() => undefined); });
    await settle();
    expect(screen.getByRole("alert")).toHaveTextContent("최신 정보를 불러오지 못했습니다");
    expect(screen.getByText("연결 확인이 필요한 계약서 1건")).toBeInTheDocument();
    expect(within(screen.getByRole("alert")).getByRole("button", { name: "다시 시도" })).toBeEnabled();
  });

  it("cached empty list + failed refetch is still an error, not 'none'", async () => {
    queryClient.setQueryData(KEY, []);
    mockGet.mockRejectedValue(new Error("boom"));
    mount();
    await settle();
    await act(async () => { await queryClient.refetchQueries({ queryKey: KEY }).catch(() => undefined); });
    await settle();
    expect(screen.getByRole("alert")).toHaveTextContent("최신 정보를 불러오지 못했습니다");
  });

  it("is collapsed by default: heading and toggle, no rows", async () => {
    mockGet.mockResolvedValue([makeEntry(1), makeEntry(2)]);
    mount();
    await settle();
    expect(screen.getByText("연결 확인이 필요한 계약서 2건")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "보기" })).toHaveAttribute("aria-expanded", "false");
    expect(rows()).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "확인" })).toBeNull();
  });

  it("expanded entries show badge, document name, client name and the differing items", async () => {
    mockGet.mockResolvedValue([makeEntry(1, { differences: ["name"] }), makeEntry(2, { documentName: "", differences: ["birthday"] })]);
    mount();
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "보기" }));
    expect(screen.getByRole("button", { name: "접기" })).toHaveAttribute("aria-expanded", "true");
    expect(rows()).toHaveLength(2);
    const [first, second] = rows() as HTMLElement[];
    expect(within(first).getByText("연결 확인 필요")).toBeInTheDocument();
    expect(within(first).getByText("계약서 1")).toBeInTheDocument();
    expect(within(first).getByText("고객 1")).toBeInTheDocument();
    expect(within(first).getByText("이름이 다릅니다")).toBeInTheDocument();
    expect(within(second).getByText("계약서")).toBeInTheDocument();
    expect(within(second).getByText("생년월일이 다릅니다")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "접기" }));
    expect(rows()).toHaveLength(0);
  });

  it("joins both differing items with a middle dot", async () => {
    mockGet.mockResolvedValue([makeEntry(1)]);
    mount();
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "보기" }));
    expect(screen.getByText("이름이 다릅니다 · 생년월일이 다릅니다")).toBeInTheDocument();
  });

  it("canConfirm false: no 확인 button, the manager-only line instead", async () => {
    mockGet.mockResolvedValue([makeEntry(1, { canConfirm: false })]);
    mount();
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "보기" }));
    expect(screen.queryByRole("button", { name: "확인" })).toBeNull();
    expect(screen.getByText("지점 관리자만 연결을 확정할 수 있습니다")).toBeInTheDocument();
  });

  it("canConfirm true: 확인 button and no manager-only line", async () => {
    mockGet.mockResolvedValue([makeEntry(1)]);
    mount();
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "보기" }));
    expect(screen.getByRole("button", { name: "확인" })).toBeInTheDocument();
    expect(screen.queryByText("지점 관리자만 연결을 확정할 수 있습니다")).toBeNull();
  });

  it("six entries: first five, then '1건 더 보기' reveals all", async () => {
    mockGet.mockResolvedValue([1, 2, 3, 4, 5, 6].map(index => makeEntry(index)));
    mount();
    await settle();
    expect(screen.getByText("연결 확인이 필요한 계약서 6건")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "보기" }));
    expect(rows()).toHaveLength(5);
    expect(screen.queryByText("계약서 6")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "1건 더 보기" }));
    expect(rows()).toHaveLength(6);
    expect(screen.getByText("계약서 6")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /더 보기/ })).toBeNull();
  });

  it("five entries show no 더 보기 toggle", async () => {
    mockGet.mockResolvedValue([1, 2, 3, 4, 5].map(index => makeEntry(index)));
    mount();
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "보기" }));
    expect(rows()).toHaveLength(5);
    expect(screen.queryByRole("button", { name: /더 보기/ })).toBeNull();
  });

  it("the entry list is bounded so the notice cannot push the list card out", async () => {
    mockGet.mockResolvedValue([makeEntry(1)]);
    mount();
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "보기" }));
    const list = document.querySelector('[data-slot="list"]') as HTMLElement;
    expect(list.className).toContain("overflow-y-auto");
    expect(list.className).toMatch(/max-h-/);
    expect((root() as HTMLElement).className).toContain("shrink-0");
  });

  it("확인 opens the sheet for that entry, with this query's refetch, and closing removes it", async () => {
    mockGet.mockResolvedValue([makeEntry(1), makeEntry(2)]);
    mount();
    await settle();
    expect(screen.queryByTestId("sheet")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "보기" }));
    fireEvent.click(within(rows()[1] as HTMLElement).getByRole("button", { name: "확인" }));
    expect(screen.getByTestId("sheet")).toHaveTextContent("doc-2");
    const props = mockSheet.mock.calls.at(-1)?.[0];
    expect(props["data-component"]).toBe(`${DC}_sheet`);
    expect(props.entry.documentId).toBe("doc-2");
    expect(props.onConfirmed).toBeUndefined();
    mockGet.mockClear();
    await act(async () => { await props.refetchConfirmations(); });
    expect(mockGet).toHaveBeenCalledTimes(1);
    act(() => props.onClose());
    expect(screen.queryByTestId("sheet")).toBeNull();
  });

  it("the sheet stays mounted when a background refetch empties the list", async () => {
    mockGet.mockResolvedValue([makeEntry(1)]);
    mount();
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "보기" }));
    fireEvent.click(screen.getByRole("button", { name: "확인" }));
    mockGet.mockResolvedValue([]);
    await act(async () => { await queryClient.refetchQueries({ queryKey: KEY }); });
    await settle();
    expect(queryClient.getQueryData(KEY)).toEqual([]);
    expect(root()).toBeNull();
    expect(screen.getByTestId("sheet")).toBeInTheDocument();
  });
});
