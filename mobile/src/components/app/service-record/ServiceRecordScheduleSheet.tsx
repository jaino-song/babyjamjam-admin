"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import {
  createServiceDayPicker,
  revertServiceDayPicker,
  type ServiceDayPickerState,
} from "@babyjamjam/shared/utils/service-day-picker";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import {
  adminServiceRecordScheduleApi,
  type AdminServiceRecordScheduleApi,
} from "@/features/service-records/api/admin-service-record-schedule.api";
import { useBusinessDayCalendar } from "@/hooks/useBusinessDayCalendar";
import { serviceRecordQueryKeys } from "@/hooks/useServiceRecords";
import { t } from "@/lib/i18n/translations";
import { useLocale } from "@/providers/LocaleProvider";
import { cn } from "@/lib/utils";
import type { ServiceDayPolicy } from "@/lib/date/business-days";

import {
  buildMonthGrid,
  changeSchedulePolicy,
  classifyScheduleDay,
  initialScheduleMonth,
  isServiceDaySafe,
  monthKey,
  readScheduleEditorModel,
  scheduleCalendarYears,
  scheduleProgress,
  shiftMonth,
  toggleScheduleDay,
  weekdayOf,
  type ScheduleDayClass,
  type ScheduleEditorModel,
} from "./service-record-schedule-model";
import {
  describeBlockingReasons,
  describeScheduleSaveError,
  scheduleText,
} from "./service-record-schedule-messages";
import {
  sameScheduleSource,
  saveServiceRecordSchedule,
  sourceIdentityOf,
  type ScheduleSourceIdentity,
} from "./service-record-schedule-save";

const SOURCE_COMPONENT = "ServiceRecordScheduleSheet";

/** Reads of the overview that a concurrent change may tear; after this many the load error shows. */
const MAX_SNAPSHOT_ATTEMPTS = 3;

const SERVICE_DAY_FIELDS = [
  { key: "saturday", textKey: "clients.form.service-day-saturday" },
  { key: "sunday", textKey: "clients.form.service-day-sunday" },
  { key: "holiday", textKey: "clients.form.service-day-holiday" },
] as const;

const WEEKDAY_KEYS = ["weekday-0", "weekday-1", "weekday-2", "weekday-3", "weekday-4", "weekday-5", "weekday-6"] as const;

/** `min-h-11` keeps every date a 44px touch target; `min-w-0` lets the 7 columns shrink instead of overflowing. */
const MONTH_CELL_BASE =
  "relative flex min-h-11 min-w-0 flex-col items-center justify-center rounded-[10px] border text-[0.75rem] font-bold leading-none";

type Snapshot =
  | { kind: "ready"; model: ScheduleEditorModel; source: ScheduleSourceIdentity }
  | { kind: "blocked" }
  | { kind: "error" };

type Phase = "loading" | "ready" | "blocked" | "error";

interface SheetMessage {
  tone: "info" | "error";
  text: string;
}

export interface ServiceRecordScheduleSheetProps {
  "data-component": string;
  clientId: number;
  clientName: string;
  /** Closes the sheet without saving. */
  onClose: () => void;
  /** The schedule is stored; the parent closes the sheet and refreshes the client. */
  onSaved: (result: { sessionCount: number }) => void;
  /** Test seam: the draft API. */
  api?: AdminServiceRecordScheduleApi;
}

