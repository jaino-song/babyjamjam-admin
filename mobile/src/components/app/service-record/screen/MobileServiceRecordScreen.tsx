"use client";

import type { ReactNode } from "react";
import {
    DAY_PAGES,
    getWizardProgress,
    resolvePlannedDates,
    type ServiceRecordWizardSlots,
} from "@babyjamjam/service-record-ui";

import { ServiceRecordStepHeader } from "@/components/app/v3/ServiceRecordStepHeader";
import { DEFAULT_PROVIDER_NAME, ProviderInfo } from "@/components/service-record/provider-info";

import type { MobileServiceRecordWizardProps } from "../ServiceRecordWizard";
import { DayPageStep } from "./DayPageStep";
import {
    DONE_TITLE,
    INVALID_COPY,
    INVALID_TITLE,
    LOADING_COPY,
    PLANNED_DATE_ERROR_COPY,
    SCREEN_TITLE,
} from "./ids";
import { OverviewStep } from "./OverviewStep";
import { PhoneStep } from "./PhoneStep";
import { ReviewStep } from "./ReviewStep";
import { useServiceDateFieldState } from "./serviceDateFieldState";
import { useHeaderFieldState, usePhoneFieldState } from "./fieldInteractionState";
import { ServiceInfoStep } from "./ServiceInfoStep";

const SOURCE_COMPONENT = "MobileServiceRecordScreen";

/**
 * What the mobile page drives: the wrapper's props without the administrator-only
 * ones (`adminMode`, `readOnly`, `headerErrors`, `changedSessionIndexes`,
 * `onOpenServiceDateEditor`, and the `admin*` / `serviceDate*` / `overviewSupplemental`
 * slots). The screen renders `ProviderInfo` and `SignaturePad` itself.
 */
export type MobileServiceRecordScreenProps = Omit<
    MobileServiceRecordWizardProps,
    "adminMode" | "readOnly" | "headerErrors" | "changedSessionIndexes" | "onOpenServiceDateEditor" | "slots"
> & {
    slots?: Pick<ServiceRecordWizardSlots, "submitModal" | "scheduleChangeModal" | "serviceDateChangeModal" | "errorNotification">;
};

/** A screen with no step of its own (loading / invalid / done): the root supplies the body. */
function StatusBody({ "data-component": dataComponent, children }: { "data-component": string; children: ReactNode }) {
    return (
        <div
            data-component={dataComponent}
            className="flex min-w-0 flex-1 flex-col items-center justify-center gap-3 px-4 py-10 text-center"
        >
            {children}
        </div>
    );
}

/**
 * The mobile service-record flow on m.admin's design system. It renders the same
 * screens, copy and callbacks as the shared `ServiceRecordWizard` does for the public
 * (non-admin, editable) flow (SRW:677-1053). Each step renders its own body and
 * sticky action bar, so this root is the `min-h-dvh` column that holds them.
 */
