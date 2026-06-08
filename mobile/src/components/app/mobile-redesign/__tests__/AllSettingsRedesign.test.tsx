import { fireEvent, render, screen } from "@testing-library/react";

jest.mock("@/lib/env", () => ({
  APP_VERSION: "0.1.0",
}));

import { AllSettingsRedesign } from "../AllSettingsRedesign";
import { LocaleProvider } from "@/providers/LocaleProvider";
import { UserProvider } from "@/providers/UserProvider";
import type { AuthUser } from "@/hooks/useGetAuthUser";

const mockPush = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

describe("AllSettingsRedesign", () => {
  beforeEach(() => {
    mockPush.mockClear();
  });

  it("renders the localized actual account role in the profile card", () => {
    const user: AuthUser = {
      id: "user-1",
      name: "김운영",
      role: "owner",
      branchName: "인천점",
    };

    render(
      <LocaleProvider locale="ko">
        <UserProvider user={user}>
          <AllSettingsRedesign menuGroups={[]} />
        </UserProvider>
      </LocaleProvider>,
    );

    expect(screen.getByText("김운영")).toBeInTheDocument();
    expect(screen.getByText("오너")).toBeInTheDocument();
    expect(screen.queryByText("인천점")).not.toBeInTheDocument();
    expect(screen.queryByText("지점장")).not.toBeInTheDocument();
    expect(screen.getByLabelText("프로필 편집")).not.toBeVisible();
    expect(screen.getByRole("button", { name: "지점 변경" })).toBeInTheDocument();
    expect(screen.getByText("아가잼잼 어드민 v0.1.0")).toBeInTheDocument();
    expect(screen.queryByText("아가잼잼 어드민 v2.4.1")).not.toBeInTheDocument();
  });

  it("routes owners to branch selection from the branch switch button", () => {
    const user: AuthUser = {
      id: "user-1",
      name: "김운영",
      role: "owner",
      branchName: "인천점",
    };

    render(
      <LocaleProvider locale="ko">
        <UserProvider user={user}>
          <AllSettingsRedesign menuGroups={[]} />
        </UserProvider>
      </LocaleProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "지점 변경" }));

    expect(mockPush).toHaveBeenCalledWith("/select-branch");
  });

  it("does not show branch switching to non-owner accounts", () => {
    const user: AuthUser = {
      id: "user-2",
      name: "김관리",
      role: "admin",
      branchName: "인천점",
    };

    render(
      <LocaleProvider locale="ko">
        <UserProvider user={user}>
          <AllSettingsRedesign menuGroups={[]} />
        </UserProvider>
      </LocaleProvider>,
    );

    expect(screen.queryByRole("button", { name: "지점 변경" })).not.toBeInTheDocument();
  });
});
