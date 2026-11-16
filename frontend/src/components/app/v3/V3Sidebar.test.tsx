import { render, screen, within } from "@testing-library/react";

import { V3Sidebar } from "./V3Sidebar";

let mockPathname = "/dashboard";

jest.mock("next/navigation", () => ({ usePathname: () => mockPathname }));
jest.mock("@/providers/UserProvider", () => ({
  useInitialUser: () => ({ name: "테스트", role: "owner" }),
}));
jest.mock("@/hooks/useConsultationInquiries", () => ({
  useConsultationInquiries: () => ({ data: { total: 0 } }),
}));
jest.mock("./SidebarNotifications", () => ({ SidebarNotifications: () => null }));
jest.mock("./SidebarAccountMenu", () => ({ SidebarAccountMenu: () => null }));
jest.mock("./useGlintUiScale", () => ({ useGlintUiScaleStyle: () => ({}) }));

describe("V3Sidebar agent navigation", () => {
  it("renders the agent link directly after dashboard in the main group", () => {
    mockPathname = "/dashboard";
    render(<V3Sidebar />);

    const mainGroup = screen.getByRole("heading", { name: "메인" }).parentElement;
    if (!mainGroup) throw new Error("The main navigation group is missing");
    const links = within(mainGroup).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual(["대시보드", "에이전트"]);
    expect(links[1]).toHaveAttribute("href", "/agent");
    expect(links[1]).toHaveAttribute("data-component", "sidebar-nav-agent");
    expect(links[1]).not.toHaveAttribute("aria-current");
  });

  it("marks the agent link active on /agent and leaves dashboard inactive", () => {
    mockPathname = "/agent";
    render(<V3Sidebar />);

    const agent = screen.getByRole("link", { name: "에이전트" });
    expect(agent).toHaveAttribute("href", "/agent");
    expect(agent).toHaveAttribute("aria-current", "page");
    expect(agent).toHaveClass("bg-v3-primary", "text-white");
    expect(screen.getByRole("link", { name: "대시보드" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "대시보드" })).not.toHaveClass("bg-v3-primary");
  });
});
