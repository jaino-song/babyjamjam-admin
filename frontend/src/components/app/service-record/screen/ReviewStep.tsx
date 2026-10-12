"use client";

import {
    DAY_PAGES,
    REVIEW_EMPTY_LABEL,
    REVIEW_SECTIONS,
    formatReviewFieldValue,
    getServiceRecordNumericErrors,
    resolvePlannedDates,
    type DailyItem,
    type ServiceRecordWizardProps,
    type ServiceRecordWizardSlots,
} from "@babyjamjam/service-record-ui";

import { ReviewRow, ReviewRowGrid, ReviewSection, StickyActionBar } from "@/components/app/ui/service-record";

import { ADMIN_MODE, DayPageHead } from "./DayPageStep";
import { ADMIN_HANDOVER_BANNER_COPY } from "./ids";

const SOURCE_COMPONENT = "ReviewStep";

export type ReviewStepProps = Pick<
    ServiceRecordWizardProps,
    | "data-component"
    | "context"
    | "day"
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
}: {
    dataComponent: string;
    field: DailyItem;
    draft: Record<string, unknown>;
}) {
    const display = formatReviewFieldValue(field, draft);
    const note = field.type === "textarea";
    return (
        <ReviewRow
            // Explicit (not derived from the grid's name): the admin specs count these suffixes.
            data-component={`${dataComponent}_section_${note ? "note" : "row"}`}
            labelId={`${dataComponent}_section_${field.key}-label`}
            label={field.label}
            value={display.value || REVIEW_EMPTY_LABEL}
            tone={display.value ? (display.ok ? "ok" : "default") : "empty"}
            layout={note ? "note" : "inline"}
            className={note ? "sm:col-span-2" : undefined}
        />
    );
}

/**
 * The confirmation page of an admin day (SRW:970-994, :1018-1025 with `adminMode`):
 * admin handover banner, the review sections, the signature slot and the admin
 * session action. Like `DayPageStep` it renders its body and sticky bar as siblings.
 * There is no resign notice in admin (SRW:972) and no submit modal.
 */
export function ReviewStep({
    "data-component": root,
    context,
    day,
    pageIdx,
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
    serviceDateDisplay,
    serviceDateEditor,
    signature,
    adminSessionAction,
}: ReviewStepProps) {
    const child = (suffix: string) => `${root}_${suffix}`;
    const reviewComponent = child("body_review");
    const currentDayPage = DAY_PAGES[pageIdx] ?? DAY_PAGES[0];
    const { currentSession, currentServiceDate } = resolvePlannedDates({
        context, day, adminMode: ADMIN_MODE, draft, defaultDate,
    });
    const signatureValue = currentSession?.clientSignature ?? clientSignature; // SRW:576
    const isSignatureLocked = Boolean(currentSession?.clientSignature); // SRW:577
    const hasInvalidNumericAnswers = Object.keys(getServiceRecordNumericErrors(draft)).length > 0; // SRW:578-579

    return (
        <>
            <div
                data-component={child("body")}
                data-source-component={SOURCE_COMPONENT}
                className="flex min-w-0 flex-1 flex-col gap-[calc(14px*var(--glint-ui-scale,1))] px-[calc(16px*var(--glint-ui-scale,1))] pb-[calc(24px*var(--glint-ui-scale,1))] pt-[calc(16px*var(--glint-ui-scale,1))] sm:px-[calc(24px*var(--glint-ui-scale,1))]"
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
                    title={currentDayPage.title}
                    serviceDateDisplay={serviceDateDisplay}
                    serviceDateEditor={serviceDateEditor}
                >
                    <div
                        data-component={child("body_handover-banner")}
                        className="rounded-[10px] bg-v3-primary-light px-[calc(12px*var(--glint-ui-scale,1))] py-[calc(10px*var(--glint-ui-scale,1))] text-[calc(13px*var(--glint-ui-scale,1))] text-v3-primary"
                    >
                        <b>{ADMIN_HANDOVER_BANNER_COPY}</b>
                    </div>
                </DayPageHead>
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
                                    <ReviewFieldRow key={field.key} dataComponent={reviewComponent} field={field} draft={draft} />
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
