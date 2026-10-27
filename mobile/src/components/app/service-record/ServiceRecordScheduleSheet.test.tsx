import type { ReactNode } from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import type {
  AdminServiceRecordScheduleApi,
  ScheduleDraft,
  ScheduleDraftState,
} from "@/features/service-records/api/admin-service-record-schedule.api";
import { createKrBusinessDayCalendar } from "@/lib/date/business-days";

import { ServiceRecordScheduleSheet } from "./ServiceRecordScheduleSheet";
import {
  FIXTURE_CALENDAR,
  FIXTURE_DATES,
  fixtureOverview,
  type FixtureOverviewOptions,
} from "./service-record-schedule.fixture";

const mockCalendarHook = {
  calendar: FIXTURE_CALENDAR,
  ready: true,
  error: null as null | "no-branch" | "load-failed",
  retry: jest.fn(),
  refreshForSave: jest.fn(),
  version: "fixture",
};
jest.mock("@/hooks/useBusinessDayCalendar", () => ({
  useBusinessDayCalendar: () => mockCalendarHook,
}));

const SOURCE = { sourceFingerprint: "fp-1", sourceCaseVersion: 7 };

function draft(overrides: Partial<ScheduleDraft> = {}): ScheduleDraft {
  return {
    id: "draft-1",
    status: "ACTIVE",
    draftVersion: 1,
    sourceCaseVersion: SOURCE.sourceCaseVersion,
    sourceFingerprint: SOURCE.sourceFingerprint,
    changes: {},
    ...overrides,
  };
}

function draftState(overrides: Partial<ScheduleDraftState> = {}): ScheduleDraftState {
  return { draft: null, sourceChanged: false, ...SOURCE, ...overrides };
}

function makeApi(options: FixtureOverviewOptions = {}) {
  const mocks = {
    getEditor: jest.fn().mockResolvedValue(fixtureOverview(options)),
    getDraft: jest.fn().mockResolvedValue(draftState()),
    startDraft: jest.fn().mockResolvedValue(draftState({ draft: draft() })),
    updateDraft: jest.fn().mockResolvedValue(draftState({ draft: draft({ draftVersion: 2 }) })),
    previewDraft: jest.fn().mockResolvedValue({ previewId: "srp_1", draftId: "draft-1", draftVersion: 2, blockingReasons: [] }),
    confirmDraft: jest.fn().mockResolvedValue({ status: "confirmed", caseVersion: 8 }),
    discardDraft: jest.fn().mockResolvedValue(draftState()),
  };
  return { api: mocks as unknown as AdminServiceRecordScheduleApi, mocks };
}

const axiosError = (status: number, data: unknown = {}) => ({ response: { status, data } });

async function openSheet(
  options: FixtureOverviewOptions = {},
  handlers: { onClose?: jest.Mock; onSaved?: jest.Mock; prepare?: (mocks: ReturnType<typeof makeApi>["mocks"]) => void } = {},
) {
  const { api, mocks } = makeApi(options);
  handlers.prepare?.(mocks);
  const onClose = handlers.onClose ?? jest.fn();
  const onSaved = handlers.onSaved ?? jest.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  render(
    <ServiceRecordScheduleSheet
      data-component="mobile_clients_detail_service-record-schedule-sheet"
      clientId={12}
      clientName="김하늘"
      api={api}
      onClose={onClose}
      onSaved={onSaved}
    />,
    { wrapper },
  );
  await screen.findByText("서비스 제공일");
  return { mocks, onClose, onSaved, user: userEvent.setup() };
}

/** The calendar cell whose accessible name starts with the date label, e.g. `12/17(목)`. */
const cell = (label: string) => screen.getByRole("button", { name: new RegExp(`^${label.replace(/[()]/g, "\\$&")}`) });
const saveButton = () => screen.getByRole("button", { name: "저장" });
const progressText = () => document.querySelector('[data-component$="_body_section-calendar_progress"]')?.textContent;
const toggle = (name: string) => screen.getByRole("switch", { name });

