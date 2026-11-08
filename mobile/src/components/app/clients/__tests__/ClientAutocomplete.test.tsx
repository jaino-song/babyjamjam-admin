import { fireEvent, render, screen } from "@testing-library/react";

import { LocaleProvider } from "@/providers/LocaleProvider";
import { ClientAutocomplete } from "../ClientAutocomplete";

const mockRefetch = jest.fn();
let mockQuery: {
  data?: Array<{ id: number; name: string; phone: string; address: string; hasSigned: boolean }>;
  isLoading?: boolean;
  isError?: boolean;
  error?: unknown;
  isFetching?: boolean;
} = {};

jest.mock("@/hooks/useClients", () => ({
  useAllClients: () => ({
    ...mockQuery,
    refetch: mockRefetch,
  }),
}));

const client = {
  id: 1,
  name: "홍길동",
  phone: "010-1234-5678",
  address: "인천",
  hasSigned: false,
};

function renderAutocomplete(props: Partial<React.ComponentProps<typeof ClientAutocomplete>> = {}) {
  return render(
    <LocaleProvider locale="ko">
      <ClientAutocomplete
        data-component="test-client-autocomplete"
        value={null}
        onChange={jest.fn()}
        label="고객"
        {...props}
      />
    </LocaleProvider>,
  );
}

describe("ClientAutocomplete query states", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery = { data: [client], isLoading: false, isError: false };
  });

  it.each([undefined, true])("does not render the selection control after an initial client read failure (hide empty: %s)", (hideEmptyDropdown) => {
    mockQuery = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error("server detail must not be shown"),
    };

    renderAutocomplete({ hideEmptyDropdown });

    expect(screen.getByText("고객 목록을 불러오지 못했어요")).toBeInTheDocument();
    expect(screen.queryByTestId("test-client-autocomplete")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(mockRefetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("server detail must not be shown")).not.toBeInTheDocument();
  });

  it.each([undefined, true])("retains stale clients and shows a retry warning after a refresh failure (hide empty: %s)", (hideEmptyDropdown) => {
    mockQuery = {
      data: [client],
      isLoading: false,
      isError: true,
      error: new Error("server detail must not be shown"),
    };

    renderAutocomplete({ hideEmptyDropdown });

    expect(screen.getByTestId("test-client-autocomplete")).toBeInTheDocument();
    expect(screen.getByText("고객 목록을 새로 불러오지 못했어요")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("textbox"));
    expect(screen.getByText("홍길동")).toBeInTheDocument();
  });

  it("hides an opted-in empty result and restores selectable matching clients", () => {
    const onChange = jest.fn();
    const { container } = renderAutocomplete({ hideEmptyDropdown: true, onChange });
    const input = screen.getByLabelText("고객");
    fireEvent.change(input, { target: { value: "없는 이름" } });

    expect(screen.queryByTestId("test-client-autocomplete_dropdown")).not.toBeInTheDocument();
    expect(container.querySelector('[data-component="test-client-autocomplete_empty"]')).not.toBeInTheDocument();
    expect(input).toHaveAttribute("data-state", "closed");
    expect(input).toHaveValue("없는 이름");

    fireEvent.change(input, { target: { value: "홍" } });
    expect(screen.getByTestId("test-client-autocomplete_dropdown")).toBeVisible();
    fireEvent.click(screen.getByText("홍길동"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(client.id, client);
  });

  it("keeps the default empty result message visible", () => {
    const { container } = renderAutocomplete();
    fireEvent.change(screen.getByLabelText("고객"), { target: { value: "없는 이름" } });

    expect(screen.getByTestId("test-client-autocomplete_dropdown")).toBeVisible();
    expect(container.querySelector('[data-component="test-client-autocomplete_empty"]')).toBeVisible();
  });
});
