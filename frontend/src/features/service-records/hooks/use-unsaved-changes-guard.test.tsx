import { StrictMode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";

import { createLeaveGuardController } from "./leave-guard-controller";
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

        it("does not prompt when a silent hash push after arming is followed by a traversal onto the editor entry", async () => {
            render(<Harness active />);
            // pushState fires no popstate: the real current entry is no longer the guard entry.
            window.history.pushState({ __NA: true }, "", `${EDITOR}#x`);

            await traverse(() => window.history.go(-2)); // EDITOR#x -> guard -> editor entry

            expect(paths()).toBe(EDITOR);
            expect(window.location.hash).toBe("");
            expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

            // The guard still holds a Back from its entry onto the editor entry.
            await traverse(() => window.history.forward()); // editor -> guard
            await traverse(() => window.history.back()); // guard -> editor
            expect(screen.getByRole("dialog")).toBeInTheDocument();
        });

        it("does not prompt for a hash-only traversal after arming over a forward tail", async () => {
            // A forward entry exists when arming: the guard push truncates it, so the list does not grow.
            window.history.pushState(null, "", `${EDITOR}#future`);
            await traverse(() => window.history.back());
            expect(window.location.hash).toBe("");
            render(<Harness active />);
            window.history.pushState({ __NA: true }, "", `${EDITOR}#x`); // silent: no popstate

            await traverse(() => window.history.go(-2)); // EDITOR#x -> guard -> editor entry

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

        describe("a router that renders from its own popstate listener (window listeners run in registration order)", () => {
            let routed: string[];
            let router: () => void;
            let addListener: jest.SpyInstance;

            beforeEach(() => {
                // Chromium runs a window popstate listener in registration order whatever its
                // `capture` flag; jsdom would run a capture listener first and hide the problem.
                // Mimic Chromium, so only a guard handler registered ahead of the router wins.
                const original = window.addEventListener.bind(window) as (...args: unknown[]) => void;
                addListener = jest
                    .spyOn(window, "addEventListener")
                    .mockImplementation(((type: string, listener: unknown, options: unknown) =>
                        original(type, listener, type === "popstate" ? false : options)) as never);
                routed = [];
                // Next's app router: registered at app boot, renders the landed route inside the event.
                router = () => { if (paths() !== EDITOR) routed.push(paths()); };
                window.addEventListener("popstate", router);
            });

            afterEach(() => {
                window.removeEventListener("popstate", router);
                addListener.mockRestore();
            });

            it("keeps the editor mounted on a multi-entry Back, and 머무르기 keeps it", async () => {
                render(<Harness active />);

                await traverse(() => window.history.go(-2)); // guard -> editor -> previous
                expect(screen.getByRole("dialog")).toBeInTheDocument();
                expect(routed).toEqual([]);
                expect(paths()).toBe(EDITOR);
                expect(window.history.state).toMatchObject(NEXT_STATE);

                fireEvent.click(screen.getByRole("button", { name: "머무르기" }));
                expect(paths()).toBe(EDITOR);
                await traverse(() => window.history.back());
                expect(screen.getByRole("dialog")).toBeInTheDocument();
                expect(routed).toEqual([]);
            });

            it("lets 나가기 continue to the entry the user was heading to", async () => {
                const onLeave = jest.fn();
                render(<Harness active onLeave={onLeave} />);

                await traverse(() => window.history.go(-2));
                expect(routed).toEqual([]);
                await traverse(() => fireEvent.click(screen.getByRole("button", { name: "나가기" })));

                expect(onLeave).toHaveBeenCalledTimes(1);
                expect(paths()).toBe("/previous");
                expect(routed).toEqual(["/previous"]);
            });
        });

        it("never navigates when deactivated without the Navigation API (the guard entry stays, unprompted)", async () => {
            const { rerender } = render(<Harness active />);
            const lengthWhileArmed = window.history.length;

            rerender(<Harness active={false} />);
            await settle();

            expect(paths()).toBe(EDITOR);
            expect(window.history.state).toMatchObject(NEXT_STATE);
            expect(window.history.length).toBe(lengthWhileArmed);
            // Documented limitation: one redundant same-URL entry, no prompt, then the previous page.
            await traverse(() => window.history.back());
            expect(paths()).toBe(EDITOR);
            expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
            await traverse(() => window.history.back());
            expect(paths()).toBe("/previous");
        });

        describe("release safety: never navigates, never rewrites history", () => {
            const originalPush = window.history.pushState;
            const originalReplace = window.history.replaceState;
            const snapshot = () => ({
                url: `${window.location.pathname}${window.location.search}${window.location.hash}`,
                state: window.history.state,
                length: window.history.length,
            });

            /** Arm, run `tamper`, release, and report what release did on its own. */
            async function releaseAfter(tamper: () => void | Promise<void>) {
                const { rerender } = render(<Harness active />);
                await act(async () => { await tamper(); });
                await settle();
                const before = snapshot();
                const popstate = jest.fn();
                window.addEventListener("popstate", popstate);
                rerender(<Harness active={false} />);
                await act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); });
                window.removeEventListener("popstate", popstate);
                return { before, after: snapshot(), popstate };
            }

            function expectUntouched({ before, after, popstate }: Awaited<ReturnType<typeof releaseAfter>>) {
                expect(after.url).toBe(before.url);
                expect(after.state).toEqual(before.state);
                expect(after.length).toBe(before.length);
                expect(popstate).not.toHaveBeenCalled();
                expect(window.history.pushState).toBe(originalPush);
                expect(window.history.replaceState).toBe(originalReplace);
            }

            it("never wraps pushState/replaceState, armed or released", async () => {
                const { rerender } = render(<Harness active />);
                expect(window.history.pushState).toBe(originalPush);
                expect(window.history.replaceState).toBe(originalReplace);
                rerender(<Harness active={false} />);
                await settle();
                expect(window.history.pushState).toBe(originalPush);
                expect(window.history.replaceState).toBe(originalReplace);
            });

            it("does not navigate on its own untouched guard entry without the Navigation API", async () => {
                const result = await releaseAfter(() => undefined);
                expect(result.after.url).toBe(EDITOR);
                expect(result.after.state).toMatchObject(NEXT_STATE);
                expectUntouched(result);
                // The redundant guard entry costs one extra Back.
                await traverse(() => window.history.back());
                expect(paths()).toBe(EDITOR);
                await traverse(() => window.history.back());
                expect(paths()).toBe("/previous");
            });

            it.each([
                ["router state without our tag", () => ({ __NA: true, marker: "replaced" })],
                ["history.state as is", () => window.history.state],
            ])("does nothing when the current entry was replaced to editor#new (%s)", async (_label, makeState) => {
                const result = await releaseAfter(() => {
                    window.history.replaceState(makeState(), "", `${EDITOR}#new`);
                });
                expect(result.after.url).toBe(`${EDITOR}#new`);
                expectUntouched(result);
            });

            it.each([
                ["router state without our tag", () => ({ __NA: true, marker: "replaced" })],
                ["history.state as is", () => window.history.state],
            ])("does nothing when the current entry was replaced to /different (%s)", async (_label, makeState) => {
                const result = await releaseAfter(() => {
                    window.history.replaceState(makeState(), "", "/different");
                });
                expect(result.after.url).toBe("/different");
                expectUntouched(result);
            });

            it("does nothing when the guard entry lost its tag but kept the URL", async () => {
                const result = await releaseAfter(() => {
                    window.history.replaceState({ __NA: true, marker: "refresh" }, "", EDITOR);
                });
                expect(result.after.url).toBe(EDITOR);
                expectUntouched(result);
            });

            it("does nothing when an entry pushed above the guard was replaced to /different", async () => {
                const result = await releaseAfter(() => {
                    window.history.pushState({ n: 1 }, "", `${EDITOR}#a`);
                    window.history.replaceState({ n: 2 }, "", "/different");
                });
                expect(result.after.url).toBe("/different");
                expect(result.after.state).toEqual({ n: 2 });
                expectUntouched(result);
            });

            it("does nothing when a router pushed a hash entry above the guard (redundant entry stays)", async () => {
                const hashState = { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: { marker: "hash-tree" } };
                const result = await releaseAfter(() => {
                    window.history.pushState(hashState, "", `${EDITOR}#x`);
                });
                expect(result.after.url).toBe(`${EDITOR}#x`);
                expect(result.after.state).toEqual(hashState);
                expectUntouched(result);

                // Documented limitation: hash entry -> redundant guard entry -> editor entry -> previous page.
                await traverse(() => window.history.back());
                expect(paths()).toBe(EDITOR);
                expect(window.location.hash).toBe("");
                await traverse(() => window.history.back());
                expect(paths()).toBe(EDITOR);
                await traverse(() => window.history.back());
                expect(paths()).toBe("/previous");
            });

            it("does nothing when a router copied history.state onto new entries ending on the editor URL", async () => {
                // The copy carries our tag and the editor URL, but it is not the guard entry.
                const result = await releaseAfter(() => {
                    window.history.pushState(window.history.state, "", "/different");
                    window.history.pushState(window.history.state, "", EDITOR);
                });
                expect(result.after.url).toBe(EDITOR);
                expectUntouched(result);
                expect(paths()).toBe(EDITOR);
            });

            it.each([
                ["truncate and re-push a copy of the tag", true],
                ["replace the predecessor in place, then go Forward", false],
            ])("never navigates after the entries were rearranged (%s)", async (_label, recopy) => {
                const { rerender } = render(<Harness active />);
                const copy = window.history.state;
                await traverse(() => {
                    window.history.pushState(null, "", `${EDITOR}#x`);
                    window.history.go(-2); // -> the editor entry
                });
                window.history.replaceState(window.history.state, "", "/different");
                if (recopy) window.history.pushState(copy, "", EDITOR); // truncates G, same length again
                else await traverse(() => window.history.forward()); // onto the guard entry
                expect(paths()).toBe(EDITOR);
                const before = snapshot();
                const popstate = jest.fn();
                window.addEventListener("popstate", popstate);
                rerender(<Harness active={false} />);
                await act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); });
                window.removeEventListener("popstate", popstate);
                expectUntouched({ before, after: snapshot(), popstate });
                expect(paths()).toBe(EDITOR);
            });

            it("does nothing after a plain <a href=\"#x\"> fragment navigation", async () => {
                const result = await releaseAfter(() => {
                    fireEvent.click(screen.getByText("hash")); // href="#section": no pushState call
                });
                expect(result.after.url).toBe(`${EDITOR}#section`);
                expectUntouched(result);
            });

            it.each([
                ["reverse", true],
                ["same", false],
            ])("two controllers released in %s order never navigate to another page", async (_label, reverse) => {
                const first = createLeaveGuardController({ onPromptChange: () => undefined });
                const second = createLeaveGuardController({ onPromptChange: () => undefined });
                first.arm();
                second.arm();
                await settle();
                const lengthBefore = window.history.length;
                const popstate = jest.fn();
                window.addEventListener("popstate", popstate);

                for (const controller of reverse ? [second, first] : [first, second]) controller.release();
                await act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); });
                window.removeEventListener("popstate", popstate);

                expect(paths()).toBe(EDITOR);
                expect(window.location.hash).toBe("");
                expect(window.history.length).toBe(lengthBefore);
                // Only the top controller's own untouched guard entry may be taken out.
                expect(popstate.mock.calls.length).toBeLessThanOrEqual(1);
                expect(window.history.pushState).toBe(originalPush);
                expect(window.history.replaceState).toBe(originalReplace);
            });
        });

        it("does not queue a prompt after being deactivated", async () => {
            const { rerender } = render(<Harness active />);
            rerender(<Harness active={false} />);
            await settle();

            await traverse(() => window.history.back());
            expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
            expect(paths()).toBe(EDITOR); // the redundant guard entry, no prompt
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

            // Deactivating never navigates; the single guard entry stays (no second one was pushed).
            rerender(<StrictMode><Harness active={false} /></StrictMode>);
            await settle();
            expect(paths()).toBe(EDITOR);
            await traverse(() => window.history.back());
            expect(paths()).toBe(EDITOR);
            await traverse(() => window.history.back());
            expect(paths()).toBe("/previous");
        });
    });
});
