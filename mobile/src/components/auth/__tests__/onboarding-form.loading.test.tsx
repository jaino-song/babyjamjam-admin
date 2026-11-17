import { fireEvent, render, screen } from "@testing-library/react";

import { completeKakaoOnboarding } from "@/app/(shell)/(auth)/kakao/onboarding/actions";

import { OnboardingForm } from "../onboarding-form";

jest.mock("next/navigation", () => ({ useRouter: () => ({ replace: jest.fn() }) }));
jest.mock("@/app/(shell)/(auth)/kakao/onboarding/actions", () => ({ completeKakaoOnboarding: jest.fn() }));

it("preserves the auth button styling and announces saving without visible busy text", async () => {
  jest.mocked(completeKakaoOnboarding).mockReturnValue(new Promise(() => {}));
  render(<OnboardingForm phone="01012345678" birthDate="1990-01-01" role="manager" />);
  const idle = screen.getByRole("button", { name: "가입 완료" });
  expect(idle).toHaveClass("auth-btn");
  expect(idle).not.toHaveAttribute("data-loading");
  fireEvent.click(idle);

  const button = await screen.findByRole("button", { name: "저장 중" });
  expect(button).toHaveClass("auth-btn", "relative");
  expect(button).toBeDisabled();
  expect(button).toHaveAttribute("aria-busy", "true");
  expect(button).toHaveAttribute("data-loading", "");
  expect(button.querySelector('[data-slot="button-idle"]')).toHaveAttribute("aria-hidden", "true");
  expect(button.querySelector('[data-slot="button-idle"]')).toHaveClass("contents", "invisible");
  expect(button.querySelector('[data-slot="button-spinner"]')).toBeInTheDocument();
  fireEvent.click(button);
  expect(completeKakaoOnboarding).toHaveBeenCalledTimes(1);
});
