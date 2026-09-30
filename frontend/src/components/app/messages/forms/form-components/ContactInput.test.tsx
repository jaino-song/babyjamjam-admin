import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { ContactInput } from "./ContactInput";

function ControlledContactInput({ initialPhone = "" }: { initialPhone?: string }) {
  const [phone, setPhone] = useState(initialPhone);

  return (
    <>
      <ContactInput
        phone={phone}
        setPhone={setPhone}
        label="전화번호"
        placeholder="010-1234-5678"
      />
      <output data-testid="phone-state">{phone}</output>
    </>
  );
}

describe("ContactInput", () => {
  it("formats typed mobile phone digits with hyphens", () => {
    render(<ControlledContactInput />);

    fireEvent.change(screen.getByLabelText("전화번호"), {
      target: { value: "01096411878" },
    });

    expect(screen.getByLabelText("전화번호")).toHaveValue("010-9641-1878");
    expect(screen.getByTestId("phone-state")).toHaveTextContent("010-9641-1878");
  });

  it("normalizes an incoming unformatted phone value", async () => {
    render(<ControlledContactInput initialPhone="01096411878" />);

    expect(screen.getByLabelText("전화번호")).toHaveValue("010-9641-1878");
    await waitFor(() => {
      expect(screen.getByTestId("phone-state")).toHaveTextContent("010-9641-1878");
    });
  });

  it("keeps the format error below the input by default", () => {
    render(<ControlledContactInput />);
    const input = screen.getByLabelText("전화번호");

    fireEvent.change(input, { target: { value: "abc" } });

    const error = screen.getByText("숫자만 입력할 수 있습니다");
    expect(error.compareDocumentPosition(input)).toBe(Node.DOCUMENT_POSITION_PRECEDING);
    expect(input).not.toHaveAttribute("aria-invalid");
    expect(input).toHaveAttribute("aria-describedby", error.id);
  });

  it("can show the format error in the label row in place of the trailing hint", () => {
    render(
      <ContactInput
        phone=""
        setPhone={jest.fn()}
        label="전화번호"
        placeholder="010-1234-5678"
        labelTrailing={<span id="hint">hint</span>}
        labelTrailingId="hint"
        errorPlacement="label-row"
      />,
    );
    const input = screen.getByLabelText("전화번호");
    expect(input).toHaveAttribute("aria-describedby", "hint");

    fireEvent.change(input, { target: { value: "abc" } });

    const error = screen.getByText("숫자만 입력할 수 있습니다");
    expect(error.compareDocumentPosition(input)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.queryByText("hint")).not.toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", error.id);
  });
});
