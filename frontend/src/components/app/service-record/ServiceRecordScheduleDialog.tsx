"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { FormDialogShell } from "@/components/app/ui/FormDialogShell";
import { FormSection } from "@/components/app/ui/form-section";
import { CalendarLoadNotice } from "@/components/app/holidays/CalendarLoadNotice";
import { useBusinessDayCalendar } from "@/hooks/useBusinessDayCalendar";
import { useToast } from "@/hooks/use-toast";
import { adminServiceRecordEditApi } from "@/features/service-records/api/admin-service-record-edit.api";
import {
    AdminServiceRecordEditApiError,
    type AdminServiceRecordEditState,
} from "@/features/service-records/types";
import { readServiceRecordScheduleBlockingReasons } from "@/features/service-records/types/admin-edit";
import { publishServiceRecordRevisionSync } from "@/features/service-records/revision-sync";
import type { KrBusinessDayCalendar, ServiceDayPolicy } from "@/lib/date/business-days";
import { t } from "@/lib/i18n/translations";
import { cn } from "@/lib/utils";
import { useLocale } from "@/providers/LocaleProvider";

import { ServiceDayCalendar, type ServiceDayCell } from "./ServiceDayCalendar";
import {
    createIdempotencyKey,
    parseOverview,
    readBlockingOperation,
    sameSource,
} from "./ServiceRecordAdminWizard";
import {
    classifyScheduleDay,
    createScheduleModel,
    deriveScheduleSource,
    revertSchedule,
    scheduleBlockingReasonsMessage,
    scheduleCalendar,
    scheduleFailureMessage,
    scheduleProgress,
    setSchedulePolicy,
    toggleScheduleDay,
    type ScheduleModel,
    type ScheduleSource,
} from "./service-record-schedule-model";

const DEFAULT_DATA_COMPONENT = "desktop_clients_service-record-schedule-dialog";
const SOURCE_COMPONENT = "ServiceRecordScheduleDialog";
const TEXT = "clients.service-record-schedule";
const NOTICE_MS = 3500;
const MAX_LOAD_ATTEMPTS = 3;

type ServiceDayKey = keyof ServiceDayPolicy;

const SERVICE_DAY_KEYS: readonly ServiceDayKey[] = ["saturday", "sunday", "holiday"];

/**
 * The one 409 that means "someone wrote the same target meanwhile", so the whole save can be
 * redone from a fresh read. Backend (admin-service-record-edit.service.ts): `throwConflictWithLatest`
 * (:1496), the repository write conflict (:932) and a moved source fingerprint (:824, :1001).
 * REQUEST_NOT_PENDING (:811, :969), REQUEST_STALE (:1017) and a bare REQUEST_CONFLICT (:542, :993,
 * :1025, :1072) mean the draft itself is gone or stale: retrying would confirm twice. A missing
 * or unknown code is not retried either. The draft proxies keep this registered `code`.
 */
const WRITE_TARGET_CHANGED_CODE = "SERVICE_RECORD_WRITE_TARGET_CHANGED";

function isRetryableWriteTargetConflict(failure: unknown): boolean {
    if (!(failure instanceof AdminServiceRecordEditApiError) || failure.status !== 409) return false;
    const body = failure.body;
    const code = typeof body === "object" && body !== null ? (body as { code?: unknown }).code : undefined;
    return code === WRITE_TARGET_CHANGED_CODE
        && !readBlockingOperation(body)
        && readServiceRecordScheduleBlockingReasons(body).length === 0
        && failure.scheduleCode === null;
}

type LoadState =
    | { kind: "loading" }
    | { kind: "error"; reason: "load-failed" | "projection-blocked" | "no-sessions" }
    | { kind: "ready" };

interface MonthView {
    year: number;
    month: number;
}

type CommitOutcome =
    | { kind: "saved"; caseId: string; caseVersion: number }
    | { kind: "reload" }
    /** A version conflict on confirm: worth one more try from the top. */
    | { kind: "retry" }
    | { kind: "error"; message: string };

export interface ServiceRecordScheduleDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    clientId: number;
    clientName: string;
    /** Runs after a successful save, once the dialog has been closed: refresh whatever shows the client. */
    onSaved: () => void | Promise<void>;
    "data-component"?: string;
}

