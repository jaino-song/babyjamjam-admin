import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useParams } from "next/navigation";

import ServiceRecordPage from "../[token]/page";
import { isoDateInKorea } from "@/lib/date/business-days";

jest.mock("next/navigation", () => ({
    useParams: jest.fn(),
}));

jest.mock("@/components/app/ui/ApprovalTwoButtonModal", () => ({
    ApprovalTwoButtonModal: () => null,
}));

jest.mock("@/components/app/ui/MobileTwoButtonModal", () => ({
    MobileTwoButtonModal: () => null,
}));

jest.mock("@/components/app/ui/NotificationOneButtonModal", () => ({
    NotificationOneButtonModal: () => null,
}));

jest.mock("@/components/app/service-record/SignaturePad", () => ({
    SignaturePad: () => null,
}));

const mockUseParams = useParams as jest.Mock;
const fetchMock = jest.fn();

function jsonResponse(data: unknown, status = 200): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => data,
    } as Response;
}

const serviceRecordContext = {
    org: { name: "테스트 제공기관" },
    employee: { id: 1, name: "제공인력" },
    client: { id: 2, name: "이용자" },
    totalSessions: 1,
    startDate: "2026-07-17",
    header: null,
    sessions: [],
    recordStatus: "IN_PROGRESS",
    pendingScheduleChange: null,
};

describe("ServiceRecordPage authentication restoration", () => {
    beforeEach(() => {
        mockUseParams.mockReturnValue({ token: "link-token" });
        fetchMock.mockReset();
        window.sessionStorage.clear();
        window.history.replaceState(null, "", "/service-record/link-token");
        global.fetch = fetchMock as typeof fetch;
    });

    it("restores a verified visit from the server cookie before showing identity verification", async () => {
        fetchMock
            .mockResolvedValueOnce(jsonResponse({ valid: true }))
            .mockResolvedValueOnce(jsonResponse(serviceRecordContext));

        render(<ServiceRecordPage />);

        await waitFor(() => {
            expect(document.querySelector('[data-component="service-record-service-title"]'))
                .toHaveTextContent("서비스 기본정보");
        });
        expect(screen.queryByText("제공인력 본인 확인")).not.toBeInTheDocument();
        expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/service-record/link-token/link");
        expect(fetchMock).toHaveBeenNthCalledWith(
            2,
            "/api/service-record/link-token/context",
            expect.objectContaining({ headers: expect.objectContaining({ "Content-Type": "application/json" }) }),
        );
    });

    it("shows identity verification when no valid server cookie is available", async () => {
        fetchMock
            .mockResolvedValueOnce(jsonResponse({ valid: true }))
            .mockResolvedValueOnce(jsonResponse({ message: "Unauthorized" }, 401));

        render(<ServiceRecordPage />);

        expect(await screen.findByText("제공인력 본인 확인")).toBeInTheDocument();
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    });

    it("returns a verified revisit to the service-record overview instead of an in-progress daily draft", async () => {
        const user = userEvent.setup();
        window.sessionStorage.setItem("daily-service-record-draft:link-token", JSON.stringify({
            header: { momName: "홍길동" },
            day: 1,
            pageIdx: 2,
            draft: { notes: "작성 중인 기록" },
        }));
        fetchMock
            .mockResolvedValueOnce(jsonResponse({ valid: true }))
            .mockResolvedValueOnce(jsonResponse({
                ...serviceRecordContext,
                totalSessions: 2,
                header: { momName: "홍길동" },
            }));

        render(<ServiceRecordPage />);

        expect(await screen.findByText("제공기록표")).toBeInTheDocument();
        expect(document.querySelector('[data-component="service-record-day-title"]')).not.toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "기록 시작" }));
        expect(document.querySelector('[data-component="service-record-day-title"]'))
            .toHaveTextContent("서비스 기록");
        expect(screen.getByDisplayValue("작성 중인 기록")).toBeInTheDocument();
    });

    it("allows entry for a different service date while showing a warning", async () => {
        const user = userEvent.setup();
        window.sessionStorage.setItem("daily-service-record-draft:link-token", JSON.stringify({
            header: { momName: "홍길동" },
            day: 1,
            pageIdx: 0,
            draft: {
                _date: "2026-07-20",
                perineum: ["이상없음"],
                breast: ["이상없음"],
                excretion: ["이상없음"],
                sitzBath: "실시",
                meals_meal: "1",
                meals_snack: "1",
            },
        }));
        fetchMock
            .mockResolvedValueOnce(jsonResponse({ valid: true }))
            .mockResolvedValueOnce(jsonResponse({
                ...serviceRecordContext,
                totalSessions: 2,
                header: { momName: "홍길동" },
            }));

        render(<ServiceRecordPage />);

        expect(await screen.findByText("제공기록표")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "기록 시작" }));

        expect(document.querySelector('[data-component="service-record-date-mismatch-notice"]'))
            .toHaveTextContent("서비스 제공일자(2026.07.20)가 오늘과 달라요. 한번 더 확인해 주세요.");
        expect(screen.getAllByRole("button", { name: /이상없음/ })[0]).toBeEnabled();
        expect(screen.getByRole("button", { name: "다음" })).toBeEnabled();
    });

    it("does not allow navigation back to submitted service information from the overview", async () => {
        fetchMock
            .mockResolvedValueOnce(jsonResponse({ valid: true }))
            .mockResolvedValueOnce(jsonResponse({
                ...serviceRecordContext,
                header: { momName: "홍길동" },
            }));

        render(<ServiceRecordPage />);

        expect(await screen.findByText("제공기록표")).toBeInTheDocument();
        expect(document.querySelector('[data-component="service-record-overview-back"]')).not.toBeInTheDocument();
    });

    it("maps daily pages to browser history so Back restores the previous wizard page", async () => {
        const user = userEvent.setup();
        window.sessionStorage.setItem("daily-service-record-draft:link-token", JSON.stringify({
            header: { momName: "홍길동" },
            day: 1,
            pageIdx: 0,
            draft: {
                _date: isoDateInKorea(),
                perineum: ["이상없음"],
                breast: ["이상없음"],
                excretion: ["이상없음"],
                sitzBath: "실시",
                meals_meal: "1",
                meals_snack: "1",
            },
        }));
        fetchMock
            .mockResolvedValueOnce(jsonResponse({ valid: true }))
            .mockResolvedValueOnce(jsonResponse({
                ...serviceRecordContext,
                totalSessions: 2,
                header: { momName: "홍길동" },
            }));

        render(<ServiceRecordPage />);

        expect(await screen.findByText("제공기록표")).toBeInTheDocument();
        expect(window.location.search).toBe("?step=overview");

        await user.click(screen.getByRole("button", { name: "기록 시작" }));
        expect(document.querySelector('[data-component="service-record-day-title"]'))
            .toHaveTextContent("산모 기록");
        expect(window.location.search).toBe("?step=day&day=1&page=0");

        await user.click(screen.getByRole("button", { name: "다음" }));
        expect(document.querySelector('[data-component="service-record-day-title"]'))
            .toHaveTextContent("신생아 기록");
        expect(window.location.search).toBe("?step=day&day=1&page=1");

        act(() => window.history.back());
        await waitFor(() => {
            expect(document.querySelector('[data-component="service-record-day-title"]'))
                .toHaveTextContent("산모 기록");
        });
        expect(window.location.search).toBe("?step=day&day=1&page=0");

        act(() => window.history.back());
        expect(await screen.findByText("제공기록표")).toBeInTheDocument();
        expect(window.location.search).toBe("?step=overview");
    });
});
