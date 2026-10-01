"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { authBirthDateSchema, authPhoneSchema, REGISTERABLE_ROLE_OPTIONS } from "@babyjamjam/shared";
import { formatIsoDateInput } from "@babyjamjam/shared/utils/date-input";
import { z } from "zod";

import { completeKakaoOnboarding } from "@/app/(shell)/(auth)/kakao/onboarding/actions";
import { FieldLabelRow, fieldMessageId } from "@/components/app/ui/FieldLabelRow";
import { useFieldMessages } from "@/hooks/use-field-messages";
import { formatKoreanPhoneNumber } from "@/lib/phone";
import { authErrorSlot } from "@/lib/validations/auth-slot-copy";
import {
  focusFirstInvalidField,
  pickSlotMessage,
  type FieldSpec,
} from "@/lib/validations/field-message";
import { useLocale } from "@/providers/LocaleProvider";
import "@/components/app/mobile-redesign/redesign.css";

const ONBOARDING_FORM_SOURCE_COMPONENT = "OnboardingForm";

/**
 * Canonical data-component base for the /kakao/onboarding route. OnboardingForm
 * is rendered only by `app/(shell)/(auth)/kakao/onboarding/page.tsx`, so the
 * route base lives here instead of being threaded through a prop.
 */
const KAKAO_ONBOARDING_BASE = "mobile_auth_kakao-onboarding";

const schema = z.object({
  phone: authPhoneSchema,
  birthDate: authBirthDateSchema,
  role: z.enum(["admin", "manager", "user"], { message: "역할을 선택해주세요." }),
});

type FormData = z.infer<typeof schema>;

type TextField = "phone" | "birthDate";

const FIELD_SPECS: Record<TextField, FieldSpec> = {
  phone: { kind: "phone", label: "전화번호", required: true },
  birthDate: { kind: "birthday", label: "생년월일", required: true },
};

/** DOM id of each validated input, in top-to-bottom order. */
const FIELD_INPUT_IDS = {
  phone: "onboarding-phone",
  birthDate: "onboarding-birth-date",
  role: "onboarding-role",
} as const;

interface OnboardingFormProps {
  email?: string;
  name?: string;
  phone?: string;
  birthDate?: string;
  role?: FormData["role"];
}

