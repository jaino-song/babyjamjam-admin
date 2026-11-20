import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import SelectBranchPage from "./page";
import { getUserBranches, setCurrentBranch } from "./actions";

jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("@/providers/UserProvider", () => ({ useInitialUser: () => null }));
jest.mock("@/lib/auth/authority-state", () => ({ resetAuthorityState: jest.fn().mockResolvedValue(undefined) }));
jest.mock("@/lib/notifications/push-endpoint", () => ({ getCurrentPushEndpoint: jest.fn().mockResolvedValue(null) }));
jest.mock("@/app/(shell)/logout/actions", () => ({ logout: jest.fn(() => new Promise(() => {})) }));
jest.mock("./actions", () => ({ getUserBranches: jest.fn(), setCurrentBranch: jest.fn() }));

const branches = [{ id: "qa", name: "개발QA점", slug: "dev-qa", description: null, role: "owner" }];

function expectBusyButton(name: string, idleLabel: string) {
  const button = screen.getByRole("button", { name });
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute("aria-busy", "true");
  expect(button).toHaveAttribute("data-loading", "");
  expect(button).toHaveClass("relative");
  const idle = button.querySelector('[data-slot="button-idle"]');
  expect(idle).toHaveAttribute("aria-hidden", "true");
  expect(idle).toHaveClass("contents", "invisible");
  expect(idle).toHaveTextContent(idleLabel);
  expect(button.querySelector('[data-slot="spinner"]')).not.toBeNull();
}

describe("branch route loading presentation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getUserBranches).mockResolvedValue({ success: true, branches });
    jest.mocked(setCurrentBranch).mockReturnValue(new Promise(() => {}));
  });

  it("names the cold-load status and keeps its label screen-reader-only", () => {
    jest.mocked(getUserBranches).mockReturnValue(new Promise(() => {}));
    render(<SelectBranchPage />);
    const status = screen.getByRole("status", { name: "지점 목록을 불러오는 중" });
    expect(status.querySelector('[data-slot="spinner"]')).not.toBeNull();
    expect(screen.getByText("지점 목록을 불러오는 중")).toHaveClass("sr-only");
  });

  it("retains the selected branch label while showing a centered busy indicator", async () => {
    render(<SelectBranchPage />);
    fireEvent.click(await screen.findByRole("button", { name: "개발QA점으로 이동" }));
    expectBusyButton("이동 중", "개발QA점으로 이동");
    expect(screen.getByRole("button", { name: "로그아웃" })).toBeDisabled();
    await waitFor(() => expect(setCurrentBranch).toHaveBeenCalledWith("qa"));
  });

  it.each([[branches], [[]]])("shows a named Spinner for logout with populated or empty branches (%j)", async (rows) => {
    jest.mocked(getUserBranches).mockResolvedValue({ success: true, branches: rows });
    render(<SelectBranchPage />);
    fireEvent.click(await screen.findByRole("button", { name: "로그아웃" }));
    expectBusyButton("로그아웃 중", "로그아웃");
  });
});
