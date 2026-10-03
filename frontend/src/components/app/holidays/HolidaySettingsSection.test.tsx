import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { holidaySettingsApi } from "@/services/holiday-settings";
import type { BranchHolidayYear } from "@/services/holidays";
import { PROBLEM_CATALOG } from "@babyjamjam/shared";

import { HolidaySettingsSection } from "./HolidaySettingsSection";

const mockToast = jest.fn();
jest.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

jest.mock("@/lib/date/business-days", () => ({
  ...jest.requireActual("@/lib/date/business-days"),
  isoDateInKorea: () => "2026-10-01",
}));

jest.mock("@/services/holiday-settings", () => ({
  holidaySettingsApi: {
    getYear: jest.fn(),
    createOverride: jest.fn(),
    deleteOverride: jest.fn(),
    syncNow: jest.fn(),
  },
}));

jest.mock("@/services/holiday-review", () => ({
  ...jest.requireActual("@/services/holiday-review"),
  holidayReviewApi: {
    listEvents: jest.fn().mockResolvedValue([]),
    listItems: jest.fn().mockResolvedValue([]),
    resolve: jest.fn(),
  },
}));

const api = holidaySettingsApi as jest.Mocked<typeof holidaySettingsApi>;

const YEAR_2026: BranchHolidayYear = {
  year: 2026,
  revision: 1,
  supported: true,
  synced: true,
  // 2026-10-01 04:00 KST
  lastSyncedAt: "2026-09-30T19:00:00.000Z",
  holidays: [
    { date: "2026-09-25", name: "추석", source: "public", excluded: false, overrideId: null },
    { date: "2026-10-03", name: "개천절", source: "public", excluded: false, overrideId: null },
    { date: "2026-10-05", name: "대체공휴일(개천절)", source: "public", excluded: false, overrideId: null },
    { date: "2026-10-09", name: "한글날", source: "public", excluded: true, overrideId: "ovr-exclude" },
    { date: "2026-10-20", name: "임시공휴일", source: "branch_add", excluded: false, overrideId: "ovr-add" },
    { date: "2026-12-25", name: "성탄절", source: "builtin", excluded: false, overrideId: null },
  ],
  inactiveOverrides: [
    { id: "inactive-future", date: "2026-11-02", kind: "add", name: "옛 임시공휴일" },
    { id: "inactive-past", date: "2026-09-01", kind: "exclude", name: null },
  ],
};

const YEAR_2027: BranchHolidayYear = {
  year: 2027,
  revision: 2,
  supported: true,
  synced: false,
  lastSyncedAt: null,
  holidays: [{ date: "2027-01-01", name: "신정", source: "builtin", excluded: false, overrideId: null }],
  inactiveOverrides: [],
};

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = jest.spyOn(queryClient, "invalidateQueries");
  render(
    <QueryClientProvider client={queryClient}>
      <HolidaySettingsSection branchId="branch-1" branchName="인천 남동지점" />
    </QueryClientProvider>,
  );
  return { invalidate };
}

function rowFor(name: string): HTMLElement {
  const row = screen.getByText(name).closest("tr");
  if (!row) throw new Error(`row not found: ${name}`);
  return row;
}

