"use client";

import { useState, type FormEvent } from "react";

import { InputField } from "@/components/app/v3";
import { Button } from "@/components/ui/button";
import { formatIsoDateInput } from "@babyjamjam/shared/utils/date-input";
import { PROBLEM_CATALOG } from "@babyjamjam/shared";

import { isValidIsoDate, isWeekend } from "./holiday-format";

const SOURCE_COMPONENT = "HolidayAddForm";
const DEFAULT_DATA_COMPONENT = "mobile_holidays_settings_add-form";
const NAME_MAX_LENGTH = 50;

const DATE_FORMAT_ERROR = "YYYY-MM-DD 형식으로 입력해 주세요.";
// Same copy the server answers with, so a client-side rejection reads the same
// as a server-side one.
const WEEKDAY_ERROR = PROBLEM_CATALOG.HOLIDAY_NOT_WEEKDAY.title["ko-KR"];
const PAST_ERROR = PROBLEM_CATALOG.HOLIDAY_DATE_IN_PAST.title["ko-KR"];
const NAME_ERROR = PROBLEM_CATALOG.HOLIDAY_NAME_REQUIRED.title["ko-KR"];
const YEAR_ERROR = PROBLEM_CATALOG.HOLIDAY_YEAR_UNSUPPORTED.title["ko-KR"];

interface HolidayAddFormProps {
  /** Today in Korea (YYYY-MM-DD). */
  today: string;
  /** Years the section shows; a date outside them is rejected before the request. */
  years: readonly number[];
  pending?: boolean;
  /** Resolves on success (the form clears) and rejects on failure (the form keeps its input; the caller reports the error). */
  onAdd: (input: { date: string; name: string }) => Promise<unknown>;
  dataComponent?: string;
}

export function HolidayAddForm({
  today,
  years,
  pending = false,
  onAdd,
  dataComponent = DEFAULT_DATA_COMPONENT,
}: HolidayAddFormProps) {
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [dateError, setDateError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);

  function validateDate(value: string): string | null {
    if (!isValidIsoDate(value)) return DATE_FORMAT_ERROR;
    if (value < today) return PAST_ERROR;
    if (isWeekend(value)) return WEEKDAY_ERROR;
    if (!years.includes(Number(value.slice(0, 4)))) return YEAR_ERROR;
    return null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    const nextDateError = validateDate(date.trim());
    const nextNameError = trimmedName.length === 0 ? NAME_ERROR : null;
    setDateError(nextDateError);
    setNameError(nextNameError);
    if (nextDateError || nextNameError) return;

    try {
      await onAdd({ date: date.trim(), name: trimmedName });
      setDate("");
      setName("");
    } catch {
      // The caller already surfaced the server's message; keep the input.
    }
  }

  const dateErrorId = `${dataComponent}-date-error`;
  const nameErrorId = `${dataComponent}-name-error`;

  return (
    <form
      noValidate
      data-component={dataComponent}
      data-source-component={SOURCE_COMPONENT}
      className="grid gap-3 rounded-2xl bg-v3-dim-white px-4 py-3.5"
      onSubmit={(event) => void handleSubmit(event)}
    >
      <InputField
        data-component={`${dataComponent}_date`}
        title="날짜"
        message={dateError}
        messageTone="error"
        messageId={dateErrorId}
        inputProps={{
          id: `${dataComponent}-date`,
          value: date,
          placeholder: "YYYY-MM-DD",
          inputMode: "numeric",
          maxLength: 10,
          autoComplete: "off",
          error: dateError !== null,
          "aria-invalid": dateError !== null,
          "aria-describedby": dateError ? dateErrorId : undefined,
          onChange: (event) => {
            setDate(formatIsoDateInput(event.target.value));
            setDateError(null);
          },
        }}
      />
      <InputField
        data-component={`${dataComponent}_name`}
        title="이름"
        message={nameError}
        messageTone="error"
        messageId={nameErrorId}
        inputProps={{
          id: `${dataComponent}-name`,
          value: name,
          placeholder: "예: 임시공휴일",
          maxLength: NAME_MAX_LENGTH,
          autoComplete: "off",
          error: nameError !== null,
          "aria-invalid": nameError !== null,
          "aria-describedby": nameError ? nameErrorId : undefined,
          onChange: (event) => {
            setName(event.target.value);
            setNameError(null);
          },
        }}
      />
      <Button
        type="submit"
        data-component={`${dataComponent}_submit-trigger`}
        disabled={pending}
        aria-busy={pending || undefined}
      >
        {pending ? "추가 중..." : "공휴일 추가"}
      </Button>
    </form>
  );
}
