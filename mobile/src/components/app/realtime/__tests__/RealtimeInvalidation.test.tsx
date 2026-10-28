import { render } from "@testing-library/react";

import { useRealtimeInvalidation } from "@/hooks/useRealtimeInvalidation";
import { useInitialUser } from "@/providers/UserProvider";

import { RealtimeInvalidation } from "../RealtimeInvalidation";

jest.mock("@/hooks/useRealtimeInvalidation", () => ({
  useRealtimeInvalidation: jest.fn(),
}));
jest.mock("@/providers/UserProvider", () => ({
  useInitialUser: jest.fn(),
}));

const mockUseRealtimeInvalidation = jest.mocked(useRealtimeInvalidation);
const mockUseInitialUser = jest.mocked(useInitialUser);

describe("RealtimeInvalidation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("subscribes under the user and branch identity when the shell has an authenticated user", () => {
    mockUseInitialUser.mockReturnValue({ id: "7", branchId: "3" } as unknown as ReturnType<typeof useInitialUser>);

    const { container } = render(<RealtimeInvalidation />);

    expect(mockUseRealtimeInvalidation).toHaveBeenCalledWith("7:3");
    expect(container).toBeEmptyDOMElement();
  });

  it("changes the subscription identity when the branch changes", () => {
    mockUseInitialUser.mockReturnValue({ id: "7", branchId: "3" } as unknown as ReturnType<typeof useInitialUser>);
    const { rerender } = render(<RealtimeInvalidation />);

    mockUseInitialUser.mockReturnValue({ id: "7", branchId: "4" } as unknown as ReturnType<typeof useInitialUser>);
    rerender(<RealtimeInvalidation />);

    expect(mockUseRealtimeInvalidation).toHaveBeenLastCalledWith("7:4");
  });

  it("does not connect while logged out", () => {
    mockUseInitialUser.mockReturnValue(null);

    render(<RealtimeInvalidation />);

    expect(mockUseRealtimeInvalidation).toHaveBeenCalledWith(null);
  });
});
