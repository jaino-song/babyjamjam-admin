"use client";


import axios from "axios";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { normalizeApiError, type NormalizedApiError } from "@babyjamjam/shared";
import { formatIsoDateInput } from "@babyjamjam/shared/utils/date-input";

import { AUTH_ROUTES } from "@/lib/auth/routes";
import { getFieldMessageText } from "@/lib/forms/field-message-text";
import { normalizeKoreanPhoneDigits } from "@/lib/phone";
import { checkPasswordStrength, getEmailFormatError, registerSchema, sanitizeNameInput, type RegisterFormData } from "@/lib/validations/auth";
import { authApi } from "@/services/api";

const ACCOUNT_FIELDS = ["email", "name", "password", "confirmPassword"] as const;
const PERSONAL_FIELDS = ["phone", "birthDate"] as const;
const PASSWORD_MISMATCH_ERROR = "비밀번호가 일치하지 않아요.";
const EMAIL_DUPLICATE_ERROR = "이미 등록된 이메일입니다. 로그인하거나 비밀번호 찾기를 이용해 주세요.";
const EMAIL_EXISTING_NOTE = "이미 등록된 이메일이에요. 카카오로 가입한 계정이라면 계속 진행해 비밀번호 로그인을 추가할 수 있어요.";
const PHONE_DUPLICATE_ERROR = "이미 등록된 전화번호예요. 다른 전화번호로 다시 시도해 주세요.";

type RegisterField = keyof RegisterFormData;
export type RegisterStep = 0 | 1;

const STEP_FIELDS: Record<RegisterStep, readonly RegisterField[]> = {
  0: ACCOUNT_FIELDS,
  1: PERSONAL_FIELDS,
};

export const REGISTER_STEP_TOTAL = 2;

/** Registered-code discriminator for the duplicate-phone failure. */
function isPhoneDuplicateFailure(errorData: unknown, normalized: NormalizedApiError): boolean {
  // Legacy Prisma body: { code: "P2002", field: "phone" }.
  if (
    errorData && typeof errorData === "object" && !Array.isArray(errorData)
    && (errorData as { code?: unknown }).code === "P2002"
    && (errorData as { field?: unknown }).field === "phone"
  ) {
    return true;
  }
  // Problem body: registered conflict code with a /phone pointer.
  return normalized.verified
    && ["REQUEST_CONFLICT", "VALIDATION_FAILED"].includes(normalized.problem?.code ?? "")
    && (normalized.problem?.errors ?? []).some((problemError) => problemError.pointer === "/phone");
}

