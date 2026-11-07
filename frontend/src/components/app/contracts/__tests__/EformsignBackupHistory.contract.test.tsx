// Main-authored contract test (BJJ-570 Phase 3). Do not edit; if it is wrong, stop and report.
import { render, screen } from "@testing-library/react";
import { EformsignBackupHistory } from "@/components/app/contracts/EformsignBackupHistory";
import { useEformsignBackupRuns } from "@/hooks/useEformsignBackupRuns";

jest.mock("@/hooks/useEformsignBackupRuns", () => ({
    useEformsignBackupRuns: jest.fn(),
}));

const mockedHook = useEformsignBackupRuns as jest.MockedFunction<typeof useEformsignBackupRuns>;
const NOW = Date.parse("2026-11-10T00:00:00.000Z");
const WARNING = "최근 26시간 안에 성공한 백업이 없습니다";

function run(overrides: Record<string, unknown>) {
    return {
        id: String(overrides["id"] ?? "r"),
        startedAt: "2026-11-09T18:00:00.000Z",
        finishedAt: "2026-11-09T18:10:00.000Z",
        status: "success",
        limited: false,
        totalDocs: 10,
        savedFiles: 2,
        skippedFiles: 18,
        failedFiles: 0,
        driveStatus: "ok",
        failures: [],
        ...overrides,
    };
}

function withRuns(items: ReturnType<typeof run>[]) {
    mockedHook.mockReturnValue({
        data: { items },
        isLoading: false,
        isError: false,
        error: null,
        refetch: jest.fn(),
    } as unknown as ReturnType<typeof useEformsignBackupRuns>);
}

describe("EformsignBackupHistory (contract)", () => {
    beforeEach(() => {
        jest.useFakeTimers();
        jest.setSystemTime(NOW);
    });
    afterEach(() => {
        jest.useRealTimers();
        mockedHook.mockReset();
    });

    it("shows the empty state", () => {
        withRuns([]);
        render(<EformsignBackupHistory />);
        expect(screen.getByText("아직 백업 기록이 없습니다")).toBeInTheDocument();
    });

    it("uses the newest unlimited success as the last success and shows no warning when recent", () => {
        withRuns([
            run({ id: "1", startedAt: "2026-11-09T23:00:00.000Z", status: "success", limited: true }),
            run({ id: "2", startedAt: "2026-11-09T22:00:00.000Z", status: "partial", failedFiles: 1, failures: [{ docId: "D1", reason: "필수 파일 없음" }] }),
            run({ id: "3", startedAt: "2026-11-09T20:00:00.000Z", status: "success" }),
        ]);
        render(<EformsignBackupHistory />);
        // 2026-11-09T20:00Z = 2026-11-10 05:00 KST
        expect(screen.getAllByText(/2026\.11\.10 05:00/).length).toBeGreaterThan(0);
        expect(screen.queryByText(WARNING)).not.toBeInTheDocument();
        expect(screen.getAllByText("성공").length).toBeGreaterThan(0);
        expect(screen.getByText("부분 실패")).toBeInTheDocument();
        expect(screen.getByText("제한 실행")).toBeInTheDocument();
    });

    it("warns when the last full success is older than 26 hours", () => {
        withRuns([run({ startedAt: "2026-11-08T21:00:00.000Z" })]); // 27 hours before NOW
        render(<EformsignBackupHistory />);
        expect(screen.getByText(WARNING)).toBeInTheDocument();
    });

    it("warns when there is no full success at all", () => {
        withRuns([run({ status: "failed", driveStatus: "skipped" }), run({ id: "x", limited: true })]);
        render(<EformsignBackupHistory />);
        expect(screen.getByText(WARNING)).toBeInTheDocument();
        expect(screen.getAllByText("실패").length).toBeGreaterThan(0);
    });
});
