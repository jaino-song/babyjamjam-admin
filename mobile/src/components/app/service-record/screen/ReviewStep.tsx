"use client";

import {
    DAY_PAGES,
    REVIEW_EMPTY_LABEL,
    REVIEW_SECTIONS,
    formatReviewFieldValue,
    getServiceRecordNumericErrors,
    hasInvalidTextAnswers,
    resolvePlannedDates,
    type DailyItem,
    type ServiceRecordWizardProps,
} from "@babyjamjam/service-record-ui";

import { ReviewRow, ReviewSection } from "@/components/app/v3/ReviewSection";
import { StickyActionBar } from "@/components/app/v3/StickyActionBar";
import { Button } from "@/components/ui/button";

import { SignaturePad } from "../SignaturePad";
import { DayPageHead } from "./DayPageStep";
import { HANDOVER_BANNER_COPY, RESIGN_NOTICE_COPY, SUBMIT_LABEL } from "./ids";

const SOURCE_COMPONENT = "ReviewStep";

/** Shown instead of the edit and submit actions on a day another caregiver submitted. */
const OTHER_CAREGIVER_NOTICE_COPY = "다른 제공인력이 제출한 회차라 수정할 수 없어요.";

export type ReviewStepProps = Pick<
    ServiceRecordWizardProps,
    | "data-component"
    | "context"
    | "day"
    | "pageIdx"
    | "draft"
    | "editing"
    | "clientSignature"
    | "busy"
    | "hasServiceDateMismatch"
    | "defaultDate"
    | "onBack"
    | "onSignatureChange"
    | "onOpenSubmitModal"
    | "onEditSection"
>;

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
    return (
        <ReviewRow
            data-component={`${dataComponent}_section_${field.type === "textarea" ? "note" : "row"}`}
            labelId={`${dataComponent}_section_${field.key}-label`}
            label={field.label}
            value={display.value || REVIEW_EMPTY_LABEL}
            tone={display.value ? (display.ok ? "ok" : "default") : "empty"}
            layout={field.type === "textarea" ? "note" : "inline"}
        />
    );
}

/**
 * The confirmation page of a day (SRW:970-994, :1018-1025 with `readOnly` and
 * `adminMode` false): handover banner, the review sections, the mom's signature and
 * the submit action. Like `DayPageStep` it renders its body and sticky bar as siblings.
 */
export function ReviewStep({
    "data-component": root,
    context,
    day,
    pageIdx,
    draft,
    editing,
    clientSignature,
    busy,
    hasServiceDateMismatch,
    defaultDate,
    onBack,
    onSignatureChange,
    onOpenSubmitModal,
    onEditSection,
}: ReviewStepProps) {
    const child = (suffix: string) => `${root}_${suffix}`;
    const reviewComponent = child("body_review");
    const currentDayPage = DAY_PAGES[pageIdx] ?? DAY_PAGES[0];
    const { currentSession, currentServiceDate } = resolvePlannedDates({
        context, day, adminMode: false, draft, defaultDate,
    });
    // The server lets only the caregiver who submitted a locked day resubmit it; a day with
    // no recorded submitter is treated as not editable, like the server does.
    const readOnlyOther = Boolean(currentSession?.locked) && currentSession?.employeeId !== context?.employee?.id;
    const signatureValue = currentSession?.clientSignature ?? clientSignature;
    const isSignatureLocked = Boolean(currentSession?.clientSignature);
    const hasInvalidNumericAnswers = Object.keys(getServiceRecordNumericErrors(draft)).length > 0;
    const submitDisabled = busy || !signatureValue || hasInvalidNumericAnswers || hasInvalidTextAnswers(draft);

    return (
        <>
            <div
                data-component={child("body")}
                data-source-component={SOURCE_COMPONENT}
                className="flex min-w-0 flex-1 flex-col gap-3.5 px-4 pb-6 pt-4"
            >
                <DayPageHead
                    data-component={root}
                    day={day}
                    pageIdx={pageIdx}
                    editing={editing}
                    hasServiceDateMismatch={hasServiceDateMismatch}
                    onBack={onBack}
                    currentServiceDate={currentServiceDate}
                    title={currentDayPage.title}
                >
                    {readOnlyOther && (
                        <div
                            data-component={child("body_other-caregiver-notice")}
                            className="rounded-[10px] bg-v3-dim-white px-3 py-2 text-[13px] text-v3-text-muted"
                        >
                            <span>{OTHER_CAREGIVER_NOTICE_COPY}</span>
                        </div>
                    )}
                    {editing && !readOnlyOther && (
                        <div
                            data-component={child("body_resign-notice")}
                            className="rounded-[10px] bg-v3-dim-white px-3 py-2 text-[13px] text-v3-text"
                        >
                            <span>{RESIGN_NOTICE_COPY}</span>
                        </div>
                    )}
                    <div
                        data-component={child("body_handover-banner")}
                        className="rounded-[10px] bg-v3-primary-light px-3 py-2.5 text-[13px] text-v3-primary"
                    >
                        <b>{HANDOVER_BANNER_COPY}</b>
                    </div>
                </DayPageHead>
                <div data-component={reviewComponent}>
                    {REVIEW_SECTIONS.map((section, sectionIndex) => (
                        <ReviewSection
                            key={section.id}
                            data-component={`${reviewComponent}_section`}
                            titleId={`${reviewComponent}_section_${section.id}-title`}
                            title={section.title}
                            tone={section.tone === "finish" ? "etc" : section.tone}
                            onEdit={editing && !readOnlyOther ? () => onEditSection(sectionIndex) : undefined}
                        >
                            {section.fields.map((field) => (
                                <ReviewFieldRow key={field.key} dataComponent={reviewComponent} field={field} draft={draft} />
                            ))}
                        </ReviewSection>
                    ))}
                </div>
                <SignaturePad
                    data-component={child("body_mom-sign")}
                    value={signatureValue ?? null}
                    signedAt={currentSession?.clientSignedAt ?? null}
                    onChange={onSignatureChange}
                    locked={isSignatureLocked}
                />
            </div>
            {!readOnlyOther && (
                <StickyActionBar data-component={child("body_confirmation-action")}>
                    <Button type="button" variant="v3" size="md" disabled={submitDisabled} onClick={onOpenSubmitModal}>
                        {SUBMIT_LABEL}
                    </Button>
                </StickyActionBar>
            )}
        </>
    );
}
