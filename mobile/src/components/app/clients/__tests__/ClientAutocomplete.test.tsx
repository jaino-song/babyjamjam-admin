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

function renderAutocomplete() {
  return render(
    <LocaleProvider locale="ko">
      <ClientAutocomplete
        data-component="test-client-autocomplete"
        value={null}
        onChange={jest.fn()}
        label="고객"
      />
    </LocaleProvider>,
  );
}

describe("ClientAutocomplete query states", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery = { data: [client], isLoading: false, isError: false };
  });

  it("does not render the selection control after an initial client read failure", () => {
    mockQuery = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error("server detail must not be shown"),
    };

    renderAutocomplete();

    expect(screen.getByText("고객 목록을 불러오지 못했어요")).toBeInTheDocument();
    expect(screen.queryByTestId("test-client-autocomplete")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(mockRefetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("server detail must not be shown")).not.toBeInTheDocument();
  });

  it("retains stale clients and shows a retry warning after a refresh failure", () => {
    mockQuery = {
      data: [client],
      isLoading: false,
      isError: true,
      error: new Error("server detail must not be shown"),
    };

    renderAutocomplete();

    expect(screen.getByTestId("test-client-autocomplete")).toBeInTheDocument();
    expect(screen.getByText("고객 목록을 새로 불러오지 못했어요")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("textbox"));
    expect(screen.getByText("홍길동")).toBeInTheDocument();
  });
});
