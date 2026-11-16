import { render, screen } from "@testing-library/react";

import { VoucherPriceTable } from "./VoucherPriceTable";

jest.mock("@/hooks", () => ({
  useVoucherYears: () => ({ data: [2026], isPending: false, isError: false }),
  useAllVoucherPriceInfos: () => ({ data: [], isPending: false, isError: false }),
}));
jest.mock("./VoucherPriceUploadForm", () => ({ VoucherPriceUploadForm: () => null }));

describe("VoucherPriceTable year select", () => {
  it("uses the prices-specific width and spacing on its year trigger", () => {
    render(<VoucherPriceTable />);

    const trigger = screen.getByRole("combobox", { name: "연도" });
    expect(trigger).toHaveAttribute("id", "price-table-year");
    expect(trigger).toHaveClass("px-3", "w-auto", "min-w-[5.75rem]", "gap-2");
    expect(trigger).not.toHaveClass("px-1.5");
    expect(trigger).not.toHaveClass("w-[4.75rem]");
  });
});