beforeEach(() => {
  mockCalendarHook.calendar = FIXTURE_CALENDAR;
  mockCalendarHook.ready = true;
  mockCalendarHook.error = null;
  mockCalendarHook.retry = jest.fn();
  mockCalendarHook.refreshForSave.mockReset().mockResolvedValue({ ok: true, calendar: FIXTURE_CALENDAR, changed: false });
});

describe("ServiceRecordScheduleSheet", () => {
  describe("layout", () => {
    it("opens as a bottom sheet with a handle, the client and start date, and the 10/10 state", async () => {
      await openSheet();

      const dialog = screen.getByRole("dialog", { name: "제공기록지 일정 변경" });
      expect(dialog).toHaveAttribute("data-side", "bottom");
      expect(dialog).toHaveAttribute("data-source-component", "ServiceRecordScheduleSheet");
      expect(dialog.querySelector('[data-slot="schedule-sheet-handle"]')).not.toBeNull();
      expect(within(dialog).getByText("김하늘 · 시작일 2026-12-14(월)")).toBeInTheDocument();
      expect(within(dialog).getByText("주말·공휴일 서비스")).toBeInTheDocument();
      expect(within(dialog).getByText("현재 선택된 날짜를 해제하고 다른 날짜를 선택할 수 있어요.")).toBeInTheDocument();
      expect(within(dialog).getByText("2026년 12월")).toBeInTheDocument();
      expect(progressText()).toBe("10/10");
      expect(saveButton()).toBeEnabled();
      for (const name of ["토요일", "일요일", "공휴일"]) expect(toggle(name)).toHaveAttribute("aria-checked", "false");
    });

    it("cannot overflow a 390px screen: full-width, shrinkable sheet and a 7-column grid of shrinkable 44px cells", async () => {
      await openSheet();

      const dialog = screen.getByRole("dialog");
      expect(dialog).toHaveClass("w-full", "min-w-0", "overflow-hidden");
      const body = document.querySelector('[data-component$="_body"]') as HTMLElement;
      expect(body).toHaveClass("min-w-0", "overflow-x-hidden", "overflow-y-auto");
      const grid = document.querySelector('[data-component$="_body_section-calendar_grid"]') as HTMLElement;
      expect(grid).toHaveClass("grid", "grid-cols-7", "w-full", "min-w-0");
      const cells = grid.querySelectorAll('[data-slot="schedule-day"]');
      expect(cells).toHaveLength(31);
      cells.forEach((day) => expect(day).toHaveClass("min-w-0", "min-h-11"));
      expect(screen.getByRole("button", { name: "저장" })).toHaveClass("h-11");
      expect(screen.getByRole("button", { name: "닫기" })).toHaveClass("h-11", "w-11");
    });

    it("stacks above the client detail sheet (z-70/z-100): scrim z-[200], sheet z-[201]", async () => {
      await openSheet();

      const dialog = screen.getByRole("dialog", { name: "제공기록지 일정 변경" });
      expect(dialog).toHaveAttribute("data-slot", "sheet-content");
      expect(dialog).toHaveClass("z-[201]");
      expect(dialog).not.toHaveClass("z-50");
      const overlay = document.querySelector('[data-slot="sheet-overlay"]');
      expect(overlay).not.toBeNull();
      expect(overlay).toHaveClass("z-[200]");
      expect(overlay).not.toHaveClass("z-50");
    });

    it("shows the legend and hides session numbers inside the cells", async () => {
      await openSheet();

      for (const label of ["평일", "주말·공휴일", "빠진 날", "선택 가능", "선택 불가"]) {
        expect(screen.getAllByText(label).length).toBeGreaterThan(0);
      }
      expect(cell("12/17(목)")).toHaveAttribute("aria-label", "12/17(목) 4회차, 누르면 뺍니다");
      expect(cell("12/17(목)")).toHaveTextContent(/^17$/);
      expect(screen.getByText("공휴일", { selector: "small" })).toBeInTheDocument();
    });
  });

  describe("written sessions are fixed", () => {
    it("says so when a written date or an earlier unwritten one is tapped, and changes nothing", async () => {
      const { user } = await openSheet();

      await user.click(cell("12/14(월)"));
      expect(screen.getByText("작성된 회차는 바꿀 수 없어요")).toBeInTheDocument();
      expect(progressText()).toBe("10/10");

      await user.click(cell("12/16(수)"));
      await user.click(cell("12/15(화)"));
      expect(screen.getByText("작성된 회차는 바꿀 수 없어요")).toBeInTheDocument();
      expect(progressText()).toBe("10/10");
      expect(cell("12/15(화)")).toHaveAttribute("aria-pressed", "true");
    });

    it("offers nothing unselected before the last written date", async () => {
      await openSheet({ dates: ["2026-12-14", "2026-12-16", ...FIXTURE_DATES.slice(3, 11)], writtenIndexes: [1, 2] });

      expect(cell("12/15(화)")).toBeDisabled();
      expect(cell("12/13(일)")).toBeDisabled();
    });
  });

  describe("picking dates", () => {
    it("deselecting 12-17 shows 9/10 and disables 저장; selecting 12-29 shows 10/10 and enables it", async () => {
      const { user } = await openSheet();

      await user.click(cell("12/17(목)"));
      expect(progressText()).toBe("9/10");
      expect(saveButton()).toBeDisabled();

      await user.click(cell("12/29(화)"));
      expect(progressText()).toBe("10/10");
      expect(saveButton()).toBeEnabled();
    });

    it("answers with the full notice and changes nothing when 10 dates are selected", async () => {
      const { user } = await openSheet();

      await user.click(cell("12/29(화)"));

      expect(screen.getByText("이미 10회차를 모두 골랐어요. 먼저 빼고 싶은 날짜를 눌러 주세요.")).toBeInTheDocument();
      expect(progressText()).toBe("10/10");
      expect(cell("12/29(화)")).toHaveAttribute("aria-pressed", "false");
    });

    it("moves between months and stops at the start month", async () => {
      const { user } = await openSheet();
      expect(screen.getByRole("button", { name: "이전 달" })).toBeDisabled();

      await user.click(screen.getByRole("button", { name: "다음 달" }));
      expect(screen.getByText("2027년 1월")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "이전 달" })).toBeEnabled();
      expect(cell("1/4(월)")).toBeEnabled();

      await user.click(screen.getByRole("button", { name: "이전 달" }));
      expect(screen.getByText("2026년 12월")).toBeInTheDocument();
    });

    it("opens on the month of the first unwritten selected date", async () => {
      await openSheet({ dates: ["2026-12-30", "2027-01-04"], writtenIndexes: [1], startDate: "2026-12-30" });
      expect(screen.getByText("2027년 1월")).toBeInTheDocument();
    });
  });

  describe("service-day toggles", () => {
    it("turns 12-19 from unavailable into selectable when 토요일 is on", async () => {
      const { user } = await openSheet();
      expect(cell("12/19(토)")).toBeDisabled();
      expect(cell("12/19(토)")).toHaveAttribute("data-day-state", "unavailable");

      await user.click(toggle("토요일"));

      expect(toggle("토요일")).toHaveAttribute("aria-checked", "true");
      expect(cell("12/19(토)")).toBeEnabled();
      expect(cell("12/19(토)")).toHaveAttribute("data-day-state", "skipped");
    });

    it("tells which unwritten date a switch took away", async () => {
      const { user } = await openSheet({
        dates: [...FIXTURE_DATES.slice(0, 5), "2026-12-19", ...FIXTURE_DATES.slice(5, 9)],
        serviceDays: { saturday: true, sunday: false, holiday: false },
      });
      expect(progressText()).toBe("10/10");

      await user.click(toggle("토요일"));

      expect(screen.getByText("12/19(토)은(는) 이제 고를 수 없어서 뺐어요.")).toBeInTheDocument();
      expect(progressText()).toBe("9/10");
      expect(saveButton()).toBeDisabled();
    });

    it("keeps 되돌리기 returning the dates and the toggles", async () => {
      const { user } = await openSheet();
      await user.click(toggle("토요일"));
      await user.click(cell("12/17(목)"));
      await user.click(cell("12/19(토)"));
      expect(progressText()).toBe("10/10");
      expect(cell("12/17(목)")).toHaveAttribute("aria-pressed", "false");

      await user.click(screen.getByRole("button", { name: "되돌리기" }));

      expect(toggle("토요일")).toHaveAttribute("aria-checked", "false");
      expect(cell("12/17(목)")).toHaveAttribute("aria-pressed", "true");
      expect(cell("12/19(토)")).toHaveAttribute("data-day-state", "unavailable");
      expect(progressText()).toBe("10/10");
    });

    it("lets a written Saturday stand while 토요일 is off and still enables 저장", async () => {
      await openSheet({
        dates: ["2026-12-14", "2026-12-15", "2026-12-16", "2026-12-17", "2026-12-18", "2026-12-19", "2026-12-21", "2026-12-22", "2026-12-23", "2026-12-24"],
        writtenIndexes: [6],
      });

      expect(toggle("토요일")).toHaveAttribute("aria-checked", "false");
      expect(cell("12/19(토)")).toHaveAttribute("data-day-state", "locked");
      expect(progressText()).toBe("10/10");
      expect(saveButton()).toBeEnabled();
    });
  });

  describe("cancel", () => {
    it("closes without saving, and the edits are not persisted", async () => {
      const { user, mocks, onClose, onSaved } = await openSheet();
      await user.click(toggle("토요일"));
      await user.click(cell("12/17(목)"));

      await user.click(screen.getByRole("button", { name: "취소" }));

      expect(onClose).toHaveBeenCalledTimes(1);
      expect(onSaved).not.toHaveBeenCalled();
      expect(mocks.startDraft).not.toHaveBeenCalled();
      expect(mocks.updateDraft).not.toHaveBeenCalled();
    });
  });

  describe("load states", () => {
    it("refuses when the projection is blocked, offering no save", async () => {
      const { api } = makeApi({ blockingReasons: [{ code: "ASSIGNMENT_RANGE_OVERLAP", message: "x" }] });
      (api.getEditor as jest.Mock).mockResolvedValue(fixtureOverview({ blockingReasons: [{ code: "ASSIGNMENT_RANGE_OVERLAP", message: "x" }] }));
      const queryClient = new QueryClient();
      render(
        <QueryClientProvider client={queryClient}>
          <ServiceRecordScheduleSheet data-component="x_sheet" clientId={12} clientName="김하늘" api={api} onClose={jest.fn()} onSaved={jest.fn()} />
        </QueryClientProvider>,
      );

      expect(await screen.findByText("일정을 확인할 수 없어 변경할 수 없어요. 제공기록지를 먼저 확인해 주세요")).toBeInTheDocument();
      expect(saveButton()).toBeDisabled();
    });

    it("shows a retry when loading fails and loads on retry", async () => {
      const { api, mocks } = makeApi();
      mocks.getEditor.mockRejectedValueOnce(axiosError(500));
      const user = userEvent.setup();
      render(
        <QueryClientProvider client={new QueryClient()}>
          <ServiceRecordScheduleSheet data-component="x_sheet" clientId={12} clientName="김하늘" api={api} onClose={jest.fn()} onSaved={jest.fn()} />
        </QueryClientProvider>,
      );

      expect(await screen.findByText("일정을 불러오지 못했어요. 잠시 후 다시 시도해 주세요")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "다시 시도" }));

      expect(await screen.findByText("서비스 제공일")).toBeInTheDocument();
      expect(mocks.getEditor).toHaveBeenCalledTimes(2);
    });

    it("keeps the service-day switches off until the holiday calendar is ready", async () => {
      mockCalendarHook.ready = false;
      const { user } = await openSheet();

      for (const name of ["토요일", "일요일", "공휴일"]) expect(toggle(name)).toBeDisabled();
      await user.click(toggle("토요일"));

      expect(toggle("토요일")).not.toBeChecked();
      expect(progressText()).toBe("10/10");
      expect(cell("12/19(토)")).toBeDisabled();
    });

    it("reads the draft identity before and after the overview and retries a torn read", async () => {
      const newer = { ...SOURCE, sourceFingerprint: "fp-2", sourceCaseVersion: 8 };
      const { mocks } = await openSheet({}, {
        prepare: (m) => {
          // First attempt: identity moves while the overview is being read. Second attempt is stable.
          m.getDraft
            .mockResolvedValueOnce(draftState())
            .mockResolvedValueOnce(draftState(newer))
            .mockResolvedValue(draftState(newer));
        },
      });

      expect(mocks.getEditor).toHaveBeenCalledTimes(2);
      expect(mocks.getDraft).toHaveBeenCalledTimes(4);
    });

    it("never saves from a snapshot whose identity moved during the read", async () => {
      const { api, mocks } = makeApi();
      // Every attempt sees the identity change between the two bracketing reads.
      let version = 7;
      mocks.getDraft.mockImplementation(async () => draftState({ sourceCaseVersion: (version += 1) }));
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      render(
        <QueryClientProvider client={queryClient}>
          <ServiceRecordScheduleSheet
            data-component="mobile_clients_detail_service-record-schedule-sheet"
            clientId={12}
            clientName="김하늘"
            api={api}
            onClose={jest.fn()}
            onSaved={jest.fn()}
          />
        </QueryClientProvider>,
      );

      expect(await screen.findByText("일정을 불러오지 못했어요. 잠시 후 다시 시도해 주세요")).toBeInTheDocument();
      expect(saveButton()).toBeDisabled();
      expect(mocks.getEditor).toHaveBeenCalledTimes(3);
      expect(mocks.updateDraft).not.toHaveBeenCalled();
      expect(mocks.startDraft).not.toHaveBeenCalled();
    });

    it("waits for the holiday calendar before the dates can be changed or saved", async () => {
      mockCalendarHook.ready = false;
      const { user } = await openSheet();

      expect(screen.getByText("휴일 달력을 불러오는 중이에요")).toBeInTheDocument();
      expect(cell("12/17(목)")).toBeDisabled();
      expect(saveButton()).toBeDisabled();
      await user.click(cell("12/17(목)"));
      expect(progressText()).toBe("10/10");
    });

    it("offers a retry when the holiday calendar failed to load", async () => {
      mockCalendarHook.ready = false;
      mockCalendarHook.error = "load-failed";
      const { user } = await openSheet();

      await user.click(screen.getByRole("button", { name: "다시 시도" }));

      expect(screen.getByText("휴일 달력을 불러오지 못했어요")).toBeInTheDocument();
      expect(mockCalendarHook.retry).toHaveBeenCalledTimes(1);
    });
  });

  describe("saving", () => {
    it("saves in the wizard's order with the whole-set schedule, then reports success", async () => {
      const { user, mocks, onSaved } = await openSheet();
      await user.click(toggle("토요일"));
      await user.click(cell("12/17(목)"));
      await user.click(cell("12/19(토)"));

      await user.click(saveButton());

      await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ sessionCount: 10 }));
      expect(mockCalendarHook.refreshForSave).toHaveBeenCalledTimes(1);
      expect(mocks.updateDraft).toHaveBeenCalledWith("draft-1", 1, {}, {
        serviceDays: { saturday: true, sunday: false, holiday: false },
        dates: ["2026-12-14", "2026-12-15", "2026-12-16", "2026-12-18", "2026-12-19", "2026-12-21", "2026-12-22", "2026-12-23", "2026-12-24", "2026-12-28"],
      });
      const order = [mocks.getDraft, mocks.startDraft, mocks.updateDraft, mocks.previewDraft, mocks.confirmDraft];
      order.slice(1).forEach((mock, index) => {
        expect(order[index].mock.invocationCallOrder[0]).toBeLessThan(mock.mock.invocationCallOrder[0]);
      });
      expect(mocks.confirmDraft).toHaveBeenCalledWith("draft-1", 2, "srp_1", expect.any(String));
      expect(mocks.discardDraft).not.toHaveBeenCalled();
    });

    it("discards an active draft left by someone else before starting", async () => {
      const { user, mocks, onSaved } = await openSheet();
      mocks.getDraft.mockResolvedValue(draftState({ draft: draft({ id: "old", draftVersion: 5, changes: { header: {} } }) }));

      await user.click(saveButton());

      await waitFor(() => expect(onSaved).toHaveBeenCalled());
      expect(mocks.discardDraft).toHaveBeenCalledWith("old", 5);
      expect(mocks.discardDraft.mock.invocationCallOrder[0]).toBeLessThan(mocks.startDraft.mock.invocationCallOrder[0]);
    });

    it("blocks save when the fresh holiday calendar no longer fits the dates", async () => {
      const { user, mocks, onSaved } = await openSheet();
      mockCalendarHook.refreshForSave.mockResolvedValue({
        ok: true,
        calendar: createKrBusinessDayCalendar(["2026-12-24", "2026-12-25"], { supportedYears: [2026, 2027, 2028], version: "fresh" }),
        changed: true,
      });

      await user.click(saveButton());

      expect(await screen.findByText("서비스 제공일을 모두 골라 주세요")).toBeInTheDocument();
      // Only the two reads that bracket the overview when the sheet opened: the save never reached the draft API.
      expect(mocks.getDraft).toHaveBeenCalledTimes(2);
      expect(mocks.startDraft).not.toHaveBeenCalled();
      expect(onSaved).not.toHaveBeenCalled();
    });

    it("does not save when the holiday calendar cannot be refreshed", async () => {
      const { user, mocks } = await openSheet();
      mockCalendarHook.refreshForSave.mockResolvedValue({ ok: false });

      await user.click(saveButton());

      expect(await screen.findByText("휴일 달력을 확인하지 못해 저장하지 못했어요. 잠시 후 다시 시도해 주세요")).toBeInTheDocument();
      expect(mocks.getDraft).toHaveBeenCalledTimes(2); // the two reads that bracket the overview on open
      expect(mocks.startDraft).not.toHaveBeenCalled();
    });

    it("reloads with a message when the record changed since the sheet opened", async () => {
      const { user, mocks, onSaved } = await openSheet();
      await user.click(cell("12/17(목)"));
      mocks.getDraft.mockResolvedValue(draftState({ sourceCaseVersion: 8 }));
      await user.click(cell("12/29(화)"));

      await user.click(saveButton());

      expect(await screen.findByText("일정이 바뀌어 다시 불러왔어요")).toBeInTheDocument();
      expect(mocks.getEditor).toHaveBeenCalledTimes(2);
      expect(mocks.startDraft).not.toHaveBeenCalled();
      expect(onSaved).not.toHaveBeenCalled();
      // The picker was reset to the reloaded schedule.
      expect(cell("12/17(목)")).toHaveAttribute("aria-pressed", "true");
      expect(cell("12/29(화)")).toHaveAttribute("aria-pressed", "false");
    });

    it("aborts, leaving the draft alone, when startDraft returns a draft that already has changes", async () => {
      const { user, mocks, onSaved } = await openSheet();
      mocks.startDraft.mockResolvedValue(draftState({ draft: draft({ changes: { header: { momName: "x" } } }) }));

      await user.click(saveButton());

      expect(await screen.findByText("다른 곳에서 수정 중인 내용이 있어 저장하지 않았어요. 잠시 후 다시 시도해 주세요")).toBeInTheDocument();
      expect(mocks.updateDraft).not.toHaveBeenCalled();
      expect(mocks.discardDraft).not.toHaveBeenCalled();
      expect(onSaved).not.toHaveBeenCalled();
      expect(saveButton()).toBeEnabled();
    });

    it("retries once automatically on a version conflict", async () => {
      const { user, mocks, onSaved } = await openSheet();
      mocks.confirmDraft
        .mockRejectedValueOnce(axiosError(409, { code: "SERVICE_RECORD_WRITE_TARGET_CHANGED" }))
        .mockResolvedValueOnce({ status: "confirmed", caseVersion: 9 });

      await user.click(saveButton());

      await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
      expect(mocks.confirmDraft).toHaveBeenCalledTimes(2);
      expect(mocks.startDraft).toHaveBeenCalledTimes(2);
    });

    it("shows the reason, without a retry, for a 409 that carries blockingReasons", async () => {
      const { user, mocks, onSaved } = await openSheet();
      mocks.confirmDraft.mockRejectedValue(
        axiosError(409, { code: "REQUEST_CONFLICT", blockingReasons: [{ code: "LOCKED_SESSION_DATE_CHANGED", sessionIndex: 2 }] }),
      );

      await user.click(saveButton());

      expect(await screen.findByText("2회차: 이미 작성된 회차의 날짜는 바꿀 수 없어요")).toBeInTheDocument();
      expect(mocks.confirmDraft).toHaveBeenCalledTimes(1);
      expect(mocks.startDraft).toHaveBeenCalledTimes(1);
      expect(onSaved).not.toHaveBeenCalled();
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("does not retry a 409 about an earlier edit that is still running, and says so", async () => {
      const { user, mocks, onSaved } = await openSheet();
      mocks.confirmDraft.mockRejectedValue(
        axiosError(409, { code: "SERVICE_RECORD_WRITE_TARGET_CHANGED", blockingOperation: { operation: "contract_period" } }),
      );

      await user.click(saveButton());

      expect(
        await screen.findByText("이전 수정의 계약서 반영이 아직 진행 중이라 저장할 수 없어요. 잠시 후 다시 시도해 주세요"),
      ).toBeInTheDocument();
      expect(mocks.confirmDraft).toHaveBeenCalledTimes(1);
      expect(mocks.startDraft).toHaveBeenCalledTimes(1);
      expect(onSaved).not.toHaveBeenCalled();
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("shows the preview's blocking reasons in Korean and discards the draft", async () => {
      const { user, mocks } = await openSheet();
      mocks.previewDraft.mockResolvedValue({
        previewId: "srp_1",
        draftId: "draft-1",
        draftVersion: 2,
        blockingReasons: [{ code: "NON_SERVICE_DAY", sessionIndex: 6 }, { code: "SCHEDULE_BEFORE_START" }],
      });

      await user.click(saveButton());

      expect(await screen.findByText(/6회차: 서비스일이 아닌 날이 포함돼 있어요/)).toBeInTheDocument();
      expect(screen.getByText(/시작일보다 앞선 날짜가 포함돼 있어요/)).toBeInTheDocument();
      expect(mocks.discardDraft).toHaveBeenCalledWith("draft-1", 2);
      expect(mocks.confirmDraft).not.toHaveBeenCalled();
    });

    it("maps a refused draft save's scheduleCode to Korean copy and keeps the sheet open", async () => {
      const { user, mocks, onSaved } = await openSheet();
      mocks.updateDraft.mockRejectedValue(axiosError(400, { code: "VALIDATION_FAILED", scheduleCode: "SCHEDULE_COUNT_MISMATCH" }));

      await user.click(saveButton());

      expect(await screen.findByText("선택한 날짜 수가 회차 수와 달라요")).toBeInTheDocument();
      expect(onSaved).not.toHaveBeenCalled();
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(saveButton()).toBeEnabled();
    });

    it("uses generic copy for an unknown failure", async () => {
      const { user, mocks } = await openSheet();
      mocks.updateDraft.mockRejectedValue(axiosError(500));

      await user.click(saveButton());

      expect(await screen.findByText("저장하지 못했어요. 잠시 후 다시 시도해 주세요")).toBeInTheDocument();
    });

    it("blocks a second save while one is in flight", async () => {
      const { user, mocks } = await openSheet();
      let release: (value: unknown) => void = () => undefined;
      mocks.confirmDraft.mockReturnValue(new Promise((resolve) => { release = resolve; }));

      await user.click(saveButton());
      await waitFor(() => expect(mocks.confirmDraft).toHaveBeenCalledTimes(1));
      expect(screen.getByRole("button", { name: "저장 중..." })).toBeDisabled();
      expect(screen.getByRole("button", { name: "취소" })).toBeDisabled();

      await act(async () => release({ status: "confirmed", caseVersion: 8 }));
      expect(mocks.startDraft).toHaveBeenCalledTimes(1);
    });
  });
});
