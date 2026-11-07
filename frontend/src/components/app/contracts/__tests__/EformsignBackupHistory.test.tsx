import { fireEvent, render, screen, within } from "@testing-library/react";
import { EformsignBackupHistory } from "../EformsignBackupHistory";
import { useEformsignBackupRuns, type EformsignBackupRun } from "@/hooks/useEformsignBackupRuns";

jest.mock("@/hooks/useEformsignBackupRuns", () => ({ useEformsignBackupRuns: jest.fn() }));
const mockHook = useEformsignBackupRuns as jest.Mock;
const NOW = Date.parse("2026-11-10T00:00:00Z");
const WARNING = "최근 26시간 안에 성공한 백업이 없습니다";
const ROOT = "desktop_contracts_sections_section-content_backups-section";

function run(overrides: Partial<EformsignBackupRun> = {}): EformsignBackupRun {
  return {
    id: "run-1", startedAt: "2026-11-09T22:00:00Z", finishedAt: "2026-11-09T22:10:00Z",
    status: "success", limited: false, totalDocs: 10, savedFiles: 2, skippedFiles: 18,
    failedFiles: 0, driveStatus: "ok", failures: [], ...overrides,
  };
}

function withRuns(items: EformsignBackupRun[], extra = {}) {
  mockHook.mockReturnValue({ data: { items }, isLoading: false, isError: false, refetch: jest.fn(), ...extra });
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
});
afterEach(() => {
  jest.useRealTimers();
  mockHook.mockReset();
});

it("shows the empty state", () => {
  withRuns([]);
  render(<EformsignBackupHistory />);
  expect(screen.getByText("아직 백업 기록이 없습니다")).toBeInTheDocument();
  expect(screen.getByText(WARNING)).toBeInTheDocument();
});

it("preserves newest-first rows, Korean statuses, all Drive values and file counts", () => {
  withRuns([
    run({ id: "new", limited: true }),
    run({ id: "middle", startedAt: "2026-11-09T21:00:00Z", status: "partial", driveStatus: "failed" }),
    run({ id: "old", startedAt: "2026-11-09T20:00:00Z", status: "failed", driveStatus: "skipped" }),
  ]);
  render(<EformsignBackupHistory />);
  const rows = screen.getAllByRole("row").slice(1);
  expect(rows).toHaveLength(3);
  ["2026.11.10 07:00", "2026.11.10 06:00", "2026.11.10 05:00"].forEach((date, index) => {
    expect(within(rows[index]).getByText(date)).toBeInTheDocument();
  });
  expect(within(rows[0]).getByText("성공")).toBeInTheDocument();
  expect(within(rows[0]).getByText("제한 실행")).toBeInTheDocument();
  expect(within(rows[0]).getByText("완료")).toBeInTheDocument();
  expect(within(rows[0]).getByText("10")).toBeInTheDocument();
  expect(within(rows[0]).getByText("2 / 18 / 0")).toBeInTheDocument();
  expect(within(rows[1]).getByText("부분 실패")).toBeInTheDocument();
  expect(within(rows[1]).getByText("실패")).toBeInTheDocument();
  expect(within(rows[2]).getByText("실패")).toBeInTheDocument();
  expect(within(rows[2]).getByText("안 함")).toBeInTheDocument();
});

it("skips newer limited successes and partial runs for the last full success", () => {
  withRuns([
    run({ id: "limited", startedAt: "2026-11-09T23:00:00Z", limited: true }),
    run({ id: "partial", status: "partial" }),
    run({ id: "full", startedAt: "2026-11-09T20:00:00Z" }),
  ]);
  render(<EformsignBackupHistory />);
  expect(screen.getByText("마지막 성공: 2026.11.10 05:00")).toBeInTheDocument();
  expect(screen.queryByText(WARNING)).not.toBeInTheDocument();
});

it.each([[27, true], [26, false], [2, false]])("warns for a full success %i hours old: %s", (hours, warns) => {
  withRuns([run({ startedAt: new Date(NOW - Number(hours) * 60 * 60 * 1000).toISOString() })]);
  render(<EformsignBackupHistory />);
  expect(screen.queryByText(WARNING) !== null).toBe(warns);
});

it("warns when no unlimited success exists", () => {
  withRuns([run({ status: "partial" }), run({ id: "limited", limited: true })]);
  render(<EformsignBackupHistory />);
  expect(screen.getByText("마지막 성공: 없음")).toBeInTheDocument();
  expect(screen.getByText(WARNING)).toBeInTheDocument();
});

it("toggles the selected run's failures and reports omitted failures", () => {
  withRuns([
    run({ failedFiles: 5, failures: [{ docId: "D1", reason: "필수 파일 없음" }, { docId: "D2", reason: "저장 실패" }] }),
    run({ id: "other", startedAt: "2026-11-09T21:00:00Z", failedFiles: 1, failures: [{ docId: "D3", reason: "검증 실패" }] }),
  ]);
  const { container } = render(<EformsignBackupHistory />);
  const rows = screen.getAllByRole("row").slice(1);
  expect(screen.queryByText("D1 — 필수 파일 없음")).not.toBeInTheDocument();
  fireEvent.click(rows[0]);
  const failures = container.querySelector(`[data-component="${ROOT}_failures"]`);
  expect(failures).toHaveAttribute("data-slot", "backup-failures");
  expect(screen.getByText("D1 — 필수 파일 없음")).toBeInTheDocument();
  expect(screen.getByText("D2 — 저장 실패")).toBeInTheDocument();
  expect(screen.getByText("외 3건")).toBeInTheDocument();
  fireEvent.click(rows[1]);
  expect(screen.queryByText("D1 — 필수 파일 없음")).not.toBeInTheDocument();
  expect(screen.getByText("D3 — 검증 실패")).toBeInTheDocument();
  fireEvent.click(rows[1]);
  expect(screen.queryByText("D3 — 검증 실패")).not.toBeInTheDocument();
});

it("shows a query error and retries the read", () => {
  const refetch = jest.fn();
  withRuns([], { isError: true, refetch });
  render(<EformsignBackupHistory />);
  expect(screen.getByRole("alert")).toHaveTextContent("불러오지 못했습니다");
  expect(screen.queryByText("아직 백업 기록이 없습니다")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  expect(refetch).toHaveBeenCalledTimes(1);
});

it("shows the table loading skeleton without an empty state or warning", () => {
  withRuns([], { isLoading: true });
  render(<EformsignBackupHistory />);
  expect(screen.getAllByRole("row")).toHaveLength(6);
  expect(screen.queryByText("아직 백업 기록이 없습니다")).not.toBeInTheDocument();
  expect(screen.queryByText(WARNING)).not.toBeInTheDocument();
});