function monthOf(iso: string): MonthView {
    return { year: Number(iso.slice(0, 4)), month: Number(iso.slice(5, 7)) };
}

function monthIndex(view: MonthView): number {
    return view.year * 12 + (view.month - 1);
}

function shiftMonth(view: MonthView, delta: number): MonthView {
    const index = monthIndex(view) + delta;
    return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

function isSupportedYear(calendar: KrBusinessDayCalendar, year: number): boolean {
    try {
        calendar.assertSupportedYear(year);
        return true;
    } catch {
        return false;
    }
}

/** A public holiday on a weekday; weekends and unsupported years never read as one. */
function isWeekdayHoliday(base: KrBusinessDayCalendar, iso: string): boolean {
    const weekday = new Date(`${iso}T00:00:00Z`).getUTCDay();
    if (weekday === 0 || weekday === 6) return false;
    try {
        return !base.isBusinessDay(iso);
    } catch {
        return false;
    }
}

function datesEqual(left: readonly string[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((date, index) => date === right[index]);
}

function formatStartDate(iso: string, locale: "ko" | "en"): string {
    const weekday = new Intl.DateTimeFormat(locale === "en" ? "en-US" : "ko-KR", { weekday: "short", timeZone: "UTC" })
        .format(new Date(`${iso}T00:00:00Z`));
    return `${iso}(${weekday})`;
}

/**
 * "제공기록지 일정 변경": the admin turns the client's Saturday / Sunday / holiday
 * service on or off and picks exactly one service date per session. Nothing is
 * stored until 저장; it then goes through the same draft → preview → confirm
 * sequence the record editor uses, so the server judges the whole schedule.
 */
export function ServiceRecordScheduleDialog({
    open,
    onOpenChange,
    clientId,
    clientName,
    onSaved,
    "data-component": dataComponent = DEFAULT_DATA_COMPONENT,
}: ServiceRecordScheduleDialogProps) {
    const locale = useLocale();
    const { toast } = useToast();
    const [load, setLoad] = useState<LoadState>({ kind: "loading" });
    const [loadKey, setLoadKey] = useState(0);
    const [source, setSource] = useState<ScheduleSource | null>(null);
    const [model, setModel] = useState<ScheduleModel | null>(null);
    const [viewMonth, setViewMonth] = useState<MonthView | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const savingRef = useRef(false);
    const identityRef = useRef<AdminServiceRecordEditState | null>(null);
    const reloadNoticeRef = useRef<string | null>(null);
    const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const extraYears = useMemo(() => {
        if (!source) return undefined;
        const years = new Set<number>();
        for (const iso of [source.startDate, ...source.initialDates]) years.add(Number(iso.slice(0, 4)));
        years.add(Math.max(...years) + 1);
        return [...years];
    }, [source]);
    const { calendar: baseCalendar, ready: calendarReady, error: calendarError, retry: retryCalendar, refreshForSave } =
        useBusinessDayCalendar({ extraYears });

    const showNotice = useCallback((message: string) => {
        setNotice(message);
        if (noticeTimer.current) clearTimeout(noticeTimer.current);
        noticeTimer.current = setTimeout(() => setNotice(null), NOTICE_MS);
    }, []);
    useEffect(() => () => {
        if (noticeTimer.current) clearTimeout(noticeTimer.current);
    }, []);

    // The overview is read between two draft reads: a case that changed in between would pair
    // this screen with a source identity it does not match, so that attempt is thrown away.
    useEffect(() => {
        const controller = new AbortController();
        let alive = true;
        const fail = (reason: "load-failed" | "projection-blocked" | "no-sessions") => {
            if (alive) setLoad({ kind: "error", reason });
        };
        void (async () => {
            try {
                for (let attempt = 0; attempt < MAX_LOAD_ATTEMPTS; attempt += 1) {
                    const before = await adminServiceRecordEditApi.getDraft(String(clientId));
                    const response = await fetch(`/api/admin/service-records/client/${encodeURIComponent(String(clientId))}/editor`, {
                        cache: "no-store",
                        signal: controller.signal,
                    });
                    if (!alive) return;
                    if (!response.ok) return fail("load-failed");
                    const overview = parseOverview(await response.json().catch(() => null));
                    if (!overview) return fail("load-failed");
                    const after = await adminServiceRecordEditApi.getDraft(String(clientId));
                    if (!alive) return;
                    if (!sameSource(before, after)) continue;

                    const derived = deriveScheduleSource(overview);
                    if (!derived.ok) return fail(derived.reason);
                    const nextModel = createScheduleModel(derived.source);
                    const firstUnwritten = nextModel.picker.selected.find((iso) => !derived.source.writtenDates.includes(iso));
                    identityRef.current = after;
                    setSource(derived.source);
                    setModel(nextModel);
                    setViewMonth(monthOf(firstUnwritten ?? derived.source.startDate));
                    setLoad({ kind: "ready" });
                    if (reloadNoticeRef.current) {
                        showNotice(reloadNoticeRef.current);
                        reloadNoticeRef.current = null;
                    }
                    return;
                }
                fail("load-failed");
            } catch {
                fail("load-failed");
            }
        })();
        return () => {
            alive = false;
            controller.abort();
        };
    }, [clientId, loadKey, showNotice]);

    const reload = useCallback((message: string | null) => {
        reloadNoticeRef.current = message;
        setLoad({ kind: "loading" });
        setModel(null);
        setSource(null);
        setLoadKey((current) => current + 1);
    }, []);

    const activeCalendar = useMemo(
        () => (model ? scheduleCalendar(model, baseCalendar) : null),
        [model, baseCalendar],
    );
    const progress = useMemo(
        () => (model && activeCalendar ? scheduleProgress(model, activeCalendar) : null),
        [model, activeCalendar],
    );
    const interactive = load.kind === "ready" && model !== null && calendarReady && !saving;
    const canSave = interactive && progress?.complete === true;

    const describeDay = (iso: string): ServiceDayCell => {
        if (!model || !activeCalendar) return { state: "unavailable", order: null, extra: false, holiday: false };
        const state = classifyScheduleDay(model, iso, activeCalendar);
        const weekday = new Date(`${iso}T00:00:00Z`).getUTCDay();
        const holiday = isWeekdayHoliday(baseCalendar, iso);
        const order = state === "selected" || state === "fixed" ? model.picker.selected.indexOf(iso) + 1 : null;
        return { state, order, extra: weekday === 0 || weekday === 6 || holiday, holiday };
    };

    const handleSelectDay = (iso: string) => {
        if (!interactive || !model || !activeCalendar) return;
        const result = toggleScheduleDay(model, iso, activeCalendar);
        if (result.outcome === "fixed") {
            showNotice(t(locale, `${TEXT}.notice-written`));
            return;
        }
        if (result.outcome === "full") {
            showNotice(t(locale, `${TEXT}.notice-full`).replace("{count}", String(model.picker.requiredCount)));
            return;
        }
        if (result.model !== model) {
            setError(null);
            setModel(result.model);
        }
    };

    const handleServiceDayToggle = (key: ServiceDayKey, checked: boolean) => {
        if (!interactive || !model) return;
        const result = setSchedulePolicy(model, { ...model.picker.policy, [key]: checked }, baseCalendar);
        setError(null);
        setModel(result.model);
        if (result.dropped.length > 0) {
            const dates = result.dropped.map((iso) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`).join(", ");
            showNotice(t(locale, `${TEXT}.notice-dropped`).replace("{dates}", dates));
        }
    };

    const handleRevert = () => {
        if (!interactive || !model) return;
        setError(null);
        setNotice(null);
        setModel(revertSchedule(model));
    };

    /** Steps 2-5 of the save: guard the source, draft, preview, confirm. A draft started here never outlives a failure. */
    const commit = async (
        dates: string[],
        policy: ServiceDayPolicy,
        identity: AdminServiceRecordEditState,
        isRetry: boolean,
    ): Promise<CommitOutcome> => {
        const id = String(clientId);
        let prepared: { id: string; version: number } | null = null;
        let confirming = false;
        const discardPrepared = async () => {
            const draft = prepared;
            prepared = null;
            if (draft) await adminServiceRecordEditApi.discardDraft(draft.id, draft.version).catch(() => undefined);
        };
        try {
            const existing = await adminServiceRecordEditApi.getDraft(id);
            if (!sameSource(identity, existing)) return { kind: "reload" };
            // A draft left by an earlier session must not leak into this one.
            if (existing.draft?.status === "ACTIVE") {
                await adminServiceRecordEditApi.discardDraft(existing.draft.id, existing.draft.draftVersion);
            }
            const started = await adminServiceRecordEditApi.startDraft(id);
            const draft = started.draft;
            if (!draft || draft.status !== "ACTIVE") {
                return { kind: "error", message: t(locale, `${TEXT}.errors.generic`) };
            }
            // Not ours (another session got there first): never update, preview, confirm or discard it.
            if (Object.keys(draft.changes).length > 0) {
                return { kind: "error", message: t(locale, `${TEXT}.errors.draft-in-use`) };
            }
            if (!sameSource(identity, started) || started.sourceChanged
                || draft.sourceFingerprint !== identity.sourceFingerprint
                || draft.sourceCaseVersion !== identity.sourceCaseVersion) {
                return { kind: "reload" };
            }
            prepared = { id: draft.id, version: draft.draftVersion };

            const updated = await adminServiceRecordEditApi.updateDraft(
                draft.id,
                draft.draftVersion,
                {},
                undefined,
                { serviceDays: { ...policy }, dates },
            );
            if (!updated.draft || updated.draft.status !== "ACTIVE" || updated.draft.id !== draft.id) {
                throw new Error("The schedule draft was not kept");
            }
            prepared = { id: updated.draft.id, version: updated.draft.draftVersion };

            const preview = await adminServiceRecordEditApi.previewDraft(prepared.id, prepared.version);
            if (preview.draftId !== prepared.id || preview.draftVersion !== prepared.version) {
                await discardPrepared();
                return { kind: "reload" };
            }
            if (preview.blockingReasons.length > 0) {
                await discardPrepared();
                return { kind: "error", message: scheduleBlockingReasonsMessage(locale, preview.blockingReasons) };
            }
            // Nobody reviews a preview here, so check that the server planned exactly the dates that were chosen.
            if (!datesEqual(preview.after.sessions.map((session) => session.serviceDate.slice(0, 10)), dates)) {
                await discardPrepared();
                return { kind: "error", message: t(locale, `${TEXT}.errors.preview-mismatch`) };
            }

            confirming = true;
            const confirmed = await adminServiceRecordEditApi.confirmDraft(
                prepared.id,
                prepared.version,
                preview.previewId,
                createIdempotencyKey(),
            );
            prepared = null;
            return { kind: "saved", caseId: confirmed.caseId, caseVersion: confirmed.caseVersion };
        } catch (failure) {
            await discardPrepared();
            // Only a concurrent write to the same target is retried (once). Every other 409 answers
            // the request itself and is shown as it is.
            if (confirming && !isRetry && isRetryableWriteTargetConflict(failure)) {
                return { kind: "retry" };
            }
            return { kind: "error", message: scheduleFailureMessage(locale, failure) };
        }
    };

    const handleSave = async () => {
        if (!model || !canSave || savingRef.current) return;
        savingRef.current = true;
        setSaving(true);
        setError(null);
        try {
            const identity = identityRef.current;
            if (!identity) {
                setError(t(locale, `${TEXT}.errors.generic`));
                return;
            }
            // Step 1: the holiday data may have moved since the dialog opened.
            const fresh = await refreshForSave();
            if (!fresh.ok) {
                setError(t(locale, `${TEXT}.errors.calendar-unavailable`));
                return;
            }
            if (!scheduleProgress(model, scheduleCalendar(model, fresh.calendar)).complete) {
                setError(t(locale, `${TEXT}.errors.no-longer-complete`));
                return;
            }

            const dates = [...model.picker.selected];
            const policy = { ...model.picker.policy };
            let outcome = await commit(dates, policy, identity, false);
            if (outcome.kind === "retry") outcome = await commit(dates, policy, identity, true);

            if (outcome.kind === "reload") {
                reload(t(locale, `${TEXT}.reloaded`));
                return;
            }
            if (outcome.kind === "retry") {
                setError(t(locale, `${TEXT}.errors.conflict`));
                return;
            }
            if (outcome.kind === "error") {
                setError(outcome.message);
                return;
            }
            publishServiceRecordRevisionSync({ caseId: outcome.caseId, caseVersion: outcome.caseVersion });
            toast({
                variant: "success",
                description: t(locale, `${TEXT}.success`).replace("{count}", String(model.picker.requiredCount)),
            });
            onOpenChange(false);
            await onSaved();
        } catch {
            setError(t(locale, `${TEXT}.errors.generic`));
        } finally {
            savingRef.current = false;
            setSaving(false);
        }
    };

    const handleOpenChange = (next: boolean) => {
        if (!next && savingRef.current) return;
        onOpenChange(next);
    };

    const startMonth = source ? monthOf(source.startDate) : null;
    const canGoPrevious = Boolean(viewMonth && startMonth && monthIndex(viewMonth) > monthIndex(startMonth));
    const canGoNext = Boolean(viewMonth && isSupportedYear(baseCalendar, shiftMonth(viewMonth, 1).year));
    const content = `${dataComponent}_content`;
    const serviceDayLabels: Record<ServiceDayKey, string> = {
        saturday: t(locale, `${TEXT}.saturday`),
        sunday: t(locale, `${TEXT}.sunday`),
        holiday: t(locale, `${TEXT}.holiday`),
    };

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <FormDialogShell
                data-component={dataComponent}
                description={t(locale, `${TEXT}.calendar-description`)}
                title={(
                    <>
                        {t(locale, `${TEXT}.title`)}
                        {source ? (
                            <span className="mt-0.5 block text-xs font-semibold text-v3-text-muted">
                                {t(locale, `${TEXT}.subtitle`)
                                    .replace("{name}", clientName)
                                    .replace("{startDate}", formatStartDate(source.startDate, locale))}
                            </span>
                        ) : null}
                    </>
                )}
                footer={(
                    <div className="ml-auto flex w-full flex-col-reverse gap-2 sm:w-[300px] sm:flex-row sm:justify-end">
                        <Button
                            type="button"
                            variant="neutral"
                            size="sm"
                            className="w-full sm:flex-1"
                            data-component={`${dataComponent}_actions_cancel`}
                            disabled={saving}
                            onClick={() => handleOpenChange(false)}
                        >
                            {t(locale, "common.cancel")}
                        </Button>
                        <Button
                            type="button"
                            variant="positive"
                            size="sm"
                            className="w-full sm:flex-1"
                            data-component={`${dataComponent}_actions_save`}
                            disabled={!canSave}
                            aria-busy={saving || undefined}
                            onClick={() => void handleSave()}
                        >
                            {saving ? <Spinner size="sm" aria-label={t(locale, `${TEXT}.saving`)} /> : t(locale, "common.save")}
                        </Button>
                    </div>
                )}
            >
                {load.kind === "loading" ? (
                    <p
                        data-component={`${content}_loading`}
                        role="status"
                        className="text-sm font-semibold text-v3-text-muted"
                    >
                        {t(locale, `${TEXT}.loading`)}
                    </p>
                ) : null}

                {load.kind === "error" ? (
                    <Alert variant="destructive" data-component={`${content}_load-error`}>
                        <AlertDescription className="flex flex-col items-start gap-2">
                            <span>{t(locale, `${TEXT}.errors.${load.reason}`)}</span>
                            {load.reason === "load-failed" ? (
                                <Button
                                    type="button"
                                    size="sm"
                                    variant="neutral"
                                    data-component={`${content}_load-error_retry`}
                                    onClick={() => reload(null)}
                                >
                                    {t(locale, `${TEXT}.retry`)}
                                </Button>
                            ) : null}
                        </AlertDescription>
                    </Alert>
                ) : null}

                {error ? (
                    <Alert variant="destructive" data-component={`${content}_error`}>
                        <AlertDescription>{error}</AlertDescription>
                    </Alert>
                ) : null}

                {load.kind === "ready" && model && progress ? (
                    <div data-component={`${content}_form`} data-source-component={SOURCE_COMPONENT} className="flex flex-col gap-5">
                        <FormSection
                            data-component={`${content}_section-service-days`}
                            title={t(locale, `${TEXT}.service-days-title`)}
                            description={t(locale, `${TEXT}.service-days-description`)}
                        >
                            <div
                                data-component={`${content}_section-service-days_options`}
                                className="flex flex-col gap-2"
                            >
                                {SERVICE_DAY_KEYS.map((key) => {
                                    const checked = model.picker.policy[key];
                                    return (
                                        <div
                                            key={key}
                                            data-component={`${content}_section-service-days_options_${key}`}
                                            className={cn(
                                                "flex min-h-11 items-center justify-between gap-3 rounded-[11px] border-[1.35px] border-v3-border bg-white py-2 pl-3.5 pr-2.5",
                                                checked && "border-v3-primary/35",
                                            )}
                                        >
                                            <span className="text-[13px] font-bold text-v3-dark">{serviceDayLabels[key]}</span>
                                            <Switch
                                                data-component={`${content}_section-service-days_options_${key}_switch`}
                                                checked={checked}
                                                disabled={!interactive}
                                                aria-label={t(locale, `${TEXT}.service-days-switch`).replace("{label}", serviceDayLabels[key])}
                                                onCheckedChange={(next) => handleServiceDayToggle(key, next)}
                                            />
                                        </div>
                                    );
                                })}
                            </div>
                        </FormSection>

                        <FormSection
                            data-component={`${content}_section-calendar`}
                            title={t(locale, `${TEXT}.calendar-title`)}
                            description={t(locale, `${TEXT}.calendar-description`)}
                        >
                            <div className="flex flex-col gap-3">
                                <div
                                    data-component={`${content}_section-calendar_controls`}
                                    className="flex flex-wrap items-center gap-2.5 text-xs font-bold text-v3-dark"
                                >
                                    <span data-component={`${content}_section-calendar_controls_count`} className="flex items-center gap-2">
                                        {t(locale, `${TEXT}.session-count`)}
                                        <span className="inline-flex h-[34px] items-center rounded-[10px] bg-v3-dim-white px-2.5">
                                            {progress.requiredCount}
                                        </span>
                                    </span>
                                    <Button
                                        type="button"
                                        variant="neutral"
                                        size="sm"
                                        className="ml-auto h-[34px] rounded-[10px] text-xs"
                                        data-component={`${content}_section-calendar_controls_revert`}
                                        disabled={!interactive}
                                        onClick={handleRevert}
                                    >
                                        {t(locale, `${TEXT}.revert`)}
                                    </Button>
                                </div>

                                <p
                                    data-component={`${content}_section-calendar_progress`}
                                    aria-live="polite"
                                    className={cn(
                                        "text-[12.5px] font-extrabold",
                                        progress.complete ? "text-v3-green" : "text-v3-orange",
                                    )}
                                >
                                    {progress.selectedCount}/{progress.requiredCount}
                                </p>

                                <CalendarLoadNotice
                                    error={calendarError}
                                    onRetry={retryCalendar}
                                    loading={!calendarReady && !calendarError}
                                    dataComponent={`${content}_section-calendar_calendar-load-notice`}
                                />

                                {notice ? (
                                    <p
                                        data-component={`${content}_section-calendar_notice`}
                                        role="status"
                                        className="text-xs font-bold text-v3-orange"
                                    >
                                        {notice}
                                    </p>
                                ) : null}

                                {viewMonth ? (
                                    <ServiceDayCalendar
                                        data-component={`${content}_section-calendar_month`}
                                        year={viewMonth.year}
                                        month={viewMonth.month}
                                        canGoPrevious={canGoPrevious}
                                        canGoNext={canGoNext}
                                        onPrevious={() => setViewMonth((current) => (current ? shiftMonth(current, -1) : current))}
                                        onNext={() => setViewMonth((current) => (current ? shiftMonth(current, 1) : current))}
                                        describeDay={describeDay}
                                        onSelectDay={handleSelectDay}
                                    />
                                ) : null}
                            </div>
                        </FormSection>
                    </div>
                ) : null}
            </FormDialogShell>
        </Dialog>
    );
}
