import { StrictMode } from "react";
import { renderToString } from "react-dom/server.node";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { OverviewStep, type OverviewStepProps } from "../OverviewStep";

const ROOT = "mobile_service-record_wizard";
const STORAGE_KEY = "bjj:service-record:guide-hint-shown";
const HINT_TEXT = "사용방법을 다시 확인해 보세요";

const makeProps = (overrides: Partial<OverviewStepProps> = {}): OverviewStepProps => ({
    "data-component": ROOT,
    context: { totalSessions: 3, startDate: "2026-09-21", header: null, sessions: [] },
    day: 1,
    draft: {},
    defaultDate: () => "2026-09-21",
    lockedDays: new Set<number>(),
    nextOpenDay: () => 1,
    isRecordFinalized: false,
    scheduleChangeBusy: false,
    onOpenDay: jest.fn(),
    onOpenScheduleChangePreview: jest.fn(),
    onOpenGuide: jest.fn(),
    ...overrides,
});

describe("OverviewStep guide hint", () => {
    beforeEach(() => {
        sessionStorage.clear();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("renders hidden on the server without reading sessionStorage", () => {
        const getItemSpy = jest.spyOn(Storage.prototype, "getItem");

        const markup = renderToString(<OverviewStep {...makeProps()} />);

        expect(markup).not.toContain(HINT_TEXT);
        expect(getItemSpy).not.toHaveBeenCalled();
    });

    it("shows the hint on the first overview and marks it shown immediately", () => {
        render(<OverviewStep {...makeProps()} />);

        expect(screen.getByText(HINT_TEXT)).toBeVisible();
        expect(screen.getByRole("status")).toHaveAttribute("data-component", `${ROOT}_body_overview-guide-hint`);
        expect(screen.getByRole("status")).toHaveAttribute("data-source-component", "GuideHintBubble");
        expect(screen.getByRole("button", { name: "안내 닫기" })).toHaveAttribute("data-component", `${ROOT}_body_overview-guide-hint_close`);
        expect(sessionStorage.getItem(STORAGE_KEY)).toBe("1");
    });

    it("stays hidden when the session key is already present", () => {
        sessionStorage.setItem(STORAGE_KEY, "1");
        render(<OverviewStep {...makeProps()} />);

        expect(screen.queryByText(HINT_TEXT)).not.toBeInTheDocument();
    });

    it("leaves storage untouched and stays hidden without onOpenGuide", () => {
        render(<OverviewStep {...makeProps({ onOpenGuide: undefined })} />);

        expect(screen.queryByText(HINT_TEXT)).not.toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "사용방법" })).not.toBeInTheDocument();
        expect(sessionStorage.length).toBe(0);
    });

    it("hides the hint when its close button is clicked", async () => {
        const user = userEvent.setup();
        const props = makeProps();
        const { rerender } = render(<OverviewStep {...props} />);

        await user.click(screen.getByRole("button", { name: "안내 닫기" }));
        rerender(<OverviewStep {...props} onOpenGuide={jest.fn()} />);

        expect(screen.queryByText(HINT_TEXT)).not.toBeInTheDocument();
        expect(props.onOpenGuide).not.toHaveBeenCalled();
    });

    it("hides the hint before opening the guide exactly once", async () => {
        const user = userEvent.setup();
        const props = makeProps();
        render(<OverviewStep {...props} />);

        await user.click(screen.getByRole("button", { name: "사용방법" }));

        expect(screen.queryByText(HINT_TEXT)).not.toBeInTheDocument();
        expect(props.onOpenGuide).toHaveBeenCalledTimes(1);
    });

    it("does not show again after unmounting in the same session", () => {
        const props = makeProps();
        const { unmount } = render(<OverviewStep {...props} />);
        expect(screen.getByText(HINT_TEXT)).toBeVisible();
        unmount();

        render(<OverviewStep {...props} />);
        expect(screen.queryByText(HINT_TEXT)).not.toBeInTheDocument();
    });

    it("shows the hint without throwing when storage reads are blocked", () => {
        jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
            throw new DOMException("Storage blocked", "SecurityError");
        });

        render(<OverviewStep {...makeProps()} />);
        expect(screen.getByText(HINT_TEXT)).toBeVisible();
    });

    it("keeps the hint visible when StrictMode runs the mount effect twice", () => {
        render(<StrictMode><OverviewStep {...makeProps()} /></StrictMode>);

        expect(screen.getByText(HINT_TEXT)).toBeVisible();
        expect(sessionStorage.getItem(STORAGE_KEY)).toBe("1");
    });

    it("still shows and dismisses the hint when storage writes are blocked", async () => {
        const user = userEvent.setup();
        jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
            throw new DOMException("Storage blocked", "SecurityError");
        });
        const props = makeProps();
        const { rerender } = render(<OverviewStep {...props} />);

        expect(screen.getByText(HINT_TEXT)).toBeVisible();
        await user.click(screen.getByRole("button", { name: "안내 닫기" }));
        rerender(<OverviewStep {...props} onOpenGuide={jest.fn()} />);
        expect(screen.queryByText(HINT_TEXT)).not.toBeInTheDocument();
        expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    });
});
