import { act, renderHook, waitFor } from "@testing-library/react";

import { api } from "@/lib/api/client";
import { authApi } from "@/services/api";

import {
  REGISTER_STEP_TOTAL,
  useRegisterPageController,
} from "../use-register-page-controller";

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock("@/lib/api/client", () => ({
  api: {
    get: jest.fn(),
  },
}));

jest.mock("@/services/api", () => ({
  authApi: {
    getBranches: jest.fn(),
    checkEmailExists: jest.fn(),
    register: jest.fn(),
  },
}));

const mockApiGet = api.get as jest.MockedFunction<typeof api.get>;
describe("useRegisterPageController phone duplicate check", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("uses two steps because branch and role are assigned by the owner", () => {
    const { result } = renderHook(() => useRegisterPageController());

    expect(REGISTER_STEP_TOTAL).toBe(2);
    expect(result.current.stepCount).toBe(2);
  });

  it("checks a complete phone and blocks an existing user number", async () => {
    mockApiGet.mockResolvedValue({ data: { exists: true } });
    const { result } = renderHook(() => useRegisterPageController());

    act(() => {
      result.current.handlePhoneChange({
        target: { value: "010-6621-1878" },
      } as React.ChangeEvent<HTMLInputElement>);
    });

    await waitFor(() => {
      expect(result.current.lastCheckedPhoneDigits).toBe("01066211878");
    });

    expect(mockApiGet).toHaveBeenCalledWith("/auth/check-phone", {
      params: { phone: "01066211878" },
      signal: expect.any(AbortSignal),
    });
    expect(result.current.isPhoneDuplicate).toBe(true);
    expect(result.current.isPhoneCheckReady).toBe(false);
  });

  it("marks a checked new phone as ready", async () => {
    mockApiGet.mockResolvedValue({ data: { exists: false } });
    const { result } = renderHook(() => useRegisterPageController());

    act(() => {
      result.current.handlePhoneChange({
        target: { value: "010-1234-5678" },
      } as React.ChangeEvent<HTMLInputElement>);
    });

    await waitFor(() => {
      expect(result.current.isPhoneCheckReady).toBe(true);
    });

    expect(result.current.isPhoneDuplicate).toBe(false);
  });

  it("submits only applicant identity fields after the second step", async () => {
    mockApiGet.mockResolvedValue({ data: { exists: false } });
    jest.mocked(authApi.checkEmailExists).mockResolvedValue({ exists: false, linkable: false });
    jest.mocked(authApi.register).mockResolvedValue({
      success: true,
      message: "인증 이메일이 발송되었습니다.",
    });
    const { result } = renderHook(() => useRegisterPageController());
    const change = (field: "email" | "name" | "password" | "confirmPassword", value: string) => {
      act(() => {
        result.current.handleChange(field)({
          target: { value },
        } as React.ChangeEvent<HTMLInputElement>);
      });
    };

    change("email", "staff@example.com");
    change("name", "홍길동");
    change("password", "Password1!");
    change("confirmPassword", "Password1!");

    await waitFor(() => {
      expect(authApi.checkEmailExists).toHaveBeenCalledWith("staff@example.com");
    });
    await act(async () => {
      await result.current.handleSubmit({ preventDefault: jest.fn() } as unknown as React.FormEvent<HTMLFormElement>);
    });
    expect(result.current.currentStep).toBe(1);

    act(() => {
      result.current.handlePhoneChange({
        target: { value: "010-1234-5678" },
      } as React.ChangeEvent<HTMLInputElement>);
    });
    act(() => {
      result.current.handleBirthDateChange({
        target: { value: "1990-01-01" },
      } as React.ChangeEvent<HTMLInputElement>);
    });
    await waitFor(() => {
      expect(result.current.isPhoneCheckReady).toBe(true);
    });

    await act(async () => {
      await result.current.handleSubmit({ preventDefault: jest.fn() } as unknown as React.FormEvent<HTMLFormElement>);
    });

    expect(authApi.register).toHaveBeenCalledWith({
      email: "staff@example.com",
      password: "Password1!",
      name: "홍길동",
      phone: "010-1234-5678",
      birthDate: "1990-01-01",
    });
    expect(result.current.isSuccess).toBe(true);
  });
});
