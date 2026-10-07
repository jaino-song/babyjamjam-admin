import { StrictMode } from "react";
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

    describe("history traversal", () => {
        const EDITOR = "/clients/42/records?tab=edit";
        const NEXT_STATE = { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: { marker: "editor-tree" } };
        const paths = () => `${window.location.pathname}${window.location.search}`;

        // jsdom runs history traversal on a later task. A held traversal's popstate is
        // swallowed by the guard (stopImmediatePropagation), so wait on time, not on the event.
        async function traverse(move: () => void) {
            await act(async () => {
                move();
                await new Promise((resolve) => setTimeout(resolve, 30));
            });
        }

        async function settle() {
            await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
        }

        beforeEach(() => {
            // Entries: /earlier, /previous, EDITOR (carrying Next-style router state).
            window.history.replaceState(null, "", "/earlier");
            window.history.pushState(null, "", "/previous");
            window.history.pushState(NEXT_STATE, "", EDITOR);
        });

        it("ignores hash-only traversals inside the editor document", async () => {
            // Arm on EDITOR#b with an earlier EDITOR#a entry behind the editor entry.
            window.history.replaceState(NEXT_STATE, "", `${EDITOR}#a`);
            window.history.pushState(NEXT_STATE, "", `${EDITOR}#b`);
            render(<Harness active />);
            const lengthBefore = window.history.length;

            await traverse(() => window.history.go(-2)); // guard -> editor -> EDITOR#a

            expect(window.location.hash).toBe("#a");
            expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
            expect(window.history.length).toBe(lengthBefore);
        });

        it("does not prompt when a hash entry made after arming is traversed", async () => {
            render(<Harness active />);
            await act(async () => { window.location.hash = "#section"; });
            await traverse(() => window.history.back()); // back onto the guard entry

            expect(paths()).toBe(EDITOR);
            expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        });

        it("lets a hash-only Forward onto the editor entry pass without a prompt", async () => {
            // Entries: .., EDITOR#a, EDITOR#b (armed on #b, guard on top).
            window.history.replaceState(NEXT_STATE, "", `${EDITOR}#a`);
            window.history.pushState(NEXT_STATE, "", `${EDITOR}#b`);
            render(<Harness active />);

            await traverse(() => window.history.go(-2)); // guard -> editor -> #a
            expect(window.location.hash).toBe("#a");
            await traverse(() => window.history.forward()); // #a -> the editor entry (#b)

            expect(window.location.hash).toBe("#b");
            expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

            // Still guarded: Back from the guard entry onto the editor entry is held.
            await traverse(() => window.history.forward()); // onto the guard entry
            await traverse(() => window.history.back());
            expect(screen.getByRole("dialog")).toBeInTheDocument();
            expect(paths()).toBe(`${EDITOR}`);
        });

        it("holds a single Back, and 머무르기 keeps the editor URL and re-arms", async () => {
            render(<Harness active />);

            await traverse(() => window.history.back());
            expect(screen.getByRole("dialog")).toBeInTheDocument();
            expect(paths()).toBe(EDITOR);

            fireEvent.click(screen.getByRole("button", { name: "머무르기" }));
            expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
            expect(paths()).toBe(EDITOR);

            // Guard re-armed: another Back is held again instead of leaving.
            await traverse(() => window.history.back());
            expect(screen.getByRole("dialog")).toBeInTheDocument();
            expect(paths()).toBe(EDITOR);
        });

        it("lets 나가기 land exactly on the previous entry after a single Back", async () => {
            const onLeave = jest.fn();
            render(<Harness active onLeave={onLeave} />);

            await traverse(() => window.history.back());
            await traverse(() => fireEvent.click(screen.getByRole("button", { name: "나가기" })));

            expect(onLeave).toHaveBeenCalledTimes(1);
            expect(paths()).toBe("/previous");
        });

        it("restores the editor URL after a multi-entry Back, and 머무르기 keeps it", async () => {
            render(<Harness active />);

            await traverse(() => window.history.go(-3)); // guard -> editor -> previous -> earlier
            expect(screen.getByRole("dialog")).toBeInTheDocument();
            expect(paths()).toBe(EDITOR);
            // Next's router state survived on the restored entry.
            expect(window.history.state).toMatchObject(NEXT_STATE);

            fireEvent.click(screen.getByRole("button", { name: "머무르기" }));
            expect(paths()).toBe(EDITOR);
            expect(window.history.state).toMatchObject(NEXT_STATE);

            // Still guarded: Back holds again.
            await traverse(() => window.history.back());
            expect(screen.getByRole("dialog")).toBeInTheDocument();
            expect(paths()).toBe(EDITOR);
        });

        it("lets 나가기 reach the entry the user was heading to after a multi-entry Back", async () => {
            render(<Harness active />);

            await traverse(() => window.history.go(-3));
            await traverse(() => fireEvent.click(screen.getByRole("button", { name: "나가기" })));

            expect(paths()).toBe("/earlier");
        });

        it("does not let the Next router see a held multi-entry traversal", async () => {
            const nextHandler = jest.fn();
            window.addEventListener("popstate", nextHandler); // registered before the guard, like Next's
            render(<Harness active />);

            await traverse(() => window.history.go(-3));
            expect(nextHandler).not.toHaveBeenCalled();
            window.removeEventListener("popstate", nextHandler);
        });

        it("takes the guard entry back out, without navigating, when deactivated", async () => {
            const { rerender } = render(<Harness active />);
            const lengthWhileArmed = window.history.length;

            rerender(<Harness active={false} />);
            await settle();

            expect(paths()).toBe(EDITOR);
            expect(window.history.state).toMatchObject(NEXT_STATE);
            // No leftover entry: one Back reaches the previous page.
            await traverse(() => window.history.back());
            expect(paths()).toBe("/previous");
            expect(window.history.length).toBe(lengthWhileArmed);
        });

        it("drops the guard entry from under a hash entry pushed while armed", async () => {
            const hashState = { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: { marker: "hash-tree" } };
            const { rerender } = render(<Harness active />);
            act(() => { window.history.pushState(hashState, "", `${EDITOR}#x`); });

            rerender(<Harness active={false} />);
            await settle();
            await act(async () => { await new Promise((resolve) => setTimeout(resolve, 80)); });

            // Same URL and state as before, still on the hash entry.
            expect(paths()).toBe(EDITOR);
            expect(window.location.hash).toBe("#x");
            expect(window.history.state).toMatchObject(hashState);
            expect(window.history.state).not.toHaveProperty("__serviceRecordLeaveGuard");

            // No extra entry: hash entry -> editor entry -> previous page.
            await traverse(() => window.history.back());
            expect(paths()).toBe(EDITOR);
            expect(window.location.hash).toBe("");
            await traverse(() => window.history.back());
            expect(paths()).toBe("/previous");
        });

        it("rebuilds several hash entries and keeps the one the user is on", async () => {
            const { rerender } = render(<Harness active />);
            act(() => { window.history.pushState({ n: 1 }, "", `${EDITOR}#x`); });
            act(() => { window.history.pushState({ n: 2 }, "", `${EDITOR}#y`); });
            await traverse(() => window.history.back()); // rest on #x

            rerender(<Harness active={false} />);
            await act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); });

            expect(window.location.hash).toBe("#x");
            expect(window.history.state).toMatchObject({ n: 1 });
            await traverse(() => window.history.forward());
            expect(window.location.hash).toBe("#y");
            expect(window.history.state).toMatchObject({ n: 2 });
            await traverse(() => window.history.go(-2));
            expect(window.location.hash).toBe("");
            await traverse(() => window.history.back());
            expect(paths()).toBe("/previous");
        });

        it("never navigates away when a fragment navigation hid the guard's position", async () => {
            const { rerender } = render(<Harness active />);
            await act(async () => { window.location.hash = "#plain"; }); // no pushState call: not tracked

            rerender(<Harness active={false} />);
            await settle();

            // Documented limitation: the guard entry stays, but the user is not moved.
            expect(paths()).toBe(EDITOR);
            expect(window.location.hash).toBe("#plain");
        });

        it("does not queue a prompt after being deactivated", async () => {
            const { rerender } = render(<Harness active />);
            rerender(<Harness active={false} />);
            await settle();

            await traverse(() => window.history.back());
            expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
            expect(paths()).toBe("/previous");
        });

        it("is safe under StrictMode's double mount (exactly one guard entry)", async () => {
            const { rerender } = render(<StrictMode><Harness active /></StrictMode>);
            await settle();
            expect(paths()).toBe(EDITOR);

            // One Back is held by the single guard entry.
            await traverse(() => window.history.back());
            expect(screen.getByRole("dialog")).toBeInTheDocument();
            expect(paths()).toBe(EDITOR);
            fireEvent.click(screen.getByRole("button", { name: "머무르기" }));

            // Deactivating leaves no extra entry behind.
            rerender(<StrictMode><Harness active={false} /></StrictMode>);
            await settle();
            await traverse(() => window.history.back());
            expect(paths()).toBe("/previous");
        });
    });
});
