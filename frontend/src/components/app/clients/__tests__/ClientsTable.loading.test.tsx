import { render, screen, within } from "@testing-library/react";
import { ClientsTable } from "../ClientsTable";
import { t } from "@/lib/i18n/translations";

const mockClients = jest.fn();
const mockSearchParams = new URLSearchParams();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: jest.fn() }), useSearchParams: () => mockSearchParams,
}));
jest.mock("@/providers/LocaleProvider", () => ({ useLocale: () => "ko" }));
jest.mock("@/hooks/useClients", () => ({
  useClients: () => mockClients(),
  useClient: () => ({}),
  useDeleteClient: () => ({ isPending: false }),
}));
jest.mock("../ClientFormDialog", () => ({ ClientFormDialog: () => null }));
jest.mock("../ClientDetailModal", () => ({ ClientDetailModal: () => null }));

it("shows a named spinner with screen-reader-only copy until the client list settles", () => {
  mockClients.mockReturnValue({ isLoading: true });
  const { rerender } = render(<ClientsTable />);
  const status = screen.getByRole("status", { name: "고객 목록을 불러오는 중" });
  expect(status).toHaveAttribute("data-component", "desktop_clients_table_body_loading");
  expect(status).toHaveAttribute("data-slot", "loading-state");
  expect(status).toHaveAttribute("data-source-component", "LoadingState");
  expect(status.querySelector('[data-slot="spinner"]')).toHaveAttribute("aria-hidden", "true");
  expect(within(status).getByText("고객 목록을 불러오는 중")).toHaveClass("sr-only");
  expect(screen.queryByText("Loading...")).not.toBeInTheDocument();

  mockClients.mockReturnValue({ isLoading: false, data: { data: [], total: 0, totalPages: 0 } });
  rerender(<ClientsTable />);
  expect(screen.queryByRole("status", { name: "고객 목록을 불러오는 중" })).not.toBeInTheDocument();
  expect(screen.getByText(t("ko", "clients.no-data"))).toBeInTheDocument();
});
