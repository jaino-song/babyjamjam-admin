import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState, type ReactNode, type ComponentProps } from "react";
import { SlidingDetailPanel } from "../SlidingDetailPanel";

function Harness({ motion, headerActions, headerSummary, detail, listHeader }: {
    motion?: "parallax" | "page"; headerActions?: ReactNode; headerSummary?: ReactNode; detail?: ReactNode; listHeader?: ReactNode;
} = {}) {
    const [open, setOpen] = useState(false);
    // Model untyped callers too; explicit typed-call contracts are checked below.
    const props = { "data-component": "test_slide", open, onBack: () => setOpen(false),
        backLabel: "일정으로 돌아가기", motion, headerActions, headerSummary,
        list: <>{listHeader}<button onClick={() => setOpen(true)}>고객 일정</button></>,
        detail: detail ?? <div>고객 상세 정보</div> };
    return <SlidingDetailPanel {...props as ComponentProps<typeof SlidingDetailPanel>} />;
}

test.each([undefined, "page"] as const)("isolates panes and restores row focus after back/Escape in %s mode", (motion) => {
    const { container } = render(<Harness motion={motion} />);
    const row = screen.getByRole("button", { name: "고객 일정" });
    row.focus();
    fireEvent.click(row);
    const back = screen.getByRole("button", { name: "일정으로 돌아가기" });
    expect(back).toHaveFocus();
    expect(container.querySelector('[data-slot="sliding-detail-list"]')).toHaveAttribute("inert");
    fireEvent.keyDown(back, { key: "Escape" });
    expect(row).toHaveFocus();
    expect(container.querySelector('[data-slot="sliding-detail-content"]')).toHaveAttribute("inert");
    expect(screen.getByText("고객 상세 정보")).toBeInTheDocument();
    fireEvent.click(row);
    fireEvent.click(screen.getByRole("button", { name: "일정으로 돌아가기" }));
    expect(row).toHaveFocus();
    expect(container.querySelector('[data-slot="sliding-detail-panel"]')).toHaveAttribute("data-open", "false");
});


test("keeps the legacy default topology, dim and attributes with omitted or explicit parallax motion", () => {
    const { container, rerender } = render(<Harness />);
    const root = container.querySelector('[data-slot="sliding-detail-panel"]')!;
    const legacyHtml = root.outerHTML;
    expect(root).not.toHaveAttribute("data-motion");
    expect(root.querySelector('[data-slot="sliding-detail-header"]')).not.toHaveAttribute("data-layout");
    expect(root).toHaveAttribute("data-source-component", "SlidingDetailPanel");
    expect([...root.querySelectorAll("[data-slot]")].map((node) => [node.getAttribute("data-slot"), node.parentElement?.getAttribute("data-slot")])).toEqual([
        ["sliding-detail-list", "sliding-detail-panel"], ["sliding-detail-dim", "sliding-detail-list"],
        ["sliding-detail-content", "sliding-detail-panel"], ["sliding-detail-header", "sliding-detail-content"],
        ["button", "sliding-detail-header"], ["sliding-detail-body", "sliding-detail-content"],
    ]);
    rerender(<Harness motion="parallax" />);
    expect(root.outerHTML).toBe(legacyHtml);
});

test("page mode keeps header actions and summary inside the translating detail pane without dim DOM", () => {
    const { container } = render(<Harness motion="page" listHeader={<h2>Jobs list</h2>} headerActions={<button>Retry</button>} headerSummary={<p>Job summary</p>} />);
    const root = container.querySelector('[data-slot="sliding-detail-panel"]')!;
    const pane = root.querySelector('[data-slot="sliding-detail-content"]')!;
    const header = pane.querySelector('[data-slot="sliding-detail-header"]')!;
    const row = header.querySelector('[data-slot="pane-header"]')!;
    const summary = header.querySelector('[data-slot="sliding-detail-header-summary"]')!;
    expect(root).toHaveAttribute("data-motion", "page");
    expect(root.querySelector('[data-slot="sliding-detail-list"]')).toContainElement(screen.getByText("Jobs list"));
    expect(root.querySelector('[data-slot="sliding-detail-dim"]')).toBeNull();
    expect(row).toContainElement(screen.getByText("일정으로 돌아가기"));
    expect(screen.getByText("일정으로 돌아가기")).toHaveAttribute("data-component", "test_slide_detail-pane_header_row_back");
    expect(row).toContainElement(screen.getByText("Retry"));
    expect(summary).toContainElement(screen.getByText("Job summary"));
    expect([...header.children]).toEqual([row, summary]);
    expect([...pane.children]).toEqual([header, pane.querySelector('[data-slot="sliding-detail-body"]')]);
    for (const node of [row, row.querySelector('[data-slot="pane-header-actions"]')!, summary]) {
        expect(node).toHaveAttribute("data-component", expect.stringMatching(/^test_slide_detail-pane_header_/));
        if (node === summary) expect(node).toHaveClass("sliding-detail-header-summary");
        else expect(node).toHaveClass("flex");
    }
});

