import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { clientKeys } from "@/features/clients/hooks/keys";
import { dashboardQueryKeys } from "@/hooks/useDashboardStats";
import {
  holidayReviewApi,
  type HolidayReviewEvent,
  type HolidayReviewItem,
} from "@/services/holiday-review";

import { HolidayReviewCards } from "./HolidayReviewCards";

const mockToast = jest.fn();
jest.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

jest.mock("@/services/holiday-review", () => ({
  ...jest.requireActual("@/services/holiday-review"),
  holidayReviewApi: {
    listEvents: jest.fn(),
    listItems: jest.fn(),
    resolve: jest.fn(),
  },
}));

const api = holidayReviewApi as jest.Mocked<typeof holidayReviewApi>;

const EVENT: HolidayReviewEvent = {
  id: "evt-1",
  date: "2026-10-05",
  change: "added",
  name: "대체공휴일(개천절)",
  source: "kasi",
  safeOpen: 2,
  riskOpen: 1,
  createdAt: "2026-09-30T19:00:00.000Z",
};

function item(id: string, name: string, category: "safe" | "risk"): HolidayReviewItem {
  return {
    id,
    clientId: `client-${id}`,
    clientName: name,
    storedEnd: "2026-10-12",
    recalculatedEnd: "2026-10-13",
    category,
    reason: category === "safe" ? "no_sessions_after_date" : "finalized",
    status: "open",
  };
}

const SAFE_ITEMS = [item("i-1", "김하늘", "safe"), item("i-2", "이서연", "safe")];
const ALL_ITEMS = [...SAFE_ITEMS, item("i-3", "박지은", "risk")];

function renderCards() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = jest.spyOn(queryClient, "invalidateQueries");
  render(
    <QueryClientProvider client={queryClient}>
      <HolidayReviewCards branchId="branch-1" />
    </QueryClientProvider>,
  );
  return { invalidate };
}

