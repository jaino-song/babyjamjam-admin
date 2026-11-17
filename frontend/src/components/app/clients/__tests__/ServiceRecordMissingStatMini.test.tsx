import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ServiceRecordMissingStatMini } from "../ServiceRecordMissingStatMini";
import type { ServiceRecordMissingClients } from "@/features/clients/types/service-record-missing";

let mockData: ServiceRecordMissingClients | undefined;
let mockError: Error | null;
const mockRefetch = jest.fn();
jest.mock("@/features/clients/hooks/use-clients", () => ({
  useServiceRecordMissingClients: () => ({ data: mockData, error: mockError, refetch: mockRefetch }),
}));

const items = [
  { clientId: 42, clientName: "두번째 고객", primaryEmployeeName: "김관리", unwrittenThroughSessionIndex: 3 },
  { clientId: 21, clientName: "첫번째 고객", primaryEmployeeName: "박관리", unwrittenThroughSessionIndex: 2 },
];
const trigger = () => screen.getByLabelText("제공기록지 미작성 고객 보기");
const row = () => screen.getByRole("button", { name: "두번째 고객 제공기록지 보기" });

beforeEach(() => {
  mockData = { count: 2, items };
  mockError = null;
  mockRefetch.mockReset();
});

it.each(["pending", "error", "zero"])("hides the card for %s and shows it when data arrives", state => {
  mockData = state === "zero" ? { count: 0, items: [] } : undefined;
  mockError = state === "error" ? new Error("failed") : null;
  const { rerender } = render(<ServiceRecordMissingStatMini name="clients" onSelectClient={() => true} />);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
  mockData = { count: 2, items };
  mockError = null;
  rerender(<ServiceRecordMissingStatMini name="clients" onSelectClient={() => true} />);
  expect(trigger()).toHaveTextContent("2명기록지 미작성");
});

it("opens the named modal, preserves order and exact copy, collapses and expands", () => {
  render(<ServiceRecordMissingStatMini name="clients" onSelectClient={() => true} />);
  expect(trigger()).toHaveAttribute("aria-haspopup", "dialog");
  fireEvent.click(trigger());
  const dialog = screen.getByRole("dialog", { name: "제공기록지 미작성" });
  expect(trigger()).toHaveAttribute("aria-expanded", "true");
  const toggle = within(dialog).getByRole("button", { name: "미작성 중인 서비스 2명" });
  expect(toggle).toHaveTextContent("미작성 중인 서비스2명");
  const rows = within(dialog).getAllByRole("button", { name: /고객 제공기록지 보기/ });
  expect(rows.map(el => el.getAttribute("aria-label"))).toEqual(items.map(item => `${item.clientName} 제공기록지 보기`));
  expect(rows[0]).toHaveTextContent("김관리 관리사 · 3회차 미작성");
  expect(rows[1]).toHaveTextContent("박관리 관리사 · 2회차 미작성");
  expect(within(dialog).getAllByText("미작성")).toHaveLength(2);
  expect(dialog.querySelector("section > p, section > h3 + p")).toBeNull();
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(within(dialog).queryByRole("button", { name: /두번째 고객 제공기록지 보기/ })).not.toBeInTheDocument();
  fireEvent.click(toggle);
  expect(row()).toBeInTheDocument();
});

it.each(["Escape", "close"])("closes with %s", async method => {
  render(<ServiceRecordMissingStatMini name="clients" onSelectClient={() => true} />);
  fireEvent.click(trigger());
  if (method === "Escape") fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape", code: "Escape" });
  else fireEvent.click(screen.getByRole("button", { name: "제공기록지 미작성 닫기" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(trigger()).toHaveAttribute("aria-expanded", "false");
});

it.each([true, false])("closes only when selection accepts the client: %s", accepted => {
  const onSelectClient = jest.fn(() => accepted);
  render(<ServiceRecordMissingStatMini name="clients" onSelectClient={onSelectClient} />);
  fireEvent.click(trigger());
  fireEvent.click(row());
  expect(onSelectClient).toHaveBeenCalledWith(42);
  expect(Boolean(screen.queryByRole("dialog"))).toBe(!accepted);
});

it.each([0, 2])("closes on a data reset and stays closed when new data has count %s", count => {
  const { rerender } = render(<ServiceRecordMissingStatMini name="clients" onSelectClient={() => true} />);
  fireEvent.click(trigger());
  expect(screen.getByRole("dialog", { name: "제공기록지 미작성" })).toBeInTheDocument();

  mockData = undefined;
  rerender(<ServiceRecordMissingStatMini name="clients" onSelectClient={() => true} />);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();

  mockData = { count, items: count === 0 ? [] : items };
  rerender(<ServiceRecordMissingStatMini name="clients" onSelectClient={() => true} />);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  if (count === 0) expect(screen.queryByRole("button")).not.toBeInTheDocument();
  else expect(trigger()).toHaveAttribute("aria-expanded", "false");
});

it("keeps the mounted trigger and modal on refetch error, shows retry, and recovers", () => {
  const { rerender } = render(<ServiceRecordMissingStatMini name="clients" onSelectClient={() => true} />);
  const card = trigger();
  fireEvent.click(card);
  mockError = new Error("refetch failed");
  rerender(<ServiceRecordMissingStatMini name="clients" onSelectClient={() => true} />);
  expect(trigger()).toBe(card);
  expect(trigger()).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("dialog", { name: "제공기록지 미작성" })).toBeInTheDocument();
  expect(screen.getByRole("alert")).toHaveTextContent("제공기록지 미작성 고객을 불러오지 못했습니다.");
  expect(screen.queryByText("미작성 중인 서비스가 없습니다.")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  expect(mockRefetch).toHaveBeenCalledTimes(1);
  mockError = null;
  rerender(<ServiceRecordMissingStatMini name="clients" onSelectClient={() => true} />);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(row()).toBeInTheDocument();
});

it("keeps an open modal and trigger at zero, then hides after closing", () => {
  const { rerender } = render(<ServiceRecordMissingStatMini name="clients" onSelectClient={() => true} />);
  const card = trigger();
  fireEvent.click(card);
  mockData = { count: 0, items: [] };
  rerender(<ServiceRecordMissingStatMini name="clients" onSelectClient={() => true} />);
  expect(trigger()).toBe(card);
  expect(trigger()).toHaveTextContent("0명");
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "미작성 중인 서비스 0명" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "제공기록지 미작성 닫기" }));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});
