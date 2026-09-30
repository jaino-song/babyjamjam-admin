import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { completeKakaoOnboarding } from "@/app/(shell)/(auth)/kakao/onboarding/actions";

import { OnboardingForm } from "../onboarding-form";

const mockReplace = jest.fn();

jest.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

jest.mock("@/app/(shell)/(auth)/kakao/onboarding/actions", () => ({
  completeKakaoOnboarding: jest.fn(),
}));

const slotOf = (field: HTMLElement) =>
  document.getElementById(field.getAttribute("aria-describedby") ?? "") as HTMLElement;

describe("OnboardingForm field messages", () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = jest.fn();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (completeKakaoOnboarding as jest.Mock).mockResolvedValue({ success: true });
  });

  it("shows nothing on first load, with example placeholders and no helper lines below", () => {
    render(<OnboardingForm email="a@b.com" name="홍길동" />);

    ["전화번호", "생년월일", "요청 권한"].forEach((label) => {
      const field = screen.getByLabelText(label);
      expect(slotOf(field)).toBeEmptyDOMElement();
      expect(slotOf(field)).toHaveAttribute("aria-live", "polite");
      expect(field).not.toHaveAttribute("aria-invalid", "true");
    });
    expect(screen.getByLabelText("전화번호")).toHaveAttribute("placeholder", "010-1234-5678");
    expect(screen.getByLabelText("생년월일")).toHaveAttribute("placeholder", "1990-01-01");
    expect(document.querySelector(".auth-helper")).toBeNull();
  });

  it("hints while the phone number is incomplete and errors once the field is left", async () => {
    const user = userEvent.setup();
    render(<OnboardingForm />);
    const phone = screen.getByLabelText("전화번호");

    await user.type(phone, "0101234");
    expect(phone).toHaveValue("010-1234");
    expect(slotOf(phone)).toHaveTextContent("010-1234-5678 형식");
    expect(slotOf(phone)).not.toHaveTextContent("입력해 주세요");

    await user.tab();
    expect(slotOf(phone)).toHaveTextContent("010-1234-5678 형식으로 입력해 주세요");
    expect(phone).toHaveAttribute("aria-invalid", "true");
  });

  it("types the birth date as digits and errors on a partial one after leaving it", async () => {
    const user = userEvent.setup();
    render(<OnboardingForm />);
    const birth = screen.getByLabelText("생년월일");

    await user.type(birth, "19900101");
    expect(birth).toHaveValue("1990-01-01");
    expect(slotOf(birth)).toBeEmptyDOMElement();

    await user.clear(birth);
    await user.type(birth, "1990");
    await user.tab();
    expect(slotOf(birth)).toHaveTextContent("YYYY-MM-DD 형식으로 입력해 주세요");
  });

  it("shows every problem in its slot when submitted empty, focuses the first, and does not submit", async () => {
    const user = userEvent.setup();
    render(<OnboardingForm />);

    await user.click(screen.getByRole("button", { name: "가입 완료" }));

    expect(slotOf(screen.getByLabelText("전화번호"))).toHaveTextContent("전화번호를 입력해 주세요");
    expect(slotOf(screen.getByLabelText("생년월일"))).toHaveTextContent("생년월일을 입력해 주세요");
    expect(slotOf(screen.getByLabelText("요청 권한"))).not.toBeEmptyDOMElement();
    expect(screen.getByLabelText("전화번호")).toHaveFocus();
    expect(completeKakaoOnboarding).not.toHaveBeenCalled();
  });

  it("submits the typed values once every field is valid", async () => {
    const user = userEvent.setup();
    render(<OnboardingForm />);

    fireEvent.change(screen.getByLabelText("전화번호"), { target: { value: "01012345678" } });
    fireEvent.change(screen.getByLabelText("생년월일"), { target: { value: "19900101" } });
    await user.selectOptions(screen.getByLabelText("요청 권한"), "manager");
    await user.click(screen.getByRole("button", { name: "가입 완료" }));

    expect(completeKakaoOnboarding).toHaveBeenCalledWith({
      phone: "010-1234-5678",
      birthDate: "1990-01-01",
      role: "manager",
    });
  });
});
