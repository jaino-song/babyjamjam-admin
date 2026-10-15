import { isRealIsoDate, resolveFieldMessage } from "../../../shared/src/utils/field-validation-message";
import { FIELD_COPY, fieldMessageToSlot, type SlotMessage } from "../field-messages";
import type { ServiceRecordContext, ServiceRecordSession } from "../types";
import { hintMessage } from "./messages";

export function isValidDateOnly(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split("-").map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return parsed.getUTCFullYear() === year
        && parsed.getUTCMonth() === month - 1
        && parsed.getUTCDate() === day;
}

export interface PlannedDatesInput {
    context: ServiceRecordContext | null;
    day: number;
    adminMode: boolean;
    draft: Record<string, unknown>;
    defaultDate: (day: number) => string;
}

export interface PlannedDates {
    /** The context session for `day`. */
    currentSession: ServiceRecordSession | undefined;
    plannedDateVectorProvided: boolean;
    /** False when a provided planned-date vector is malformed (wrong length, duplicates, bad date). */
    plannedDateVectorValid: boolean;
    plannedDateBySession: Map<number, string> | null;
    plannedServiceDate: string | undefined;
    providerDateLocked: boolean;
    currentServiceDate: string;
    displayDateForSession: (sessionIndex: number, session?: { serviceDate: string }) => string;
}

export function resolvePlannedDates({
    context,
    day,
    adminMode,
    draft,
    defaultDate,
}: PlannedDatesInput): PlannedDates {
    const currentSession = context?.sessions.find((session) => session.sessionIndex === day);
    const plannedDateVectorProvided = context?.plannedSessionDates !== undefined;
    const plannedDateVector = context?.plannedSessionDates;
    const plannedDateVectorValid = !plannedDateVectorProvided || (
        Array.isArray(plannedDateVector)
        && plannedDateVector.length === (context?.totalSessions ?? 0)
        && new Set(plannedDateVector.map((session) => session.sessionIndex)).size === plannedDateVector.length
        && new Set(plannedDateVector.map((session) => session.serviceDate)).size === plannedDateVector.length
        && plannedDateVector.every((session) => (
            Number.isSafeInteger(session.sessionIndex)
            && session.sessionIndex > 0
            && session.sessionIndex <= (context?.totalSessions ?? 0)
            && isValidDateOnly(session.serviceDate)
        ))
    );
    const plannedDateBySession = plannedDateVectorValid
        ? new Map(plannedDateVector?.map((session) => [session.sessionIndex, session.serviceDate]))
        : null;
    const plannedServiceDate = plannedDateBySession?.get(day);
    const providerDateLocked = !adminMode && plannedDateVectorProvided;
    const currentServiceDate = (providerDateLocked ? plannedServiceDate : undefined)
        || (draft._date as string | undefined)
        || currentSession?.serviceDate?.slice(0, 10)
        || plannedServiceDate
        || (plannedDateVectorProvided ? "" : defaultDate(day));
    const displayDateForSession = (sessionIndex: number, session?: { serviceDate: string }): string => (
        session?.serviceDate?.slice(0, 10)
        || plannedDateBySession?.get(sessionIndex)
        || (plannedDateVectorProvided ? "" : defaultDate(sessionIndex))
    );
    return {
        currentSession,
        plannedDateVectorProvided,
        plannedDateVectorValid,
        plannedDateBySession,
        plannedServiceDate,
        providerDateLocked,
        currentServiceDate,
        displayDateForSession,
    };
}

/** Earliest date the service date may take: the context start for day 1, the default date of the day otherwise. */
export function getServiceDateMin({
    day,
    context,
    defaultDate,
}: {
    day: number;
    context: ServiceRecordContext | null;
    defaultDate: (day: number) => string;
}): string | undefined {
    return day <= 1 ? (context?.startDate?.slice(0, 10) ?? undefined) : defaultDate(day);
}

export interface ServiceDateMessageInput {
    /** The text being typed, or null when the field is not being edited. */
    text: string | null;
    hadValue: boolean;
    touched: boolean;
    focused: boolean;
    submitted: boolean;
    min: string | undefined;
    /** The date differs from today (a caution, not an error). */
    mismatch: boolean;
    /** The date field is on screen. */
    fieldVisible: boolean;
}

export interface ServiceDateMessage {
    /** Only a complete valid date on or after `min` is reported to the caller. */
    reportable: (text: string) => boolean;
    blocked: boolean;
    /** The field's own format/range message, without the mismatch caution. */
    message: SlotMessage | null;
    /** What the field's message slot shows: `message`, else the mismatch caution while the field is visible. */
    slot: SlotMessage | null;
}

export function getServiceDateMessage({
    text,
    hadValue,
    touched,
    focused,
    submitted,
    min,
    mismatch,
    fieldVisible,
}: ServiceDateMessageInput): ServiceDateMessage {
    const reportable = (candidate: string): boolean => (
        isRealIsoDate(candidate) && (!min || candidate >= min)
    );
    const blocked = text !== null && !reportable(text);
    const message = text === null ? null : fieldMessageToSlot(
        resolveFieldMessage("date", {
            value: text,
            hadValue,
            touched,
            focused,
        }, {
            required: true,
            submitted,
            dateRange: min ? { notBefore: min } : undefined,
        }),
        { label: "제공일자", rangeText: FIELD_COPY.serviceDateBefore },
    );
    // A date that differs from today is a caution about this field: it sits in the field's slot
    // (below any error or format hint) while the field is on screen.
    const slot: SlotMessage | null = message
        ?? (fieldVisible && mismatch ? hintMessage(FIELD_COPY.serviceDateMismatch) : null);
    return { reportable, blocked, message, slot };
}