describe("HolidaySettingsSection", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    api.getYear.mockImplementation(async (_branchId, year) => (year === 2027 ? YEAR_2027 : YEAR_2026));
    api.createOverride.mockResolvedValue(undefined);
    api.deleteOverride.mockResolvedValue(undefined);
  });

  it("shows the branch, the scope note, the year tabs and the last sync time (KST)", async () => {
    renderSection();

    expect(await screen.findByText("대체공휴일(개천절)")).toBeInTheDocument();
    expect(api.getYear).toHaveBeenCalledWith("branch-1", 2026);
    expect(screen.getByText("인천 남동지점", { selector: "[data-slot='holiday-branch-pill']" })).toBeInTheDocument();
    expect(screen.getByText(/공공데이터 공휴일은 모든 지점에 똑같이 적용돼요/)).toHaveTextContent(
      "여기서 추가하거나 제외한 날짜는 인천 남동지점에만 적용돼요.",
    );
    expect(screen.getByRole("tab", { name: "2026" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "2027" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByText("마지막 동기화 10월 1일 04:00")).toBeInTheDocument();
    expect(document.querySelector("[data-slot='holiday-review-cards']")).not.toBeNull();
  });

  it("shows the not-synced notice and loads the next year on its tab", async () => {
    renderSection();
    await screen.findByText("한글날");

    // Radix tabs activate on pointer-down (not click).
    fireEvent.mouseDown(screen.getByRole("tab", { name: "2027" }));

    expect(await screen.findByText("신정")).toBeInTheDocument();
    expect(api.getYear).toHaveBeenCalledWith("branch-1", 2027);
    expect(screen.getByText("아직 동기화되지 않았어요 (기본 공휴일 목록 사용 중)")).toBeInTheDocument();
  });

  it("switches the year from the keyboard and exposes the selected tab accessibly", async () => {
    renderSection();
    await screen.findByText("한글날");

    const tab2026 = screen.getByRole("tab", { name: "2026" });
    expect(screen.getByRole("tablist", { name: "연도" })).toHaveAttribute("data-component", "desktop_settings_sections_holidays_toolbar_year-tabs");
    act(() => tab2026.focus());
    fireEvent.keyDown(tab2026, { key: "ArrowRight" });

    expect(await screen.findByText("신정")).toBeInTheDocument();
    expect(api.getYear).toHaveBeenCalledWith("branch-1", 2027);
    expect(screen.getByRole("tab", { name: "2027" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "2026" })).toHaveAttribute("aria-selected", "false");
  });

  it("renders the source chip and the right action for each row", async () => {
    renderSection();
    await screen.findByText("한글날");

    const publicRow = rowFor("대체공휴일(개천절)");
    expect(within(publicRow).getByText("10월 5일 (월)")).toBeInTheDocument();
    expect(within(publicRow).getByText("공공데이터")).toBeInTheDocument();
    expect(within(publicRow).getByRole("button", { name: "제외" })).toBeInTheDocument();

    const builtinRow = rowFor("성탄절");
    expect(within(builtinRow).getByText("공공데이터")).toBeInTheDocument();
    expect(within(builtinRow).getByRole("button", { name: "제외" })).toBeInTheDocument();

    const excludedRow = rowFor("한글날");
    expect(within(excludedRow).getByText("지점 제외")).toBeInTheDocument();
    expect(within(excludedRow).getByRole("button", { name: "다시 포함" })).toBeInTheDocument();

    const addedRow = rowFor("임시공휴일");
    expect(within(addedRow).getByText("지점 추가")).toBeInTheDocument();
    expect(within(addedRow).getByRole("button", { name: "삭제" })).toBeInTheDocument();
  });

  it("locks rows before today (no actions) and rows on a weekend get no 제외", async () => {
    renderSection();
    await screen.findByText("한글날");

    const pastRow = rowFor("추석");
    expect(within(pastRow).queryByRole("button")).not.toBeInTheDocument();
    expect(within(pastRow).getByText("지난 날짜")).toBeInTheDocument();

    const weekendRow = rowFor("개천절");
    expect(within(weekendRow).getByText("10월 3일 (토)")).toBeInTheDocument();
    expect(within(weekendRow).queryByRole("button")).not.toBeInTheDocument();
  });

  it("제외 creates an exclude override and refreshes both caches", async () => {
    const { invalidate } = renderSection();
    await screen.findByText("한글날");

    fireEvent.click(within(rowFor("대체공휴일(개천절)")).getByRole("button", { name: "제외" }));

    await waitFor(() => {
      expect(api.createOverride).toHaveBeenCalledWith("branch-1", { date: "2026-10-05", kind: "exclude" });
    });
    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["holiday-settings", "branch-1"] });
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ["holidays", "branch-1"] });
    });
  });

  it("다시 포함 and 삭제 delete the row's override id", async () => {
    renderSection();
    await screen.findByText("한글날");

    fireEvent.click(within(rowFor("한글날")).getByRole("button", { name: "다시 포함" }));
    await waitFor(() => expect(api.deleteOverride).toHaveBeenCalledWith("branch-1", "ovr-exclude"));

    fireEvent.click(within(rowFor("임시공휴일")).getByRole("button", { name: "삭제" }));
    await waitFor(() => expect(api.deleteOverride).toHaveBeenCalledWith("branch-1", "ovr-add"));
  });

  it("lists only future inactive overrides, with a 삭제 that deletes them", async () => {
    renderSection();
    await screen.findByText("한글날");

    expect(screen.getByText("적용되지 않는 지점 설정")).toBeInTheDocument();
    expect(screen.getByText("공공데이터가 바뀌어 지금은 효과가 없는 설정이에요.")).toBeInTheDocument();
    expect(screen.getByText(/옛 임시공휴일/)).toBeInTheDocument();
    expect(screen.queryByText("9월 1일 (화)")).not.toBeInTheDocument();

    const item = screen.getByText(/옛 임시공휴일/).closest("li") as HTMLElement;
    fireEvent.click(within(item).getByRole("button", { name: "삭제" }));
    await waitFor(() => expect(api.deleteOverride).toHaveBeenCalledWith("branch-1", "inactive-future"));
  });

  describe("add form", () => {
    async function openForm() {
      renderSection();
      await screen.findByText("한글날");
      return {
        date: screen.getByLabelText("날짜"),
        name: screen.getByLabelText("이름"),
        submit: screen.getByRole("button", { name: "공휴일 추가" }),
      };
    }

    it("hyphenates the date while typing digits and creates an add override", async () => {
      const form = await openForm();

      fireEvent.change(form.date, { target: { value: "20261021" } });
      expect(form.date).toHaveValue("2026-10-21");
      fireEvent.change(form.name, { target: { value: "임시공휴일" } });
      fireEvent.click(form.submit);

      await waitFor(() => {
        expect(api.createOverride).toHaveBeenCalledWith("branch-1", {
          date: "2026-10-21",
          kind: "add",
          name: "임시공휴일",
        });
      });
      await waitFor(() => expect(form.date).toHaveValue(""));
    });

    it("rejects a malformed date, a past date, a weekend and a missing name before any request", async () => {
      const form = await openForm();
      fireEvent.change(form.name, { target: { value: "임시공휴일" } });

      fireEvent.change(form.date, { target: { value: "2026" } });
      fireEvent.click(form.submit);
      expect(await screen.findByText("YYYY-MM-DD 형식으로 입력해 주세요.")).toBeInTheDocument();

      fireEvent.change(form.date, { target: { value: "20260930" } });
      fireEvent.click(form.submit);
      expect(await screen.findByText(PROBLEM_CATALOG.HOLIDAY_DATE_IN_PAST.title["ko-KR"])).toBeInTheDocument();

      fireEvent.change(form.date, { target: { value: "20261024" } }); // Saturday
      fireEvent.click(form.submit);
      expect(await screen.findByText(PROBLEM_CATALOG.HOLIDAY_NOT_WEEKDAY.title["ko-KR"])).toBeInTheDocument();

      fireEvent.change(form.date, { target: { value: "20261021" } });
      fireEvent.change(form.name, { target: { value: "  " } });
      fireEvent.click(form.submit);
      expect(await screen.findByText(PROBLEM_CATALOG.HOLIDAY_NAME_REQUIRED.title["ko-KR"])).toBeInTheDocument();

      expect(api.createOverride).not.toHaveBeenCalled();
    });

    it("keeps the input and reports the server's message when the request fails", async () => {
      api.createOverride.mockRejectedValue({
        response: { status: 409, data: { code: "HOLIDAY_ALREADY_PUBLIC", statusCode: 409 } },
      });
      const form = await openForm();

      fireEvent.change(form.date, { target: { value: "20261005" } });
      fireEvent.change(form.name, { target: { value: "중복" } });
      fireEvent.click(form.submit);

      await waitFor(() => {
        expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" }));
      });
      expect(form.date).toHaveValue("2026-10-05");
      expect(form.name).toHaveValue("중복");
    });
  });

  describe("지금 동기화", () => {
    it("renders each year's result", async () => {
      api.syncNow.mockResolvedValue({
        results: [
          { year: 2026, status: "unchanged", added: 0, removed: 0 },
          { year: 2027, status: "updated", added: 1, removed: 0 },
          { year: 2028, status: "updated", added: 2, removed: 1 },
          { year: 2029, status: "updated", added: 0, removed: 0 },
          { year: 2030, status: "failed", added: 0, removed: 0, error: "x" },
        ],
      });
      renderSection();
      await screen.findByText("한글날");

      fireEvent.click(screen.getByRole("button", { name: "지금 동기화" }));

      expect(await screen.findByText("2026년 변경 없음")).toBeInTheDocument();
      expect(screen.getByText("2027년 1건 추가")).toBeInTheDocument();
      expect(screen.getByText("2028년 2건 추가 · 1건 삭제")).toBeInTheDocument();
      expect(screen.getByText("2029년 이름 변경 반영")).toBeInTheDocument();
      expect(screen.getByText("2030년 공휴일 정보를 가져오지 못했어요")).toBeInTheDocument();
      expect(api.syncNow).toHaveBeenCalledWith("branch-1");
    });

    it("tells the user to wait on a 429", async () => {
      api.syncNow.mockRejectedValue({ response: { status: 429, data: {} } });
      renderSection();
      await screen.findByText("한글날");

      fireEvent.click(screen.getByRole("button", { name: "지금 동기화" }));

      expect(await screen.findByText("잠시 후 다시 시도해 주세요.")).toBeInTheDocument();
    });
  });

  it("shows an error when the list cannot be loaded", async () => {
    api.getYear.mockRejectedValue(new Error("boom"));
    renderSection();

    expect(await screen.findByText("공휴일 목록을 불러오지 못했어요.")).toBeInTheDocument();
  });
});
