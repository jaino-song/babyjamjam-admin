import { fireEvent, render, screen, within } from "@testing-library/react";

import type { Client } from "@/lib/client/types";

import { ClientAutocomplete } from "./ClientAutocomplete";

const clients: Client[] = [
  {
    id: 7,
    name: "박서연",
    phone: "01077778888",
    address: "인천 연수구",
    hasSigned: true,
    eDocId: "document-1",
    documentStatus: "requested",
  } as Client,
  {
    id: 8,
    name: "김하나",
    phone: "01011112222",
    address: "인천 남동구",
    hasSigned: false,
  } as Client,
];

jest.mock("@/hooks/useClients", () => ({
  useAllClients: () => ({ data: clients, isLoading: false }),
}));

jest.mock("@/providers/LocaleProvider", () => ({
  useLocale: () => "ko",
}));

jest.mock("@/lib/i18n/translations", () => ({
  t: (_locale: string, key: string) =>
    key === "contract-msg.client-signed" ? "서명 완료" : key,
}));

jest.mock("@/stores/client-dialog-store", () => ({
  useClientDialogStore: (selector: (state: { setPrefillName: jest.Mock }) => unknown) =>
    selector({ setPrefillName: jest.fn() }),
}));

function renderAutocomplete() {
  return render(
    <ClientAutocomplete
      data-component="mobile_messages_recipient_search"
      value={null}
      onChange={() => undefined}
      label="산모님"
    />,
  );
}

describe("ClientAutocomplete shared search", () => {
  it.each([
    ["+82 10 7777", "박서연"],
    ["010-7777", "박서연"],
    ["ㅂㅅㅇ", "박서연"],
    ["연수구", "박서연"],
  ])("matches %s through the shared multi-field search", (query, expectedName) => {
    renderAutocomplete();

    const input = within(screen.getByTestId("mobile_messages_recipient_search")).getByRole("textbox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: query } });

    const dropdown = screen.getByTestId("mobile_messages_recipient_search_dropdown");
    expect(within(dropdown).getByText(expectedName)).toBeInTheDocument();
  });

  it("shows the signed status as 서명 완료 in search results", () => {
    renderAutocomplete();

    const input = within(screen.getByTestId("mobile_messages_recipient_search")).getByRole("textbox");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "박서연" } });

    const dropdown = screen.getByTestId("mobile_messages_recipient_search_dropdown");
    expect(within(dropdown).getByText("서명 완료")).toBeInTheDocument();
    expect(within(dropdown).queryByText("계약완료")).not.toBeInTheDocument();
  });
});
