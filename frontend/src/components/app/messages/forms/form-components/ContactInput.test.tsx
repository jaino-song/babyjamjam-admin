import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { ContactInput } from "./ContactInput";

function ControlledContactInput({ initialPhone = "", required = false }: { initialPhone?: string; required?: boolean }) {
  const [phone, setPhone] = useState(initialPhone);

  return (
    <>
      <ContactInput
        phone={phone}
        setPhone={setPhone}
        label="전화번호"
        placeholder="010-1234-5678"
        required={required}
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

  it("shows the rejected-keystroke error in the label row, never below the input", () => {
    render(<ControlledContactInput />);
    const input = screen.getByLabelText("전화번호");

    fireEvent.change(input, { target: { value: "abc" } });

    const error = screen.getByText("숫자만 입력할 수 있습니다");
    expect(error.compareDocumentPosition(input)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(error).toHaveAttribute("aria-live", "polite");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", error.id);

    fireEvent.change(input, { target: { value: "010" } });

    expect(screen.queryByText("숫자만 입력할 수 있습니다")).not.toBeInTheDocument();
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

  describe("inline messages", () => {
    const MESSAGE_SELECTOR = '[data-slot="field-message"], [data-slot="field-error-message"]';

    it("shows nothing on first render", () => {
      const { container } = render(<ControlledContactInput required />);

      expect(container.querySelectorAll(MESSAGE_SELECTOR)).toHaveLength(0);
      expect(screen.getByLabelText(/전화번호/)).not.toHaveAttribute("aria-invalid");
    });

    it("hints the format while focused and reports a partial number once the field is left", () => {
      render(<ControlledContactInput required />);
      const input = screen.getByLabelText(/전화번호/);

      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: "0101234" } });
      expect(screen.getByText("010-1234-5678 형식")).toBeInTheDocument();
      expect(input).not.toHaveAttribute("aria-invalid");

      fireEvent.blur(input);

      const error = screen.getByText("010-1234-5678로 입력해 주세요");
      expect(error.compareDocumentPosition(input)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
      expect(input).toHaveAttribute("aria-invalid", "true");
      expect(input).toHaveAttribute("aria-describedby", error.id);
    });

    it("reports a required field only after a value was cleared", () => {
      render(<ControlledContactInput required />);
      const input = screen.getByLabelText(/전화번호/);

      fireEvent.focus(input);
      fireEvent.blur(input);
      expect(screen.queryByText("전화번호를 입력해 주세요")).not.toBeInTheDocument();

      fireEvent.change(input, { target: { value: "010" } });
      fireEvent.change(input, { target: { value: "" } });

      expect(screen.getByText("전화번호를 입력해 주세요")).toBeInTheDocument();
    });

    it("forgets the old value when the parent clears the phone, but still reports a user-typed clear", () => {
      function ClearableContactInput() {
        const [phone, setPhone] = useState("");
        return (
          <>
            <ContactInput phone={phone} setPhone={setPhone} label="전화번호" placeholder="010-1234-5678" required />
            <button type="button" onClick={() => setPhone("")}>
              parent clear
            </button>
          </>
        );
      }
      render(<ClearableContactInput />);
      const input = screen.getByLabelText(/전화번호/);

      fireEvent.focus(input);
      fireEvent.change(input, { target: { value: "01012345678" } });
      fireEvent.blur(input);
      expect(input).toHaveValue("010-1234-5678");

      fireEvent.click(screen.getByRole("button", { name: "parent clear" }));

      expect(input).toHaveValue("");
      expect(screen.queryByText("전화번호를 입력해 주세요")).not.toBeInTheDocument();
      expect(input).not.toHaveAttribute("aria-invalid");

      fireEvent.change(input, { target: { value: "010" } });
      fireEvent.change(input, { target: { value: "" } });

      expect(screen.getByText("전화번호를 입력해 주세요")).toBeInTheDocument();
    });

    it("reports a required empty field once the form was submitted", () => {
      const { rerender } = render(
        <ContactInput phone="" setPhone={jest.fn()} label="전화번호" placeholder="010-1234-5678" required />,
      );
      expect(screen.queryByText("전화번호를 입력해 주세요")).not.toBeInTheDocument();

      rerender(
        <ContactInput phone="" setPhone={jest.fn()} label="전화번호" placeholder="010-1234-5678" required submitted />,
      );

      expect(screen.getByText("전화번호를 입력해 주세요")).toBeInTheDocument();
    });

    it("does not report an empty optional field after submit", () => {
      render(<ContactInput phone="" setPhone={jest.fn()} label="전화번호" placeholder="010-1234-5678" submitted />);

      expect(screen.queryByText("전화번호를 입력해 주세요")).not.toBeInTheDocument();
    });

    it("ranks an external error above the format hint and the format hint above trailing info", () => {
      const { rerender } = render(
        <ContactInput
          phone="010-12"
          setPhone={jest.fn()}
          label="전화번호"
          placeholder="010-1234-5678"
          labelTrailing={<span id="info">등록된 번호와 달라요</span>}
          labelTrailingId="info"
          externalMessage={{ tone: "error", text: "이미 등록된 번호예요" }}
        />,
      );
      const input = screen.getByLabelText("전화번호");
      expect(screen.getByText("이미 등록된 번호예요")).toBeInTheDocument();
      expect(screen.queryByText("010-1234-5678 형식")).not.toBeInTheDocument();
      expect(screen.queryByText("등록된 번호와 달라요")).not.toBeInTheDocument();

      rerender(
        <ContactInput
          phone="010-12"
          setPhone={jest.fn()}
          label="전화번호"
          placeholder="010-1234-5678"
          labelTrailing={<span id="info">등록된 번호와 달라요</span>}
          labelTrailingId="info"
        />,
      );
      expect(screen.getByText("010-1234-5678 형식")).toBeInTheDocument();
      expect(screen.queryByText("등록된 번호와 달라요")).not.toBeInTheDocument();

      rerender(
        <ContactInput
          phone="010-1234-5678"
          setPhone={jest.fn()}
          label="전화번호"
          placeholder="010-1234-5678"
          labelTrailing={<span id="info">등록된 번호와 달라요</span>}
          labelTrailingId="info"
        />,
      );
      expect(screen.getByText("등록된 번호와 달라요")).toBeInTheDocument();
      expect(input).toHaveAttribute("aria-describedby", "info");
    });

    it("shows an external hint when the field has nothing of its own to say", () => {
      render(
        <ContactInput
          phone=""
          setPhone={jest.fn()}
          label="전화번호"
          placeholder="010-1234-5678"
          externalMessage={{ tone: "hint", text: "기존 고객 번호예요" }}
        />,
      );

      expect(screen.getByText("기존 고객 번호예요")).toBeInTheDocument();
      expect(screen.getByLabelText("전화번호")).not.toHaveAttribute("aria-invalid");
    });

    it("keeps a disabled field free of messages", () => {
      const { container } = render(
        <ContactInput phone="010-12" setPhone={jest.fn()} label="전화번호" placeholder="010" disabled required submitted />,
      );

      expect(container.querySelectorAll(MESSAGE_SELECTOR)).toHaveLength(0);
    });
  });
});
