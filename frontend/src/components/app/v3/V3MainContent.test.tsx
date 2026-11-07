import { render, screen } from "@testing-library/react";
import { V3MainContent } from "./V3MainContent";
let mockPathname = "/chat";
jest.mock("next/navigation", () => ({ usePathname: () => mockPathname }));
jest.mock("./FloatingQuickActions", () => ({ FloatingQuickActions: () => <div data-testid="quick-actions" /> }));
jest.mock("./useGlintUiScale", () => ({ useGlintUiScaleStyle: () => ({}) }));
describe("V3MainContent chat height", () => {
    it("bounds chat within the sole main and reserves mobile bottom navigation space", () => {
        mockPathname = "/chat";
        render(<V3MainContent data-component="desktop_chrome_main"><section>채팅</section></V3MainContent>);
        expect(screen.getAllByRole("main")).toHaveLength(1);
        expect(screen.getByRole("main")).toHaveClass("h-dvh", "max-md:!pb-[calc(96px+env(safe-area-inset-bottom))]");
        expect(screen.getByTestId("quick-actions")).toBeInTheDocument();
    });
    it.each(["/dashboard", "/clients", "/messages", "/contracts"])("preserves existing height/padding and quick actions at %s", (path) => {
        mockPathname = path;
        render(<V3MainContent data-component="desktop_chrome_main">내용</V3MainContent>);
        expect(screen.getByRole("main")).toHaveClass("h-screen", "pb-[calc(80px*var(--glint-ui-scale,1))]");
        expect(screen.getByRole("main")).not.toHaveClass("h-dvh");
        expect(screen.getByTestId("quick-actions")).toBeInTheDocument();
    });
    it("preserves the branch selector's zero-padding exclusion", () => {
        mockPathname = "/select-branch";
        render(<V3MainContent data-component="desktop_chrome_main">지점</V3MainContent>);
        expect(screen.getByRole("main")).toHaveClass("h-screen", "p-0", "md:p-0");
        expect(screen.queryByTestId("quick-actions")).not.toBeInTheDocument();
    });
});
