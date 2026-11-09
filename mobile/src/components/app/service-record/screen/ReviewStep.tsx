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
import { SERVICE_DATE_LABEL, SUBMIT_LABEL } from "./ids";
import { StatusBadge } from "@/components/app/ui/status-badge";
import { formatServiceDate } from "./ServiceDateSheet";

const SOURCE_COMPONENT = "ReviewStep";

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
    | "defaultDate"
    | "onBack"
    | "onSignatureChange"
    | "onOpenSubmitModal"
    | "onEditSection"
> & {
    onOpenDateSheet?: () => void;
    onDeleteSession?: () => void;
    serviceDateError?: string | null;
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
    defaultDate,
    onBack,
    onSignatureChange,
    onOpenSubmitModal,
    onEditSection,
    onOpenDateSheet,
    onDeleteSession,
    serviceDateError,
}: ReviewStepProps) {
    const child = (suffix: string) => `${root}_${suffix}`;
    const reviewComponent = child("body_review");
    const currentDayPage = DAY_PAGES[pageIdx] ?? DAY_PAGES[0];
    const { currentSession, currentServiceDate } = resolvePlannedDates({
        context, day, adminMode: false, draft, defaultDate,
    });
    const signatureValue = currentSession?.clientSignature ?? clientSignature;
    const isSignatureLocked = Boolean(currentSession?.clientSignature);
    const hasInvalidNumericAnswers = Object.keys(getServiceRecordNumericErrors(draft)).length > 0;
    const submitDisabled = busy || !currentServiceDate || Boolean(serviceDateError) || !signatureValue || hasInvalidNumericAnswers || hasInvalidTextAnswers(draft);

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
                    onBack={onBack}
                    currentServiceDate={currentServiceDate}
                    title={editing ? `${day}회차 기록 수정` : currentDayPage.title}
                    titleAccessory={editing ? <StatusBadge data-component={child("body_submitted-badge")} variant="primary" className="text-xs">제출완료</StatusBadge> : undefined}
                />
                {editing && (
                    <ReviewSection data-component={child("body_service-date")} titleId={child("body_service-date_title")} title={SERVICE_DATE_LABEL} tone="baby" onEdit={onOpenDateSheet}>
                        <ReviewRow
                            data-component={child("body_service-date_row")}
                            labelId={child("body_service-date_row_label")}
                            label={SERVICE_DATE_LABEL}
                            value={<>
                                {currentSession?.serviceDate.slice(0, 10) !== currentServiceDate && <del className="mr-2 text-v3-text-muted">{currentSession?.serviceDate.slice(5, 10).replace("-", ".")}</del>}
                                {formatServiceDate(currentServiceDate)}
                            </>}
                            tone={currentSession?.serviceDate.slice(0, 10) !== currentServiceDate ? "ok" : "default"}
                        />
                        {currentSession?.serviceDate.slice(0, 10) !== currentServiceDate && <p data-component={child("body_service-date_help")} className="text-sm text-v3-text-muted">다른 회차 날짜는 바뀌지 않아요.</p>}
                        {serviceDateError && <p data-component={child("body_service-date_error")} role="alert" className="text-sm text-v3-burgundy">{serviceDateError}</p>}
                    </ReviewSection>
                )}
                <div data-component={reviewComponent}>
                    {REVIEW_SECTIONS.map((section, sectionIndex) => (
                        <ReviewSection
                            key={section.id}
                            data-component={`${reviewComponent}_section`}
                            titleId={`${reviewComponent}_section_${section.id}-title`}
                            title={section.title}
                            tone={section.tone === "finish" ? "etc" : section.tone}
                            onEdit={editing ? () => onEditSection(sectionIndex) : undefined}
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
            <StickyActionBar data-component={child("body_confirmation-action")}>
                {currentSession && <Button data-component={child("body_confirmation-action_delete")} type="button" variant="v3-outline" size="md" className="text-base border-v3-burgundy text-v3-burgundy" disabled={busy} onClick={onDeleteSession}>기록 삭제</Button>}
                <Button className="text-base" type="button" variant="v3" size="md" disabled={submitDisabled} onClick={onOpenSubmitModal}>
                    {SUBMIT_LABEL}
                </Button>
            </StickyActionBar>
        </>
    );
}
