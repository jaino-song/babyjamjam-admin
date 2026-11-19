import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import DashboardPage from "./page";

const mockSearchParams = new URLSearchParams("clientId=1");
jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: jest.fn() }),
  useSearchParams: () => mockSearchParams,
  redirect: jest.fn(),
}));
jest.mock("@/hooks/useDashboardStats", () => ({
  useDashboardOverview: () => ({
    data: {
      stats: { activeClients: 1, contractsNotSent: 0, contractsPendingSignature: 0, upcomingThisMonth: 0, upcomingNextMonth: 0 },
      clients: { data: [{ id: 1, name: "QA-고객", serviceStatus: "active" }], total: 1, page: 1, limit: 50, totalPages: 1 },
    },
    isError: false, isLoading: false, isFetching: false,
  }),
}));
jest.mock("@/providers/UserProvider", () => ({ useInitialUser: () => ({ id: "qa" }) }));
jest.mock("@/hooks/useBusinessDayCalendar", () => ({ useBusinessDayCalendar: () => ({}) }));
jest.mock("@/components/app/clients/ClientDetailPanel", () => ({
  ClientDetailPanel: ({ trailing }: { trailing: ReactNode }) => <>{trailing}</>,
}));

it("uses the shared 32px icon button with a 44px hit area for the customer menu", async () => {
  render(<DashboardPage />);
  const trigger = screen.getByRole("button", { name: "고객 상세 메뉴" });
  expect(trigger).toHaveAttribute("data-size", "icon");
  expect(trigger).toHaveClass(
    "h-[calc(32px*var(--glint-ui-scale,1))]",
    "w-[calc(32px*var(--glint-ui-scale,1))]",
    "relative", "after:absolute",
    "after:h-[calc(44px*var(--glint-ui-scale,1))]",
    "after:w-[calc(44px*var(--glint-ui-scale,1))]",
  );
  expect(trigger).not.toHaveClass("h-9");
  expect(trigger).not.toHaveClass("w-9");
  expect(trigger.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  expect(trigger.querySelector("svg")).toHaveClass("w-5", "h-5");
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  expect(await screen.findByRole("menuitem", { name: "고객 상세 보기" })).toHaveAttribute("href", "/clients?id=1");
});
