"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authBirthDateSchema, authPhoneSchema } from "@babyjamjam/shared";
import { formatIsoDateInput } from "@babyjamjam/shared/utils/date-input";
import { z } from "zod";

import { completeAccountOnboarding } from "@/app/(shell)/(auth)/onboarding/actions";
import { ButtonLoadingContent } from "@/components/ui/button";
import { FieldLabelRow, fieldMessageId } from "@/components/app/ui/FieldLabelRow";
import { useFieldMessages } from "@/hooks/use-field-messages";
import { resetAuthorityState } from "@/lib/auth/authority-state";
import { formatKoreanPhoneNumber } from "@/lib/phone";
import { authErrorSlot } from "@/lib/validations/auth-slot-copy";
import {
  focusFirstInvalidField,
  pickSlotMessage,
  type FieldSpec,
} from "@/lib/validations/field-message";
import { useLocale } from "@/providers/LocaleProvider";
import "@/components/app/mobile-redesign/redesign.css";

const ONBOARDING_FORM_SOURCE_COMPONENT = "AccountCompletionForm";

const ACCOUNT_COMPLETION_BASE = "mobile_auth_onboarding";

const schema = z.object({
  phone: authPhoneSchema,
  birthDate: authBirthDateSchema,
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
} as const;

interface AccountCompletionFormProps {
  email?: string;
  name?: string;
  phone?: string;
  birthDate?: string;
}

export function AccountCompletionForm(props: AccountCompletionFormProps) {
  const router = useRouter();
  const locale = useLocale();
  const [form, setForm] = useState<Partial<FormData>>({
    phone: props.phone ?? "",
    birthDate: props.birthDate ?? "",
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

  const slots = {
    phone: pickSlotMessage(fieldMessages.slot("phone"), authErrorSlot("phone", errors.phone)),
    birthDate: pickSlotMessage(fieldMessages.slot("birthDate"), authErrorSlot("birthDate", errors.birthDate)),
  };
  const fieldProps = (field: keyof typeof slots) => ({
    "aria-invalid": slots[field]?.tone === "err" ? (true as const) : undefined,
    "aria-describedby": fieldMessageId(FIELD_INPUT_IDS[field]),
  });

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    fieldMessages.markSubmitted();
    const body = { ...(!props.phone ? { phone: form.phone } : {}), ...(!props.birthDate ? { birthDate: form.birthDate } : {}) };
    const result = schema.partial().safeParse(body);
    if (!result.success) {
      const next: Record<string, string> = {};
      result.error.issues.forEach(issue => { next[String(issue.path[0])] = issue.message; });
      setErrors(next);
      focusFirstInvalidField(Object.keys(next).map(field => FIELD_INPUT_IDS[field as TextField]));
      return;
    }

    setIsLoading(true);
    const response = await completeAccountOnboarding(result.data);
    setIsLoading(false);
    if (!response.success) {
      // The server action already returns contract-resolved authored copy;
      // store it verbatim instead of re-adapting the string.
      if (response.authErrorCode) { router.replace(`/login?authError=${response.authErrorCode}`); return; }
      if (response.field) setErrors(current => ({ ...current, [response.field]: response.error || "" }));
      else setServerError(response.error || "계정 정보를 저장하지 못했습니다.");
      return;
    }
    await resetAuthorityState();
    // Reload the shell so its server-rendered UserProvider receives the new identity.
    window.location.replace(response.requiresBranchSelection ? "/select-branch" : "/dashboard");
  };

  return (
    <div
      className="auth-page" data-slot="auth-page"
      data-component={ACCOUNT_COMPLETION_BASE}
      data-source-component={ONBOARDING_FORM_SOURCE_COMPONENT}
    >
      <div className="auth-brand" data-slot="auth-brand">
        <div className="auth-title" data-slot="auth-title">추가 정보 입력</div>
        <div className="auth-sub" data-slot="auth-sub">서비스 이용에 필요한 정보를 입력하면 바로 로그인돼요.</div>
      </div>
      {serverError && <div className="auth-server-error" data-slot="auth-server-error" role="alert">{serverError}</div>}
      <form className="auth-form" data-slot="auth-form" onSubmit={submit}>
        <div className="auth-input-group" data-slot="auth-input-group">
          <FieldLabelRow
            data-component={`${ACCOUNT_COMPLETION_BASE}_email-field`}
            htmlFor="onboarding-email"
            label="이메일"
            message={null}
          />
          <input id="onboarding-email" className="auth-input" data-slot="auth-input" value={props.email ?? ""} disabled aria-describedby={fieldMessageId("onboarding-email")} />
        </div>
        <div className="auth-input-group" data-slot="auth-input-group">
          <FieldLabelRow
            data-component={`${ACCOUNT_COMPLETION_BASE}_name-field`}
            htmlFor="onboarding-name"
            label="이름"
            message={null}
          />
          <input id="onboarding-name" className="auth-input" data-slot="auth-input" value={props.name ?? ""} disabled aria-describedby={fieldMessageId("onboarding-name")} />
        </div>
        {!props.phone && <div className="auth-input-group" data-slot="auth-input-group">
          <FieldLabelRow
            data-component={`${ACCOUNT_COMPLETION_BASE}_phone-field`}
            htmlFor={FIELD_INPUT_IDS.phone}
            label="전화번호"
            message={slots.phone}
          />
          <input
            id={FIELD_INPUT_IDS.phone}
            data-slot="auth-input" className={`auth-input ${slots.phone?.tone === "err" ? "error" : ""}`}
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
        </div>}
        {!props.birthDate && <div className="auth-input-group" data-slot="auth-input-group">
          <FieldLabelRow
            data-component={`${ACCOUNT_COMPLETION_BASE}_birth-date-field`}
            htmlFor={FIELD_INPUT_IDS.birthDate}
            label="생년월일"
            message={slots.birthDate}
          />
          <input
            id={FIELD_INPUT_IDS.birthDate}
            data-slot="auth-input" className={`auth-input ${slots.birthDate?.tone === "err" ? "error" : ""}`}
            inputMode="numeric"
            maxLength={10}
            autoComplete="bday"
            value={form.birthDate ?? ""}
            onChange={(event) => updateField("birthDate", formatIsoDateInput(event.target.value))}
            {...fieldMessages.bind("birthDate")}
            placeholder="1990-01-01"
            {...fieldProps("birthDate")}
          />
        </div>}
        <button
          data-component={`${ACCOUNT_COMPLETION_BASE}_submit`}
          data-slot="auth-btn"
          className={isLoading ? "auth-btn relative" : "auth-btn"}
          type="submit"
          disabled={isLoading}
          aria-busy={isLoading ? true : undefined}
          data-loading={isLoading ? "" : undefined}
        >
          <ButtonLoadingContent loading={isLoading} loadingLabel="저장 중">저장하고 시작하기</ButtonLoadingContent>
        </button>
      </form>
    </div>
  );
}
