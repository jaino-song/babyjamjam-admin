"use client";

import axios from "axios";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { AUTH_ROUTES } from "@/lib/auth/routes";
import { api } from "@/lib/api/client";
import { REGISTERABLE_ROLE_OPTIONS } from "@/lib/constants/roles";
import { checkPasswordStrength, getEmailFormatError, registerSchema, sanitizeNameInput, type RegisterFormData } from "@/lib/validations/auth";
import { authApi } from "@/services/api";

const ACCOUNT_FIELDS = ["email", "name", "password", "confirmPassword"] as const;
const PERSONAL_FIELDS = ["phone", "birthDate"] as const;
const BRANCH_FIELDS = ["branchId", "role"] as const;
const PASSWORD_MISMATCH_ERROR = "비밀번호가 일치하지 않습니다.";
const EMAIL_DUPLICATE_ERROR = "이미 등록된 이메일입니다.";
const EMAIL_LINKABLE_MESSAGE = "카카오 계정 연결 가능";
const PHONE_DUPLICATE_ERROR = "이미 존재하는 사용자 입니다.";

type RegisterField = keyof RegisterFormData;
export type RegisterStep = 0 | 1 | 2;

const STEP_FIELDS: Record<RegisterStep, readonly RegisterField[]> = {
  0: ACCOUNT_FIELDS,
  1: PERSONAL_FIELDS,
  2: BRANCH_FIELDS,
};

export const REGISTER_STEP_TOTAL = 3;

function formatBirthDateInput(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 8);

  if (digits.length <= 4) {
    return digits;
  }

  if (digits.length <= 6) {
    return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  }

  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
}

