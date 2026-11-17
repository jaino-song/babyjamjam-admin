import { render, screen } from "@testing-library/react";
import { V3MobileHeader } from "./V3MobileHeader";

let mockPathname = "/agent";
jest.mock("next/navigation", () => ({ usePathname: () => mockPathname }));
jest.mock("@/providers/UserProvider", () => ({ useInitialUser: () => ({ name: "관리자", branchName: "개발QA점" }) }));
jest.mock("@/components/app/notifications/NotificationBell", () => ({ NotificationBell: () => <span>알림</span> }));

it.each(["/agent", "/chat"])("hides the shared header on %s", (pathname) => {
  mockPathname = pathname;
  render(<V3MobileHeader data-component="mobile_shell_header" />);
  expect(screen.queryByRole("banner")).not.toBeInTheDocument();
});

it("retains the shared header on other screens", () => {
  mockPathname = "/all";
  render(<V3MobileHeader data-component="mobile_shell_header" />);
  expect(screen.getByRole("banner")).toHaveTextContent("관리자 님");
  expect(screen.getByRole("banner")).toHaveTextContent("개발QA점");
  expect(screen.getByRole("banner")).toHaveClass("fixed", "existing-navbar");
  expect(screen.getByRole("banner")).toHaveAttribute("data-slot", "mobile-header");
});

it("embeds the same identity and bell with route-owned leading and trailing controls", () => {
  mockPathname = "/agent";
  render(<V3MobileHeader
    data-component="mobile_chat_agent-shell_header"
    data-slot="agent-header"
    embedded
    leadingSlot={<button>대화 목록</button>}
    trailingSlot={<button>새 대화</button>}
  />);
  const header = screen.getByRole("banner");
  expect(header).toHaveAttribute("data-source-component", "V3MobileHeader");
  expect(header).toHaveClass("relative");
  expect(header).not.toHaveClass("fixed");
  expect(header).toHaveTextContent("대화 목록관리자 님개발QA점새 대화알림");
});
