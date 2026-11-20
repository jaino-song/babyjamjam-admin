import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { completeAccountOnboarding } from "@/app/(shell)/(auth)/onboarding/actions";
import { AccountCompletionForm } from "../account-completion-form";
const replace = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
jest.mock("@/app/(shell)/(auth)/onboarding/actions", () => ({ completeAccountOnboarding: jest.fn() }));
beforeEach(() => { jest.clearAllMocks(); Element.prototype.scrollIntoView = jest.fn(); });
it.each([true, false])("submits only missing phone and navigates with branch selection %s", async requiresBranchSelection => {
  jest.mocked(completeAccountOnboarding).mockResolvedValue({ success: true, requiresBranchSelection });
  render(<AccountCompletionForm email="qa@example.test" name="테스트" birthDate="1990-01-01" />);
  expect(screen.queryByLabelText("생년월일")).toBeNull();
  expect(screen.getByLabelText("이메일")).toBeDisabled();
  expect(screen.getByLabelText("이름")).toBeDisabled();
  fireEvent.change(screen.getByLabelText("전화번호"), { target: { value: "01012345678" } });
  fireEvent.click(screen.getByText("저장하고 시작하기"));
  await waitFor(() => expect(completeAccountOnboarding).toHaveBeenCalledWith({ phone: "010-1234-5678" }));
  expect(replace).toHaveBeenCalledWith(requiresBranchSelection ? "/select-branch" : "/dashboard");
});
it("submits only missing birth date and shows a returned field error", async () => {
  jest.mocked(completeAccountOnboarding).mockResolvedValue({ success: false, field: "birthDate", error: "생년월일을 확인해 주세요." });
  render(<AccountCompletionForm phone="010-1234-5678" />);
  expect(screen.queryByLabelText("전화번호")).toBeNull();
  fireEvent.change(screen.getByLabelText("생년월일"), { target: { value: "19900101" } });
  fireEvent.click(screen.getByText("저장하고 시작하기"));
  await waitFor(() => expect(completeAccountOnboarding).toHaveBeenCalledWith({ birthDate: "1990-01-01" }));
  expect(await screen.findByText("생년월일을 확인해 주세요")).toBeInTheDocument();
});
it("sends denied accounts back to the login notice", async () => {
  jest.mocked(completeAccountOnboarding).mockResolvedValue({ success: false, authErrorCode: "PENDING_APPROVAL" });
  render(<AccountCompletionForm phone="010-1234-5678" />);
  fireEvent.change(screen.getByLabelText("생년월일"), { target: { value: "19900101" } });
  fireEvent.click(screen.getByText("저장하고 시작하기"));
  await waitFor(() => expect(replace).toHaveBeenCalledWith("/login?authError=PENDING_APPROVAL"));
});
