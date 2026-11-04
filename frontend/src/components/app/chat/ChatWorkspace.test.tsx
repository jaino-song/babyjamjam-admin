import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ChatInput } from "./ChatInput";
import { ChatWorkspace } from "./ChatWorkspace";

function Workspace({ children }: { children?: ReactNode }) {
    return <ChatWorkspace data-component="desktop_chat_workspace" stats={<div>통계</div>} list={(close) => <Button onClick={close}>실제 대화 선택</Button>} header={(menu) => <div>{menu}<h1>선택한 대화</h1></div>}><div data-testid="viewport">본문{children}</div><div data-testid="composer">입력</div></ChatWorkspace>;
}
function viewport(width: number) {
    let currentWidth = width;
    const listeners = new Set<() => void>();
    Object.defineProperty(window, "matchMedia", { configurable: true, value: jest.fn((query: string) => ({
        get matches() { return query === "(max-width: 1279px)" && currentWidth < 1280; },
        addEventListener: (_: string, fn: () => void) => listeners.add(fn),
        removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    })) });
    return (next: number) => act(() => { currentWidth = next; listeners.forEach((fn) => fn()); });
}
describe("ChatWorkspace compact authority", () => {
    it.each([375, 1024, 1279])("uses only the modal list at %ipx, then closes on resize without remounting the thread", async (width) => {
        const resize = viewport(width);
        render(<Workspace />);
        const thread = screen.getByTestId("viewport");
        const composer = screen.getByTestId("composer");
        const menu = screen.getByRole("button", { name: "사이드바 열기" });
        expect(screen.queryByRole("button", { name: "실제 대화 선택" })).not.toBeInTheDocument();
        fireEvent.click(menu);
        const dialog = await screen.findByRole("dialog", { name: "대화 목록" });
        expect(dialog).toContainElement(document.activeElement as HTMLElement);
        expect(document.querySelectorAll('[id="desktop_chat_workspace-sidebar"]')).toHaveLength(1);
        resize(1280);
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
        expect(screen.getAllByRole("button", { name: "실제 대화 선택" })).toHaveLength(1);
        expect(screen.getByTestId("viewport")).toBe(thread);
        expect(screen.getByTestId("composer")).toBe(composer);
        resize(width);
        expect(menu).toHaveAttribute("aria-expanded", "false");
    });
    it("keeps two panels at 1280 and independently preserves desktop collapse", () => {
        const resize = viewport(1280);
        render(<Workspace />);
        const menu = screen.getByRole("button", { name: "사이드바 열기" });
        expect(screen.getByRole("button", { name: "실제 대화 선택" })).toBeInTheDocument();
        fireEvent.click(menu);
        expect(screen.queryByRole("button", { name: "실제 대화 선택" })).not.toBeInTheDocument();
        resize(1024);
        fireEvent.click(menu);
        fireEvent.click(screen.getByRole("button", { name: "실제 대화 선택" }));
        resize(1280);
        expect(menu).toHaveAttribute("aria-expanded", "false");
        fireEvent.click(menu);
        expect(screen.getByRole("button", { name: "실제 대화 선택" })).toBeInTheDocument();
    });
});


describe("ChatWorkspace scoped control sizing", () => {
    let style: HTMLStyleElement;
    beforeEach(() => {
        const css = readFileSync(resolve(__dirname, "../../../app/globals.css"), "utf8");
        const marker = "/* Chat workspace controls retain readable type and 44px targets under Glint scaling. */";
        expect(css).toContain(marker);
        style = document.createElement("style");
        // Reproduce Main's observed Glint 0.8 sizes before applying the actual scoped rules.
        style.textContent = 'input, textarea { font-size: 11.2px; min-height: 32px; } [data-slot="button"] { min-height: 32px; min-width: 32px; }' + css.slice(css.indexOf(marker));
        document.head.appendChild(style);
    });
    afterEach(() => { style.remove(); });

    it.each([375, 1280])("keeps workspace inputs at 16px and controls at least 44px at %ipx without changing widget defaults", (width) => {
        viewport(width);
        const { container } = render(<>
            <Workspace>
                <Input aria-label="목록 검색" />
                <Textarea aria-label="Agent 질문 입력" />
                <Button aria-label="Agent 전송">전송</Button>
                <ChatInput variant="workspace" onSubmit={jest.fn()} />
            </Workspace>
            <div data-testid="widget"><ChatInput onSubmit={jest.fn()} /></div>
        </>);
        const workspace = container.querySelector('[data-slot="chat-workspace"]') as HTMLElement;
        for (const input of within(workspace).getAllByRole("textbox")) {
            expect(getComputedStyle(input).fontSize).toBe("16px");
            expect(getComputedStyle(input).lineHeight).toBe("26px");
            expect(getComputedStyle(input).minHeight).toBe("44px");
        }
        for (const button of within(workspace).getAllByRole("button")) {
            expect(getComputedStyle(button).minHeight).toBe("44px");
            expect(getComputedStyle(button).minWidth).toBe("44px");
        }
        const widget = screen.getByTestId("widget");
        expect(getComputedStyle(within(widget).getByRole("textbox")).fontSize).toBe("11.2px");
        expect(getComputedStyle(within(widget).getByRole("button")).minHeight).toBe("32px");
    });

    it("applies the same target minimums inside the portal drawer", async () => {
        viewport(375);
        render(<Workspace />);
        fireEvent.click(screen.getByRole("button", { name: "사이드바 열기" }));
        const drawer = await screen.findByRole("dialog", { name: "대화 목록" });
        for (const button of within(drawer).getAllByRole("button")) {
            expect(getComputedStyle(button).minHeight).toBe("44px");
            expect(getComputedStyle(button).minWidth).toBe("44px");
        }
    });
});
