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

  it("connects when the shell has an authenticated user", () => {
    mockUseInitialUser.mockReturnValue({ id: 1 } as unknown as ReturnType<typeof useInitialUser>);

    const { container } = render(<RealtimeInvalidation />);

    expect(mockUseRealtimeInvalidation).toHaveBeenCalledWith(true);
    expect(container).toBeEmptyDOMElement();
  });

  it("does not connect while logged out", () => {
    mockUseInitialUser.mockReturnValue(null);

    render(<RealtimeInvalidation />);

    expect(mockUseRealtimeInvalidation).toHaveBeenCalledWith(false);
  });
});
