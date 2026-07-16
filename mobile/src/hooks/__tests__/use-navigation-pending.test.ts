import { act, renderHook } from "@testing-library/react";

import { useNavigationPending } from "../use-navigation-pending";

describe("useNavigationPending", () => {
  it("should remain pending after navigation starts", () => {
    const { result } = renderHook(() => useNavigationPending());

    expect(result.current.isNavigationPending).toBe(false);

    act(() => result.current.startNavigation());

    expect(result.current.isNavigationPending).toBe(true);
  });
});
