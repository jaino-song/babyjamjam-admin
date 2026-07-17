import { act, renderHook } from "@testing-library/react";

import { useNavigationPending } from "./use-navigation-pending";

describe("useNavigationPending", () => {
  it("should remain pending after navigation starts when the async action settles", () => {
    const { result, rerender } = renderHook(
      ({ isActionPending }) => useNavigationPending(isActionPending),
      { initialProps: { isActionPending: true } },
    );

    act(() => result.current.beginNavigation());
    rerender({ isActionPending: false });

    expect(result.current.isPending).toBe(true);
  });

  it("should recover when the async action settles without navigation", () => {
    const { result, rerender } = renderHook(
      ({ isActionPending }) => useNavigationPending(isActionPending),
      { initialProps: { isActionPending: true } },
    );

    rerender({ isActionPending: false });

    expect(result.current.isPending).toBe(false);
  });
});