function formatPhoneInput(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 11);

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
    branchId: "",
    role: undefined,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [accountsLinked, setAccountsLinked] = useState(false);
  const [branches, setBranches] = useState<{ value: string; label: string }[]>([]);
  const [isLoadingOrgs, setIsLoadingOrgs] = useState(true);
  const [currentStep, setCurrentStep] = useState<RegisterStep>(0);
  const [isCheckingEmailDuplicate, setIsCheckingEmailDuplicate] = useState(false);
  const [isEmailDuplicate, setIsEmailDuplicate] = useState(false);
  const [isEmailLinkable, setIsEmailLinkable] = useState(false);
  const [isCheckingPhoneDuplicate, setIsCheckingPhoneDuplicate] = useState(false);
  const [isPhoneDuplicate, setIsPhoneDuplicate] = useState(false);
  const [emailTouched, setEmailTouched] = useState(false);

  const normalizedEmail = (formData.email ?? "").trim().toLowerCase();
  const phoneDigits = (formData.phone ?? "").replace(/\D/g, "");
  const emailFormatError = getEmailFormatError(formData.email ?? "");

  useEffect(() => {
    authApi.getBranches()
      .then((orgs) => {
        setBranches(orgs.map((org) => ({ value: org.id, label: org.name })));
      })
      .catch(() => {
        setBranches([]);
      })
      .finally(() => setIsLoadingOrgs(false));
  }, []);

  useEffect(() => {
    if (!normalizedEmail || emailFormatError) {
      setIsCheckingEmailDuplicate(false);
      setIsEmailDuplicate(false);
      setIsEmailLinkable(false);
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
        .then(({ exists, linkable }) => {
          if (isCancelled) {
            return;
          }

          const isDuplicate = exists && !linkable;
          const isLinkable = exists && linkable;
          setIsEmailDuplicate(isDuplicate);
          setIsEmailLinkable(isLinkable);
          setErrors((prev) => {
            const nextErrors = { ...prev };
            if (isDuplicate) {
              nextErrors.email = EMAIL_DUPLICATE_ERROR;
            } else if (nextErrors.email === EMAIL_DUPLICATE_ERROR) {
              delete nextErrors.email;
            }
            return nextErrors;
          });
        })
        .catch(() => {
          if (!isCancelled) {
            setIsEmailDuplicate(false);
            setIsEmailLinkable(false);
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

  useEffect(() => {
    if (phoneDigits.length !== 11) {
      setIsCheckingPhoneDuplicate(false);
      setIsPhoneDuplicate(false);
      setErrors((prev) => {
        if (prev.phone !== PHONE_DUPLICATE_ERROR) {
          return prev;
        }

        const nextErrors = { ...prev };
        delete nextErrors.phone;
        return nextErrors;
      });
      return;
    }

    const abortController = new AbortController();

    setIsCheckingPhoneDuplicate(true);

    void api.get("/auth/check-phone", {
      params: { phone: phoneDigits },
      signal: abortController.signal,
    })
      .then((response) => {
        if (abortController.signal.aborted) {
          return;
        }

        const exists = response.data?.exists === true;
        setIsPhoneDuplicate(exists);
        setErrors((prev) => {
          const nextErrors = { ...prev };
          if (exists) {
            nextErrors.phone = PHONE_DUPLICATE_ERROR;
          } else if (nextErrors.phone === PHONE_DUPLICATE_ERROR) {
            delete nextErrors.phone;
          }
          return nextErrors;
        });
      })
      .catch(() => {
        if (abortController.signal.aborted) {
          return;
        }

        setIsPhoneDuplicate(false);
      })
      .finally(() => {
        if (!abortController.signal.aborted) {
          setIsCheckingPhoneDuplicate(false);
        }
      });

    return () => {
      abortController.abort();
      setIsCheckingPhoneDuplicate(false);
    };
  }, [phoneDigits]);

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

    if (step === 0) {
      if (isCheckingEmailDuplicate) {
        return false;
      }

      if (isEmailDuplicate) {
        fieldErrors.email = EMAIL_DUPLICATE_ERROR;
      }
    }

    if (step === 1 && phoneDigits.length === 11) {
      if (isCheckingPhoneDuplicate) {
        return false;
      }

      if (isPhoneDuplicate) {
        fieldErrors.phone = PHONE_DUPLICATE_ERROR;
      }
    }

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
    setIsPhoneDuplicate(false);
    setServerError(null);
  };

  const handleBirthDateChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = formatBirthDateInput(event.target.value);
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

  const handleSelectChange = (field: "branchId" | "role") => (value: string) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => {
        const nextErrors = { ...prev };
        delete nextErrors[field];
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
      } else if (PERSONAL_FIELDS.some((field) => nextErrors[field])) {
        setCurrentStep(1);
      } else {
        setCurrentStep(2);
      }
      return;
    }

    setIsLoading(true);

    try {
      const response = await authApi.register({
        email: result.data.email,
        password: result.data.password,
        name: result.data.name,
        phone: result.data.phone,
        birthDate: result.data.birthDate,
        branchId: result.data.branchId,
        role: result.data.role,
      });

      if (response.success) {
        if (response.code === "ACCOUNTS_LINKED") {
          setAccountsLinked(true);
        }
        setIsSuccess(true);
      } else if (response.code === "P2002" && response.message?.includes("phone")) {
        setErrors((prev) => ({ ...prev, phone: PHONE_DUPLICATE_ERROR }));
        setCurrentStep(1);
      } else {
        setServerError(response.message || "회원가입에 실패했습니다.");
      }
    } catch (requestError: unknown) {
      console.error("Registration error:", requestError);
      const errorData = axios.isAxiosError(requestError) ? requestError.response?.data : undefined;

      if (errorData?.code === "P2002" && (errorData?.field === "phone" || errorData?.message?.includes("phone"))) {
        setErrors((prev) => ({ ...prev, phone: PHONE_DUPLICATE_ERROR }));
        setCurrentStep(1);
      } else if (errorData?.errors) {
        setServerError(errorData.errors.join("\n"));
      } else if (errorData?.message) {
        setServerError(errorData.message);
      } else {
        setServerError("네트워크 오류가 발생했습니다. 다시 시도해 주세요.");
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
  const emailLinkableMessage = isEmailLinkable ? EMAIL_LINKABLE_MESSAGE : undefined;
  const showPhoneDuplicateWarning = errors.phone === PHONE_DUPLICATE_ERROR;
  const hasStepOneRequirements =
    Boolean(formData.email?.trim()) &&
    Boolean(formData.name?.trim()) &&
    Boolean(formData.password) &&
    Boolean(formData.confirmPassword) &&
    passwordStrength.isValid &&
    !emailFormatError &&
    !showEmailDuplicateWarning &&
    !isEmailDuplicate &&
    !isCheckingEmailDuplicate &&
    !showConfirmPasswordMismatch &&
    !errors.email &&
    !errors.name &&
    !errors.password;
  const hasStepTwoRequirements =
    phoneDigits.length === 11 &&
    Boolean(formData.birthDate) &&
    !errors.birthDate &&
    !showPhoneDuplicateWarning &&
    !isPhoneDuplicate &&
    !isCheckingPhoneDuplicate;
  const hasStepThreeRequirements =
    Boolean(formData.branchId) &&
    Boolean(formData.role) &&
    !isLoadingOrgs &&
    !errors.branchId &&
    !errors.role;

  return {
    formData,
    errors,
    serverError,
    isLoading,
    isSuccess,
    accountsLinked,
    branches,
    isLoadingOrgs,
    currentStep,
    isCheckingEmailDuplicate,
    emailLinkableMessage,
    isCheckingPhoneDuplicate,
    passwordStrength,
    handleChange,
    handleEmailBlur,
    handlePhoneChange,
    handleBirthDateChange,
    handleSelectChange,
    handleSubmit,
    handlePreviousStep,
    clearServerError: () => setServerError(null),
    goToLogin: () => router.push(AUTH_ROUTES.login),
    stepCount: REGISTER_STEP_TOTAL,
    isCurrentStepActionDisabled:
      currentStep === 0
        ? !hasStepOneRequirements
        : currentStep === 1
          ? !hasStepTwoRequirements
          : !hasStepThreeRequirements,
    roleOptions: REGISTERABLE_ROLE_OPTIONS,
  };
}
