import { isValidBirthdayIsoDate } from "@babyjamjam/shared/utils/birthday";
import { normalizeKoreanPhoneDigits } from "@babyjamjam/shared/utils/phone";
import {
  resolveFieldMessage,
  withObjectParticle,
  type FieldInputState,
  type FieldMessage,
} from "@babyjamjam/shared/utils/field-validation-message";

import { t, type Locale } from "@/lib/i18n/translations";

/**
 * Mobile rendering of the shared field-message resolver. The resolver decides
 * WHICH message a field shows (a code); this module turns that code into the
 * surface copy and into the tone names the mobile form styles already use.
 */

/** "muted" = hint, "err" = error, "ok"/"pending" = duplicate-check status. */
export type SlotTone = "muted" | "ok" | "err" | "pending";

export interface SlotMessage {
  text: string;
  tone: SlotTone;
}

/** "birthday" is a date that may not lie in the future. */
export type FieldSpecKind = "text" | "phone" | "date" | "birthday";

export interface FieldSpec {
  kind: FieldSpecKind;
  /** Field name used in the required message (e.g. 이름 -> "이름을 입력해 주세요"). */
  label: string;
  required?: boolean;
  dateRange?: { notBefore?: string };
  /**
   * Phone only: the form needs a mobile number (11 digits, 01X...), so a
   * landline the shared resolver accepts still counts as incomplete here.
   */
  mobileOnly?: boolean;
  /**
   * Phone + mobileOnly only: the number already stored for the record being
   * edited. While the value still equals it (digits only) the mobile-only rule
   * is waived, so an existing landline passes until the user changes it.
   */
  acceptedPhone?: string | null;
}

const MOBILE_PHONE_DIGITS = /^01\d{9}$/;

function isAcceptedStoredPhone(spec: FieldSpec, value: string): boolean {
  const accepted = normalizeKoreanPhoneDigits(spec.acceptedPhone ?? "");
  return accepted !== "" && accepted === normalizeKoreanPhoneDigits(value);
}

/** A value the shared resolver can never accept, used to force its "incomplete" branch. */
const ALWAYS_INCOMPLETE_PHONE = "0";

export interface FieldMessageContext {
  submitted: boolean;
}

function labelForCopy(locale: Locale, label: string): string {
  return locale === "ko" ? withObjectParticle(label) : label;
}

export function fieldMessageText(locale: Locale, message: FieldMessage, label: string): string {
  const copy = t(locale, `validation.${message.code}`);
  return copy.replace("{label}", labelForCopy(locale, label));
}

function toSlotMessage(locale: Locale, message: FieldMessage, label: string): SlotMessage {
  return {
    text: fieldMessageText(locale, message, label),
    tone: message.tone === "error" ? "err" : "muted",
  };
}

/** The message a field's label-row slot shows for its validation state, or null. */
export function resolveSlotMessage(
  locale: Locale,
  spec: FieldSpec,
  state: FieldInputState,
  ctx: FieldMessageContext,
): SlotMessage | null {
  const resolverOptions = {
    required: spec.required,
    submitted: ctx.submitted,
    dateRange: spec.dateRange,
  };
  const message =
    spec.kind === "phone"
    && spec.mobileOnly
    && state.value !== ""
    && !MOBILE_PHONE_DIGITS.test(normalizeKoreanPhoneDigits(state.value))
    && !isAcceptedStoredPhone(spec, state.value)
      // Reuse the resolver's hint/error timing instead of duplicating it.
      ? resolveFieldMessage("phone", { ...state, value: ALWAYS_INCOMPLETE_PHONE }, resolverOptions)
      : resolveFieldMessage(spec.kind === "birthday" ? "date" : spec.kind, state, resolverOptions);
  if (message) return toSlotMessage(locale, message, spec.label);

  // The shared resolver accepts any real date; a birthday may not be in the future.
  if (spec.kind === "birthday" && state.value !== "" && !isValidBirthdayIsoDate(state.value)) {
    return { text: t(locale, "validation.birthday-future"), tone: "err" };
  }
  return null;
}

/** True when the value cannot be saved as it stands (any hint/error counts). */
export function isFieldValueInvalid(locale: Locale, spec: FieldSpec, value: string): boolean {
  return (
    resolveSlotMessage(
      locale,
      spec,
      { value, hadValue: false, touched: true, focused: false },
      { submitted: true },
    ) !== null
  );
}

/**
 * One slot shows one message. Error beats hint beats informational status
 * (duplicate-check "ok"/"pending"); ties keep the caller's order.
 */
export function pickSlotMessage(
  ...candidates: ReadonlyArray<SlotMessage | null | undefined>
): SlotMessage | null {
  const present = candidates.filter((candidate): candidate is SlotMessage => Boolean(candidate));
  return (
    present.find((candidate) => candidate.tone === "err")
    ?? present.find((candidate) => candidate.tone === "muted")
    ?? present[0]
    ?? null
  );
}

const FOCUSABLE_SELECTOR = "input,select,textarea,button,[tabindex]";

/** Scrolls to and focuses the first element found among ids (caller orders them). */
export function focusFirstInvalidField(ids: ReadonlyArray<string>): void {
  for (const id of ids) {
    const element = document.getElementById(id);
    if (!element) continue;
    const target = element.matches(FOCUSABLE_SELECTOR)
      ? element
      : element.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ?? element;
    target.scrollIntoView?.({ block: "center", behavior: "smooth" });
    target.focus({ preventScroll: true });
    return;
  }
}
