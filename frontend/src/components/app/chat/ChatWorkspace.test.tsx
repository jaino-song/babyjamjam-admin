import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Button } from "@/components/ui/button";
import { ChatWorkspace } from "./ChatWorkspace";

function Workspace() {
    return <ChatWorkspace data-component="desktop_chat_workspace" stats={<div>통계</div>} list={(close) => <Button onClick={close}>실제 대화 선택</Button>} header={(menu) => <div>{menu}<h1>선택한 대화</h1></div>}><div data-testid="viewport">본문</div><div data-testid="composer">입력</div></ChatWorkspace>;
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
