import { fireEvent, render, screen } from "@testing-library/react";

import { ClientAutocomplete } from "../ClientAutocomplete";
import { EmployeeAutocomplete } from "../EmployeeAutocomplete";

let mockLoading = false;

jest.mock("@/hooks/useClients", () => ({
  useAllClients: () => ({ data: [], isLoading: mockLoading }),
}));
jest.mock("@/hooks/useEmployees", () => ({
  useEmployees: () => ({ data: [], isLoading: mockLoading, refetch: jest.fn() }),
}));
jest.mock("@/stores/client-dialog-store", () => ({
  useClientDialogStore: () => jest.fn(),
}));
jest.mock("@/stores/employee-dialog-store", () => ({
  useEmployeeDialogStore: () => jest.fn(),
}));
jest.mock("../ClientFormDialog", () => ({ ClientFormDialog: () => null }));
jest.mock("@/components/app/employees/EmployeeFormDialog", () => ({ EmployeeFormDialog: () => null }));

beforeAll(() => {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  HTMLElement.prototype.scrollIntoView = jest.fn();
});

describe.each([
  ["고객", ClientAutocomplete],
  ["제공인력", EmployeeAutocomplete],
] as const)("%s autocomplete loading and icon actions", (label, Autocomplete) => {
  it("labels both spinners and removes the loading status after data arrives", () => {
    mockLoading = true;
    const props = { value: null, onChange: jest.fn(), label };
    const { rerender } = render(<Autocomplete {...props} />);
    const loadingLabel = `${label} 목록을 불러오는 중`;
    expect(screen.getByRole("status", { name: loadingLabel }).querySelector(".sr-only")).toHaveTextContent(loadingLabel);
    fireEvent.click(screen.getByRole("combobox", { name: label }));
    const statuses = screen.getAllByRole("status", { name: loadingLabel });
    expect(statuses).toHaveLength(2);
    for (const status of statuses) {
      expect(status.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
      expect(status.querySelector(".sr-only")).toHaveTextContent(loadingLabel);
    }
    mockLoading = false;
    rerender(<Autocomplete {...props} />);
    expect(screen.queryByRole("status", { name: loadingLabel })).not.toBeInTheDocument();
  });

  it("uses the 32/44 icon size while preserving the small manual-entry icon", () => {
    mockLoading = false;
    render(label === "고객"
      ? <ClientAutocomplete value={null} onChange={jest.fn()} label={label} onManualValueChange={jest.fn()} />
      : <EmployeeAutocomplete value={null} onChange={jest.fn()} label={label} allowManualInput />);
    fireEvent.click(screen.getByRole("combobox", { name: label }));
    const play = screen.getByRole("button", { name: "수동 입력으로 진행" });
    expect(play).toHaveAttribute("data-size", "icon");
    expect(play).toHaveClass("h-[calc(32px*var(--glint-ui-scale,1))]", "after:h-[calc(44px*var(--glint-ui-scale,1))]", "[&_svg]:size-3.5");
    expect(play).toBeDisabled();
  });
});
