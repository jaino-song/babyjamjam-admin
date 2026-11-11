"use client";

import {
    REVIEW_EMPTY_LABEL,
    REVIEW_SECTIONS,
    formatReviewFieldValue,
    formatShortDate,
    getServiceRecordNumericErrors,
    resolvePlannedDates,
    type DailyItem,
    type ServiceRecordWizardProps,
    type ServiceRecordWizardSlots,
} from "@babyjamjam/service-record-ui";

import { ReviewRow, ReviewRowGrid, ReviewSection, StickyActionBar } from "@/components/app/ui/service-record";

import { ADMIN_MODE, DayPageHead } from "./DayPageStep";
import { Badge } from "@/components/ui/badge";
import { getAdminSessionStatus } from "./sessionStatus";

const SOURCE_COMPONENT = "ReviewStep";

export type ReviewStepProps = Pick<
    ServiceRecordWizardProps,
    | "data-component"
    | "context"
    | "day"
    | "changedSessionIndexes"
    | "lockedDays"
    | "pageIdx"
    | "draft"
    | "editing"
    | "readOnly"
    | "clientSignature"
    | "busy"
    | "hasServiceDateMismatch"
    | "defaultDate"
    | "onBack"
    | "onSignatureChange"
    | "onOpenServiceDateEditor"
    | "onEditSection"
> & {
    adminEditedSessionIndexes?: ReadonlySet<number>;
    baseSessionDraft?: Record<string, unknown>;
    serviceDateDisplay?: ServiceRecordWizardSlots["serviceDateDisplay"];
    serviceDateEditor?: ServiceRecordWizardSlots["serviceDateEditor"];
    /** Rendered under the review, called as SRW:987-993 does. Admin passes a read-only signature. */
    signature?: ServiceRecordWizardSlots["signature"];
    /**
     * Replaces the submit button inside the sticky bar (SRW:1020-1023). Required: the
     * admin wizard always passes it, so SRW's fallback button (SRW:1024) is not built.
     */
    adminSessionAction: NonNullable<ServiceRecordWizardSlots["adminSessionAction"]>;
};

function ReviewFieldRow({
    dataComponent,
    field,
    draft,
    baseSessionDraft,
}: {
    dataComponent: string;
    field: DailyItem;
    draft: Record<string, unknown>;
    baseSessionDraft?: Record<string, unknown>;
}) {
    const display = formatReviewFieldValue(field, draft);
    const base = baseSessionDraft === undefined ? undefined : formatReviewFieldValue(field, baseSessionDraft);
    const changed = base !== undefined && base.value !== display.value;
    const note = field.type === "textarea";
    return (
        <ReviewRow
            // Explicit (not derived from the grid's name): the admin specs count these suffixes.
            data-component={`${dataComponent}_section_${note ? "note" : "row"}`}
            labelId={`${dataComponent}_section_${field.key}-label`}
            label={field.label}
            value={changed ? <>
                <span className="sr-only" data-slot="old-value-label">변경 전 </span>
                <span data-slot="old-value" className="mr-[calc(6px*var(--glint-ui-scale,1))] text-v3-text-muted line-through">{base.value || REVIEW_EMPTY_LABEL}</span>
                <span className="sr-only" data-slot="new-value-label"> 변경 후 </span>
                <span data-slot="new-value" className="text-v3-burgundy">{display.value || REVIEW_EMPTY_LABEL}</span>
            </> : display.value || REVIEW_EMPTY_LABEL}
            tone={display.value ? (display.ok ? "ok" : "default") : "empty"}
            layout={note ? "note" : "inline"}
            className={note ? "sm:col-span-2" : undefined}
        />
    );
}

/**
 * The confirmation page of an admin day (SRW:970-994, :1018-1025 with `adminMode`):
 * session status, the review sections, the signature slot and the admin
 * session action. Like `DayPageStep` it renders its body and sticky bar as siblings.
 * There is no resign notice in admin (SRW:972) and no submit modal.
 */
