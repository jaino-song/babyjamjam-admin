import { render, screen } from "@testing-library/react";
import { useQuery } from "@tanstack/react-query";

import { useGetAuthUser } from "@/hooks/useGetAuthUser";

import { MessageTenantApplicationSettings } from "../MessageTenantApplicationSettings";

jest.mock("@tanstack/react-query", () => ({
  useQuery: jest.fn(),
}));

jest.mock("@/hooks/useGetAuthUser", () => ({
  useGetAuthUser: jest.fn(),
}));

jest.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: jest.fn(),
  }),
}));

const mockedUseQuery = jest.mocked(useQuery);
const mockedUseGetAuthUser = jest.mocked(useGetAuthUser);

function mockSenderApproval(isApproved: boolean) {
  mockedUseQuery.mockReturnValue({
    data: {
      approvalStatus: isApproved ? "approved" : "not_requested",
      isApproved,
      canRequest: !isApproved,
      requestedAt: null,
      approvedAt: isApproved ? "2026-06-05T00:00:00.000Z" : null,
    },
    isLoading: false,
  } as unknown as ReturnType<typeof useQuery>);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockedUseGetAuthUser.mockReturnValue({
    data: {
      id: "user-1",
      name: "송진호",
      branchName: "인천점",
    },
  } as unknown as ReturnType<typeof useGetAuthUser>);
});

describe("MessageTenantApplicationSettings", () => {
  it("keeps the settings section content but hides the sender application item after approval", () => {
    mockSenderApproval(true);

    const { container } = render(<MessageTenantApplicationSettings />);

    expect(screen.getAllByText("설정").length).toBeGreaterThan(0);
    expect(screen.queryByText("메시지 발송 기능 신청")).not.toBeInTheDocument();
    expect(container.querySelector('[data-component="messages-settings-layout"]')).toBeInTheDocument();
    expect(container.querySelector('[data-component="messages-settings-tenant-application"]')).not.toBeInTheDocument();
  });

  it("shows the sender application item before approval", () => {
    mockSenderApproval(false);

    const { container } = render(<MessageTenantApplicationSettings />);

    expect(screen.getAllByText("메시지 발송 기능 신청").length).toBeGreaterThan(0);
    expect(container.querySelector('[data-component="messages-settings-tenant-application"]')).toBeInTheDocument();
  });
});