describe("HolidayReviewCards", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    api.listEvents.mockResolvedValue([EVENT]);
    api.listItems.mockImplementation(async (_branch, _event, filters) =>
      ALL_ITEMS.filter(
        (row) =>
          (!filters?.category || row.category === filters.category) &&
          (!filters?.q || row.clientName.includes(filters.q)),
      ),
    );
    api.resolve.mockResolvedValue({ fixed: 0, kept: 0, skipped: [] });
  });

  it("keeps its slot root but renders nothing inside when there are no events", async () => {
    api.listEvents.mockResolvedValue([]);
    renderCards();

    await waitFor(() => expect(api.listEvents).toHaveBeenCalledWith("branch-1"));
    const root = document.querySelector("[data-slot='holiday-review-cards']");
    expect(root).not.toBeNull();
    expect(root).toBeEmptyDOMElement();
  });

  it("shows the change, the counts, the help text and both actions", async () => {
    renderCards();

    expect(await screen.findByText("10/5 대체공휴일(개천절) 추가")).toBeInTheDocument();
    expect(screen.getByText("공휴일 변경으로 종료일 확인이 필요해요")).toBeInTheDocument();
    expect(screen.getByText("2명 바로 수정 가능")).toBeInTheDocument();
    expect(screen.getByText("1명 직접 확인 필요")).toBeInTheDocument();
    expect(screen.getByText("공공데이터")).toBeInTheDocument();
    expect(screen.getByText(/바뀐 날짜 이후 서비스 기록이 없고/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "목록 보기" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "2명 한 번에 수정" })).toBeEnabled();
  });

  it("words a branch-override event without a public name", async () => {
    api.listEvents.mockResolvedValue([{ ...EVENT, source: "branch", change: "removed", name: null }]);
    renderCards();

    expect(await screen.findByText("10/5 이 지점 공휴일에서 빠짐")).toBeInTheDocument();
    expect(screen.getByText("지점 설정")).toBeInTheDocument();
  });

  it("disables the bulk fix when no client is safe to fix", async () => {
    api.listEvents.mockResolvedValue([{ ...EVENT, safeOpen: 0, riskOpen: 3 }]);
    renderCards();

    expect(await screen.findByRole("button", { name: "0명 한 번에 수정" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "목록 보기" })).toBeEnabled();
  });

  it("shows a quiet error with a retry when the events cannot be loaded", async () => {
    api.listEvents.mockRejectedValueOnce(new Error("boom"));
    renderCards();

    expect(await screen.findByText(/불러오지 못했어요/)).toBeInTheDocument();
    api.listEvents.mockResolvedValue([EVENT]);
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));

    expect(await screen.findByText("10/5 대체공휴일(개천절) 추가")).toBeInTheDocument();
  });

  describe("bulk fix", () => {
    it("asks for confirmation first and sends nothing when cancelled", async () => {
      renderCards();
      fireEvent.click(await screen.findByRole("button", { name: "2명 한 번에 수정" }));

      const dialog = await screen.findByRole("dialog");
      expect(within(dialog).getByText("2명의 종료일을 한 번에 수정할까요?")).toBeInTheDocument();
      expect(api.resolve).not.toHaveBeenCalled();

      fireEvent.click(within(dialog).getByRole("button", { name: "취소" }));

      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(api.listItems).not.toHaveBeenCalled();
      expect(api.resolve).not.toHaveBeenCalled();
    });

    it("fetches the open safe items, fixes only those ids and refreshes every dependent cache", async () => {
      api.listItems.mockResolvedValue(SAFE_ITEMS);
      api.resolve.mockResolvedValue({ fixed: 2, kept: 0, skipped: [] });
      const { invalidate } = renderCards();
      fireEvent.click(await screen.findByRole("button", { name: "2명 한 번에 수정" }));

      fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "2명 수정" }));

      expect(await screen.findByText("2명 수정했어요")).toBeInTheDocument();
      expect(api.listItems).toHaveBeenCalledWith("branch-1", "evt-1", { category: "safe", status: "open" });
      expect(api.resolve).toHaveBeenCalledWith("branch-1", "evt-1", ["i-1", "i-2"], "fix");
      await waitFor(() => {
        expect(invalidate).toHaveBeenCalledWith({ queryKey: ["holiday-review-events", "branch-1"] });
        expect(invalidate).toHaveBeenCalledWith({ queryKey: ["holiday-review-items", "branch-1"] });
        expect(invalidate).toHaveBeenCalledWith({ queryKey: clientKeys.all });
        expect(invalidate).toHaveBeenCalledWith({ queryKey: dashboardQueryKeys.overviewAll() });
      });
    });

    it("shows who was skipped and why, with a Korean reason per code", async () => {
      api.listItems.mockResolvedValue(SAFE_ITEMS);
      api.resolve.mockResolvedValue({
        fixed: 0,
        kept: 0,
        skipped: [
          { itemId: "i-1", code: "CLIENT_CHANGED" },
          { itemId: "i-2", code: "A_CODE_FROM_THE_FUTURE" },
        ],
      });
      renderCards();
      fireEvent.click(await screen.findByRole("button", { name: "2명 한 번에 수정" }));
      fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "2명 수정" }));

      expect(await screen.findByText("2명은 수정하지 못했어요")).toBeInTheDocument();
      const rows = screen.getAllByText((_text, element) => element?.getAttribute("data-slot") === "holiday-review-skipped-row");
      expect(rows[0]).toHaveTextContent("김하늘 · 그 사이 고객 정보나 종료일이 바뀌었어요");
      expect(rows[1]).toHaveTextContent("이서연 · 수정하지 못했어요");
    });

    it("reports a failed request in a toast", async () => {
      api.listItems.mockResolvedValue(SAFE_ITEMS);
      api.resolve.mockRejectedValue(new Error("boom"));
      renderCards();
      fireEvent.click(await screen.findByRole("button", { name: "2명 한 번에 수정" }));
      fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "2명 수정" }));

      await waitFor(() => expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" })));
    });
  });

  describe("list dialog", () => {
    async function openDialog() {
      const view = renderCards();
      fireEvent.click(await screen.findByRole("button", { name: "목록 보기" }));
      const dialog = await screen.findByRole("dialog");
      await within(dialog).findByText("김하늘");
      return { ...view, dialog };
    }

    function selectTab(dialog: HTMLElement, name: RegExp) {
      // Radix tabs activate on mouse down.
      fireEvent.mouseDown(within(dialog).getByRole("tab", { name }), { button: 0 });
    }

    it("lists the open clients with stored and new end dates and a reason label", async () => {
      const { dialog } = await openDialog();

      expect(api.listItems).toHaveBeenCalledWith("branch-1", "evt-1", { status: "open" });
      expect(within(dialog).getByText("10/5 대체공휴일(개천절) 추가 · 남은 고객 3명")).toBeInTheDocument();
      const row = within(dialog).getByText("박지은").closest("tr") as HTMLElement;
      expect(within(row).getByText("2026-10-12")).toBeInTheDocument();
      expect(within(row).getByText("2026-10-13")).toBeInTheDocument();
      expect(within(row).getByText("서비스 기록 확정됨")).toBeInTheDocument();
      expect(within(row).getByText("고객 정보에서 직접 수정해 주세요")).toBeInTheDocument();
    });

    it("filters by tab through the API params", async () => {
      const { dialog } = await openDialog();

      selectTab(dialog, /바로 수정 가능/);
      await waitFor(() =>
        expect(api.listItems).toHaveBeenCalledWith("branch-1", "evt-1", { category: "safe", status: "open" }),
      );
      await waitFor(() => expect(within(dialog).queryByText("박지은")).not.toBeInTheDocument());

      selectTab(dialog, /직접 확인 필요/);
      await waitFor(() =>
        expect(api.listItems).toHaveBeenCalledWith("branch-1", "evt-1", { category: "risk", status: "open" }),
      );
      expect(await within(dialog).findByText("박지은")).toBeInTheDocument();
      expect(within(dialog).queryByText("김하늘")).not.toBeInTheDocument();
    });

    it("sends the trimmed, debounced name search as q", async () => {
      const { dialog } = await openDialog();

      fireEvent.change(within(dialog).getByLabelText("고객 이름 검색"), { target: { value: " 이서 " } });

      await waitFor(() =>
        expect(api.listItems).toHaveBeenCalledWith("branch-1", "evt-1", { status: "open", q: "이서" }),
      );
      expect(await within(dialog).findByText("이서연")).toBeInTheDocument();
      expect(within(dialog).queryByText("김하늘")).not.toBeInTheDocument();
    });

    it("selects every visible row with the header checkbox", async () => {
      const { dialog } = await openDialog();

      fireEvent.click(within(dialog).getByRole("checkbox", { name: "보이는 고객 모두 선택" }));

      expect(within(dialog).getByText("3명 선택")).toBeInTheDocument();
      expect(within(dialog).getByRole("checkbox", { name: "김하늘 선택" })).toBeChecked();

      fireEvent.click(within(dialog).getByRole("checkbox", { name: "보이는 고객 모두 선택" }));
      expect(within(dialog).getByText("0명 선택")).toBeInTheDocument();
    });

    it("disables the fix with a hint when a risk row is selected, but still allows keeping", async () => {
      const { dialog } = await openDialog();
      const fix = within(dialog).getByRole("button", { name: "선택 고객 종료일 수정" });
      const keep = within(dialog).getByRole("button", { name: "선택 고객 그대로 두기" });
      expect(fix).toBeDisabled();
      expect(keep).toBeDisabled();

      fireEvent.click(within(dialog).getByRole("checkbox", { name: "김하늘 선택" }));
      expect(fix).toBeEnabled();

      fireEvent.click(within(dialog).getByRole("checkbox", { name: "박지은 선택" }));
      expect(fix).toBeDisabled();
      expect(keep).toBeEnabled();
      expect(within(dialog).getByText(/직접 확인이 필요한 고객이 있어 수정할 수 없어요/)).toBeInTheDocument();
    });

    it("fixes the selected ids", async () => {
      api.resolve.mockResolvedValue({ fixed: 2, kept: 0, skipped: [] });
      const { dialog } = await openDialog();

      fireEvent.click(within(dialog).getByRole("checkbox", { name: "김하늘 선택" }));
      fireEvent.click(within(dialog).getByRole("checkbox", { name: "이서연 선택" }));
      fireEvent.click(within(dialog).getByRole("button", { name: "선택 고객 종료일 수정" }));

      await waitFor(() => expect(api.resolve).toHaveBeenCalledWith("branch-1", "evt-1", ["i-1", "i-2"], "fix"));
      expect(await within(dialog).findByText("2명 수정했어요")).toBeInTheDocument();
      expect(within(dialog).getByText("0명 선택")).toBeInTheDocument();
    });

    it("keeps the selected ids (risk rows included), shows skipped rows and refreshes the caches", async () => {
      api.resolve.mockResolvedValue({
        fixed: 0,
        kept: 1,
        skipped: [{ itemId: "i-3", code: "ITEM_NOT_OPEN" }],
      });
      const { dialog, invalidate } = await openDialog();

      fireEvent.click(within(dialog).getByRole("checkbox", { name: "김하늘 선택" }));
      fireEvent.click(within(dialog).getByRole("checkbox", { name: "박지은 선택" }));
      fireEvent.click(within(dialog).getByRole("button", { name: "선택 고객 그대로 두기" }));

      await waitFor(() => expect(api.resolve).toHaveBeenCalledWith("branch-1", "evt-1", ["i-1", "i-3"], "keep"));
      expect(await within(dialog).findByText("1명은 그대로 두었어요")).toBeInTheDocument();
      expect(within(dialog).getByText("1명은 처리하지 못했어요")).toBeInTheDocument();
      expect(within(dialog).getByText("박지은", { selector: "b" })).toBeInTheDocument();
      expect(within(dialog).getByText(/이미 처리된 항목이에요/)).toBeInTheDocument();
      await waitFor(() => {
        expect(invalidate).toHaveBeenCalledWith({ queryKey: ["holiday-review-items", "branch-1"] });
        expect(invalidate).toHaveBeenCalledWith({ queryKey: clientKeys.all });
        expect(invalidate).toHaveBeenCalledWith({ queryKey: dashboardQueryKeys.overviewAll() });
      });
    });

    it("shows an indeterminate header checkbox when only some visible rows are selected", async () => {
      const { dialog } = await openDialog();
      const header = within(dialog).getByRole("checkbox", { name: "보이는 고객 모두 선택" });
      expect(header).toHaveAttribute("aria-checked", "false");

      fireEvent.click(within(dialog).getByRole("checkbox", { name: "김하늘 선택" }));
      expect(header).toHaveAttribute("aria-checked", "mixed");

      fireEvent.click(header);
      expect(header).toHaveAttribute("aria-checked", "true");
    });

    it("caps the name search at the backend's 100 characters", async () => {
      const { dialog } = await openDialog();

      expect(within(dialog).getByLabelText("고객 이름 검색")).toHaveAttribute("maxlength", "100");
    });

    it("never leaves a tab pointing at a missing panel", async () => {
      const { dialog } = await openDialog();

      for (const tab of within(dialog).getAllByRole("tab")) {
        const panelId = tab.getAttribute("aria-controls");
        expect(panelId).toBeTruthy();
        expect(document.getElementById(panelId as string)).not.toBeNull();
      }
    });

    it("keeps the dialog and the skipped reasons after the last open rows disappear from the events", async () => {
      api.resolve.mockResolvedValue({
        fixed: 1,
        kept: 0,
        skipped: [{ itemId: "i-2", code: "CLIENT_CHANGED" }],
      });
      const { dialog } = await openDialog();
      // The backend closed every open row, so the refetched events no longer include this one.
      api.listEvents.mockResolvedValue([]);

      fireEvent.click(within(dialog).getByRole("checkbox", { name: "김하늘 선택" }));
      fireEvent.click(within(dialog).getByRole("checkbox", { name: "이서연 선택" }));
      fireEvent.click(within(dialog).getByRole("button", { name: "선택 고객 종료일 수정" }));

      expect(await within(dialog).findByText("1명 수정했어요")).toBeInTheDocument();
      await waitFor(() => expect(api.listEvents).toHaveBeenCalledTimes(2));
      await waitFor(() =>
        expect(document.querySelector("[data-slot='holiday-review-panel']")).not.toBeInTheDocument(),
      );

      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(within(dialog).getByText("1명은 수정하지 못했어요")).toBeInTheDocument();
      expect(within(dialog).getByText(/그 사이 고객 정보나 종료일이 바뀌었어요/)).toBeInTheDocument();
      expect(within(dialog).getByText("10/5 대체공휴일(개천절) 추가 · 남은 고객 0명")).toBeInTheDocument();

      fireEvent.keyDown(dialog, { key: "Escape" });

      await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
      expect(document.querySelector("[data-slot='holiday-review-cards']")).toBeEmptyDOMElement();
    });

    it("refetches the open rows after a RECALCULATED_CHANGED skip so the refreshed new end date shows", async () => {
      api.resolve.mockResolvedValue({
        fixed: 1,
        kept: 0,
        skipped: [{ itemId: "i-2", code: "RECALCULATED_CHANGED" }],
      });
      const { dialog } = await openDialog();
      const secondRow = within(dialog).getByText("이서연").closest("tr") as HTMLElement;
      expect(within(secondRow).getByText("2026-10-13")).toBeInTheDocument();
      const listCallsBefore = api.listItems.mock.calls.length;
      // The backend refreshed the item's recomputed end date while skipping it.
      api.listItems.mockResolvedValue([
        item("i-2", "이서연", "safe"),
        item("i-3", "박지은", "risk"),
      ].map((row) => (row.id === "i-2" ? { ...row, recalculatedEnd: "2026-10-14" } : row)));

      fireEvent.click(within(dialog).getByRole("checkbox", { name: "김하늘 선택" }));
      fireEvent.click(within(dialog).getByRole("checkbox", { name: "이서연 선택" }));
      fireEvent.click(within(dialog).getByRole("button", { name: "선택 고객 종료일 수정" }));

      expect(
        await within(dialog).findByText(/새 종료일이 다시 계산됐어요. 목록에서 확인해 주세요./),
      ).toBeInTheDocument();
      await waitFor(() => expect(api.listItems.mock.calls.length).toBeGreaterThan(listCallsBefore));
      const refreshedRow = (await within(dialog).findByText("2026-10-14")).closest("tr") as HTMLElement;
      expect(within(refreshedRow).getByText("이서연")).toBeInTheDocument();
    });

    it("shows an empty state when a filter matches nobody", async () => {
      const { dialog } = await openDialog();
      api.listItems.mockResolvedValue([]);

      fireEvent.change(within(dialog).getByLabelText("고객 이름 검색"), { target: { value: "없는사람" } });

      expect(await within(dialog).findByText("해당하는 고객이 없어요.")).toBeInTheDocument();
    });
  });
});
