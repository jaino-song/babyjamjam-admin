import { act, render, screen } from "@testing-library/react";

import { OfflineNotice } from "../OfflineNotice";

const originalOnline = Object.getOwnPropertyDescriptor(window.navigator, "onLine");

function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, value: online });
  act(() => {
    window.dispatchEvent(new Event(online ? "online" : "offline"));
  });
}

afterEach(() => {
  if (originalOnline) Object.defineProperty(window.navigator, "onLine", originalOnline);
  else Reflect.deleteProperty(window.navigator, "onLine");
});

it("shows an initial offline state and hides after reconnecting", () => {
  setOnline(false);
  render(<OfflineNotice data-component="mobile_shell_offline-notice" />);
  expect(screen.getByRole("status")).toHaveTextContent("오프라인 상태입니다. 연결되면 자동으로 다시 불러옵니다.");
  expect(screen.getByRole("status")).toHaveAttribute("data-component", "mobile_shell_offline-notice");
  setOnline(true);
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
});

it("reacts to going offline and cleans up its listeners", () => {
  setOnline(true);
  const removeListener = jest.spyOn(window, "removeEventListener");
  const { unmount } = render(<OfflineNotice data-component="mobile_shell_offline-notice" />);
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  setOnline(false);
  expect(screen.getByRole("status")).toBeInTheDocument();
  unmount();
  expect(removeListener).toHaveBeenCalledWith("online", expect.any(Function));
  expect(removeListener).toHaveBeenCalledWith("offline", expect.any(Function));
  removeListener.mockRestore();
});