test.each([undefined, "page"] as const)("respects a child's prevented Escape in %s mode", (motion) => {
    const { container } = render(<Harness motion={motion} detail={<button onKeyDown={(event) => event.preventDefault()}>Child escape</button>} />);
    fireEvent.click(screen.getByRole("button", { name: "고객 일정" }));
    fireEvent.keyDown(screen.getByText("Child escape"), { key: "Escape" });
    expect(container.querySelector('[data-slot="sliding-detail-panel"]')).toHaveAttribute("data-open", "true");
});

test.each([undefined, "parallax"] as const)("ignores untyped %s parallax slots without replacing the focused back button", (motion) => {
    const { container, rerender } = render(<Harness motion={motion} />);
    const listButton = screen.getByRole("button", { name: "고객 일정" });
    listButton.focus(); fireEvent.click(listButton);
    const back = screen.getByRole("button", { name: "일정으로 돌아가기" });
    expect(back).toHaveFocus();
    rerender(<Harness motion={motion} headerActions={<button>Async action</button>} headerSummary={<p>Async summary</p>} />);
    expect(screen.getByRole("button", { name: "일정으로 돌아가기" })).toBe(back);
    expect(back).toHaveFocus();
    expect(screen.queryByText("Async action")).not.toBeInTheDocument();
    expect(screen.queryByText("Async summary")).not.toBeInTheDocument();
    expect(container.querySelector('[data-slot="pane-header"]')).toBeNull();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(container.querySelector('[data-slot="sliding-detail-panel"]')).toHaveAttribute("data-open", "false");
    expect(listButton).toHaveFocus();
});

test("page async slots retain the same focused back node and Escape navigation", () => {
    const { container, rerender } = render(<Harness motion="page" />);
    const listButton = screen.getByRole("button", { name: "고객 일정" });
    listButton.focus(); fireEvent.click(listButton);
    const back = screen.getByRole("button", { name: "일정으로 돌아가기" });
    rerender(<Harness motion="page" headerActions={<button>Async action</button>} headerSummary={<p>Async summary</p>} />);
    expect(screen.getByRole("button", { name: "일정으로 돌아가기" })).toBe(back);
    expect(back).toHaveFocus();
    expect(screen.getByText("Async action")).toBeInTheDocument();
    expect(screen.getByText("Async summary")).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(container.querySelector('[data-slot="sliding-detail-panel"]')).toHaveAttribute("data-open", "false");
    expect(listButton).toHaveFocus();
});

const typedBase = { "data-component": "desktop_test_slider", open: false, onBack: () => {}, backLabel: "Back", list: null, detail: null };
void (<SlidingDetailPanel open={false} onBack={() => {}} backLabel="Back" list={null} detail={null} />);
// Valid page calls may provide both slots.
void (<SlidingDetailPanel {...typedBase} motion="page" headerActions={<span />} headerSummary={<span />} />);
// @ts-expect-error Header actions require an explicit page variant.
void (<SlidingDetailPanel {...typedBase} headerActions={<span />} />);
// @ts-expect-error Parallax does not accept header summaries.
void (<SlidingDetailPanel {...typedBase} motion="parallax" headerSummary={<span />} />);

