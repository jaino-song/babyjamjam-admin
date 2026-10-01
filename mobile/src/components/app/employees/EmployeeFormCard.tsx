"use client";
import { formatIsoDateInput } from "@babyjamjam/shared/utils/date-input";

import { ChevronDown } from "lucide-react";
import { useLocale } from "@/providers/LocaleProvider";
import { t } from "@/lib/i18n/translations";
import { formatKoreanPhoneNumber, normalizeKoreanPhoneDigits } from "@/lib/phone";
import type { SlotMessage } from "@/lib/validations/field-message";
import { cn } from "@/lib/utils";
import { DEFAULT_EMPLOYEE_GRADE, EMPLOYEE_GRADES } from "@/features/employees/grade";
import { Switch } from "@/components/ui/switch";
import { WORK_AREAS, formatWorkAreaLabel } from "./employee-form.constants";
import styles from "./EmployeeFormCard.module.css";

const GRADE_OPTIONS = [
  { value: EMPLOYEE_GRADES[2], label: "스탠다드" },
  { value: EMPLOYEE_GRADES[1], label: "베스트" },
  { value: EMPLOYEE_GRADES[0], label: "프리미엄" },
] as const;

/** Always-on guidance for the open-to-next-work switch, shown in its label-row slot. */
const OPEN_STATUS_GUIDANCE = "완료 후 배정 후보에 표시돼요";

export interface EmployeeFormCardData {
  name: string;
  workArea: string[];
  phone: string;
  grade: string;
  openToNextWork: boolean;
  birthday: string;
}

export type EmployeeFormCardField = "name" | "phone" | "birthday";

/** The one message each field shows in the top-right of its label row. */
export interface EmployeeFormCardMessages {
  name?: SlotMessage | null;
  phone?: SlotMessage | null;
  birthday?: SlotMessage | null;
  workArea?: SlotMessage | null;
}

interface EmployeeFormCardProps {
  /** Caller-context canonical base, e.g. `mobile_employees_form-dialog_card`. */
  "data-component": string;
  formData: EmployeeFormCardData;
  messages: EmployeeFormCardMessages;
  disabled?: boolean;
  assignmentLabel?: string;
  assignmentDescription?: string;
  onChange: <K extends keyof EmployeeFormCardData>(field: K, value: EmployeeFormCardData[K]) => void;
  onFieldFocus: (field: EmployeeFormCardField) => void;
  onFieldBlur: (field: EmployeeFormCardField) => void;
  onWorkAreaTouched: () => void;
}

interface FieldLabelRowProps {
  "data-component": string;
  htmlFor?: string;
  label: string;
  required?: boolean;
  message?: SlotMessage | null;
  messageId: string;
}

/**
 * Label plus the field's single message slot. The row is one label line tall
 * (see .labelRow), so a message can never change the layout; it is cut with an
 * ellipsis instead. The live region stays mounted so updates are announced.
 */
function FieldLabelRow({
  "data-component": dataComponent,
  htmlFor,
  label,
  required = false,
  message,
  messageId,
}: FieldLabelRowProps) {
  const labelContent = (
    <>
      {label}
      {required ? <span className={styles.required}>*</span> : null}
    </>
  );

  return (
    <div className={styles.labelRow} data-component={`${dataComponent}_label-row`}>
      {htmlFor ? (
        <label className={styles.label} htmlFor={htmlFor}>
          {labelContent}
        </label>
      ) : (
        <div className={styles.label}>{labelContent}</div>
      )}
      <span
        id={messageId}
        className={cn(
          styles.inlineHelper,
          message?.tone === "ok" && styles.inlineHelperOk,
          message?.tone === "err" && styles.inlineHelperErr,
          message?.tone === "pending" && styles.inlineHelperPending,
        )}
        aria-live="polite"
        data-component={`${dataComponent}_helper`}
      >
        {message?.tone === "ok" ? "✓ " : null}
        {message?.text}
      </span>
    </div>
  );
}

