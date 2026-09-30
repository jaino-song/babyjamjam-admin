import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { authApi } from "@/services/api";

import RegisterPage from "./page";

const mockPush = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

jest.mock("@/services/api", () => ({
  authApi: {
    checkEmailExists: jest.fn(),
    register: jest.fn(),
  },
}));

const mockCheckEmailExists = jest.mocked(authApi.checkEmailExists);

describe("RegisterPage", () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockCheckEmailExists.mockReset();
    mockCheckEmailExists.mockResolvedValue({ exists: false, linkable: false });
  });

  it("advances to the profile step when the account fields are valid", async () => {
    const user = userEvent.setup();

    render(<RegisterPage />);

    await user.type(screen.getByLabelText("이메일"), "new.user@example.com");
    await user.type(screen.getByLabelText("이름"), "테스트");
    await user.type(screen.getByLabelText("비밀번호"), "Password1!");
    await user.type(screen.getByLabelText("비밀번호 확인"), "Password1!");

    await waitFor(() => {
      expect(mockCheckEmailExists).toHaveBeenCalledWith("new.user@example.com");
    });

    await user.click(screen.getByRole("button", { name: "다음" }));

    expect(await screen.findByLabelText("전화번호")).toBeInTheDocument();
  });

  describe("field messages", () => {
    const slotOf = (field: HTMLElement) =>
      document.getElementById(field.getAttribute("aria-describedby") ?? "") as HTMLElement;

    beforeAll(() => {
      Element.prototype.scrollIntoView = jest.fn();
    });

    const fillAccountStep = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.type(screen.getByLabelText("이메일"), "new.user@example.com");
      await user.type(screen.getByLabelText("이름"), "테스트");
      await user.type(screen.getByLabelText("비밀번호"), "Password1!");
      await user.type(screen.getByLabelText("비밀번호 확인"), "Password1!");
      await waitFor(() => {
        expect(mockCheckEmailExists).toHaveBeenCalledWith("new.user@example.com");
      });
      await user.click(screen.getByRole("button", { name: "다음" }));
      return screen.findByLabelText("전화번호");
    };

    it("shows nothing on first load and drops the old helper lines below the inputs", () => {
      render(<RegisterPage />);

      ["이메일", "이름", "비밀번호", "비밀번호 확인"].forEach((label) => {
        const field = screen.getByLabelText(label);
        expect(slotOf(field)).toBeEmptyDOMElement();
        expect(slotOf(field)).toHaveAttribute("aria-live", "polite");
        expect(field).not.toHaveAttribute("aria-invalid", "true");
      });
      expect(document.querySelector(".auth-helper")).toBeNull();
    });

    it("calls a cleared field required only after it held a value", async () => {
      const user = userEvent.setup();
      render(<RegisterPage />);
      const name = screen.getByLabelText("이름");

      await user.click(name);
      await user.tab();
      expect(slotOf(name)).toBeEmptyDOMElement();

      await user.type(name, "테");
      await user.clear(name);
      expect(slotOf(name)).toHaveTextContent("이름을 입력해 주세요");
    });

    it("shows every required message when 다음 is pressed and focuses the first field", async () => {
      const user = userEvent.setup();
      render(<RegisterPage />);

      await user.click(screen.getByRole("button", { name: "다음" }));

      expect(slotOf(screen.getByLabelText("이메일"))).toHaveTextContent("이메일을 입력해 주세요");
      expect(slotOf(screen.getByLabelText("이름"))).toHaveTextContent("이름을 입력해 주세요");
      expect(slotOf(screen.getByLabelText("비밀번호"))).toHaveTextContent("비밀번호를 입력해 주세요");
      expect(slotOf(screen.getByLabelText("비밀번호 확인"))).toHaveTextContent("비밀번호 확인을 입력해 주세요");
      await waitFor(() => {
        expect(screen.getByLabelText("이메일")).toHaveFocus();
      });
      expect(screen.getByLabelText("이메일")).toHaveAttribute("aria-invalid", "true");
    });

    it("keeps the email duplicate-check status in the email slot", async () => {
      const user = userEvent.setup();
      render(<RegisterPage />);

      await user.type(screen.getByLabelText("이메일"), "new.user@example.com");

      await waitFor(() => {
        expect(slotOf(screen.getByLabelText("이메일"))).toHaveTextContent("이메일 확인됨");
      });
      expect(document.querySelector(".auth-input-trailing")).toBeNull();
    });

    it("hints while the phone number is incomplete and errors once it is left", async () => {
      const user = userEvent.setup();
      render(<RegisterPage />);
      const phone = await fillAccountStep(user);

      expect(slotOf(phone)).toBeEmptyDOMElement();
      await user.type(phone, "0101234");
      expect(phone).toHaveValue("010-1234");
      expect(slotOf(phone)).toHaveTextContent("010-1234-5678 형식");
      expect(slotOf(phone)).not.toHaveTextContent("입력해 주세요");

      await user.tab();
      expect(slotOf(phone)).toHaveTextContent("010-1234-5678 형식으로 입력해 주세요");
      expect(phone).toHaveAttribute("aria-invalid", "true");
    });

    it("types the birth date as digits and reports a partial one after leaving it", async () => {
      const user = userEvent.setup();
      render(<RegisterPage />);
      await fillAccountStep(user);
      const birth = screen.getByLabelText("생년월일");

      expect(slotOf(birth)).toBeEmptyDOMElement();
      await user.type(birth, "19900101");
      expect(birth).toHaveValue("1990-01-01");
      expect(slotOf(birth)).toBeEmptyDOMElement();

      await user.clear(birth);
      await user.type(birth, "199001");
      await user.tab();
      expect(slotOf(birth)).toHaveTextContent("YYYY-MM-DD로 입력해 주세요");
    });

    it("stays on the profile step and shows both messages when 다음 is pressed with nothing filled in", async () => {
      const user = userEvent.setup();
      render(<RegisterPage />);
      const phone = await fillAccountStep(user);

      await user.click(screen.getByRole("button", { name: "다음" }));

      expect(slotOf(phone)).toHaveTextContent("전화번호를 입력해 주세요");
      expect(slotOf(screen.getByLabelText("생년월일"))).toHaveTextContent("생년월일을 입력해 주세요");
      await waitFor(() => {
        expect(phone).toHaveFocus();
      });
      expect(screen.queryByLabelText("요청 권한")).not.toBeInTheDocument();
    });

    it("sends a duplicate phone back to the profile step and focuses the phone field", async () => {
      const user = userEvent.setup();
      jest.mocked(authApi.register).mockRejectedValue({
        response: { status: 409, data: { code: "P2002", field: "phone" } },
      });
      render(<RegisterPage />);
      const phone = await fillAccountStep(user);

      await user.type(phone, "01012345678");
      await user.type(screen.getByLabelText("생년월일"), "19900101");
      await user.click(screen.getByRole("button", { name: "다음" }));
      await user.selectOptions(await screen.findByLabelText("요청 권한"), screen.getAllByRole("option")[1]);
      await user.click(screen.getByRole("button", { name: "회원가입" }));

      const phoneAgain = await screen.findByLabelText("전화번호");
      expect(screen.queryByLabelText("요청 권한")).not.toBeInTheDocument();
      expect(slotOf(phoneAgain)).toHaveTextContent("이미 등록된 전화번호");
      await waitFor(() => expect(phoneAgain).toHaveFocus());
    });
  });
});