test.each([undefined, "page"] as const)("preserves every literal provided namespace in %s mode", (motion) => {
    const { container } = render(<Harness motion={motion} headerActions={<button>Action</button>} headerSummary={<p>Summary</p>} />);
    expect([...container.querySelectorAll("[data-component]")].map((node) => node.getAttribute("data-component"))).toEqual(motion === "page" ? [
        "test_slide", "test_slide_list-pane", "test_slide_detail-pane", "test_slide_detail-pane_header",
        "test_slide_detail-pane_header_row", "test_slide_detail-pane_header_row_back",
        "test_slide_detail-pane_header_row_actions", "test_slide_detail-pane_header_summary", "test_slide_detail-pane_body",
    ] : [
        "test_slide", "test_slide_list-pane", "test_slide_detail-pane", "test_slide_detail-pane_header",
        "test_slide_detail-pane_header_back", "test_slide_detail-pane_body",
    ]);
});

test.each([undefined, "page"] as const)("omits owned metadata and preserves caller children in %s mode", (motion) => {
    for (const metadata of [{}, { "data-component": "" }]) {
        const onBack = jest.fn();
        const props = { open: true, onBack, backLabel: "Optional back", list: <button>Optional row</button>, detail: <button>Optional detail</button>, ...metadata };
        const view = (detail: ReactNode) => motion === "page"
            ? <SlidingDetailPanel {...props} motion="page" headerActions={<button>Optional action</button>} headerSummary={<p>Optional summary</p>} detail={detail} />
            : <SlidingDetailPanel {...props} detail={detail} />;
        const { container, rerender, unmount } = render(view(props.detail));
        const root = container.querySelector('[data-slot="sliding-detail-panel"]');
        expect(root).toHaveAttribute("data-source-component", "SlidingDetailPanel");
        expect(root).toHaveAttribute("data-open", "true");
        expect(container.querySelector('[data-slot="sliding-detail-list"]')).toHaveAttribute("inert");
        expect(container.querySelector('[data-slot="sliding-detail-content"]')).not.toHaveAttribute("inert");
        expect(screen.getByRole("button", { name: "Optional back" })).toHaveFocus();
        expect(container.querySelectorAll("[data-component]")).toHaveLength(0);
        if (motion === "page") expect(screen.getByText("Optional summary")).toBeInTheDocument();
        rerender(view(<button data-component="caller_authored_detail">Optional detail</button>));
        expect(screen.getByText("Optional detail")).toHaveAttribute("data-component", "caller_authored_detail");
        expect(container.querySelectorAll("[data-component]")).toHaveLength(1);
        fireEvent.keyDown(screen.getByRole("button", { name: "Optional back" }), { key: "Escape" });
        expect(onBack).toHaveBeenCalledTimes(1);
        unmount();
    }
});

