import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

import SelectBranchPage from "./page";
import { getUserBranches, setCurrentBranch } from "./actions";
import { resetAuthorityState } from "@/lib/auth/authority-state";

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockClear = jest.fn();
const mockRouter = { push: mockPush, replace: mockReplace };
const mockQueryClient = { clear: mockClear };
const mockSearchParams = new URLSearchParams();

jest.mock("./actions", () => ({
  getUserBranches: jest.fn(),
  setCurrentBranch: jest.fn(),
}));

jest.mock("next/navigation", () => ({
  useRouter: () => mockRouter,
  useSearchParams: () => mockSearchParams,
}));

jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => mockQueryClient,
}));

jest.mock("@/lib/auth/authority-state", () => ({
  resetAuthorityState: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("@/components/auth/auth-panel", () => ({
  AuthPanel: ({
    children,
    title,
    subtitle,
  }: {
    children: ReactNode;
    title?: ReactNode;
    subtitle?: ReactNode;
  }) => (
    <main>
      <h1>{title}</h1>
      <p>{subtitle}</p>
      {children}
    </main>
  ),
}));

const mockedGetUserBranches = jest.mocked(getUserBranches);
const mockedSetCurrentBranch = jest.mocked(setCurrentBranch);
const mockedResetAuthorityState = jest.mocked(resetAuthorityState);

const branches = [
  {
    id: "branch-a",
    name: "강남점",
    slug: "gangnam",
    description: "서울 강남",
    role: "admin",
  },
  {
    id: "branch-b",
    name: "송도점",
    slug: "songdo",
    description: "인천 송도",
    role: "member",
  },
];

beforeEach(() => {
  jest.resetAllMocks();
  mockSearchParams.delete("returnTo");
  mockedResetAuthorityState.mockResolvedValue(undefined);
  mockedGetUserBranches.mockResolvedValue({ success: true, branches });
  mockedSetCurrentBranch.mockResolvedValue({ success: true });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("SelectBranchPage branch action accessibility", () => {
  it.each([
    { failure: "result", returnTo: "https://example.com", destination: "/dashboard" },
    { failure: "throw", returnTo: "/service-record-admin/client-123", destination: "/service-record-admin/client-123" },
  ])("allows a manual retry after a $failure failure and navigates to $destination", async ({ failure, returnTo, destination }) => {
    const failureMessage = "지점 선택에 실패했어요.";
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockSearchParams.set("returnTo", returnTo);
    if (failure === "throw") {
      mockedSetCurrentBranch.mockRejectedValueOnce(new Error("selection unavailable"));
    } else {
      mockedSetCurrentBranch.mockResolvedValueOnce({ success: false, error: failureMessage });
    }
    let resolveRetry: ((result: { success: boolean }) => void) | undefined;
    mockedSetCurrentBranch.mockImplementationOnce(() => new Promise((resolve) => {
      resolveRetry = resolve;
    }));

    render(<SelectBranchPage />);
    fireEvent.click(await screen.findByRole("button", { name: "강남점 지점 선택" }));

    const error = await screen.findByRole("alert");
    expect(error).toHaveTextContent(failureMessage);
    expect(error).toHaveAttribute("data-component", "desktop_select-branch_content_selection-error");
    expect(error).toHaveClass("text-destructive");
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
    for (const option of screen.getAllByRole("button", { name: /지점 선택$/ })) {
      expect(option).toBeEnabled();
      expect(option).not.toHaveAttribute("aria-busy");
      expect(option.tabIndex).toBe(0);
      option.focus();
      expect(document.activeElement).toBe(option);
    }
    expect(mockedGetUserBranches).toHaveBeenCalledTimes(1);
    expect(mockedSetCurrentBranch).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "강남점 지점 선택" }));
    await waitFor(() => expect(mockedSetCurrentBranch).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "강남점 지점 선택" })).toBeDisabled();
    await act(async () => resolveRetry?.({ success: true }));

    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith(destination);
    expect(mockedGetUserBranches).toHaveBeenCalledTimes(1);
    expect(mockedSetCurrentBranch.mock.calls).toEqual([["branch-a"], ["branch-a"]]);
    expect(mockedResetAuthorityState).toHaveBeenCalledTimes(2);
    for (const index of [0, 1]) {
      expect(mockedResetAuthorityState.mock.invocationCallOrder[index]).toBeLessThan(
        mockedSetCurrentBranch.mock.invocationCallOrder[index],
      );
    }
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it.each(["result", "throw"])("retains the sole non-owner branch after an automatic %s failure for manual retry", async (failure) => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    mockedGetUserBranches.mockResolvedValue({ success: true, branches: [branches[0]] });
    if (failure === "throw") {
      mockedSetCurrentBranch.mockRejectedValueOnce(new Error("selection unavailable"));
    } else {
      mockedSetCurrentBranch.mockResolvedValueOnce({ success: false, error: "다시 선택해 주세요." });
    }

    render(<SelectBranchPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      failure === "throw" ? "지점 선택에 실패했어요." : "다시 선택해 주세요.",
    );
    const option = screen.getByRole("button", { name: "강남점 지점 선택" });
    expect(option).toBeEnabled();
    option.focus();
    expect(document.activeElement).toBe(option);
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockedGetUserBranches).toHaveBeenCalledTimes(1);
    expect(mockedSetCurrentBranch).toHaveBeenCalledTimes(1);

    fireEvent.click(option);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/dashboard"));
    expect(mockedGetUserBranches).toHaveBeenCalledTimes(1);
    expect(mockedSetCurrentBranch.mock.calls).toEqual([["branch-a"], ["branch-a"]]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps successful automatic selection loading until navigation takes over", async () => {
    mockedGetUserBranches.mockResolvedValue({ success: true, branches: [branches[0]] });
    render(<SelectBranchPage />);

    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/dashboard"));
    expect(screen.getByRole("heading", { name: "지점 불러오는 중" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /지점 선택$/ })).not.toBeInTheDocument();
    expect(mockedGetUserBranches).toHaveBeenCalledTimes(1);
    expect(mockedSetCurrentBranch).toHaveBeenCalledTimes(1);
  });

  it("exposes every available branch as a named, focusable Button action", async () => {
    render(<SelectBranchPage />);

    const options = await screen.findAllByRole("button", { name: /지점 선택$/ });

    expect(options).toHaveLength(branches.length);
    for (const [index, option] of options.entries()) {
      expect(option).toHaveAttribute("data-component", "desktop_select-branch_list_card");
      expect(option).toHaveAttribute("type", "button");
      expect(option.tagName).toBe("BUTTON");
      expect(option).toHaveClass("focus-visible:ring-2");
      expect(option).toHaveClass("focus-visible:ring-v3-primary", "border-2", "border-v3-selectable-border", "hover:border-v3-selectable-border");
      expect(option).not.toHaveAttribute("aria-pressed");
      expect(option.className).not.toContain("!border");
      expect(option).toHaveAttribute("aria-label", `${branches[index].name} 지점 선택`);
      expect(option.tabIndex).toBe(0);

      option.focus();
      expect(document.activeElement).toBe(option);
    }
  });

  it("keeps pointer selection parity and prevents duplicate activation while pending", async () => {
    let resolveSelection: ((result: { success: boolean }) => void) | undefined;
    mockedSetCurrentBranch.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSelection = resolve;
        }),
    );

    render(<SelectBranchPage />);

    const firstOption = await screen.findByRole("button", { name: "강남점 지점 선택" });
    const secondOption = screen.getByRole("button", { name: "송도점 지점 선택" });

    fireEvent.click(firstOption);

    await waitFor(() => expect(mockedResetAuthorityState).toHaveBeenCalledWith({ clear: mockClear }));
    await waitFor(() => expect(mockedSetCurrentBranch).toHaveBeenCalledWith("branch-a"));
    expect(mockedResetAuthorityState.mock.invocationCallOrder[0]).toBeLessThan(
      mockedSetCurrentBranch.mock.invocationCallOrder[0],
    );
    expect(mockedSetCurrentBranch).toHaveBeenCalledTimes(1);
    expect(firstOption).toBeDisabled();
    expect(secondOption).toBeDisabled();
    for (const option of [firstOption, secondOption]) {
      expect(option).toHaveAttribute("aria-busy", "true");
      expect(option).toHaveClass("border-2", "border-v3-selectable-border");
      expect(option).not.toHaveClass("border-v3-primary");
      expect(option).not.toHaveAttribute("aria-pressed");
    }

    fireEvent.click(firstOption);
    expect(mockedSetCurrentBranch).toHaveBeenCalledTimes(1);

    resolveSelection?.({ success: true });
  });
});