export function ReviewStep({
    "data-component": root,
    context,
    day,
    draft,
    editing,
    readOnly = false,
    clientSignature,
    busy,
    hasServiceDateMismatch,
    defaultDate,
    onBack,
    onSignatureChange,
    onOpenServiceDateEditor,
    onEditSection,
    baseSessionDraft,
    changedSessionIndexes,
    lockedDays,
    adminEditedSessionIndexes,
    serviceDateEditor,
    signature,
    adminSessionAction,
}: ReviewStepProps) {
    const child = (suffix: string) => `${root}_${suffix}`;
    const reviewComponent = child("body_review");
    const { currentSession, currentServiceDate } = resolvePlannedDates({
        context, day, adminMode: ADMIN_MODE, draft, defaultDate,
    });
    const signatureValue = currentSession?.clientSignature ?? clientSignature; // SRW:576
    const isSignatureLocked = Boolean(currentSession?.clientSignature); // SRW:577
    const hasInvalidNumericAnswers = Object.keys(getServiceRecordNumericErrors(draft)).length > 0; // SRW:578-579

    const baseDate = String(baseSessionDraft?._date ?? "");
    const dateChanged = baseSessionDraft !== undefined && baseDate !== currentServiceDate;
    const hasVisibleChanges = dateChanged || (baseSessionDraft !== undefined && REVIEW_SECTIONS.some((section) =>
        section.fields.some((field) => formatReviewFieldValue(field, baseSessionDraft).value !== formatReviewFieldValue(field, draft).value)));
    const status = getAdminSessionStatus({
        pending: Boolean(changedSessionIndexes?.has(day)) || hasVisibleChanges,
        adminEdited: Boolean(adminEditedSessionIndexes?.has(day)),
        done: Boolean(lockedDays?.has(day)),
        adminEditing: !readOnly,
    });
    const displayDate = (date: string) => date
        ? `${formatShortDate(date)}(${"일월화수목금토"[new Date(`${date.slice(0, 10)}T00:00:00Z`).getUTCDay()]})`
        : REVIEW_EMPTY_LABEL;

    return (
        <>
            <div
                data-component={child("body")}
                data-source-component={SOURCE_COMPONENT}
                className="flex min-w-0 flex-1 flex-col gap-[calc(14px*var(--glint-ui-scale,1))] px-[calc(16px*var(--glint-ui-scale,1))] pb-[calc(24px*var(--glint-ui-scale,1))] pt-[calc(16px*var(--glint-ui-scale,1))]"
            >
                <DayPageHead
                    data-component={root}
                    day={day}
                    editing={editing}
                    readOnly={readOnly}
                    busy={busy}
                    hasServiceDateMismatch={hasServiceDateMismatch}
                    onBack={onBack}
                    onOpenServiceDateEditor={onOpenServiceDateEditor}
                    currentServiceDate={currentServiceDate}
                    title={`${day}회차 기록`}
                    hideDateChip
                    titleBadge={<Badge
                        data-component={child("body_submitted-badge")}
                        variant="outline"
                        className={`rounded-[50px] px-[calc(12px*var(--glint-ui-scale,1))] py-[calc(4px*var(--glint-ui-scale,1))] text-[calc(12px*var(--glint-ui-scale,1))] font-semibold ${status.tone === "warning" ? "bg-status-warning border-status-warning-line! text-status-warning-fg" : status.tone === "success" ? "bg-status-success border-status-success-line! text-status-success-fg" : "bg-v3-primary-light border-v3-primary/20! text-v3-primary"}`}
                    >{status.label}</Badge>}
                />
                <ReviewSection
                    data-component={child("body_service-date")}
                    titleId={child("body_service-date_title")}
                    title="서비스 제공일"
                    tone="baby"
                    headerAction={serviceDateEditor?.({
                        "data-component": child("body_date-edit"),
                        sessionIndex: day,
                        serviceDate: currentServiceDate,
                        disabled: readOnly || busy,
                        onOpen: () => onOpenServiceDateEditor?.(day),
                    })}
                >
                    <ReviewRow
                        data-component={child("body_service-date_row")}
                        labelId={child("body_service-date_row_label")}
                        label="서비스 제공일"
                        value={dateChanged ? <>
                            <span className="sr-only" data-slot="old-value-label">변경 전 </span>
                            <span data-slot="old-value" className="mr-[calc(6px*var(--glint-ui-scale,1))] text-v3-text-muted line-through">{displayDate(baseDate)}</span>
                            <span className="sr-only" data-slot="new-value-label"> 변경 후 </span>
                            <span data-slot="new-value" className="text-v3-burgundy">{displayDate(currentServiceDate)}</span>
                        </> : displayDate(currentServiceDate)}
                    />
                </ReviewSection>
                <div data-component={reviewComponent} data-slot="review">
                    {REVIEW_SECTIONS.map((section, sectionIndex) => (
                        <ReviewSection
                            key={section.id}
                            data-component={`${reviewComponent}_section`}
                            titleId={`${reviewComponent}_section_${section.id}-title`}
                            title={section.title}
                            tone={section.tone === "finish" ? "etc" : section.tone}
                            // SRW:418 - the edit buttons are absent (not disabled) unless editing and not read-only.
                            onEdit={editing && !readOnly ? () => onEditSection(sectionIndex) : undefined}
                        >
                            <ReviewRowGrid data-component={`${reviewComponent}_section_grid`}>
                                {section.fields.map((field) => (
                                    <ReviewFieldRow key={field.key} dataComponent={reviewComponent} field={field} draft={draft} baseSessionDraft={baseSessionDraft} />
                                ))}
                            </ReviewRowGrid>
                        </ReviewSection>
                    ))}
                </div>
                {signature
                    ? signature({
                        "data-component": child("body_mom-sign"),
                        value: signatureValue ?? null,
                        signedAt: currentSession?.clientSignedAt ?? null,
                        onChange: onSignatureChange,
                        locked: isSignatureLocked,
                    })
                    : null}
            </div>
            <StickyActionBar data-component={child("body_confirmation-action")}>
                {typeof adminSessionAction === "function"
                    ? adminSessionAction({ hasInvalidNumericAnswers })
                    : adminSessionAction}
            </StickyActionBar>
        </>
    );
}