// These assertions inspect the shipped stylesheet; jsdom does not load its transitions.
const stylesheet = readFileSync(resolve(__dirname, "../../../../app/globals.css"), "utf8");
const compact = (value: string | undefined) => (value ?? "").replace(/\s+/g, "");
type CssTuple = [context: string, selector: string, property: string, value: string];
function cssInventory(source: string, context: string[] = []): CssTuple[] {
    const css = source.replace(/\/\*[\s\S]*?\*\//g, "");
    const result: CssTuple[] = [];
    let start = 0, opening = 0, depth = 0, quote = "";
    for (let index = 0; index < css.length; index++) {
        const char = css[index];
        if (quote) {
            if (char === "\\") index++;
            else if (char === quote) quote = "";
            continue;
        }
        if (char === '"' || char === "'") { quote = char; continue; }
        if (char === ";" && depth === 0) start = index + 1;
        if (char === "{") { if (depth === 0) opening = index; depth++; }
        if (char !== "}") continue;
        if (--depth < 0) throw new Error("Unbalanced stylesheet block");
        if (depth !== 0) continue;
        const selector = css.slice(start, opening).trim().replace(/\s+/g, " ");
        const body = css.slice(opening + 1, index);
        if (selector.startsWith("@")) {
            result.push(...cssInventory(body, [...context, selector]));
        } else {
            // Keep the FULL selector/list, including unknown wrappers and specificity.
            if (/\.sliding-detail-(?:list|content|dim|header)(?:-[a-z0-9-]+)?(?![a-z0-9_-])/i.test(selector)) {
                for (const declaration of body.split(";")) {
                    const colon = declaration.indexOf(":");
                    const property = declaration.slice(0, colon).trim();
                    if (colon < 0 || !/^[a-z_-][a-z0-9_-]*$/i.test(property)) continue;
                    result.push([context.join(" > "), selector, property, declaration.slice(colon + 1).trim().replace(/\s+/g, " ")]);
                }
            }
            if (body.includes("{")) result.push(...cssInventory(body, context));
        }
        start = index + 1;
    }
    if (depth || quote) throw new Error("Unbalanced stylesheet block or string");
    return result;
}
function declaration(selector: string, property: string, source = stylesheet, context = "") {
    return cssInventory(source).filter(([scope, selectors, name]) =>
        scope === context && selectors.split(",").some((part) => part.trim() === selector) && name === property).at(-1)?.[3];
}
const page = '.sliding-detail-panel[data-motion="page"]';
const paneSelectors = [".sliding-detail-list", ".sliding-detail-content"];

// Fixed independent contract, in source order; no sorting or generated snapshots.
const expectedCssInventory: CssTuple[] = [
    ["", ".sliding-detail-list, .sliding-detail-content", "position", "absolute"],
    ["", ".sliding-detail-list, .sliding-detail-content", "inset", "0"],
    ["", ".sliding-detail-list, .sliding-detail-content", "display", "flex"],
    ["", ".sliding-detail-list, .sliding-detail-content", "flex-direction", "column"],
    ["", ".sliding-detail-list, .sliding-detail-content", "min-height", "0"],
    ["", ".sliding-detail-list, .sliding-detail-content", "transition", "transform 380ms cubic-bezier(0.32, 0.72, 0, 1)"],
    ["", ".sliding-detail-list, .sliding-detail-content", "will-change", "transform"],
    ["", ".sliding-detail-list", "transform", "translateX(0)"],
    ["", '.sliding-detail-panel[data-open="true"] > .sliding-detail-list', "transform", "translateX(-30%)"],
    ["", ".sliding-detail-dim", "position", "absolute"],
    ["", ".sliding-detail-dim", "inset", "0"],
    ["", ".sliding-detail-dim", "background", "rgba(15,23,42,.08)"],
    ["", ".sliding-detail-dim", "opacity", "0"],
    ["", ".sliding-detail-dim", "pointer-events", "none"],
    ["", ".sliding-detail-dim", "transition", "opacity 380ms cubic-bezier(0.32,0.72,0,1)"],
    ["", '.sliding-detail-panel[data-open="true"] > .sliding-detail-list > .sliding-detail-dim', "opacity", "1"],
    ["", ".sliding-detail-content", "z-index", "2"],
    ["", ".sliding-detail-content", "transform", "translateX(100%)"],
    ["", ".sliding-detail-content", "background", "white"],
    ["", ".sliding-detail-content", "border-radius", "28px"],
    ["", '.sliding-detail-panel[data-open="true"] > .sliding-detail-content', "transform", "translateX(0)"],
    ["", ".sliding-detail-header", "display", "flex"],
    ["", ".sliding-detail-header", "flex-shrink", "0"],
    ["", ".sliding-detail-header", "padding", "calc(20px*var(--glint-ui-scale,1)) calc(24px*var(--glint-ui-scale,1)) 0"],
    ["@media (prefers-reduced-motion: reduce)", ".sliding-detail-list, .sliding-detail-content, .sliding-detail-dim", "transition-duration", ".01ms"],
    ["", `${page} > .sliding-detail-list, ${page} > .sliding-detail-content`, "width", "100%"],
    ["", `${page} > .sliding-detail-list, ${page} > .sliding-detail-content`, "transition", "transform 300ms cubic-bezier(.22,1,.36,1)"],
    ["", `${page}[data-open="true"] > .sliding-detail-list`, "transform", "translateX(calc(-100% - 16px))"],
    ["", `${page} > .sliding-detail-content`, "transform", "translateX(calc(100% + 16px))"],
    ["", `${page}[data-open="true"] > .sliding-detail-content`, "transform", "translateX(0)"],
    ["", '.sliding-detail-header[data-layout="stack"]', "flex-direction", "column"],
    ["", '.sliding-detail-header[data-layout="stack"]', "gap", "16px"],
    ["", ".sliding-detail-header-row", "display", "flex"],
    ["", ".sliding-detail-header-row", "align-items", "center"],
    ["", ".sliding-detail-header-row", "justify-content", "space-between"],
    ["", ".sliding-detail-header-row", "gap", "12px"],
    ["", ".sliding-detail-header-actions", "display", "flex"],
    ["", ".sliding-detail-header-actions", "align-items", "center"],
    ["", ".sliding-detail-header-actions", "gap", "8px"],
    ["", ".sliding-detail-header-actions", "flex-shrink", "0"],
    ["", ".sliding-detail-header-summary", "min-width", "0"],
    ["", `${page} > .sliding-detail-content > .sliding-detail-header`, "padding", "0"],
    ["@media (prefers-reduced-motion: reduce)", `${page} > .sliding-detail-list, ${page} > .sliding-detail-content`, "transition", "none"],
];

test("actual CSS inventory preserves every relevant selector/declaration and media context in source order", () => {
    expect(cssInventory(stylesheet)).toEqual(expectedCssInventory);
});

test("inventory preserves nested context, full selector lists, duplicate declarations and their order", () => {
    const source = '@import "theme.css"; /* ignored */ @media (width < 500px) { @supports (display: grid) { .wrapper .sliding-detail-list, .other { transition: none; transition: transform 1s; } } }';
    expect(cssInventory(source)).toEqual([
        ["@media (width < 500px) > @supports (display: grid)", ".wrapper .sliding-detail-list, .other", "transition", "none"],
        ["@media (width < 500px) > @supports (display: grid)", ".wrapper .sliding-detail-list, .other", "transition", "transform 1s"],
    ]);
});

test("the default stylesheet retains the 380ms parallax, dim and header geometry", () => {
    for (const selector of paneSelectors) {
        expect(compact(declaration(selector, "transition")!)).toBe("transform380mscubic-bezier(0.32,0.72,0,1)");
    }
    expect(declaration('.sliding-detail-panel[data-open="true"] > .sliding-detail-list', "transform")).toBe("translateX(-30%)");
    expect(declaration(".sliding-detail-content", "transform")).toBe("translateX(100%)");
    expect(compact(declaration(".sliding-detail-dim", "transition")!)).toBe("opacity380mscubic-bezier(0.32,0.72,0,1)");
    expect(compact(declaration(".sliding-detail-header", "padding")!)).toBe("calc(20px*var(--glint-ui-scale,1))calc(24px*var(--glint-ui-scale,1))0");
});

test("page stylesheet moves both full-width panes across the fixed 16px gap with 300ms easing", () => {
    for (const selector of paneSelectors) {
        expect(compact(declaration(`${page} > ${selector}`, "transition")!)).toBe("transform300mscubic-bezier(.22,1,.36,1)");
        expect(declaration(`${page} > ${selector}`, "width")).toBe("100%");
    }
    expect(compact(declaration(`${page}[data-open="true"] > .sliding-detail-list`, "transform")!)).toBe("translateX(calc(-100%-16px))");
    expect(compact(declaration(`${page} > .sliding-detail-content`, "transform")!)).toBe("translateX(calc(100%+16px))");
    expect(declaration(`${page}[data-open="true"] > .sliding-detail-content`, "transform")).toBe("translateX(0)");
    expect(declaration(`${page} > .sliding-detail-content > .sliding-detail-header`, "padding")).toBe("0");
});

test("page reduced-motion removes transitions while default parallax keeps its existing reduction", () => {
    const reduced = "@media (prefers-reduced-motion: reduce)";
    for (const selector of paneSelectors) {
        expect(declaration(`${page} > ${selector}`, "transition", stylesheet, reduced)).toBe("none");
        expect(declaration(selector, "transition-duration", stylesheet, reduced)).toBe(".01ms");
    }
});