export function ServiceRecordScheduleSheet({
  "data-component": dataComponent,
  clientId,
  clientName,
  onClose,
  onSaved,
  api = adminServiceRecordScheduleApi,
}: ServiceRecordScheduleSheetProps) {
  const locale = useLocale();
  const queryClient = useQueryClient();
  const text = useCallback(
    (key: string, values?: Record<string, string | number>) => scheduleText(locale, key, values),
    [locale],
  );
  const part = (suffix: string) => `${dataComponent}_${suffix}`;

  const [phase, setPhase] = useState<Phase>("loading");
  const [reloadKey, setReloadKey] = useState(0);
  const [model, setModel] = useState<ScheduleEditorModel | null>(null);
  const [picker, setPicker] = useState<ServiceDayPickerState | null>(null);
  const [month, setMonth] = useState<[number, number]>([0, 0]);
  const [message, setMessage] = useState<SheetMessage | null>(null);
  const [saving, setSaving] = useState(false);
  const sourceRef = useRef<ScheduleSourceIdentity | null>(null);
  const savingRef = useRef(false);

  const {
    calendar: baseCalendar,
    ready: calendarReady,
    error: calendarError,
    retry: retryCalendar,
    refreshForSave,
  } = useBusinessDayCalendar({ extraYears: model ? scheduleCalendarYears(model) : [] });

  const fetchSnapshot = useCallback(async (): Promise<Snapshot> => {
    try {
      // The overview and the source identity are separate reads. Bracketing the overview with two
      // identity reads proves nothing changed in between; otherwise old dates would be paired with a
      // newer fingerprint and a save would silently overwrite the other admin's change.
      for (let attempt = 0; attempt < MAX_SNAPSHOT_ATTEMPTS; attempt += 1) {
        const before = await api.getDraft(clientId);
        if (!before.sourceFingerprint) return { kind: "error" };
        const overview = await api.getEditor(clientId);
        const after = await api.getDraft(clientId);
        if (!sameScheduleSource(sourceIdentityOf(before), after)) continue;
        const result = readScheduleEditorModel(overview);
        if (!result.ok) return { kind: "blocked" };
        return { kind: "ready", model: result.model, source: sourceIdentityOf(after) };
      }
      return { kind: "error" };
    } catch {
      return { kind: "error" };
    }
  }, [api, clientId]);

  /** Replaces everything the sheet shows with a fresh read: model, source identity, picker and month. */
  const applySnapshot = useCallback((snapshot: Snapshot) => {
    if (snapshot.kind !== "ready") {
      setPhase(snapshot.kind);
      return;
    }
    const next = createServiceDayPicker({
      startDate: snapshot.model.startDate,
      requiredCount: snapshot.model.requiredCount,
      initialDates: snapshot.model.initialDates,
      policy: snapshot.model.serviceDays,
    });
    sourceRef.current = snapshot.source;
    setModel(snapshot.model);
    setPicker(next);
    setMonth(initialScheduleMonth(snapshot.model, next));
    setPhase("ready");
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchSnapshot().then((snapshot) => {
      if (!cancelled) applySnapshot(snapshot);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchSnapshot, applySnapshot, reloadKey]);

  const retryLoad = () => {
    setPhase("loading");
    setReloadKey((key) => key + 1);
  };

  const pickerCalendar = useMemo(
    () => (picker ? baseCalendar.withServiceDays(picker.policy) : null),
    [baseCalendar, picker],
  );
  const progress = useMemo(
    () => (model && picker && pickerCalendar ? scheduleProgress(model, picker, pickerCalendar) : null),
    [model, picker, pickerCalendar],
  );

  const weekdayLabel = (iso: string) => text(WEEKDAY_KEYS[weekdayOf(iso)]);
  const shortDate = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}(${weekdayLabel(iso)})`;

  const handleDayClick = (iso: string) => {
    if (!model || !picker || !pickerCalendar || !calendarReady || savingRef.current) return;
    const { state, outcome } = toggleScheduleDay(model, picker, iso, pickerCalendar);
    if (outcome === "full") {
      setMessage({ tone: "info", text: text("notice-full", { count: model.requiredCount }) });
    } else if (outcome === "locked") {
      setMessage({ tone: "info", text: text("notice-locked") });
    } else if (outcome !== "not-selectable") {
      setPicker(state);
      setMessage(null);
    }
  };

  const handlePolicyChange = (key: keyof ServiceDayPolicy, checked: boolean) => {
    // Dropping dates needs the branch holiday calendar; before it is ready the classification is a guess.
    if (!model || !picker || !calendarReady || savingRef.current) return;
    const { state, dropped } = changeSchedulePolicy(
      model,
      picker,
      { ...picker.policy, [key]: checked },
      baseCalendar,
    );
    setPicker(state);
    setMessage(dropped.length > 0 ? { tone: "info", text: text("notice-dropped", { dates: dropped.map(shortDate).join(", ") }) } : null);
  };

  const handleRevert = () => {
    if (!picker || savingRef.current) return;
    setPicker(revertServiceDayPicker(picker));
    setMessage(null);
  };

  const handleSave = async () => {
    if (savingRef.current || !model || !picker) return;
    savingRef.current = true;
    setSaving(true);
    setMessage(null);
    try {
      const fresh = await refreshForSave();
      if (!fresh.ok) {
        setMessage({ tone: "error", text: text("calendar-refresh-failed") });
        return;
      }
      const freshProgress = scheduleProgress(model, picker, fresh.calendar.withServiceDays(picker.policy));
      if (!freshProgress.complete) {
        setMessage({ tone: "error", text: text("notice-incomplete") });
        return;
      }
      const source = sourceRef.current;
      if (!source) {
        setMessage({ tone: "error", text: text("save-failed") });
        return;
      }
      const result = await saveServiceRecordSchedule({
        api,
        clientId,
        source,
        schedule: { serviceDays: { ...picker.policy }, dates: [...picker.selected] },
      });
      if (result.kind === "saved") {
        void queryClient.invalidateQueries({ queryKey: serviceRecordQueryKeys.clientOverviews() });
        onSaved({ sessionCount: model.requiredCount });
        return;
      }
      if (result.kind === "source-changed") {
        applySnapshot(await fetchSnapshot());
        setMessage({ tone: "info", text: text("notice-reloaded") });
        return;
      }
      if (result.kind === "blocked") {
        setMessage({ tone: "error", text: describeBlockingReasons(locale, result.reasons) });
        return;
      }
      setMessage({ tone: "error", text: text(result.kind === "draft-in-use" ? "draft-in-use" : "draft-start-failed") });
    } catch (error) {
      setMessage({ tone: "error", text: describeScheduleSaveError(locale, error) });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const monthBounds = useMemo(() => {
    if (!model) return null;
    const years = scheduleCalendarYears(model);
    const first: [number, number] = [Number(model.startDate.slice(0, 4)), Number(model.startDate.slice(5, 7)) - 1];
    const last: [number, number] = [Math.max(...years), 11];
    return { first, last };
  }, [model]);

  const holidayFreeCalendar = baseCalendar;
  const orderOf = useMemo(
    () => new Map((picker?.selected ?? []).map((iso, index) => [iso, index + 1])),
    [picker?.selected],
  );

  const classOf = (iso: string): ScheduleDayClass =>
    model && picker && pickerCalendar ? classifyScheduleDay(model, picker, iso, pickerCalendar) : "unavailable";

  const renderDay = (iso: string) => {
    const dayClass = classOf(iso);
    const day = Number(iso.slice(8, 10));
    const weekday = weekdayOf(iso);
    const plainWeekday = weekday >= 1 && weekday <= 5 && isServiceDaySafe(holidayFreeCalendar, iso);
    const holidayTag = weekday >= 1 && weekday <= 5 && !isServiceDaySafe(holidayFreeCalendar, iso);
    const order = orderOf.get(iso);
    const selected = dayClass === "selected" || dayClass === "locked";
    const disabled = dayClass === "before-start" || dayClass === "unavailable" || dayClass === "fixed-unavailable"
      || !calendarReady || saving;
    const label = selected
      ? text(dayClass === "locked" ? "day-locked" : "day-selected", { date: shortDate(iso), order: order ?? 0 })
      : text("day-open", { date: shortDate(iso) });
    return (
      <button
        key={iso}
        type="button"
        data-slot="schedule-day"
        data-day-state={dayClass}
        aria-label={label}
        aria-pressed={selected}
        disabled={disabled}
        onClick={() => handleDayClick(iso)}
        className={cn(
          MONTH_CELL_BASE,
          "border-transparent bg-white text-v3-dark",
          dayClass === "before-start" && "border-v3-border bg-v3-dim-white text-v3-text-muted/60",
          (dayClass === "unavailable" || dayClass === "fixed-unavailable")
            && "border-v3-border text-v3-text-muted/70 bg-[repeating-linear-gradient(135deg,#fff_0_5px,hsl(214_20%_96%)_5px_10px)]",
          (dayClass === "available" || dayClass === "skipped") && "border-v3-border bg-white",
          dayClass === "skipped" && "border-dashed border-v3-orange text-v3-orange",
          selected && (plainWeekday ? "border-v3-primary bg-v3-primary text-white" : "border-v3-green bg-v3-green text-white"),
          dayClass === "locked" && "ring-2 ring-inset ring-white/40",
        )}
      >
        <span>{day}</span>
        {holidayTag ? <small className="mt-0.5 text-[0.53rem] font-extrabold leading-none">{text("holiday-tag")}</small> : null}
      </button>
    );
  };

  const complete = progress?.complete ?? false;
  const saveDisabled = saving || phase !== "ready" || !calendarReady || !complete;
  const closeDisabled = saving;
  const subtitle = model
    ? text("subtitle", { name: clientName, startDate: `${model.startDate}(${weekdayLabel(model.startDate)})` })
    : clientName;
  const grid = buildMonthGrid(month[0], month[1]);

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open && !closeDisabled) onClose();
      }}
    >
      <SheetContent
        side="bottom"
        overlayClassName="z-[200]"
        data-component={dataComponent}
        data-source-component={SOURCE_COMPONENT}
        className="z-[201] flex max-h-[94dvh] w-full min-w-0 flex-col gap-0 overflow-hidden rounded-t-[28px] bg-white p-0"
      >
        <div aria-hidden="true" data-slot="schedule-sheet-handle" className="mx-auto mt-3 h-1 w-9 shrink-0 rounded-full bg-v3-border" />
        <SheetHeader data-component={part("header")} className="gap-0.5 px-[22px] pb-2 pt-3 pr-16">
          <SheetTitle className="text-[1.25rem] font-bold text-v3-dark">{text("title")}</SheetTitle>
          <SheetDescription className="text-xs font-semibold text-v3-text-muted">{subtitle}</SheetDescription>
          <SheetClose asChild>
            <button
              type="button"
              aria-label={text("close")}
              disabled={closeDisabled}
              data-component={part("header_close")}
              className="absolute right-2 top-3 flex h-11 w-11 items-center justify-center rounded-xl text-v3-text-muted"
            >
              <X size={20} strokeWidth={2} />
            </button>
          </SheetClose>
        </SheetHeader>

        <div
          data-component={part("body")}
          className="grid min-h-0 min-w-0 flex-1 content-start gap-5 overflow-y-auto overflow-x-hidden px-4 pb-4"
        >
          {phase === "loading" ? (
            <div role="status" className="flex items-center justify-center gap-2 py-10 text-sm text-v3-text-muted">
              <Spinner size="sm" />
              {text("loading")}
            </div>
          ) : null}

          {phase === "error" ? (
            <div role="alert" className="grid justify-items-center gap-3 py-8 text-center text-sm text-v3-text-muted">
              <p>{text("load-error")}</p>
              <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={retryLoad}>
                {text("retry")}
              </Button>
            </div>
          ) : null}

          {phase === "blocked" ? (
            <p role="alert" className="py-8 text-center text-sm text-v3-text-muted">{text("projection-blocked")}</p>
          ) : null}

          {phase === "ready" && model && picker ? (
            <>
              <section data-component={part("body_section-service-days")} className="min-w-0">
                <h3 className="text-sm font-extrabold text-v3-dark">{text("section-service-days")}</h3>
                <p className="mt-1 text-xs font-semibold text-v3-text-muted">{text("service-days-help")}</p>
                <div role="group" aria-label={text("section-service-days")} className="mt-2 grid min-w-0 gap-2">
                  {SERVICE_DAY_FIELDS.map(({ key, textKey }) => (
                    <div
                      key={key}
                      data-component={part(`body_section-service-days_${key}`)}
                      className="flex min-h-12 min-w-0 items-center justify-between gap-3 rounded-[14px] border-[1.5px] border-v3-border bg-white px-4"
                    >
                      <Label htmlFor={`schedule-sheet-${key}`} className="cursor-pointer text-[0.82rem] font-bold text-v3-dark">
                        {t(locale, textKey)}
                      </Label>
                      <Switch
                        id={`schedule-sheet-${key}`}
                        checked={picker.policy[key]}
                        disabled={saving || !calendarReady}
                        onCheckedChange={(checked) => handlePolicyChange(key, checked)}
                      />
                    </div>
                  ))}
                </div>
              </section>

              <section data-component={part("body_section-calendar")} className="min-w-0">
                <h3 className="text-sm font-extrabold text-v3-dark">{text("section-calendar")}</h3>
                <p className="mt-1 text-xs font-semibold text-v3-text-muted">{text("calendar-help")}</p>

                <div className="mt-3 flex min-w-0 items-center justify-between gap-3 text-xs font-bold text-v3-dark">
                  <p data-component={part("body_section-calendar_count")}>
                    {text("session-count")} <span className="ml-1 rounded-[10px] bg-v3-dim-white px-2.5 py-1.5">{model.requiredCount}</span>
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={saving}
                    data-component={part("body_section-calendar_revert")}
                    className="min-h-11 rounded-xl px-3"
                    onClick={handleRevert}
                  >
                    {text("revert")}
                  </Button>
                </div>

                <p
                  data-component={part("body_section-calendar_progress")}
                  className={cn("py-1 text-[0.8rem] font-extrabold", complete ? "text-v3-green" : "text-v3-orange")}
                >
                  {`${progress?.selectedCount ?? 0}/${model.requiredCount}`}
                </p>

                {!calendarReady ? (
                  <div role="status" className="mt-2 flex items-center gap-2 text-xs text-v3-text-muted">
                    {calendarError ? (
                      <>
                        <span>{text("calendar-error")}</span>
                        <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={retryCalendar}>
                          {text("retry")}
                        </Button>
                      </>
                    ) : (
                      <>
                        <Spinner size="sm" />
                        <span>{text("calendar-loading")}</span>
                      </>
                    )}
                  </div>
                ) : null}

                <div className="mt-2 flex min-w-0 items-center justify-between">
                  <p className="text-sm font-extrabold text-v3-dark">
                    {text("month-title", { year: month[0], month: month[1] + 1 })}
                  </p>
                  <div data-component={part("body_section-calendar_month-nav")} className="flex gap-1.5">
                    <button
                      type="button"
                      aria-label={text("prev-month")}
                      disabled={!monthBounds || monthKey(month) <= monthKey(monthBounds.first)}
                      data-component={part("body_section-calendar_month-nav_prev")}
                      onClick={() => setMonth((current) => shiftMonth(current, -1))}
                      className="flex h-11 w-11 items-center justify-center rounded-[10px] border border-v3-border bg-white text-v3-dark disabled:opacity-35"
                    >
                      <ChevronLeft size={18} strokeWidth={2.2} />
                    </button>
                    <button
                      type="button"
                      aria-label={text("next-month")}
                      disabled={!monthBounds || monthKey(month) >= monthKey(monthBounds.last)}
                      data-component={part("body_section-calendar_month-nav_next")}
                      onClick={() => setMonth((current) => shiftMonth(current, 1))}
                      className="flex h-11 w-11 items-center justify-center rounded-[10px] border border-v3-border bg-white text-v3-dark disabled:opacity-35"
                    >
                      <ChevronRight size={18} strokeWidth={2.2} />
                    </button>
                  </div>
                </div>

                <div
                  data-component={part("body_section-calendar_grid")}
                  className="mt-2 grid w-full min-w-0 grid-cols-7 gap-1"
                >
                  {WEEKDAY_KEYS.map((key, index) => (
                    <div
                      key={key}
                      className={cn(
                        "min-w-0 py-1 text-center text-[0.66rem] font-extrabold text-v3-text-muted",
                        index === 0 && "text-v3-burgundy",
                        index === 6 && "text-v3-primary",
                      )}
                    >
                      {text(key)}
                    </div>
                  ))}
                  {Array.from({ length: grid.leadingBlanks }, (_, index) => (
                    <div key={`blank-${index}`} aria-hidden="true" className="min-w-0" />
                  ))}
                  {grid.dates.map(renderDay)}
                </div>

                <ul
                  data-component={part("body_section-calendar_legend")}
                  className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[0.69rem] font-bold text-v3-text-muted"
                >
                  <li><i className="mr-1 inline-block size-3 rounded bg-v3-primary align-[-2px]" />{text("legend-weekday")}</li>
                  <li><i className="mr-1 inline-block size-3 rounded bg-v3-green align-[-2px]" />{text("legend-extra")}</li>
                  <li><i className="mr-1 inline-block size-3 rounded border border-dashed border-v3-orange align-[-2px]" />{text("legend-skipped")}</li>
                  <li><i className="mr-1 inline-block size-3 rounded border border-v3-border align-[-2px]" />{text("legend-open")}</li>
                  <li><i className="mr-1 inline-block size-3 rounded border border-v3-border bg-v3-dim-white align-[-2px]" />{text("legend-unavailable")}</li>
                </ul>
              </section>
            </>
          ) : null}

          {message ? (
            <p
              role={message.tone === "error" ? "alert" : "status"}
              data-component={part("body_message")}
              className={cn(
                "whitespace-pre-line text-xs font-bold",
                message.tone === "error" ? "text-v3-burgundy" : "text-v3-text",
              )}
            >
              {message.text}
            </p>
          ) : null}
        </div>

        <SheetFooter
          data-component={part("footer")}
          className="mt-0 flex-row gap-2 border-t border-v3-border bg-white p-4"
        >
          <Button
            type="button"
            variant="outline"
            disabled={closeDisabled}
            data-component={part("footer_cancel")}
            className="h-11 min-w-0 flex-1"
            onClick={onClose}
          >
            {text("cancel")}
          </Button>
          <Button
            type="button"
            disabled={saveDisabled}
            data-component={part("footer_save")}
            className="h-11 min-w-0 flex-1"
            onClick={() => void handleSave()}
          >
            {saving ? (
              <>
                <Spinner size="sm" />
                {text("saving")}
              </>
            ) : (
              text("save")
            )}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
