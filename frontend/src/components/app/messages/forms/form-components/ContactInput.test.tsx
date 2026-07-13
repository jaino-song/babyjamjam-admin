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
});
