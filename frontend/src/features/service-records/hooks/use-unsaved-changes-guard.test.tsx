import { act, fireEvent, render, screen } from "@testing-library/react";

import { useUnsavedChangesGuard } from "./use-unsaved-changes-guard";

function Harness({ active, onLeave = () => undefined }: { active: boolean; onLeave?: () => void }) {
    const guard = useUnsavedChangesGuard({ active, onLeave });
    return (
        <div>
            <a href="/clients">go</a>
            <a href="/clients" target="_blank">blank</a>
            <a href="/files/a.pdf" download>download</a>
            <a href="#section">hash</a>
            <a href="https://example.com/x">external</a>
            {guard.leavePromptOpen ? (
                <div role="dialog">
                    <button type="button" onClick={guard.stay}>머무르기</button>
                    <button type="button" onClick={guard.leave}>나가기</button>
                </div>
            ) : null}
        </div>
    );
}

function dispatchBeforeUnload(): BeforeUnloadEvent {
    const event = new Event("beforeunload", { cancelable: true }) as BeforeUnloadEvent;
    // jsdom's plain Event only has the legacy boolean `returnValue`; browsers use a string.
    Object.defineProperty(event, "returnValue", { writable: true, value: undefined });
    window.dispatchEvent(event);
    return event;
}

describe("useUnsavedChangesGuard", () => {
    it("prevents beforeunload only while active", () => {
        const { rerender } = render(<Harness active={false} />);
        expect(dispatchBeforeUnload().defaultPrevented).toBe(false);

        rerender(<Harness active />);
        const event = dispatchBeforeUnload();
        expect(event.defaultPrevented).toBe(true);
        expect(event.returnValue).toBe("");

        rerender(<Harness active={false} />);
        expect(dispatchBeforeUnload().defaultPrevented).toBe(false);
    });

    it("intercepts a same-origin link click and offers to stay", () => {
        render(<Harness active />);
        const downstream = jest.fn();
        document.addEventListener("click", downstream);

        fireEvent.click(screen.getByText("go"));
        expect(screen.getByRole("dialog")).toBeInTheDocument();
        expect(downstream).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole("button", { name: "머무르기" }));
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        document.removeEventListener("click", downstream);
    });

    it("lets 나가기 drop the changes and re-issue the click", () => {
        const onLeave = jest.fn();
        render(<Harness active onLeave={onLeave} />);
        fireEvent.click(screen.getByText("go"));

        const reissued = jest.fn();
        const record = (event: Event) => {
            if (event.target === screen.getByText("go")) reissued();
            event.preventDefault();
        };
        document.addEventListener("click", record);
        fireEvent.click(screen.getByRole("button", { name: "나가기" }));
        document.removeEventListener("click", record);

        expect(onLeave).toHaveBeenCalledTimes(1);
        expect(reissued).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        expect(dispatchBeforeUnload().defaultPrevented).toBe(false);
    });

    it.each([
        ["new tab", () => fireEvent.click(screen.getByText("blank"))],
        ["download", () => fireEvent.click(screen.getByText("download"))],
        ["hash-only", () => fireEvent.click(screen.getByText("hash"))],
        ["other origin", () => fireEvent.click(screen.getByText("external"))],
        ["modified click", () => fireEvent.click(screen.getByText("go"), { metaKey: true })],
    ])("does not intercept a %s link", (_label, click) => {
        render(<Harness active />);
        click();
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("does not intercept links while inactive", () => {
        render(<Harness active={false} />);
        fireEvent.click(screen.getByText("go"));
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("holds browser back with a guard entry and asks before leaving", () => {
        const pushState = jest.spyOn(window.history, "pushState");
        const go = jest.spyOn(window.history, "go").mockImplementation(() => undefined);
        const onLeave = jest.fn();
        render(<Harness active onLeave={onLeave} />);
        expect(pushState).toHaveBeenCalledTimes(1);

        act(() => { window.dispatchEvent(new PopStateEvent("popstate")); });
        expect(pushState).toHaveBeenCalledTimes(2);
        expect(screen.getByRole("dialog")).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "나가기" }));
        expect(onLeave).toHaveBeenCalledTimes(1);
        expect(go).toHaveBeenCalledWith(-2);

        pushState.mockRestore();
        go.mockRestore();
    });

    it("takes the guard entry back out when deactivated without leaving", () => {
        const back = jest.spyOn(window.history, "back").mockImplementation(() => undefined);
        const { rerender } = render(<Harness active />);

        rerender(<Harness active={false} />);

        expect(back).toHaveBeenCalledTimes(1);
        back.mockRestore();
    });
});
