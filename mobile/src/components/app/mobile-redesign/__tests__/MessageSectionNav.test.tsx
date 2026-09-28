import { render, screen } from "@testing-library/react";

import { MESSAGE_NAVIGATION_ITEMS, MessageSectionNav } from "../MessageSectionNav";
import { useMessagesPermissionGuard } from "@/app/(shell)/messages/MessagesPermissionGuard";
import { useGetAuthUser } from "@/hooks/useGetAuthUser";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock("@/hooks/useGetAuthUser", () => ({
  useGetAuthUser: jest.fn(),
}));

jest.mock("@/app/(shell)/messages/MessagesPermissionGuard", () => ({
  useMessagesPermissionGuard: jest.fn(),
}));

const mockUseGetAuthUser = useGetAuthUser as jest.Mock;
const mockUseMessagesPermissionGuard = useMessagesPermissionGuard as jest.Mock;

const BRANCH_MANAGEMENT_LABEL = "자동 전송";
const RELEASED_LABELS = ["전송하기", "설정"];
// 발송 기록 (the merged screen) is gated only by sender approval, not by
// owner status, so it behaves differently from both groups above: unlike
// UNRELEASED_LABELS it is never owner-gated, but unlike RELEASED_LABELS it
// is not exempt from the sender-approval check either.
const APPROVAL_GATED_LABEL = "발송 기록";

function renderNav() {
  return render(<MessageSectionNav data-component="mobile_tests_message-section-nav" activeId="send" />);
}

describe("MessageSectionNav", () => {
  beforeEach(() => {
    mockUseGetAuthUser.mockReset();
    mockUseMessagesPermissionGuard.mockReset();
    mockUseGetAuthUser.mockReturnValue({
      data: { role: "user", branchRole: "manager" },
      isPending: false,
      isLoading: false,
      isFetching: false,
      isError: false,
    });
    mockUseMessagesPermissionGuard.mockReturnValue({
      isLoading: false,
      needsSenderApproval: false,
    });
  });

  it.each([
    ["global user with manager branch role", { role: "user", branchRole: "manager" }],
    ["global owner", { role: "owner", branchRole: null }],
  ])("allows branch-management automation for %s", (_label, user) => {
    mockUseGetAuthUser.mockReturnValue({
      data: user,
      isPending: false,
      isLoading: false,
      isFetching: false,
      isError: false,
    });

    renderNav();

    expect(screen.getByRole("button", { name: BRANCH_MANAGEMENT_LABEL })).toBeEnabled();
    const templates = screen.getByRole("button", { name: "템플릿" });
    if (user.role === "owner") {
      expect(templates).toBeEnabled();
    } else {
      expect(templates).toBeDisabled();
    }
  });

  it.each([
    ["global admin with user branch role", { role: "admin", branchRole: "user" }],
    ["global user without branch role", { role: "user" }],
    ["no resolved user", null],
  ])("keeps automation disabled for %s", (_label, user) => {
    mockUseGetAuthUser.mockReturnValue({
      data: user,
      isPending: false,
      isLoading: false,
      isFetching: false,
      isError: false,
    });

    renderNav();

    expect(screen.getByRole("button", { name: BRANCH_MANAGEMENT_LABEL })).toBeDisabled();
    expect(screen.getByRole("button", { name: "템플릿" })).toBeDisabled();
  });

  it("disables every section except send and settings while sender approval is pending", () => {
    mockUseGetAuthUser.mockReturnValue({
      data: { role: "owner" },
      isPending: false,
      isLoading: false,
      isFetching: false,
      isError: false,
    });
    mockUseMessagesPermissionGuard.mockReturnValue({
      isLoading: false,
      needsSenderApproval: true,
    });

    renderNav();

    for (const label of ["템플릿", BRANCH_MANAGEMENT_LABEL, APPROVAL_GATED_LABEL]) {
      expect(screen.getByRole("button", { name: label })).toBeDisabled();
    }
    for (const label of RELEASED_LABELS) {
      expect(screen.getByRole("button", { name: label })).toBeEnabled();
    }
  });

  it("shows non-interactive section skeletons while the permission check is loading", () => {
    mockUseGetAuthUser.mockReturnValue({
      data: { role: "owner" },
      isPending: false,
      isLoading: false,
      isFetching: false,
      isError: false,
    });
    mockUseMessagesPermissionGuard.mockReturnValue({
      isLoading: true,
      needsSenderApproval: false,
    });

    const { container } = renderNav();

    const nav = screen.getByRole("navigation", { name: "메시지 기능" });
    expect(nav).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByRole("button", { name: "전송하기" })).not.toBeInTheDocument();

    const skeletons = container.querySelectorAll('[data-loading="true"]');
    expect(skeletons).toHaveLength(MESSAGE_NAVIGATION_ITEMS.length);
    skeletons.forEach((skeleton) => {
      expect(skeleton).toBeDisabled();
      expect(skeleton).toHaveAttribute("data-component", "mobile_tests_message-section-nav_item-skeleton");
      expect(skeleton).toHaveClass("skeleton-base");
      expect(skeleton).toHaveAttribute("aria-hidden", "true");
    });
  });

  it("fails closed while the live authority query transitions branches", () => {
    const view = renderNav();

    expect(screen.getByRole("button", { name: BRANCH_MANAGEMENT_LABEL })).toBeEnabled();

    mockUseGetAuthUser.mockReturnValue({
      data: { role: "user", branchRole: "manager" },
      isPending: false,
      isLoading: false,
      isFetching: true,
      isError: false,
    });
    view.rerender(<MessageSectionNav data-component="mobile_tests_message-section-nav" activeId="send" />);
    expect(screen.getByRole("button", { name: BRANCH_MANAGEMENT_LABEL })).toBeDisabled();

    mockUseGetAuthUser.mockReturnValue({
      data: { role: "user", branchRole: "user" },
      isPending: false,
      isLoading: false,
      isFetching: false,
      isError: false,
    });
    view.rerender(<MessageSectionNav data-component="mobile_tests_message-section-nav" activeId="send" />);
    expect(screen.getByRole("button", { name: BRANCH_MANAGEMENT_LABEL })).toBeDisabled();

    mockUseGetAuthUser.mockReturnValue({
      data: { role: "user", branchRole: "user" },
      isPending: false,
      isLoading: false,
      isFetching: true,
      isError: false,
    });
    view.rerender(<MessageSectionNav data-component="mobile_tests_message-section-nav" activeId="send" />);
    expect(screen.getByRole("button", { name: BRANCH_MANAGEMENT_LABEL })).toBeDisabled();

    mockUseGetAuthUser.mockReturnValue({
      data: { role: "user", branchRole: "manager" },
      isPending: false,
      isLoading: false,
      isFetching: false,
      isError: false,
    });
    view.rerender(<MessageSectionNav data-component="mobile_tests_message-section-nav" activeId="send" />);
    expect(screen.getByRole("button", { name: BRANCH_MANAGEMENT_LABEL })).toBeEnabled();
  });
});
