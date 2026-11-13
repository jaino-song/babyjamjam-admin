import { fireEvent, render, screen } from "@testing-library/react";

import { MESSAGE_NAVIGATION_ITEMS, MessageSectionNav } from "../MessageSectionNav";
import { useMessagesPermissionGuard } from "@/app/(shell)/messages/MessagesPermissionGuard";
import { useGetAuthUser } from "@/hooks/useGetAuthUser";

const mockPush = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
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
const RELEASED_LABELS = ["메세지 제작", "설정"];
// 발송 기록 requires sender approval, but has no owner-role restriction.
const APPROVAL_GATED_LABEL = "발송 기록";

function renderNav() {
  return render(<MessageSectionNav data-component="mobile_tests_message-section-nav" activeId="send" />);
}

describe("MessageSectionNav", () => {
  beforeEach(() => {
    mockPush.mockClear();
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

  it("prepends the mobile-only maker destination without changing send", () => {
    expect(MESSAGE_NAVIGATION_ITEMS[0]).toMatchObject({ id: "complete", title: "메세지 제작", href: "/messages/compose" });
    expect(MESSAGE_NAVIGATION_ITEMS[1]).toMatchObject({ id: "send", href: "/messages/new" });
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

  it.each([
    ["denied", { isLoading: false, needsSenderApproval: true }],
    ["loading", { isLoading: true, needsSenderApproval: false }],
  ])("keeps maker/settings usable and disables send navigation when approval is %s", (_label, permission) => {
    mockUseGetAuthUser.mockReturnValue({
      data: { role: "owner" }, isPending: false, isLoading: false, isFetching: false, isError: false,
    });
    mockUseMessagesPermissionGuard.mockReturnValue(permission);
    const { container } = renderNav();

    for (const label of ["전송하기", "템플릿", BRANCH_MANAGEMENT_LABEL, APPROVAL_GATED_LABEL]) {
      expect(screen.getByRole("button", { name: label })).toBeDisabled();
    }
    for (const label of RELEASED_LABELS) {
      expect(screen.getByRole("button", { name: label })).toBeEnabled();
    }
    expect(container.querySelector('[data-loading="true"]')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "전송하기" }));
    expect(mockPush).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "메세지 제작" }));
    expect(mockPush).toHaveBeenCalledWith("/messages/compose");
  });

  it("enables ordinary send navigation when approved", () => {
    renderNav();
    fireEvent.click(screen.getByRole("button", { name: "전송하기" }));
    expect(screen.getByRole("button", { name: "전송하기" })).toBeEnabled();
    expect(mockPush).toHaveBeenCalledWith("/messages/new");
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