export function EmployeeFormCard({
  "data-component": dataComponent,
  formData,
  messages,
  disabled = false,
  assignmentLabel,
  assignmentDescription = "등록 완료 후 선택값으로 자동 입력됩니다",
  onChange,
  onFieldFocus,
  onFieldBlur,
  onWorkAreaTouched,
}: EmployeeFormCardProps) {
  const sub = (suffix: string) => `${dataComponent}_${suffix}`;
  const locale = useLocale();

  const setField = <K extends keyof EmployeeFormCardData>(field: K, value: EmployeeFormCardData[K]) => {
    onChange(field, value);
  };

  const toggleWorkArea = (area: string) => {
    const nextAreas = formData.workArea.includes(area)
      ? formData.workArea.filter((selectedArea) => selectedArea !== area)
      : [...formData.workArea, area];

    setField("workArea", nextAreas);
  };

  return (
    <div className={styles.cardStack} data-component={dataComponent}>
      {assignmentLabel ? (
        <div className={styles.contextStrip} data-component={sub("assignment")}>
          <div>
            <strong className={styles.contextTitle}>{assignmentLabel}</strong>
            <span className={styles.contextDescription}>{assignmentDescription}</span>
          </div>
          <span className={styles.contextBadge}>신규 등록</span>
        </div>
      ) : null}

      <section className={styles.formSection} data-component={sub("section-basic")}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>{t(locale, "employees.form.section-basic")}</h2>
        </div>

        <div className={styles.field} data-component={sub("section-basic_field-name")}>
          <FieldLabelRow
            data-component={sub("section-basic_field-name")}
            htmlFor="employee-form-name"
            label={t(locale, "employees.form.name")}
            required
            message={messages.name}
            messageId="employee-form-name-message"
          />
          <input
            id="employee-form-name"
            className={cn(styles.control, messages.name?.tone === "err" && styles.controlError)}
            value={formData.name}
            onChange={(event) => setField("name", event.target.value)}
            onFocus={() => onFieldFocus("name")}
            onBlur={() => onFieldBlur("name")}
            placeholder="홍길동"
            aria-invalid={messages.name?.tone === "err"}
            aria-describedby="employee-form-name-message"
            disabled={disabled}
          />
        </div>

        <div className={styles.field} data-component={sub("section-basic_field-phone")}>
          <FieldLabelRow
            data-component={sub("section-basic_field-phone")}
            htmlFor="employee-form-phone"
            label={t(locale, "employees.form.phone")}
            required
            message={messages.phone}
            messageId="employee-form-phone-message"
          />
          <input
            id="employee-form-phone"
            className={cn(styles.control, messages.phone?.tone === "err" && styles.controlError)}
            value={formatKoreanPhoneNumber(formData.phone)}
            onChange={(event) => setField("phone", normalizeKoreanPhoneDigits(event.target.value))}
            onFocus={() => onFieldFocus("phone")}
            onBlur={() => onFieldBlur("phone")}
            placeholder="010-1234-5678"
            maxLength={20}
            inputMode="tel"
            aria-invalid={messages.phone?.tone === "err"}
            aria-describedby="employee-form-phone-message"
            disabled={disabled}
          />
        </div>

        <div className={styles.field} data-component={sub("section-basic_field-birthday")}>
          <FieldLabelRow
            data-component={sub("section-basic_field-birthday")}
            htmlFor="employee-form-birthday"
            label="생년월일"
            message={messages.birthday}
            messageId="employee-form-birthday-message"
          />
          <input
            id="employee-form-birthday"
            className={cn(styles.control, messages.birthday?.tone === "err" && styles.controlError)}
            value={formData.birthday}
            onChange={(event) => setField("birthday", formatIsoDateInput(event.target.value))}
            onFocus={() => onFieldFocus("birthday")}
            onBlur={() => onFieldBlur("birthday")}
            placeholder="1958-03-03"
            maxLength={10}
            inputMode="numeric"
            aria-invalid={messages.birthday?.tone === "err"}
            aria-describedby="employee-form-birthday-message"
            disabled={disabled}
          />
        </div>
      </section>

      <section className={styles.formSection} data-component={sub("section-work")}>
        <div className={styles.sectionHead}>
          <h2 className={styles.sectionTitle}>{t(locale, "employees.form.section-work")}</h2>
        </div>

        <div className={styles.field} data-component={sub("section-work_field-grade")}>
          <FieldLabelRow
            data-component={sub("section-work_field-grade")}
            htmlFor="employee-form-grade"
            label={t(locale, "employees.form.grade")}
            required
            messageId="employee-form-grade-message"
          />
          <div className={styles.selectWrap}>
            <select
              id="employee-form-grade"
              className={styles.select}
              aria-describedby="employee-form-grade-message"
              value={formData.grade || DEFAULT_EMPLOYEE_GRADE}
              onChange={(event) => setField("grade", event.target.value)}
              disabled={disabled}
            >
              {GRADE_OPTIONS.map((grade) => (
                <option key={grade.value} value={grade.value}>
                  {grade.label}
                </option>
              ))}
            </select>
            <ChevronDown className={styles.selectIcon} aria-hidden="true" strokeWidth={2.2} />
          </div>
        </div>

        <div className={styles.field} data-component={sub("section-work_field-work-area")}>
          <FieldLabelRow
            data-component={sub("section-work_field-work-area")}
            label={t(locale, "employees.form.work-area")}
            required
            message={messages.workArea}
            messageId="employee-form-work-area-message"
          />
          <div
            id="employee-form-work-area"
            className={styles.chipGrid}
            data-component={sub("section-work_field-work-area_options")}
            aria-describedby="employee-form-work-area-message"
            onBlur={onWorkAreaTouched}
          >
            {WORK_AREAS.map((area) => {
              const isSelected = formData.workArea.includes(area);

              return (
                <button
                  key={area}
                  type="button"
                  className={cn(styles.chip, isSelected && styles.chipSelected)}
                  onClick={() => toggleWorkArea(area)}
                  aria-pressed={isSelected}
                  disabled={disabled}
                >
                  {formatWorkAreaLabel(area)}
                </button>
              );
            })}
          </div>
        </div>

        <div className={styles.field} data-component={sub("section-work_field-open-status")}>
          <FieldLabelRow
            data-component={sub("section-work_field-open-status")}
            label={t(locale, "employees.form.open-to-next-work")}
            message={{ text: OPEN_STATUS_GUIDANCE, tone: "muted" }}
            messageId="employee-form-open-status-message"
          />
          <div className={styles.switchRow}>
            <strong className={styles.switchTitle}>다음 근무 배정 가능</strong>
            <Switch
              data-component={sub("section-work_field-open-status_switch")}
              thumbDataComponent="employees-form-dialog-open-status-switch-thumb"
              checked={formData.openToNextWork}
              onCheckedChange={(checked) => setField("openToNextWork", checked)}
              aria-label="다음 근무 배정 가능"
              aria-describedby="employee-form-open-status-message"
              disabled={disabled}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
