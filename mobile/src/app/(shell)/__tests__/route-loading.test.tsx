import { render, screen } from "@testing-library/react";

import CallbackPage from "../(auth)/callback/page";
import HolidaysPage from "../holidays/page";
import LogoutPage from "../logout/page";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
  useSearchParams: () => new URLSearchParams("code=pending"),
}));
jest.mock("../(auth)/callback/actions", () => ({ exchangeToken: jest.fn(() => new Promise(() => {})) }));
jest.mock("../logout/actions", () => ({ logout: jest.fn(() => new Promise(() => {})) }));
jest.mock("@/lib/auth/authority-state", () => ({ resetAuthorityState: jest.fn(() => new Promise(() => {})) }));
jest.mock("@/lib/notifications/push-endpoint", () => ({ getCurrentPushEndpoint: jest.fn(() => new Promise(() => {})) }));
jest.mock("@/hooks/useGetAuthUser", () => ({ useGetAuthUser: () => ({ isPending: true }) }));
jest.mock("@/components/app/holidays/HolidaySettingsSection", () => ({ HolidaySettingsSection: () => null }));

it.each([
  [CallbackPage, "로그인 중"],
  [LogoutPage, "로그아웃 중"],
  [HolidaysPage, "권한 확인 중"],
] as const)("renders %p loading as a named status with screen-reader-only copy", (Page, label) => {
  render(<Page />);
  const status = screen.getByRole("status", { name: label });
  expect(status).toHaveAttribute("data-source-component", "LoadingState");
  expect(status.querySelector('[data-slot="spinner"]')).not.toBeNull();
  expect(screen.getByText(label)).toHaveClass("sr-only");
});
