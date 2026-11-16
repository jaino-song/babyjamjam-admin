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
});
