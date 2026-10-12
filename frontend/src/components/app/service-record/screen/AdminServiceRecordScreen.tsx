"use client";

import {
    DAY_PAGES,
    getWizardProgress,
    resolvePlannedDates,
    type ServiceRecordWizardProps,
} from "@babyjamjam/service-record-ui";

import { ServiceRecordStepHeader } from "@/components/app/ui/service-record";

import { ADMIN_MODE, DayPageStep } from "./DayPageStep";
import { useHeaderFieldState } from "./headerFieldState";
import { PLANNED_DATE_ERROR_COPY, SCREEN_TITLE } from "./ids";
import { OverviewStep } from "./OverviewStep";
import { ReviewStep } from "./ReviewStep";
import { ServiceInfoStep } from "./ServiceInfoStep";

const SOURCE_COMPONENT = "AdminServiceRecordScreen";

/** `ReviewStep` requires an action; the admin wizard always passes one, so the shared wizard's fallback button (SRW:1024) is not built. */
const NO_SESSION_ACTION = <></>;

/**
 * The administrator service-record flow on the admin design system. It takes the
 * shared `ServiceRecordWizard`'s props and renders the screens the admin editor
 * reaches (SRW:677-1053 with `adminMode`): 기본정보 (`service`), `overview`, and the day
 * pages including the confirmation page (`day`). Each step renders its own body and
 * sticky action bar, so this root is the `min-h-dvh` column that holds them and owns
 * the header.
 *
 * Not built, because the admin editor never passes them (AdminWizard passes only
 * "overview" | "day" | "service"): `loading` (SRW:714), `invalid` (SRW:716-721),
 * `phone` (SRW:723-747) and `done` (SRW:1041-1046), and every public-only control
 * (service-date input, schedule change, resign notice, submit button fallback).
 */
export function AdminServiceRecordScreen({
    "data-component": root,
    screen,
    context,
    header,
    headerErrors,
    day,
    pageIdx,
    draft,
    editing,
    readOnly = false,
    changedSessionIndexes,
    clientSignature,
    busy,
    lockedDays,
    hasServiceDateMismatch,
    defaultDate,
    onBack,
    onHeaderChange,
    onDeliveryTypeChange,
    onSaveHeader,
    onOpenDay,
    onOpenServiceDateEditor,
    onFieldChange,
    onToggleMulti,
    onSignatureChange,
    onNextPage,
    onEditSection,
    slots,
}: ServiceRecordWizardProps) {
    const child = (suffix: string) => `${root}_${suffix}`;
    const currentDayPage = DAY_PAGES[pageIdx] ?? DAY_PAGES[0];
    const { plannedDateVectorProvided, plannedDateVectorValid } = resolvePlannedDates({
        context, day, adminMode: ADMIN_MODE, draft, defaultDate,
    });
    // The 기본정보 fields' state outlives the step (SRW:522-526, :534), so it lives here.
    const headerState = useHeaderFieldState(header);
    const progress = getWizardProgress(screen, pageIdx);

    // SRW:683-688 for the reachable screens.
    const crumbs = (
        <>
            {screen === "service" && <>2단계 · <b>서비스 기본정보</b></>}
            {screen === "overview" && <>3단계 · <b>일자별 기록</b></>}
            {screen === "day" && <><b>{day}회차</b> · {currentDayPage.title} ({pageIdx + 1}/{DAY_PAGES.length})</>}
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
                meta={slots?.provider?.({
                    "data-component": child("top-bar_meta_provider-name"),
                    providerName: context?.org?.name,
                })}
                crumbs={crumbs}
                progress={progress / 100}
            />
            {/* SRW:695 - AdminWizard passes none today; rendered for parity. */}
            {slots?.adminToolbar ? (
                <div
                    data-component={child("top-bar_admin-toolbar")}
                    data-slot="admin-toolbar"
                    className="px-[calc(16px*var(--glint-ui-scale,1))] pt-[calc(8px*var(--glint-ui-scale,1))] sm:px-[calc(24px*var(--glint-ui-scale,1))]"
                >
                    {slots.adminToolbar}
                </div>
            ) : null}
            {/* SRW:703-707 - on any screen. */}
            {context && plannedDateVectorProvided && !plannedDateVectorValid ? (
                <p
                    data-component={child("body_planned-date-error")}
                    role="alert"
                    className="mx-[calc(16px*var(--glint-ui-scale,1))] mt-[calc(16px*var(--glint-ui-scale,1))] rounded-[10px] bg-v3-burgundy-light px-[calc(12px*var(--glint-ui-scale,1))] py-[calc(8px*var(--glint-ui-scale,1))] text-[calc(13px*var(--glint-ui-scale,1))] font-semibold text-v3-burgundy sm:mx-[calc(24px*var(--glint-ui-scale,1))]"
                >
                    {PLANNED_DATE_ERROR_COPY}
                </p>
            ) : null}

            {screen === "service" && context && (
                <ServiceInfoStep
                    data-component={root}
                    context={context}
                    header={header}
                    headerErrors={headerErrors}
                    readOnly={readOnly}
                    busy={busy}
                    onBack={onBack}
                    onHeaderChange={onHeaderChange}
                    onDeliveryTypeChange={onDeliveryTypeChange}
                    onSaveHeader={onSaveHeader}
                    fieldState={headerState}
                    adminHeaderAction={slots?.adminHeaderAction}
                />
            )}

            {screen === "overview" && context && (
                <OverviewStep
                    data-component={root}
                    context={context}
                    day={day}
                    draft={draft}
                    readOnly={readOnly}
                    changedSessionIndexes={changedSessionIndexes}
                    defaultDate={defaultDate}
                    lockedDays={lockedDays}
                    onOpenDay={onOpenDay}
                    serviceDateDisplay={slots?.serviceDateDisplay}
                    overviewSupplemental={slots?.overviewSupplemental}
                    adminConfirmAction={slots?.adminConfirmAction}
                    adminCommitActions={slots?.adminCommitActions}
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
                    readOnly={readOnly}
                    clientSignature={clientSignature}
                    busy={busy}
                    hasServiceDateMismatch={hasServiceDateMismatch}
                    defaultDate={defaultDate}
                    onBack={onBack}
                    onSignatureChange={onSignatureChange}
                    onOpenServiceDateEditor={onOpenServiceDateEditor}
                    onEditSection={onEditSection}
                    serviceDateDisplay={slots?.serviceDateDisplay}
                    serviceDateEditor={slots?.serviceDateEditor}
                    signature={slots?.signature}
                    adminSessionAction={slots?.adminSessionAction ?? NO_SESSION_ACTION}
                />
            ) : (
                <DayPageStep
                    data-component={root}
                    context={context}
                    day={day}
                    pageIdx={pageIdx}
                    draft={draft}
                    editing={editing}
                    readOnly={readOnly}
                    busy={busy}
                    hasServiceDateMismatch={hasServiceDateMismatch}
                    defaultDate={defaultDate}
                    onBack={onBack}
                    onFieldChange={onFieldChange}
                    onToggleMulti={onToggleMulti}
                    onNextPage={onNextPage}
                    onOpenServiceDateEditor={onOpenServiceDateEditor}
                    serviceDateDisplay={slots?.serviceDateDisplay}
                    serviceDateEditor={slots?.serviceDateEditor}
                />
            ))}

            {/* SRW:1048-1051 */}
            {slots?.submitModal}
            {slots?.scheduleChangeModal}
            {slots?.serviceDateChangeModal}
            {slots?.errorNotification}
        </div>
    );
}