export function OnboardingForm(props: OnboardingFormProps) {
  const router = useRouter();
  const locale = useLocale();
  const [form, setForm] = useState<Partial<FormData>>({
    phone: props.phone ?? "",
    birthDate: props.birthDate ?? "",
    role: props.role,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fieldMessages = useFieldMessages<TextField>({
    values: { phone: form.phone ?? "", birthDate: form.birthDate ?? "" },
    specs: FIELD_SPECS,
    locale,
  });

  const updateField = (field: keyof FormData, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: "" }));
    setServerError(null);
  };

  const update = (field: keyof FormData) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    updateField(field, event.target.value);
  };

  const slots = {
    phone: pickSlotMessage(fieldMessages.slot("phone"), authErrorSlot("phone", errors.phone)),
    birthDate: pickSlotMessage(fieldMessages.slot("birthDate"), authErrorSlot("birthDate", errors.birthDate)),
    role: authErrorSlot("role", errors.role),
  };
  const fieldProps = (field: keyof typeof slots) => ({
    "aria-invalid": slots[field]?.tone === "err" ? (true as const) : undefined,
    "aria-describedby": fieldMessageId(FIELD_INPUT_IDS[field]),
  });

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    fieldMessages.markSubmitted();
    const result = schema.safeParse(form);
    const invalidTextFields = fieldMessages.invalidFields(["phone", "birthDate"]);
    if (!result.success || invalidTextFields.length > 0) {
      const next: Record<string, string> = {};
      if (!result.success) {
        result.error.issues.forEach((issue) => {
          const field = String(issue.path[0]);
          if (!next[field]) next[field] = issue.message;
        });
        setErrors(next);
      }
      const problemFields = (["phone", "birthDate", "role"] as const).filter(
        (field) => next[field] || (field !== "role" && invalidTextFields.includes(field)),
      );
      focusFirstInvalidField(problemFields.map((field) => FIELD_INPUT_IDS[field]));
      return;
    }

    setIsLoading(true);
    const response = await completeKakaoOnboarding(result.data);
    setIsLoading(false);
    if (!response.success) {
      // The server action already returns contract-resolved authored copy;
      // store it verbatim instead of re-adapting the string.
      setServerError(response.error || "계정 정보를 저장하지 못했습니다.");
      return;
    }
    router.replace("/login?authError=PENDING_APPROVAL");
  };

  return (
    <div
      className="auth-page"
      data-component={KAKAO_ONBOARDING_BASE}
      data-source-component={ONBOARDING_FORM_SOURCE_COMPONENT}
    >
      <div className="auth-brand">
        <div className="auth-title">카카오 가입 마무리</div>
        <div className="auth-sub">로그인에 필요한 추가 정보를 입력해 주세요.</div>
      </div>
      {serverError && <div className="auth-server-error" role="alert">{serverError}</div>}
      <form className="auth-form" onSubmit={submit}>
        <div className="auth-input-group">
          <FieldLabelRow
            data-component={`${KAKAO_ONBOARDING_BASE}_email-field`}
            htmlFor="onboarding-email"
            label="이메일"
            message={null}
          />
          <input id="onboarding-email" className="auth-input" value={props.email ?? ""} disabled aria-describedby={fieldMessageId("onboarding-email")} />
        </div>
        <div className="auth-input-group">
          <FieldLabelRow
            data-component={`${KAKAO_ONBOARDING_BASE}_name-field`}
            htmlFor="onboarding-name"
            label="이름"
            message={null}
          />
          <input id="onboarding-name" className="auth-input" value={props.name ?? ""} disabled aria-describedby={fieldMessageId("onboarding-name")} />
        </div>
        <div className="auth-input-group">
          <FieldLabelRow
            data-component={`${KAKAO_ONBOARDING_BASE}_phone-field`}
            htmlFor={FIELD_INPUT_IDS.phone}
            label="전화번호"
            message={slots.phone}
          />
          <input
            id={FIELD_INPUT_IDS.phone}
            className={`auth-input ${slots.phone?.tone === "err" ? "error" : ""}`}
            type="tel"
            inputMode="numeric"
            maxLength={13}
            autoComplete="tel"
            value={form.phone ?? ""}
            onChange={(event) => updateField("phone", formatKoreanPhoneNumber(event.target.value))}
            {...fieldMessages.bind("phone")}
            placeholder="010-1234-5678"
            {...fieldProps("phone")}
          />
        </div>
        <div className="auth-input-group">
          <FieldLabelRow
            data-component={`${KAKAO_ONBOARDING_BASE}_birth-date-field`}
            htmlFor={FIELD_INPUT_IDS.birthDate}
            label="생년월일"
            message={slots.birthDate}
          />
          <input
            id={FIELD_INPUT_IDS.birthDate}
            className={`auth-input ${slots.birthDate?.tone === "err" ? "error" : ""}`}
            inputMode="numeric"
            maxLength={10}
            autoComplete="bday"
            value={form.birthDate ?? ""}
            onChange={(event) => updateField("birthDate", formatIsoDateInput(event.target.value))}
            {...fieldMessages.bind("birthDate")}
            placeholder="1990-01-01"
            {...fieldProps("birthDate")}
          />
        </div>
        <div className="auth-input-group">
          <FieldLabelRow
            data-component={`${KAKAO_ONBOARDING_BASE}_role-field`}
            htmlFor={FIELD_INPUT_IDS.role}
            label="요청 권한"
            message={slots.role}
          />
          <div className="auth-select-wrap">
            <select
              id={FIELD_INPUT_IDS.role}
              className="auth-select"
              value={form.role ?? ""}
              onChange={update("role")}
              {...fieldProps("role")}
            >
              <option value="">요청할 권한을 선택해주세요</option>
              {REGISTERABLE_ROLE_OPTIONS.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
            </select>
            <ChevronDown className="auth-select-chev" size={16} aria-hidden="true" />
          </div>
        </div>
        <button className="auth-btn" type="submit" disabled={isLoading}>{isLoading ? "저장 중…" : "가입 완료"}</button>
      </form>
    </div>
  );
}