function formatPhoneInput(value: string) {
  // Country-code input is normalized first; the mobile-only prefix policy stays.
  const digits = normalizeKoreanPhoneDigits(value).slice(0, 11);

  if (digits.length === 0) {
    return "";
  }

  if (digits[0] !== "0") {
    return "";
  }

  if (digits.length === 1) {
    return "0";
  }

  if (digits[1] !== "1") {
    return "0";
  }

  if (digits.length <= 3) {
    return digits;
  }

  if (digits.length <= 7) {
    return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  }

  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

function getConfirmPasswordMismatchError(password?: string, confirmPassword?: string) {
  if (!password || !confirmPassword) {
    return undefined;
  }

  return password === confirmPassword ? undefined : PASSWORD_MISMATCH_ERROR;
}

export function useRegisterPageController() {
  const router = useRouter();
  const [formData, setFormData] = useState<Partial<RegisterFormData>>({
    email: "",
    password: "",
    confirmPassword: "",
    name: "",
    phone: "",
    birthDate: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [accountsLinked, setAccountsLinked] = useState(false);
  const [currentStep, setCurrentStep] = useState<RegisterStep>(0);
  const [isCheckingEmailDuplicate, setIsCheckingEmailDuplicate] = useState(false);
  const [emailLookup, setEmailLookup] = useState<{ email: string; exists: boolean } | null>(null);
  const [linkChallengeToken, setLinkChallengeToken] = useState<string | null>(null);
  const [emailVerificationRequired, setEmailVerificationRequired] = useState(true);
  const [emailTouched, setEmailTouched] = useState(false);

  const normalizedEmail = (formData.email ?? "").trim().toLowerCase();
  const isEmailDuplicate = emailLookup?.email === normalizedEmail && emailLookup.exists;
  const phoneDigits = (formData.phone ?? "").replace(/\D/g, "");
  const emailFormatError = getEmailFormatError(formData.email ?? "");

  useEffect(() => {
    if (!normalizedEmail || emailFormatError) {
      setIsCheckingEmailDuplicate(false);
      setEmailLookup(null);

      setErrors((prev) => {
        if (prev.email !== EMAIL_DUPLICATE_ERROR) {
          return prev;
        }

        const nextErrors = { ...prev };
        delete nextErrors.email;
        return nextErrors;
      });
      return;
    }

    let isCancelled = false;
    const timeoutId = window.setTimeout(() => {
      setIsCheckingEmailDuplicate(true);

      void authApi.checkEmailExists(normalizedEmail)
        .then(({ exists }) => {
          if (!isCancelled) setEmailLookup({ email: normalizedEmail, exists });
        })
        .catch(() => {
          if (!isCancelled) {
            setEmailLookup(null);

            setErrors((prev) => {
              if (prev.email !== EMAIL_DUPLICATE_ERROR) {
                return prev;
              }

              const nextErrors = { ...prev };
              delete nextErrors.email;
              return nextErrors;
            });
          }
        })
        .finally(() => {
          if (!isCancelled) {
            setIsCheckingEmailDuplicate(false);
          }
        });
    }, 250);

    return () => {
      isCancelled = true;
      window.clearTimeout(timeoutId);
      setIsCheckingEmailDuplicate(false);
    };
  }, [normalizedEmail, emailFormatError]);

  const clearFieldErrors = (fields: readonly RegisterField[]) => {
    setErrors((prev) => {
      const nextErrors = { ...prev };
      fields.forEach((field) => {
        delete nextErrors[field];
      });
      return nextErrors;
    });
  };

  const collectFieldErrors = (
    issues: { path: PropertyKey[]; message: string }[],
    fields?: readonly RegisterField[],
  ) => {
    const allowedFields = fields ? new Set<string>(fields) : null;
    const nextErrors: Record<string, string> = {};

    issues.forEach((issue) => {
      const field = issue.path[0];
      if (typeof field !== "string") {
        return;
      }

      if (allowedFields && !allowedFields.has(field)) {
        return;
      }

      if (!nextErrors[field]) {
        nextErrors[field] = issue.message;
      }
    });

    return nextErrors;
  };

  const validateStep = (step: RegisterStep) => {
    const fields = STEP_FIELDS[step];
    const result = registerSchema.safeParse(formData);
    const fieldErrors = result.success ? {} : collectFieldErrors(result.error.issues, fields);

    if (step === 0 && isCheckingEmailDuplicate) return false;

    setErrors((prev) => {
      const nextErrors = { ...prev };
      fields.forEach((field) => {
        delete nextErrors[field];
      });
      return { ...nextErrors, ...fieldErrors };
    });

    return Object.keys(fieldErrors).length === 0;
  };

  const handleChange = (field: keyof RegisterFormData) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = field === "name" ? sanitizeNameInput(event.target.value) : event.target.value;
    const nextFormData = { ...formData, [field]: value };
    const nextEmailError = field === "email" ? getEmailFormatError(value) : undefined;

    setFormData(nextFormData);
    setErrors((prev) => {
      const nextErrors = { ...prev };
      delete nextErrors[field];

      if (field === "email" && (emailTouched || Boolean(prev.email)) && nextEmailError) {
        nextErrors.email = nextEmailError;
      }

      if (field === "password" || field === "confirmPassword") {
        const mismatchError = getConfirmPasswordMismatchError(
          nextFormData.password,
          nextFormData.confirmPassword,
        );

        if (mismatchError) {
          nextErrors.confirmPassword = mismatchError;
        } else if (nextErrors.confirmPassword === PASSWORD_MISMATCH_ERROR) {
          delete nextErrors.confirmPassword;
        }
      }

      return nextErrors;
    });
    setServerError(null);
  };

  const handleEmailBlur = () => {
    setEmailTouched(true);

    const emailError = getEmailFormatError(formData.email ?? "");

    if (!emailError) {
      return;
    }

    setErrors((prev) => ({ ...prev, email: emailError }));
  };

  const handlePhoneChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = formatPhoneInput(event.target.value);

    setFormData((prev) => ({ ...prev, phone: value }));
    setErrors((prev) => {
      const nextErrors = { ...prev };
      delete nextErrors.phone;
      return nextErrors;
    });
    setServerError(null);
  };

  const handleBirthDateChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = formatIsoDateInput(event.target.value);
    setFormData((prev) => ({ ...prev, birthDate: value }));

    if (errors.birthDate) {
      setErrors((prev) => {
        const nextErrors = { ...prev };
        delete nextErrors.birthDate;
        return nextErrors;
      });
    }

    setServerError(null);
  };

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setServerError(null);

    if (currentStep < REGISTER_STEP_TOTAL - 1) {
      if (validateStep(currentStep)) {
        const nextStep = (currentStep + 1) as RegisterStep;
        clearFieldErrors(STEP_FIELDS[nextStep]);
        setCurrentStep(nextStep);
      }
      return;
    }

    const result = registerSchema.safeParse(formData);
    if (!result.success) {
      const nextErrors = collectFieldErrors(result.error.issues);
      setErrors(nextErrors);

      if (ACCOUNT_FIELDS.some((field) => nextErrors[field])) {
        setCurrentStep(0);
      } else {
        setCurrentStep(1);
      }
      return;
    }

    setIsLoading(true);

    const submittedEmail = result.data.email.trim().toLowerCase();
    let submittedEmailExists = false;
    if (emailLookup?.email === submittedEmail) {
      submittedEmailExists = emailLookup.exists;
    } else {
      try {
        const { exists } = await authApi.checkEmailExists(submittedEmail);
        submittedEmailExists = exists;
        setEmailLookup({ email: submittedEmail, exists });
      } catch {
        // Match the debounced lookup's fail-open behavior without treating it as a register failure.
      }
    }

    try {
      const response = await authApi.register({
        email: result.data.email,
        password: result.data.password,
        name: result.data.name,
        phone: result.data.phone,
        birthDate: result.data.birthDate,
      });

      if (response.success) {
        if (response.linkVerificationRequired && response.linkChallengeToken) {
          setLinkChallengeToken(response.linkChallengeToken);
          return;
        }
        if (submittedEmailExists) {
          setErrors((prev) => ({ ...prev, email: EMAIL_DUPLICATE_ERROR }));
          setCurrentStep(0);
          return;
        }
        if (response.code === "ACCOUNTS_LINKED") {
          setAccountsLinked(true);
        }
        setIsSuccess(true);
      } else if (response.code === "P2002") {
        // Registered-code discrimination only — the register flow cannot
        // produce another P2002, so no raw-message content check is needed.
        setErrors((prev) => ({ ...prev, phone: PHONE_DUPLICATE_ERROR }));
        setCurrentStep(1);
      } else {
        setServerError("회원가입에 실패했어요.");
      }
    } catch (requestError: unknown) {

      const errorData = axios.isAxiosError(requestError) ? requestError.response?.data : undefined;
      const normalized = normalizeApiError(requestError, { locale: "ko-KR", operation: "mutation" });

      if (axios.isAxiosError(requestError) && requestError.response?.status === 403 && errorData?.code === "PENDING_APPROVAL") {
        router.replace("/login?authError=LINK_PENDING_APPROVAL");
        return;
      }

      if (isPhoneDuplicateFailure(errorData, normalized)) {
        const issue = normalized.problem?.errors?.find((item) => item.pointer === "/phone");
        const message = normalized.problem?.code === "VALIDATION_FAILED" && issue?.code !== "INVALID_VALUE"
          ? getFieldMessageText("ko", { tone: "error", code: issue?.code === "REQUIRED" ? "required" : "phone-format" }, "전화번호")
          : PHONE_DUPLICATE_ERROR;
        setErrors((prev) => ({ ...prev, phone: message }));
        setCurrentStep(1);
      } else {
        // Registered problem message (verified) or locally authored copy —
        // upstream body messages/arrays are never rendered.
        setServerError(axios.isAxiosError(requestError) && requestError.response?.status === 429 ? (normalized.verified ? normalized.message : "요청이 너무 많아요. 잠시 후 다시 시도해 주세요.") : "네트워크 오류가 발생했어요. 다시 시도해 주세요.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handlePreviousStep = () => {
    const previousStep = Math.max(currentStep - 1, 0) as RegisterStep;
    clearFieldErrors(STEP_FIELDS[currentStep]);
    setServerError(null);
    setCurrentStep(previousStep);
  };

  const passwordStrength = checkPasswordStrength(formData.password || "");
  const showConfirmPasswordMismatch = errors.confirmPassword === PASSWORD_MISMATCH_ERROR;
  const showEmailDuplicateWarning = errors.email === EMAIL_DUPLICATE_ERROR;
  const existingEmailNote = isEmailDuplicate ? EMAIL_EXISTING_NOTE : undefined;
  const hasStepOneRequirements =
    Boolean(formData.email?.trim()) &&
    Boolean(formData.name?.trim()) &&
    Boolean(formData.password) &&
    Boolean(formData.confirmPassword) &&
    passwordStrength.isValid &&
    !emailFormatError &&
    !showEmailDuplicateWarning &&
    !isCheckingEmailDuplicate &&
    !showConfirmPasswordMismatch &&
    !errors.email &&
    !errors.name &&
    !errors.password;
  const hasStepTwoRequirements =
    phoneDigits.length === 11 &&
    Boolean(formData.birthDate) &&
    !errors.birthDate;
  return {
    formData,
    errors,
    serverError,
    isLoading,
    isSuccess,
    accountsLinked,
    currentStep,
    isCheckingEmailDuplicate,
    existingEmailNote,
    linkChallengeToken,
    emailVerificationRequired,
    restartLink: () => setLinkChallengeToken(null),
    verifyLink: async (code: string) => {
      if (!linkChallengeToken) return { success: false };
      try {
        const response = await authApi.verifyRegisterLink(linkChallengeToken, code);
        if (response.success) {
          setEmailVerificationRequired(response.emailVerificationRequired !== false);
          setAccountsLinked(true);
          setIsSuccess(true);
          setLinkChallengeToken(null);
          return { success: true };
        }
      } catch (error) {
        const normalized = normalizeApiError(error, { locale: "ko-KR", operation: "mutation" });
        if (axios.isAxiosError(error) && error.response?.status === 429) {
          return { success: false, error: normalized.verified ? normalized.message : "요청이 너무 많아요. 잠시 후 다시 시도해 주세요." };
        }
        return { success: false, error: normalized.problem?.code === "VALIDATION_FAILED" && normalized.problem.errors?.some((item) => item.pointer === "/code")
          ? "인증번호가 맞지 않거나 만료됐어요. 다시 입력하거나 처음부터 진행해 주세요."
          : "회원가입에 실패했어요." };
      }
      return { success: false, error: "회원가입에 실패했어요." };
    },
    passwordStrength,
    handleChange,
    handleEmailBlur,
    handlePhoneChange,
    handleBirthDateChange,
    handleSubmit,
    handlePreviousStep,
    clearServerError: () => setServerError(null),
    goToLogin: () => router.push(AUTH_ROUTES.login),
    stepCount: REGISTER_STEP_TOTAL,
    isCurrentStepActionDisabled:
      currentStep === 0
        ? !hasStepOneRequirements
        : !hasStepTwoRequirements,
  };
}