export function MobileServiceRecordScreen({
    "data-component": root,
    screen,
    phone,
    phoneError,
    phoneFieldError,
    context,
    header,
    day,
    pageIdx,
    draft,
    editing,
    clientSignature,
    busy,
    isRecordFinalized,
    lockedDays,
    nextOpenDay,
    scheduleChangeBusy,
    hasServiceDateMismatch,
    defaultDate,
    onPhoneChange,
    onSubmitPhone,
    onBack,
    onHeaderChange,
    onDeliveryTypeChange,
    onSaveHeader,
    onOpenDay,
    onOpenScheduleChangePreview,
    onServiceDateChange,
    onFieldChange,
    onToggleMulti,
    onSignatureChange,
    onNextPage,
    onOpenSubmitModal,
    onEditSection,
    slots,
}: MobileServiceRecordScreenProps) {
    const child = (suffix: string) => `${root}_${suffix}`;
    const currentDayPage = DAY_PAGES[pageIdx] ?? DAY_PAGES[0];
    const { plannedDateVectorProvided, plannedDateVectorValid, currentServiceDate } = resolvePlannedDates({
        context, day, adminMode: false, draft, defaultDate,
    });
    // The service-date field's state outlives the day pages (SRW:529-536), so it lives here.
    const dateState = useServiceDateFieldState({ currentServiceDate, day });
    // Phone and header interaction state also lives at wizard level (SRW:523-528), so it survives history navigation.
    const phoneState = usePhoneFieldState(phone);
    const headerState = useHeaderFieldState(header);
    const progress = getWizardProgress(screen, pageIdx);

    const crumbs = (
        <>
            {screen === "phone" && <>1단계 · <b>본인 확인</b></>}
            {screen === "service" && <>2단계 · <b>서비스 기본정보</b></>}
            {screen === "overview" && <>3단계 · <b>일자별 기록</b></>}
            {screen === "day" && <><b>{day}회차</b> · {currentDayPage.title} ({pageIdx + 1}/{DAY_PAGES.length})</>}
            {screen === "done" && <b>최종 제출 완료</b>}
        </>
    );

    return (
        <div
            data-component={root}
            data-source-component={SOURCE_COMPONENT}
            className="flex min-h-dvh min-w-0 flex-col bg-white"
        >
            <ServiceRecordStepHeader
                data-component={child("top-bar")}
                title={SCREEN_TITLE}
                meta={(
                    <ProviderInfo
                        data-component={child("top-bar_meta_provider-name")}
                        providerName={context?.org?.name ?? DEFAULT_PROVIDER_NAME}
                    />
                )}
                crumbs={crumbs}
                progress={progress / 100}
            />
            {context && plannedDateVectorProvided && !plannedDateVectorValid ? (
                <p
                    data-component={child("body_planned-date-error")}
                    role="alert"
                    className="mx-4 mt-4 rounded-[10px] bg-v3-burgundy-light px-3 py-2 text-[13px] font-semibold text-v3-burgundy"
                >
                    {PLANNED_DATE_ERROR_COPY}
                </p>
            ) : null}

            {screen === "loading" && (
                <StatusBody data-component={child("body")}>
                    <p data-component={child("body_loading")} className="text-sm text-v3-text-muted">{LOADING_COPY}</p>
                </StatusBody>
            )}

            {screen === "invalid" && (
                <StatusBody data-component={child("body")}>
                    <div data-component={child("body_invalid-center")} className="flex flex-col gap-2">
                        <div data-component={child("body_invalid-center_title")} className="text-lg font-bold text-v3-dark">
                            {INVALID_TITLE}
                        </div>
                        <p className="text-sm text-v3-text-muted">{INVALID_COPY}</p>
                    </div>
                </StatusBody>
            )}

            {screen === "phone" && (
                <PhoneStep
                    data-component={root}
                    phone={phone}
                    phoneError={phoneError}
                    phoneFieldError={phoneFieldError}
                    busy={busy}
                    onPhoneChange={onPhoneChange}
                    onSubmitPhone={onSubmitPhone}
                    fieldState={phoneState}
                />
            )}

            {screen === "service" && context && (
                <ServiceInfoStep
                    data-component={root}
                    context={context}
                    header={header}
                    busy={busy}
                    onBack={onBack}
                    onHeaderChange={onHeaderChange}
                    onDeliveryTypeChange={onDeliveryTypeChange}
                    onSaveHeader={onSaveHeader}
                    fieldState={headerState}
                />
            )}

            {screen === "overview" && context && (
                <OverviewStep
                    data-component={root}
                    context={context}
                    day={day}
                    draft={draft}
                    defaultDate={defaultDate}
                    lockedDays={lockedDays}
                    nextOpenDay={nextOpenDay}
                    isRecordFinalized={isRecordFinalized}
                    scheduleChangeBusy={scheduleChangeBusy}
                    onOpenDay={onOpenDay}
                    onOpenScheduleChangePreview={onOpenScheduleChangePreview}
                />
            )}

            {/* One element type per page kind and no key on pageIdx: the input pages stay mounted while the page index moves between them. */}
            {screen === "day" && (currentDayPage.confirmation ? (
                <ReviewStep
                    data-component={root}
                    context={context}
                    day={day}
                    pageIdx={pageIdx}
                    draft={draft}
                    editing={editing}
                    clientSignature={clientSignature}
                    busy={busy}
                    hasServiceDateMismatch={hasServiceDateMismatch}
                    defaultDate={defaultDate}
                    onBack={onBack}
                    onSignatureChange={onSignatureChange}
                    onOpenSubmitModal={onOpenSubmitModal}
                    onEditSection={onEditSection}
                />
            ) : (
                <DayPageStep
                    data-component={root}
                    context={context}
                    day={day}
                    pageIdx={pageIdx}
                    draft={draft}
                    editing={editing}
                    isRecordFinalized={isRecordFinalized}
                    scheduleChangeBusy={scheduleChangeBusy}
                    hasServiceDateMismatch={hasServiceDateMismatch}
                    defaultDate={defaultDate}
                    onBack={onBack}
                    onServiceDateChange={onServiceDateChange}
                    onOpenScheduleChangePreview={onOpenScheduleChangePreview}
                    onFieldChange={onFieldChange}
                    onToggleMulti={onToggleMulti}
                    onNextPage={onNextPage}
                    dateState={dateState}
                />
            ))}

            {screen === "done" && (
                <StatusBody data-component={child("body")}>
                    <div data-component={child("body_done-center")} className="flex flex-col items-center gap-3">
                        <span data-component={child("body_done-center_icon")} aria-hidden="true" className="text-5xl">✅</span>
                        <h2 data-component={child("body_done-center_title")} className="text-lg font-bold text-v3-dark">
                            {DONE_TITLE}
                        </h2>
                    </div>
                </StatusBody>
            )}
            {slots?.submitModal}
            {slots?.scheduleChangeModal}
            {slots?.serviceDateChangeModal}
            {slots?.errorNotification}
        </div>
    );
}
